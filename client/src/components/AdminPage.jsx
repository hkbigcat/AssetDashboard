function formatBattery(battery) {
  if (battery == null) return '—';
  return `${battery}%`;
}

function TypeBadge({ type }) {
  const className =
    type === 'Motion' ? 'motion' : type === 'Door' ? 'door' : 'beacon';
  return <span className={`admin-type-badge ${className}`}>{type}</span>;
}

function StatusBadge({ status }) {
  const online = status === 'Online';
  return (
    <span className={`admin-status-badge ${online ? 'online' : 'offline'}`}>
      <span className="admin-status-dot" />
      {status}
    </span>
  );
}

export default function AdminPage({ admin }) {
  const gateways = admin?.gateways || [];
  const sensors = admin?.sensors || [];

  return (
    <div className="admin-page">
      <section className="panel admin-panel">
        <div className="panel-header">
          <h2>Gateway</h2>
          <span className="location-badge">{gateways.length} registered</span>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Mac Address</th>
                <th>Location</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {gateways.length === 0 ? (
                <tr>
                  <td colSpan={3} className="admin-empty">
                    No gateway configured
                  </td>
                </tr>
              ) : (
                gateways.map((gw) => (
                  <tr key={gw.mac}>
                    <td className="mono">{gw.mac}</td>
                    <td>{gw.location}</td>
                    <td>
                      <StatusBadge status={gw.status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel admin-panel">
        <div className="panel-header">
          <h2>Sensor</h2>
          <span className="location-badge">{sensors.length} registered</span>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Mac Address</th>
                <th>Location</th>
                <th>Type of sensor</th>
                <th>Battery Level</th>
              </tr>
            </thead>
            <tbody>
              {sensors.length === 0 ? (
                <tr>
                  <td colSpan={4} className="admin-empty">
                    No sensors configured
                  </td>
                </tr>
              ) : (
                sensors.map((sensor) => (
                  <tr key={`${sensor.type}-${sensor.mac}`}>
                    <td className="mono">{sensor.mac}</td>
                    <td>{sensor.location}</td>
                    <td>
                      <TypeBadge type={sensor.type} />
                    </td>
                    <td className="mono">{formatBattery(sensor.battery)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
