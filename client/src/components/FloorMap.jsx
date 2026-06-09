import AssetIcon from './AssetIcon';

function getPosition(asset, index, total) {
  if (asset.live && asset.distanceEstimate != null) {
    const pct = Math.min(85, Math.max(15, 15 + asset.distanceEstimate * 12));
    const angle = (index / total) * Math.PI * 2;
    return {
      left: `${50 + Math.cos(angle) * pct * 0.35}%`,
      top: `${50 + Math.sin(angle) * pct * 0.3}%`,
    };
  }

  const demoPositions = {
    'demo-001': { left: '72%', top: '28%' },
    'demo-002': { left: '18%', top: '75%' },
    'demo-003': { left: '55%', top: '18%' },
    'demo-004': { left: '30%', top: '45%' },
    'demo-005': { left: '80%', top: '68%' },
    'demo-006': { left: '42%', top: '82%' },
  };

  return demoPositions[asset.id] || { left: '50%', top: '50%' };
}

export default function FloorMap({ assets, room }) {
  const liveAssets = assets?.filter((a) => a.live) || [];
  const gatewayLocation = room?.gateway?.location || 'East Wing - Room 101';

  return (
    <section className="panel map-panel">
      <div className="panel-header">
        <h2>Location Map</h2>
        <span className="map-legend">
          <span className="legend-item live">● Live (MQTT)</span>
          <span className="legend-item demo">○ Demo</span>
        </span>
      </div>

      <div className="floor-map">
        <div className="map-zone east-wing">
          <span className="zone-label">East Wing</span>
          <div className="room-box room-101">
            <span className="room-label">Room 101</span>
            <div className="gateway-marker" title={gatewayLocation}>
              <span className="gateway-icon">⬡</span>
              <span>Gateway</span>
            </div>

            {liveAssets.map((asset, i) => {
              const pos = getPosition(asset, i, liveAssets.length);
              return (
                <div
                  key={asset.id}
                  className={`asset-marker live ${asset.tamper ? 'tampered' : ''}`}
                  style={pos}
                  title={`${asset.asset} — ${asset.distance}`}
                >
                  <AssetIcon type={asset.icon} />
                  <span className="marker-distance">{asset.distance}</span>
                </div>
              );
            })}

            {room?.motion && <div className="motion-pulse" />}
          </div>
        </div>

        <div className="map-zone west-wing">
          <span className="zone-label">West Wing</span>
          <div className="room-box meeting-room">
            <span className="room-label">Meeting 5/F</span>
          </div>
        </div>

        <div className="map-zone other-zones">
          <div className="mini-room server">Server B1</div>
          <div className="mini-room store">Store 2/F</div>
          <div className="mini-room warehouse">Warehouse C</div>
        </div>

        {assets
          ?.filter((a) => !a.live)
          .map((asset) => {
            const pos = getPosition(asset, 0, 1);
            return (
              <div
                key={asset.id}
                className={`asset-marker demo ${asset.tamper ? 'tampered' : ''}`}
                style={pos}
                title={`${asset.asset} — ${asset.location}`}
              >
                <AssetIcon type={asset.icon} />
              </div>
            );
          })}
      </div>
    </section>
  );
}