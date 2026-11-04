import { config } from './env.js';
import tagRows from './config/rfid-tags.json' with { type: 'json' };

function normalizeEpc(epc) {
  return String(epc ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

function loadCatalog() {
  const map = new Map();
  if (!Array.isArray(tagRows)) return map;
  for (const row of tagRows) {
    const epc = normalizeEpc(row?.name);
    if (!epc) continue;
    map.set(epc, String(row.description ?? '').trim());
  }
  return map;
}

const catalog = loadCatalog();

/**
 * Turn a fixed-reader inventory into the same asset shape the handheld posts.
 * Known EPCs use the catalog description as the asset name. Unknown EPCs keep the EPC.
 * One row per EPC; a later report for the same EPC replaces the earlier one.
 */
export function tagsToAssets(tags, location) {
  const byId = new Map();
  for (const tag of tags || []) {
    const epc = normalizeEpc(tag?.epc ?? tag?.id);
    if (!epc) continue;
    const description = catalog.get(epc) || '';
    byId.set(epc, {
      id: epc,
      name: description || epc,
      description,
      location,
      rssi: tag.rssi ?? null,
      tid: tag.tid != null ? String(tag.tid).trim() : '',
      antenna: tag.antenna ?? tag.ant ?? null,
      count: tag.count ?? null,
    });
  }
  return [...byId.values()];
}

export async function readFixedReader() {
  const reader = config.fixedReader;
  const body = {
    ip: reader.ip,
    port: reader.port,
    antennas: reader.antennas.length ? reader.antennas : [1],
    durationMs: reader.durationMs,
  };
  const url = `${reader.baseUrl.replace(/\/$/, '')}/api/read`;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(reader.durationMs + 15000),
    });
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    const error = new Error(
      timedOut ? 'RFID reader did not respond in time' : `Cannot reach RFID reader at ${url}`
    );
    error.status = 502;
    throw error;
  }

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    const error = new Error('RFID reader returned invalid JSON');
    error.status = 502;
    throw error;
  }

  if (!res.ok || data.ok === false) {
    const error = new Error(data.error || `RFID reader error HTTP ${res.status}`);
    error.status = res.status === 409 ? 409 : 502;
    throw error;
  }

  return {
    reader: data,
    assets: tagsToAssets(data.tags, reader.location),
    request: body,
  };
}
