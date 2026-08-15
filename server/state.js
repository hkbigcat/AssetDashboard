import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  formatDistanceRange,
  parseJsonParsedPayload,
  parseJsonRawPayload,
  rssiToDistance,
} from './parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const assetsConfig = JSON.parse(
  readFileSync(join(__dirname, 'config', 'assets.json'), 'utf-8')
);
const demoAssets = JSON.parse(
  readFileSync(join(__dirname, 'config', 'demo-assets.json'), 'utf-8')
);

const gateway = assetsConfig.assets.find((a) => a.sensor === 'Gateway');
const pirSensor = assetsConfig.assets.find((a) => a.sensor === 'PIR');
const beacons = assetsConfig.assets.filter((a) => a.sensor === 'Beacon');

const MOTION_HOLD_MS = 120_000;

const sensorState = {
  gateway: {
    mac: gateway?.mac_address,
    location: gateway?.location || 'East Wing - Room 101',
    connected: false,
    lastSeen: null,
    seq: null,
  },
  pir: {
    mac: pirSensor?.mac_address?.toLowerCase(),
    location: pirSensor?.location || gateway?.location,
    motion: false,
    motionDetectedAt: null,
    temperature: null,
    humidity: null,
    battery: null,
    rssi: null,
    lastSeen: null,
  },
  beacons: {},
};

for (const beacon of beacons) {
  sensorState.beacons[beacon.mac_address] = {
    mac: beacon.mac_address,
    asset: beacon.asset,
    location: beacon.location || gateway?.location,
    icon: beacon.icon || 'asset',
    rssi: null,
    tamper: false,
    battery: null,
    distance: null,
    distanceRange: null,
    txPower: -59,
    lastSeen: null,
    live: true,
  };
}

let mqttConnected = false;
let lastMqttMessage = null;
let lastMessageFormat = null;
let lastPirBatchStats = null;
let mqttBrokerInfo = {
  broker: 'localhost',
  port: 1883,
  url: 'mqtt://localhost:1883',
  topics: ['/gw/#', 'gw/#'],
};

/** @type {Map<string, { id: string, name: string, description: string, location: string, lastSeen: string }>} */
const rfidAssets = new Map();
let lastRfidUpload = null;

const clients = new Set();

export function setMqttBrokerInfo(info) {
  mqttBrokerInfo = { ...mqttBrokerInfo, ...info };
}

export function getMqttStatus() {
  return {
    connected: mqttConnected,
    broker: mqttBrokerInfo.broker,
    port: mqttBrokerInfo.port,
    url: mqttBrokerInfo.url,
    topics: mqttBrokerInfo.topics,
    lastMessage: lastMqttMessage,
    format: lastMessageFormat,
    motionCapable: lastMessageFormat === 'json-raw',
    pirStats: lastPirBatchStats,
  };
}

export function getPirDebug() {
  return {
    pirMac: sensorState.pir.mac,
    motion: isMotionActive(),
    motionDetectedAt: sensorState.pir.motionDetectedAt,
    motionHoldMs: MOTION_HOLD_MS,
    lastMessageFormat,
    motionCapable: lastMessageFormat === 'json-raw',
    lastPirBatchStats,
    pir: sensorState.pir,
  };
}

export function addClient(ws) {
  clients.add(ws);
}

export function removeClient(ws) {
  clients.delete(ws);
}

export function broadcast(data) {
  const message = JSON.stringify(data);
  for (const client of clients) {
    if (client.readyState === 1) {
      client.send(message);
    }
  }
}

function isMotionActive() {
  if (!sensorState.pir.motionDetectedAt) return false;
  return Date.now() - sensorState.pir.motionDetectedAt < MOTION_HOLD_MS;
}

function applyPirMotion(detected) {
  if (detected) {
    sensorState.pir.motion = true;
    sensorState.pir.motionDetectedAt = Date.now();
  } else if (!isMotionActive()) {
    sensorState.pir.motion = false;
  }
}

export function processReading(reading, { deferMotion = false } = {}) {
  const { mac, rssi, timestamp, parsed } = reading;
  if (!mac || !parsed) return false;

  if (mac === sensorState.pir.mac) {
    if (parsed.type === 'ht') {
      sensorState.pir.temperature = parsed.temperature;
      sensorState.pir.humidity = parsed.humidity;
      sensorState.pir.battery = parsed.battery;
      sensorState.pir.rssi = rssi;
      sensorState.pir.lastSeen = timestamp;
    }
    if (parsed.type === 'pir') {
      sensorState.pir.battery = parsed.battery ?? sensorState.pir.battery;
      sensorState.pir.rssi = rssi;
      sensorState.pir.lastSeen = timestamp;
      if (!deferMotion) {
        applyPirMotion(parsed.motion ?? false);
      }
      return parsed.motion ?? false;
    }
    return false;
  }

  const beacon = sensorState.beacons[mac];
  if (!beacon) return;

  beacon.rssi = rssi;
  beacon.lastSeen = timestamp;

  if (parsed.type === 'tp') {
    beacon.tamper = parsed.tamper ?? parsed.demolished ?? false;
    beacon.battery = parsed.battery ?? beacon.battery;
  }

  if (parsed.type === 'ib') {
    if (parsed.rssi_at_xm != null) beacon.txPower = parsed.rssi_at_xm;
    const distance = rssiToDistance(rssi, beacon.txPower);
    beacon.distance = distance;
    beacon.distanceRange = formatDistanceRange(distance);
  }

  if (beacon.rssi != null && (parsed.type === 'tp' || parsed.type === 'ib')) {
    const distance = rssiToDistance(beacon.rssi, beacon.txPower);
    beacon.distance = distance;
    beacon.distanceRange = formatDistanceRange(distance);
  }
}

/**
 * Ingest RFID asset list from POST /api/posts.
 * Replaces RFID assets for every location present in the payload;
 * assets at other locations are kept.
 * @param {unknown} body
 * @returns {{ accepted: number, locations: Record<string, number> }}
 */
export function processRfidPosts(body) {
  const items = normalizeRfidPayload(body);
  if (!items.length) {
    return { accepted: 0, locations: {} };
  }

  const now = new Date().toISOString();
  const locationsInPayload = new Set();
  const locationCounts = {};

  for (const item of items) {
    const location = String(item.location ?? '').trim() || 'Unknown';
    locationsInPayload.add(location);
  }

  // Drop previous RFID assets for locations being re-uploaded
  for (const [id, asset] of rfidAssets) {
    if (locationsInPayload.has(asset.location)) {
      rfidAssets.delete(id);
    }
  }

  for (const item of items) {
    const id = String(item.id ?? '').trim();
    if (!id) continue;

    const location = String(item.location ?? '').trim() || 'Unknown';
    const name = String(item.name ?? id).trim() || id;
    const description = String(item.description ?? '').trim();

    rfidAssets.set(id, {
      id,
      name,
      description,
      location,
      lastSeen: now,
    });

    locationCounts[location] = (locationCounts[location] || 0) + 1;
  }

  lastRfidUpload = {
    at: now,
    accepted: items.filter((i) => String(i.id ?? '').trim()).length,
    locations: locationCounts,
  };

  broadcast({ type: 'update', data: getDashboardState() });

  return {
    accepted: lastRfidUpload.accepted,
    locations: locationCounts,
  };
}

function normalizeRfidPayload(body) {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object') {
    if (Array.isArray(body.assets)) return body.assets;
    if (Array.isArray(body.data)) return body.data;
    if (Array.isArray(body.posts)) return body.posts;
    // Single asset object
    if (body.id != null) return [body];
  }
  return [];
}

export function processMqttMessage(topic, payload) {
  lastMqttMessage = { topic, timestamp: new Date().toISOString() };

  let parsed;
  const payloadStr = payload.toString();

  if (payloadStr.startsWith('[') || payloadStr.startsWith('{')) {
    try {
      const json = JSON.parse(payloadStr);
      if (Array.isArray(json)) {
        parsed = { type: 'json-raw', ...parseJsonRawPayload(json) };
      } else if (json.adv) {
        parsed = { type: 'json-parsed', ...parseJsonParsedPayload(json) };
      }
    } catch {
      return;
    }
  }

  if (!parsed) return;

  lastMessageFormat = parsed.type;

  if (parsed.gateway) {
    sensorState.gateway.connected = true;
    sensorState.gateway.lastSeen = parsed.gateway.timestamp;
    sensorState.gateway.seq = parsed.gateway.seq;
  }

  let batchMotion = false;
  let pirFrames = 0;
  let pirMotionFrames = 0;
  for (const reading of parsed.readings) {
    if (reading.mac === sensorState.pir.mac) {
      pirFrames++;
      if (reading.parsed?.type === 'pir' && reading.parsed?.motion) {
        pirMotionFrames++;
      }
    }
    const motion = processReading(reading, { deferMotion: true });
    if (motion) batchMotion = true;
  }

  lastPirBatchStats = {
    topic,
    format: parsed.type,
    pirFrames,
    pirMotionFrames,
    batchMotion,
    totalReadings: parsed.readings.length,
    timestamp: new Date().toISOString(),
  };

  if (batchMotion) {
    applyPirMotion(true);
  } else {
    sensorState.pir.motion = false;
    sensorState.pir.motionDetectedAt = null;
  }

  broadcast({ type: 'update', data: getDashboardState() });
}

let lastBroadcastMotion = null;

export function tickState() {
  const motion = isMotionActive();
  if (motion !== lastBroadcastMotion) {
    lastBroadcastMotion = motion;
    broadcast({ type: 'update', data: getDashboardState() });
  }
}

export function setMqttConnected(connected) {
  mqttConnected = connected;
  broadcast({ type: 'mqtt-status', data: getMqttStatus() });
}

function buildLiveAssets() {
  return Object.values(sensorState.beacons).map((beacon) => ({
    id: beacon.mac,
    asset: beacon.asset,
    location: beacon.location,
    icon: beacon.icon,
    mac: beacon.mac,
    rssi: beacon.rssi,
    tamper: beacon.tamper,
    battery: beacon.battery,
    distance: beacon.distanceRange?.label ?? (beacon.distance != null ? `${beacon.distance} m` : '—'),
    distanceMin: beacon.distanceRange?.min,
    distanceMax: beacon.distanceRange?.max,
    distanceEstimate: beacon.distance,
    gateway: sensorState.gateway.location,
    lastSeen: beacon.lastSeen,
    live: true,
    source: 'MQTT',
    category: 'Live Asset',
  }));
}

function buildRfidAssets() {
  return Array.from(rfidAssets.values()).map((item) => ({
    id: item.id,
    asset: item.name,
    description: item.description,
    location: item.location,
    icon: 'asset',
    mac: item.id,
    rssi: null,
    tamper: null,
    distance: '-',
    distanceMin: null,
    distanceMax: null,
    distanceEstimate: null,
    gateway: null,
    lastSeen: item.lastSeen,
    live: false,
    source: 'RFID',
    category: item.description || 'RFID Asset',
  }));
}

/** Aggregate RFID asset counts per location for the Location Map. */
function buildRfidLocations() {
  const counts = {};
  for (const asset of rfidAssets.values()) {
    counts[asset.location] = (counts[asset.location] || 0) + 1;
  }
  return Object.entries(counts).map(([location, count]) => ({
    location,
    count,
    label: `[RFID] x ${count}`,
  }));
}

export function getDashboardState() {
  const motion = isMotionActive();
  sensorState.pir.motion = motion;

  const room = {
    location: sensorState.gateway.location,
    gateway: sensorState.gateway,
    pir: { ...sensorState.pir, motion },
    temperature: sensorState.pir.temperature,
    humidity: sensorState.pir.humidity,
    motion,
  };

  const liveAssets = buildLiveAssets();
  const rfid = buildRfidAssets();
  const demo = demoAssets.assets.map(({ temperature, humidity, motion: _m, ...a }) => ({
    ...a,
    tamper: a.tamper,
    source: 'Demo',
  }));

  return {
    room,
    assets: [...liveAssets, ...rfid, ...demo],
    rfidLocations: buildRfidLocations(),
    liveCount: liveAssets.length,
    rfidCount: rfid.length,
    demoCount: demo.length,
    mqtt: getMqttStatus(),
    rfid: lastRfidUpload,
    updatedAt: new Date().toISOString(),
  };
}