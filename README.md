# Office Assets Location Dashboard

A real-time web dashboard for tracking office asset locations using BLE beacons, PIR motion sensors, and MQTT gateways.

The dashboard subscribes to gateway MQTT messages, parses sensor data, and displays asset distance, tamper status, room temperature/humidity, and occupancy on a live map and asset table.

## Features

- **Live asset tracking** — beacon RSSI converted to estimated distance from gateway
- **Tamper detection** — per-asset tamper status from beacon sensors
- **Room monitoring** — temperature, humidity, and PIR motion occupancy (room-level only)
- **Location map** — visual placement of live and demo assets across office zones
- **Asset list** — filterable table with icons, distance, tamper, and data source
- **Real-time updates** — WebSocket push from backend on each MQTT batch
- **Demo assets** — example entries for rooms without physical beacons

## Architecture

```
Gateway (BLE) ──MQTT──▶ Node.js API ──WebSocket──▶ React Dashboard
                         │
                         ├─ JSON-RAW parser (motion, RSSI, tamper)
                         └─ JSON-PARSED parser (ht, tp, ib)
```

| Component | Stack | Port |
|-----------|-------|------|
| Backend | Node.js, Express, MQTT.js, WebSocket | 3001 |
| Frontend | React, Vite | 5173 |

## Prerequisites

- Node.js 18+
- An MQTT broker (e.g. Eclipse Mosquitto, HiveMQ)
- BLE gateway publishing sensor data to MQTT

## Quick Start

```bash
# Install all dependencies
npm run install:all

# Configure environment (see below)
cp server/.env.example server/.env

# Start backend + frontend
npm run dev
```

Open http://localhost:5173

The API runs at http://localhost:3001.

## Environment Variables

Copy `server/.env.example` to `server/.env` and adjust as needed.

| Variable | Default | Description |
|----------|---------|-------------|
| `MQTT_BROKER` | `localhost` | MQTT broker hostname |
| `MQTT_PORT` | `1883` | MQTT broker port |
| `MQTT_PROTOCOL` | `mqtt` | `mqtt` or `mqtts` |
| `MQTT_URL` | *(built from above)* | Optional full URL override |
| `MQTT_TOPICS` | `"/gw/#,gw/#"` | Subscribe topics (comma-separated, **must be quoted** in `.env`) |
| `PORT` | `3001` | API server port |
| `LOAD_SAMPLE_DATA` | `false` | Load sample data from `docs/` on startup (dev only) |

Example for HiveMQ public broker:

```env
MQTT_BROKER=broker.hivemq.com
MQTT_PORT=1883
MQTT_TOPICS="/gw/#,gw/#"
```

> **Note:** In `.env` files, `#` starts a comment. Always quote `MQTT_TOPICS` when it contains `#` wildcards.

## Gateway & MQTT Configuration

### Recommended gateway settings

| Setting | Value |
|---------|-------|
| Data format | **JSON-RAW** (required for motion detection) |
| Publish interval | 30s (15s optional for faster updates) |
| MQTT port | 1883 |
| Subscribe topic | `/gw/#` or `gw/#` |

### Data formats

The gateway can output four formats. This dashboard supports:

| Format | Motion | Temp/Humidity | Tamper | RSSI distance |
|--------|--------|---------------|--------|---------------|
| **JSON-RAW** | Yes | Yes | Yes | Yes |
| JSON-PARSED | No | Yes | Yes | Yes |
| BINARY-SHORT | — | — | — | — |
| MCV3-CONNECT | — | — | — | — |

Motion detection requires **JSON-RAW** because PIR motion frames are only available in raw BLE hex payloads. JSON-PARSED includes `ht`, `tp`, and `ib` types but not PIR motion.

### MQTT topic

Gateways typically publish to:

```
/gw/<gateway-mac>/status
```

The server subscribes to both `/gw/#` and `gw/#` to handle leading-slash variations.

## Sensors & Assets

Configured in `server/config/assets.json`:

| Type | MAC | Location |
|------|-----|----------|
| Gateway | `ac233fc26f52` | East Wing - Room 101 |
| PIR (motion + temp/humidity) | `c3000060ef76` | East Wing - Room 101 |
| Beacon → Epson Printer | `c300005cf7a4` | East Wing - Room 101 |
| Beacon → Canon EOS R5 Mark II | `c300005cf7c6` | East Wing - Room 101 |

Demo assets (no physical beacons) are defined in `server/config/demo-assets.json`.

Reference data formats and sample payloads are in `docs/sample-data/` and `docs/data-table/`.

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Server health check |
| `GET /api/state` | Full dashboard state (room, assets, MQTT status) |
| `GET /api/mqtt` | MQTT connection info and broker config |
| `GET /api/debug/pir` | PIR motion debug info |
| `WS /ws` | WebSocket for live state updates |

## Project Structure

```
AssetsDashboard/
├── client/                  # React frontend (Vite)
│   └── src/
│       ├── components/      # RoomPanel, FloorMap, AssetList
│       └── hooks/           # useDashboard (WebSocket + API)
├── server/                  # Node.js backend
│   ├── config/
│   │   ├── assets.json      # Live sensors & beacons
│   │   └── demo-assets.json # Example assets
│   ├── env.js               # Environment config
│   ├── parser.js            # BLE / MQTT payload parser
│   ├── state.js             # Sensor state & WebSocket broadcast
│   └── index.js             # Express + MQTT + WebSocket server
├── docs/
│   ├── assets.json
│   ├── sample-data/         # JSON-RAW, JSON-PARSED, etc.
│   └── data-table/          # BLE frame field definitions
└── package.json             # Root scripts
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run install:all` | Install server and client dependencies |
| `npm run dev` | Start backend and frontend in development |
| `npm run build` | Build frontend for production |
| `npm run start` | Start backend only (production) |

## Deployment

The backend maintains a persistent MQTT connection and WebSocket server, so it must run on a long-lived host.

**Recommended setup:**

| Part | Platform |
|------|----------|
| Frontend (`client/`) | Vercel, Netlify, or any static host |
| Backend (`server/`) | Railway, Render, Fly.io, or VPS |

### Backend

1. Deploy the `server/` directory
2. Set environment variables (`MQTT_BROKER`, `MQTT_PORT`, `MQTT_TOPICS`, `PORT`)
3. Ensure the host allows outbound TCP to your MQTT broker on port 1883

### Frontend

1. Build with `npm run build` in `client/`
2. Set `VITE_API_URL` if the API is on a different host (update `useDashboard.js` accordingly)
3. Deploy the `client/dist/` output

Point your gateway MQTT publish target to the same broker configured in `MQTT_BROKER`.

## Troubleshooting

### Motion always shows "Room empty"

- Confirm gateway is set to **JSON-RAW** (not JSON-PARSED)
- Check `/api/debug/pir` — `motionCapable` should be `true` and `lastMessageFormat` should be `json-raw`
- Wave at the PIR sensor and wait for the next gateway publish cycle (up to 30s)

### Motion always shows "Someone present"

- Usually caused by misclassified BLE frames; ensure you are on the latest parser version
- Check `/api/debug/pir` for `pirMotionFrames` count per batch

### No live data updating

- Verify MQTT connection in Room Status bar (broker address and Connected/Disconnected)
- Confirm gateway publishes to `/gw/<mac>/status` and topics match `MQTT_TOPICS`
- Check that `MQTT_TOPICS` is quoted in `.env` (unquoted `#` is treated as a comment)

### Dashboard shows JSON-PARSED — motion unavailable

The gateway is sending JSON-PARSED format. Switch the gateway output to JSON-RAW for motion support. Temperature, humidity, tamper, and distance will still work with JSON-PARSED.

## License

Private — internal demo project.