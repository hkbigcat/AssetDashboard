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
};