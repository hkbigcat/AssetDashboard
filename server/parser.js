const TX_POWER_DEFAULT = -59;
const PATH_LOSS_EXPONENT = 2.0;

export function parseFixedPoint88(hex) {
  const value = parseInt(hex, 16);
  return Math.round((value / 256) * 100) / 100;
}

export function rssiToDistance(rssi, txPower = TX_POWER_DEFAULT) {
  if (rssi === 0 || rssi === undefined || rssi === null) return null;
  const ratio = (txPower - rssi) / (10 * PATH_LOSS_EXPONENT);
  const distance = Math.pow(10, ratio);
  return Math.round(distance * 100) / 100;
}

export function formatDistanceRange(distance) {
  if (distance == null) return { label: 'Unknown', min: null, max: null };
  const min = Math.max(0.1, Math.round((distance * 0.85) * 10) / 10);
  const max = Math.round((distance * 1.15) * 10) / 10;
  return {
    label: `${min}-${max} m`,
    min,
    max,
    estimate: distance,
  };
}

export function isPirMotion(pirData, version) {
  if (version === '11') return pirData === 0x0001;
  if (version === '19') return pirData === 0x00a1;
  return false;
}

function parseServiceFrame(hex, frameStart) {
  if (frameStart + 4 > hex.length) return null;

  const frameType = hex.slice(frameStart, frameStart + 2);
  const version = hex.slice(frameStart + 2, frameStart + 4);
  if (frameType !== 'a1') return null;

  if (version === '01' && hex.length >= frameStart + 16) {
    return {
      type: 'ht',
      battery: parseInt(hex.slice(frameStart + 4, frameStart + 6), 16),
      temperature: parseFixedPoint88(hex.slice(frameStart + 6, frameStart + 10)),
      humidity: parseFixedPoint88(hex.slice(frameStart + 10, frameStart + 14)),
    };
  }

  if (version === '11' && hex.length >= frameStart + 10) {
    const pirData = parseInt(hex.slice(frameStart + 6, frameStart + 10), 16);
    return {
      type: 'pir',
      battery: parseInt(hex.slice(frameStart + 4, frameStart + 6), 16),
      motion: isPirMotion(pirData, version),
      pirData,
    };
  }

  if (version === '19' && hex.length >= frameStart + 10) {
    const pirData = parseInt(hex.slice(frameStart + 6, frameStart + 10), 16);
    return {
      type: 'pir',
      battery: parseInt(hex.slice(frameStart + 4, frameStart + 6), 16),
      motion: isPirMotion(pirData, version),
      pirData,
    };
  }

  if (version === '08' && hex.length >= frameStart + 6) {
    return {
      type: 'status',
      battery: parseInt(hex.slice(frameStart + 4, frameStart + 6), 16),
    };
  }

  if ((version === '20' || version === '12') && hex.length >= frameStart + 8) {
    const tamperByte = parseInt(hex.slice(frameStart + 6, frameStart + 8), 16);
    return {
      type: 'tp',
      battery: parseInt(hex.slice(frameStart + 4, frameStart + 6), 16),
      tamper: tamperByte === 0x01,
      demolished: tamperByte === 0x01,
    };
  }

  return null;
}

function pickBestFrame(frames) {
  if (frames.length === 0) return null;
  const motionFrame = frames.find((f) => f.type === 'pir' && f.motion);
  if (motionFrame) return motionFrame;
  const htFrame = frames.find((f) => f.type === 'ht');
  if (htFrame) return htFrame;
  const pirFrame = frames.find((f) => f.type === 'pir');
  if (pirFrame) return pirFrame;
  return frames[0];
}

export function parseRawAdvertisement(raw) {
  if (!raw || typeof raw !== 'string') return null;

  const hex = raw.toLowerCase();

  const ibeaconMatch = hex.match(/4c000215([0-9a-f]{32})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{2})/);
  if (ibeaconMatch) {
    const rssi_at_xm = parseInt(ibeaconMatch[4], 16);
    return {
      type: 'ib',
      uuid: ibeaconMatch[1],
      major: parseInt(ibeaconMatch[2], 16),
      minor: parseInt(ibeaconMatch[3], 16),
      rssi_at_xm: rssi_at_xm > 127 ? rssi_at_xm - 256 : rssi_at_xm,
    };
  }

  const frames = [];
  let searchFrom = 0;
  while (searchFrom < hex.length) {
    const serviceIdx = hex.indexOf('16e1ff', searchFrom);
    if (serviceIdx === -1) break;
    const frame = parseServiceFrame(hex, serviceIdx + 6);
    if (frame) frames.push(frame);
    searchFrom = serviceIdx + 6;
  }

  return pickBestFrame(frames);
}

export function parseJsonRawPayload(payload) {
  let items;
  try {
    items = typeof payload === 'string' ? JSON.parse(payload) : payload;
  } catch {
    return { gateway: null, readings: [] };
  }

  if (!Array.isArray(items) || items.length === 0) {
    return { gateway: null, readings: [] };
  }

  const gatewayItem = items[0].gateway ? items[0] : null;
  const readings = [];

  for (let i = gatewayItem ? 1 : 0; i < items.length; i++) {
    const item = items[i];
    if (!item.mac || !item.raw) continue;

    const parsed = parseRawAdvertisement(item.raw);
    readings.push({
      mac: item.mac.toLowerCase(),
      rssi: item.rssi,
      timestamp: item.timestamp,
      raw: item.raw,
      parsed,
    });
  }

  return {
    gateway: gatewayItem
      ? {
          mac: gatewayItem.gateway.toLowerCase(),
          timestamp: gatewayItem.timestamp,
          seq: gatewayItem.seq,
        }
      : null,
    readings,
  };
}

export function parseJsonParsedPayload(payload) {
  let data;
  try {
    data = typeof payload === 'string' ? JSON.parse(payload) : payload;
  } catch {
    return { gateway: null, readings: [] };
  }

  const readings = (data.adv || []).map((adv) => ({
    mac: adv.mac?.toLowerCase(),
    rssi: adv.rssi,
    timestamp: adv.tm,
    parsed: {
      type: adv.type,
      temperature: adv.temperature,
      humidity: adv.humidity,
      battery: adv.battery,
      tamper: adv.demolished,
      demolished: adv.demolished,
      motion: adv.type === 'pir' ? adv.motion : undefined,
      rssi_at_xm: adv.rssi_at_xm,
      uuid: adv.uuid,
      major: adv.major,
      minor: adv.minor,
    },
  }));

  return {
    gateway: data.gw
      ? { mac: data.gw.toLowerCase(), timestamp: data.tm, seq: data.seq }
      : null,
    readings,
  };
}