export default function RoomPanel({ room, mqtt }) {
  if (!room) return null;

  const { gateway, pir, temperature, humidity, motion } = room;

  return (
    <section className="panel room-panel">
      <div className="panel-header">
        <h2>Room Status</h2>
        <span className="location-badge">{gateway?.location}</span>
      </div>

      <div className="room-grid">
        <div className="stat-card">
          <span className="stat-label">Gateway</span>
          <span className="stat-value mono">{gateway?.mac || '—'}</span>
          <span className={`stat-badge ${gateway?.connected ? 'online' : 'offline'}`}>
            {gateway?.connected ? 'Online' : 'Offline'}
          </span>
        </div>

        <div className="stat-card">
          <span className="stat-label">Temperature</span>
          <span className="stat-value large">
            {temperature != null ? `${temperature.toFixed(1)}°C` : '—'}
          </span>
        </div>

        <div className="stat-card">
          <span className="stat-label">Humidity</span>
          <span className="stat-value large">
            {humidity != null ? `${humidity.toFixed(1)}%` : '—'}
          </span>
        </div>

        <div className={`stat-card motion-card ${motion ? 'active' : ''}`}>
          <span className="stat-label">Occupancy</span>
          <span className="stat-value">
            {motion ? (
              <>
                <span className="motion-dot" />
                Someone present
              </>
            ) : (
              'Room empty'
            )}
          </span>
          <span className="stat-hint">PIR motion sensor</span>
        </div>
      </div>

      <div className="mqtt-bar">
        <span className={`mqtt-indicator ${mqtt?.connected ? 'connected' : ''}`} />
        MQTT {mqtt?.connected ? 'Connected' : 'Disconnected'}
        {mqtt?.broker && (
          <> · {mqtt.broker}:{mqtt.port}</>
        )}
        {mqtt?.topics?.length > 0 && (
          <> · {mqtt.topics.join(', ')}</>
        )}
        {mqtt?.format && (
          <span className={`format-badge ${mqtt.motionCapable ? 'raw' : 'parsed'}`}>
            {mqtt.format === 'json-raw' ? 'JSON-RAW' : 'JSON-PARSED'}
            {!mqtt.motionCapable && ' — motion unavailable'}
          </span>
        )}
        {pir?.lastSeen && (
          <span className="last-seen">Last update: {new Date(pir.lastSeen).toLocaleTimeString()}</span>
        )}
      </div>
    </section>
  );
}