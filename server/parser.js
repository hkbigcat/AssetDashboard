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

/** Eddystone-URL scheme prefixes (Google Eddystone spec). */
const EDDYSTONE_URL_SCHEMES = {
  0x00: 'http://www.',
  0x01: 'https://www.',
  0x02: 'http://',
  0x03: 'https://',
};

/** Eddystone-URL encoded suffix / expansion bytes. */
const EDDYSTONE_URL_EXPANSIONS = {
  0x00: '.com/',
  0x01: '.org/',
  0x02: '.edu/',
  0x03: '.net/',
  0x04: '.info/',
  0x05: '.biz/',
  0x06: '.gov/',
  0x07: '.com',
  0x08: '.org',
  0x09: '.edu',
  0x0a: '.net',
  0x0b: '.info',
  0x0c: '.biz',
  0x0d: '.gov',
};

function signedByte(hexByte) {
  const value = parseInt(hexByte, 16);
  return value > 127 ? value - 256 : value;
}

/**
 * Parse Eddystone service data (bytes after UUID FEAA).
 * Supports URL (0x10) and UID (0x00) frames used by Minew location beacons.
 */
export function parseEddystoneFrame(serviceDataHex) {
  if (!serviceDataHex || serviceDataHex.length < 2) return null;
  const hex = serviceDataHex.toLowerCase();
  const frameType = hex.slice(0, 2);

  // Eddystone-URL
  if (frameType === '10' && hex.length >= 6) {
    const txPower = signedByte(hex.slice(2, 4));
    const schemeCode = parseInt(hex.slice(4, 6), 16);
    let url = EDDYSTONE_URL_SCHEMES[schemeCode] ?? '';
    for (let i = 6; i + 2 <= hex.length; i += 2) {
      const b = parseInt(hex.slice(i, i + 2), 16);
      if (EDDYSTONE_URL_EXPANSIONS[b] != null) {
        url += EDDYSTONE_URL_EXPANSIONS[b];
      } else if (b >= 0x20 && b <= 0x7e) {
        url += String.fromCharCode(b);
      }
    }
    return {
      type: 'eddystone-url',
      txPower,
      rssi_at_xm: txPower,
      url,
    };
  }

  // Eddystone-UID: type(1) + txPower(1) + namespace(10) + instance(6) [+ RFU(2)]
  if (frameType === '00' && hex.length >= 34) {
    const txPower = signedByte(hex.slice(2, 4));
    return {
      type: 'eddystone-uid',
      txPower,
      rssi_at_xm: txPower,
      namespace: hex.slice(4, 24),
      instance: hex.slice(24, 36),
    };
  }

  return null;
}

/**
 * Minew manufacturer-specific data (company ID 0x0639).
 * Supports Connect V3 combination frames (door contact) and classic S4 door frames.
 * Manufacturer payload is the bytes after company ID (little-endian 39 06).
 */
export function parseMinewManufacturerData(mfgHex) {
  if (!mfgHex || mfgHex.length < 4) return null;
  const hex = mfgHex.toLowerCase();
  const frameType = hex.slice(0, 2);
  const frameVersion = parseInt(hex.slice(2, 4), 16);

  // Connect V3 — combination frame with sensor blocks
  if (frameType === 'ca' && frameVersion === 0x03) {
    const result = {
      type: 'door',
      protocol: 'minew-connect-v3',
      open: null,
      contact: null,
      tamper: null,
      battery: null,
      contactCycle: null,
      tamperCycle: null,
    };

    // Walk combination blocks until the trailing 4-byte salt/signature
    let offset = 2; // byte index into binary buffer
    const bytes = [];
    for (let i = 0; i + 2 <= hex.length; i += 2) {
      bytes.push(parseInt(hex.slice(i, i + 2), 16));
    }
    const POST_LEN = 4;

    while (offset < bytes.length - POST_LEN) {
      const blockId = bytes[offset];
      if (blockId === 0x1f && offset + 5 <= bytes.length) {
        // Door contact block: status, contactCycle, (reserved), tamperCycle
        const status = bytes[offset + 1];
        // bit7: magnet/contact absent when set → door open
        // bit6: anti-disassembly / tamper when set
        const contact = (status & 0x80) === 0x00;
        result.contact = contact;
        result.open = !contact;
        result.tamper = (status & 0x40) === 0x40;
        result.contactCycle = bytes[offset + 2];
        result.tamperCycle = bytes[offset + 4];
        offset += 5;
        continue;
      }
      if (blockId === 0x21 && offset + 2 <= bytes.length) {
        result.battery = bytes[offset + 1];
        offset += 2;
        continue;
      }
      if (blockId === 0x22 && offset + 2 <= bytes.length) {
        // Alternate contact trigger block
        const triggered = bytes[offset + 1] > 0;
        result.open = triggered;
        result.contact = !triggered;
        offset += 2;
        continue;
      }
      // Unknown block — stop walking
      break;
    }

    if (result.open != null || result.tamper != null || result.battery != null) {
      return result;
    }
    return null;
  }

  // Classic S4 door alarm frame: a4 01 battery magnet antiDisassembly alarm ...
  if (frameType === 'a4' && frameVersion === 0x01 && hex.length >= 12) {
    const battery = parseInt(hex.slice(4, 6), 16);
    const magnetAlarm = parseInt(hex.slice(6, 8), 16) > 0;
    const antiDisassembly = parseInt(hex.slice(8, 10), 16) > 0;
    return {
      type: 'door',
      protocol: 'minew-s4',
      battery,
      // magnet alarm active ⇒ door open (no contact)
      open: magnetAlarm,
      contact: !magnetAlarm,
      // anti-disassembly byte > 0 ⇒ cover opened / tampered
      tamper: antiDisassembly,
    };
  }

  return null;
}

/**
 * Extract Minew manufacturer payload (company 0x0639) from a full BLE ADV hex string.
 */
function extractMinewMfgPayload(hex) {
  // Walk AD structures: [len][type][data...]
  let i = 0;
  while (i + 4 <= hex.length) {
    const len = parseInt(hex.slice(i, i + 2), 16);
    if (!len || i + 2 + len * 2 > hex.length) break;
    const type = hex.slice(i + 2, i + 4);
    const data = hex.slice(i + 4, i + 2 + len * 2);
    if (type === 'ff' && data.startsWith('3906')) {
      return data.slice(4); // strip company ID
    }
    i += 2 + len * 2;
  }

  // Fallback: search for company ID + Connect V3 / S4 frame markers
  const mfgIdx = hex.indexOf('3906ca');
  if (mfgIdx !== -1) return hex.slice(mfgIdx + 4);
  const s4Idx = hex.indexOf('3906a4');
  if (s4Idx !== -1) return hex.slice(s4Idx + 4);
  return null;
}

export function parseRawAdvertisement(raw) {
  if (!raw || typeof raw !== 'string') return null;

  const hex = raw.toLowerCase();

  // Minew manufacturer data (company 0x0639) — door / contact sensors
  const minewMfg = extractMinewMfgPayload(hex);
  if (minewMfg) {
    const doorFrame = parseMinewManufacturerData(minewMfg);
    if (doorFrame) return doorFrame;
  }

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

  // Eddystone (UUID FEAA) — Minew location beacons, etc.
  let searchFrom = 0;
  while (searchFrom < hex.length) {
    const eddystoneIdx = hex.indexOf('16aafe', searchFrom);
    if (eddystoneIdx === -1) break;
    const frame = parseEddystoneFrame(hex.slice(eddystoneIdx + 6));
    if (frame) return frame;
    searchFrom = eddystoneIdx + 6;
  }

  // Minew sensor service data (UUID E1FF): HT / PIR / TP / status
  const frames = [];
  searchFrom = 0;
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

  // Accept a single reading object { mac, raw, rssi, ... } as well as gateway batches
  if (!Array.isArray(items)) {
    if (items && typeof items === 'object' && items.mac && items.raw) {
      items = [items];
    } else {
      return { gateway: null, readings: [] };
    }
  }

  if (items.length === 0) {
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