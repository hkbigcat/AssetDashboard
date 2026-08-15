export default function DoorPanel({ doors }) {
  if (!doors?.length) return null;

  return (
    <section className="panel door-panel">
      <div className="panel-header">
        <h2>Door Status</h2>
        <span className="location-badge">Magnetic sensors</span>
      </div>

      <div className="door-list">
        {doors.map((door) => {
          const stateClass =
            door.open === true ? 'open' : door.open === false ? 'closed' : 'unknown';
          return (
            <div
              key={door.id}
              className={`door-card ${stateClass}${door.tamper ? ' tampered' : ''}`}
            >
              <div className="door-card-main">
                <span className={`door-status-icon ${stateClass}`} aria-hidden="true">
                  {door.open === true ? '▣' : door.open === false ? '▤' : '▫'}
                </span>
                <div className="door-headline">
                  <strong className={`door-status-text ${stateClass}`}>
                    {door.headline}
                  </strong>
                  <span className="door-meta mono">
                    {door.mac}
                    {door.rssi != null ? ` · ${door.rssi} dBm` : ''}
                    {door.battery != null ? ` · Batt ${door.battery}%` : ''}
                  </span>
                </div>
              </div>

              <div className="door-badges">
                <span className={`door-state-badge ${stateClass}`}>
                  {door.statusLabel}
                </span>
                {door.tamper ? (
                  <span className="door-tamper-badge alert">Tampered</span>
                ) : door.open != null ? (
                  <span className="door-tamper-badge ok">Tamper OK</span>
                ) : (
                  <span className="door-tamper-badge na">Tamper —</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
