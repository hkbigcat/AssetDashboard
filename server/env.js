function buildMqttUrl() {
  if (process.env.MQTT_URL) {
    return process.env.MQTT_URL;
  }

  const broker = process.env.MQTT_BROKER || 'localhost';
  const port = process.env.MQTT_PORT || '1883';
  const protocol = process.env.MQTT_PROTOCOL || 'mqtt';

  return `${protocol}://${broker}:${port}`;
}

export const config = {
  port: Number(process.env.PORT) || 3001,
  /** RFID reader upload API — listen on all interfaces */
  rfidPort: Number(process.env.RFID_PORT) || 3000,
  rfidHost: process.env.RFID_HOST || '0.0.0.0',
  mqtt: {
    url: buildMqttUrl(),
    broker: process.env.MQTT_BROKER || 'localhost',
    port: Number(process.env.MQTT_PORT) || 1883,
    protocol: process.env.MQTT_PROTOCOL || 'mqtt',
    topics: (process.env.MQTT_TOPICS || '/gw/#,gw/#')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
  },
  loadSampleData: process.env.LOAD_SAMPLE_DATA === 'true',
  /** Fixed UHF reader web API (RfidWeb on :5080). Antenna is in West Wing Hall. */
  fixedReader: {
    baseUrl: process.env.RFID_READER_URL || 'http://127.0.0.1:5080',
    ip: process.env.RFID_READER_IP || '192.168.1.135',
    port: Number(process.env.RFID_READER_PORT) || 8160,
    antennas: (process.env.RFID_READER_ANTENNAS || '1')
      .split(',')
      .map((n) => Number(n.trim()))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 4),
    durationMs: Number(process.env.RFID_READER_DURATION_MS) || 2000,
    location: process.env.RFID_FIXED_LOCATION || 'West Wing Hall',
  },
};