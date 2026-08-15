import 'dotenv/config';

if (process.env.VERCEL) {
  console.error(
    'The MQTT backend cannot run on Vercel serverless. Deploy server/ to Railway, Render, or a VPS.'
  );
  process.exit(1);
}

import cors from 'cors';
import express from 'express';
import { createServer } from 'http';
import mqtt from 'mqtt';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { config } from './env.js';
import {
  addClient,
  getDashboardState,
  getMqttStatus,
  getPirDebug,
  processMqttMessage,
  processRfidPosts,
  removeClient,
  setMqttBrokerInfo,
  setMqttConnected,
  tickState,
} from './state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const {
  port: PORT,
  rfidPort: RFID_PORT,
  rfidHost: RFID_HOST,
  mqtt: mqttConfig,
  loadSampleData: shouldLoadSampleData,
} = config;

setMqttBrokerInfo({
  broker: mqttConfig.broker,
  port: mqttConfig.port,
  url: mqttConfig.url,
  topics: mqttConfig.topics,
});

const app = express();
const corsOrigins = process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()).filter(Boolean);
app.use(cors(corsOrigins?.length ? { origin: corsOrigins } : undefined));
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({
    name: 'Office Assets Location Dashboard API',
    status: 'running',
    mqtt: getMqttStatus(),
    endpoints: {
      health: '/api/health',
      state: '/api/state',
      mqtt: '/api/mqtt',
      rfidPosts: 'POST /api/posts',
      pirDebug: '/api/debug/pir',
      websocket: '/ws',
    },
    rfid: {
      port: RFID_PORT,
      host: RFID_HOST,
      path: '/api/posts',
    },
    note: 'This is the backend API. The web dashboard UI is hosted separately (e.g. on Vercel).',
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/state', (_req, res) => {
  res.json(getDashboardState());
});

app.get('/api/mqtt', (_req, res) => {
  res.json(getMqttStatus());
});

app.get('/api/debug/pir', (_req, res) => {
  res.json(getPirDebug());
});

/**
 * RFID reader upload — expects a JSON array of
 * { id, name, description, location } (extra fields ignored).
 * Available on the main API port and on the dedicated RFID port (default 3000).
 */
app.post('/api/posts', (req, res) => {
  try {
    const result = processRfidPosts(req.body);
    console.log(
      `RFID upload: ${result.accepted} asset(s) — locations: ${JSON.stringify(result.locations)}`
    );
    res.status(200).json({
      ok: true,
      accepted: result.accepted,
      locations: result.locations,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('RFID /api/posts error:', err.message);
    res.status(400).json({ ok: false, error: err.message || 'Invalid payload' });
  }
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  addClient(ws);
  ws.send(JSON.stringify({ type: 'init', data: getDashboardState() }));
  ws.on('close', () => removeClient(ws));
});

function connectMqtt() {
  const client = mqtt.connect(mqttConfig.url, {
    reconnectPeriod: 5000,
    connectTimeout: 10000,
  });

  client.on('connect', () => {
    console.log(`MQTT connected to ${mqttConfig.url}`);
    setMqttConnected(true);
    for (const topic of mqttConfig.topics) {
      client.subscribe(topic, (err) => {
        if (err) console.error(`MQTT subscribe error (${topic}):`, err.message);
        else console.log(`Subscribed to ${topic}`);
      });
    }
  });

  client.on('message', (topic, payload) => {
    processMqttMessage(topic, payload);
  });

  client.on('error', (err) => {
    console.error('MQTT error:', err.message);
  });

  client.on('close', () => {
    setMqttConnected(false);
    console.log('MQTT disconnected — retrying...');
  });

  return client;
}

function loadSampleData() {
  if (!shouldLoadSampleData) return;

  try {
    const samplePath = join(__dirname, '..', 'docs', 'sample-data', 'JSON-RAW.txt');
    const content = readFileSync(samplePath, 'utf-8');
    const match = content.match(/Payload:(\[[\s\S]+\])/);
    if (!match) return;

    processMqttMessage('gw/sample', match[1]);
    console.log('Loaded sample JSON-RAW data (LOAD_SAMPLE_DATA=true)');
  } catch (err) {
    console.warn('Could not load sample data:', err.message);
  }
}

connectMqtt();
loadSampleData();

setInterval(tickState, 5000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Assets Dashboard API running at http://0.0.0.0:${PORT}`);
});

// Dedicated RFID listener (all interfaces) so the handheld reader can POST to :3000
if (RFID_PORT !== PORT) {
  const rfidServer = createServer(app);
  rfidServer.listen(RFID_PORT, RFID_HOST, () => {
    console.log(
      `RFID upload API listening at http://${RFID_HOST}:${RFID_PORT}/api/posts (POST)`
    );
  });
  rfidServer.on('error', (err) => {
    console.error(`RFID port ${RFID_PORT} error:`, err.message);
  });
}