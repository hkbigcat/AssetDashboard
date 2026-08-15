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
const doorSensors = assetsConfig.assets.filter((a) => a.sensor === 'Door');
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
  /** @type {Record<string, object>} */
  doors: {},
  beacons: {},
};

for (const door of doorSensors) {
  const mac = door.mac_address.toLowerCase();
  sensorState.doors[mac] = {
    mac,
    name: door.asset || door.location || 'Door',
    location: door.location || door.asset || 'Door',
    open: null,
    contact: null,
    tamper: false,
    battery: null,
    rssi: null,
    lastSeen: null,
    protocol: null,
  };
}

for (const beacon of beacons) {
  const mac = beacon.mac_address.toLowerCase();
  sensorState.beacons[mac] = {
    mac,
    asset: beacon.asset,
    location: beacon.location || gateway?.location,
    icon: beacon.icon || 'asset',
    rssi: null,
    tamper: false,
    battery: null,
    distance: null,
    distanceRange: null,
    txPower: -59,
    frameType: null,
    url: null,
    lastSeen: null,
    live: true,
  };
}

const RANGING_FRAME_TYPES = new Set(['ib', 'tp', 'eddystone-url', 'eddystone-uid']);

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

  const door = sensorState.doors[mac];
  if (door && parsed.type === 'door') {
    door.rssi = rssi;
    door.lastSeen = timestamp;
    door.protocol = parsed.protocol ?? door.protocol;
    if (parsed.open != null) door.open = parsed.open;
    if (parsed.contact != null) door.contact = parsed.contact;
    if (parsed.tamper != null) door.tamper = parsed.tamper;
    if (parsed.battery != null) door.battery = parsed.battery;
    return false;
  }

  const beacon = sensorState.beacons[mac];
  if (!beacon) return;

  beacon.rssi = rssi;
  beacon.lastSeen = timestamp;
  beacon.frameType = parsed.type;

  if (parsed.type === 'tp') {
    beacon.tamper = parsed.tamper ?? parsed.demolished ?? false;
    beacon.battery = parsed.battery ?? beacon.battery;
  }

  if (parsed.type === 'eddystone-url' && parsed.url) {
    beacon.url = parsed.url;
  }

  // iBeacon measured power, Eddystone calibrated TX @ 0 m, or prior calibration
  if (parsed.rssi_at_xm != null) {
    beacon.txPower = parsed.rssi_at_xm;
  } else if (parsed.txPower != null) {
    beacon.txPower = parsed.txPower;
  }

  if (beacon.rssi != null && RANGING_FRAME_TYPES.has(parsed.type)) {
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
      } else if (json.mac && json.raw) {
        // Single JSON-RAW advertisement object (e.g. Eddystone location beacon)
        parsed = { type: 'json-raw', ...parseJsonRawPayload(json) };
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
  if (!connected) {
    sensorState.gateway.connected = false;
  }
  broadcast({ type: 'mqtt-status', data: getMqttStatus() });
}

const DEFAULT_SENSOR_LOCATION = 'East Wing - Room 101';

function formatBatteryLevel(battery) {
  if (battery == null || Number.isNaN(Number(battery))) return null;
  const n = Number(battery);
  // Minew frames usually report 0–100; clamp for display safety
  if (n < 0) return null;
  return Math.min(100, Math.round(n));
}

function buildAdminInventory() {
  const location = sensorState.gateway.location || DEFAULT_SENSOR_LOCATION;

  const gateways = [
    {
      mac: (sensorState.gateway.mac || gateway?.mac_address || '—').toLowerCase(),
      location,
      status: sensorState.gateway.connected ? 'Online' : 'Offline',
      lastSeen: sensorState.gateway.lastSeen,
    },
  ];

  const sensors = [];

  if (sensorState.pir.mac) {
    sensors.push({
      mac: sensorState.pir.mac,
      location: sensorState.pir.location || location,
      type: 'Motion',
      battery: formatBatteryLevel(sensorState.pir.battery),
      lastSeen: sensorState.pir.lastSeen,
      name: 'PIR Motion Sensor',
    });
  }

  for (const beacon of Object.values(sensorState.beacons)) {
    sensors.push({
      mac: beacon.mac,
      location: beacon.location || location,
      type: 'Location Beacon',
      battery: formatBatteryLevel(beacon.battery),
      lastSeen: beacon.lastSeen,
      name: beacon.asset,
    });
  }

  for (const door of Object.values(sensorState.doors)) {
    sensors.push({
      mac: door.mac,
      location: door.location || location,
      type: 'Door',
      battery: formatBatteryLevel(door.battery),
      lastSeen: door.lastSeen,
      name: door.name,
    });
  }

  sensors.sort((a, b) => {
    const typeOrder = { Motion: 0, Door: 1, 'Location Beacon': 2 };
    const ta = typeOrder[a.type] ?? 9;
    const tb = typeOrder[b.type] ?? 9;
    if (ta !== tb) return ta - tb;
    return a.mac.localeCompare(b.mac);
  });

  return { gateways, sensors };
}

function liveCategory(beacon) {
  if (beacon.frameType === 'eddystone-url' || beacon.frameType === 'eddystone-uid') {
    return 'Location Beacon (Eddystone)';
  }
  return 'Live Asset';
}

function buildDoorStatuses() {
  return Object.values(sensorState.doors).map((door) => {
    let statusLabel = 'Unknown';
    if (door.open === true) statusLabel = 'Open';
    else if (door.open === false) statusLabel = 'Closed';

    return {
      id: door.mac,
      mac: door.mac,
      name: door.name,
      location: door.location,
      open: door.open,
      contact: door.contact,
      tamper: !!door.tamper,
      battery: door.battery,
      rssi: door.rssi,
      lastSeen: door.lastSeen,
      protocol: door.protocol,
      statusLabel,
      headline:
        door.open == null
          ? `${door.name} — waiting for data`
          : `${door.name} is ${statusLabel}`,
    };
  });
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
    category: liveCategory(beacon),
    frameType: beacon.frameType,
    url: beacon.url,
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
  const doors = buildDoorStatuses();
  const rfid = buildRfidAssets();
  const demo = demoAssets.assets.map(({ temperature, humidity, motion: _m, ...a }) => ({
    ...a,
    tamper: a.tamper,
    source: 'Demo',
  }));

  const admin = buildAdminInventory();

  return {
    room,
    doors,
    assets: [...liveAssets, ...rfid, ...demo],
    rfidLocations: buildRfidLocations(),
    liveCount: liveAssets.length,
    rfidCount: rfid.length,
    demoCount: demo.length,
    admin,
    mqtt: getMqttStatus(),
    rfid: lastRfidUpload,
    updatedAt: new Date().toISOString(),
  };
}