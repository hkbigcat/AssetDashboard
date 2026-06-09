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
  removeClient,
  setMqttBrokerInfo,
  setMqttConnected,
  tickState,
} from './state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const { port: PORT, mqtt: mqttConfig, loadSampleData: shouldLoadSampleData } = config;

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

server.listen(PORT, () => {
  console.log(`Assets Dashboard API running at http://localhost:${PORT}`);
});