import { useState } from 'react';
import AssetIcon from './AssetIcon';

function TamperBadge({ tamper, source }) {
  if (source === 'RFID' || tamper == null) {
    return <span className="tamper-badge na">-</span>;
  }
  return (
    <span className={`tamper-badge ${tamper ? 'alert' : 'ok'}`}>
      {tamper ? 'Tampered' : 'Normal'}
    </span>
  );
}

function SourceBadge({ source, live }) {
  const resolved = source || (live ? 'MQTT' : 'Demo');
  const className =
    resolved === 'RFID' ? 'rfid' : resolved === 'MQTT' || live ? 'mqtt' : 'demo';
  const label =
    resolved === 'RFID' ? 'RFID' : resolved === 'MQTT' || live ? 'MQTT Live' : 'Demo';

  return <span className={`live-badge ${className}`}>{label}</span>;
}

export default function AssetList({ assets }) {
  const [filter, setFilter] = useState('all');
  const [sortBy, setSortBy] = useState('name');

  if (!assets) return null;

  const rfidCount = assets.filter((a) => a.source === 'RFID').length;
  const liveCount = assets.filter((a) => a.live || a.source === 'MQTT').length;
  const demoCount = assets.filter((a) => a.source === 'Demo' || (!a.live && a.source !== 'RFID')).length;

  let filtered = [...assets];
  if (filter === 'live') filtered = filtered.filter((a) => a.live || a.source === 'MQTT');
  if (filter === 'demo') filtered = filtered.filter((a) => a.source === 'Demo' || (!a.live && a.source !== 'RFID' && a.source !== 'MQTT'));
  if (filter === 'rfid') filtered = filtered.filter((a) => a.source === 'RFID');
  if (filter === 'tamper') filtered = filtered.filter((a) => a.tamper === true);

  filtered.sort((a, b) => {
    if (sortBy === 'distance') {
      const da = a.distanceEstimate ?? a.distanceMin ?? 999;
      const db = b.distanceEstimate ?? b.distanceMin ?? 999;
      return da - db;
    }
    if (sortBy === 'location') return String(a.location).localeCompare(String(b.location));
    if (sortBy === 'source') {
      return String(a.source || '').localeCompare(String(b.source || ''));
    }
    return a.asset.localeCompare(b.asset);
  });

  return (
    <section className="panel asset-panel">
      <div className="panel-header">
        <h2>Assets</h2>
        <div className="asset-controls">
          <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter assets">
            <option value="all">All ({assets.length})</option>
            <option value="live">Live MQTT ({liveCount})</option>
            <option value="rfid">RFID ({rfidCount})</option>
            <option value="demo">Demo only ({demoCount})</option>
            <option value="tamper">Tampered</option>
          </select>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="Sort assets">
            <option value="name">Sort by name</option>
            <option value="distance">Sort by distance</option>
            <option value="location">Sort by location</option>
            <option value="source">Sort by source</option>
          </select>
        </div>
      </div>

      <div className="asset-table-wrap">
        <table className="asset-table">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Location</th>
              <th>Distance</th>
              <th>Tamper</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((asset) => (
              <tr key={asset.id} className={asset.tamper ? 'row-alert' : ''}>
                <td className="asset-name-cell">
                  <AssetIcon type={asset.icon} className="table-icon" />
                  <div>
                    <strong>{asset.asset}</strong>
                    {asset.category && <span className="category">{asset.category}</span>}
                    {asset.mac && <span className="mac mono">{asset.mac}</span>}
                  </div>
                </td>
                <td>{asset.location}</td>
                <td className="mono">
                  {asset.distance}
                  {asset.rssi != null && (
                    <span className="rssi">{asset.rssi} dBm</span>
                  )}
                </td>
                <td>
                  <TamperBadge tamper={asset.tamper} source={asset.source} />
                </td>
                <td>
                  <SourceBadge source={asset.source} live={asset.live} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
