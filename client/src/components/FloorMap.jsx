import AssetIcon from './AssetIcon';

function getPosition(asset, index, total, { reserveBottom = false } = {}) {
  if (asset.live && asset.distanceEstimate != null) {
    const pct = Math.min(85, Math.max(15, 15 + asset.distanceEstimate * 12));
    const angle = (index / Math.max(total, 1)) * Math.PI * 2;
    return {
      left: `${50 + Math.cos(angle) * pct * 0.35}%`,
      top: `${50 + Math.sin(angle) * pct * 0.3}%`,
    };
  }

  // Keep demo markers above the RFID strip when it is visible
  const demoPositions = reserveBottom
    ? {
        'demo-001': { left: '72%', top: '26%' },
        'demo-002': { left: '18%', top: '58%' },
        'demo-003': { left: '55%', top: '16%' },
        'demo-004': { left: '30%', top: '40%' },
        'demo-005': { left: '80%', top: '52%' },
        'demo-006': { left: '42%', top: '62%' },
      }
    : {
        'demo-001': { left: '72%', top: '28%' },
        'demo-002': { left: '18%', top: '75%' },
        'demo-003': { left: '55%', top: '18%' },
        'demo-004': { left: '30%', top: '45%' },
        'demo-005': { left: '80%', top: '68%' },
        'demo-006': { left: '42%', top: '82%' },
      };

  return demoPositions[asset.id] || { left: '50%', top: '50%' };
}

function formatRfidRoomLabel(loc) {
  const room = String(loc.location).match(/^\d+$/)
    ? `Room ${loc.location}`
    : loc.location;
  return `${room} [RFID] x ${loc.count}`;
}

function isRoom101Asset(asset) {
  const loc = (asset.location || '').toLowerCase();
  return loc.includes('room 101') || loc.includes('east wing');
}

function isWarehouseAsset(asset) {
  return (asset.location || '').toLowerCase().includes('warehouse');
}

function LiveMarker({ asset, style }) {
  return (
    <div
      className={`asset-marker live ${asset.tamper ? 'tampered' : ''}`}
      style={style}
      title={`${asset.asset} — ${asset.distance}${asset.url ? ` — ${asset.url}` : ''}`}
    >
      <AssetIcon type={asset.icon} />
      <span className="marker-distance">{asset.distance}</span>
    </div>
  );
}

export default function FloorMap({ assets, room, rfidLocations }) {
  const liveAssets = assets?.filter((a) => a.live) || [];
  const room101Live = liveAssets.filter(isRoom101Asset);
  const warehouseLive = liveAssets.filter(isWarehouseAsset);
  const otherLive = liveAssets.filter((a) => !isRoom101Asset(a) && !isWarehouseAsset(a));
  const demoAssets = assets?.filter((a) => !a.live && a.source !== 'RFID') || [];
  const rfidRooms = rfidLocations || [];
  const gatewayLocation = room?.gateway?.location || 'East Wing - Room 101';
  const hasRfid = rfidRooms.length > 0;

  return (
    <section className="panel map-panel">
      <div className="panel-header">
        <h2>Location Map</h2>
        <span className="map-legend">
          <span className="legend-item live">● Live (MQTT)</span>
          <span className="legend-item rfid">● RFID</span>
          <span className="legend-item demo">○ Demo</span>
        </span>
      </div>

      <div className={`floor-map${hasRfid ? ' has-rfid' : ''}`}>
        <div className="map-zone east-wing">
          <span className="zone-label">East Wing</span>
          <div className="room-box room-101">
            <span className="room-label">Room 101</span>
            <div className="gateway-marker" title={gatewayLocation}>
              <span className="gateway-icon">⬡</span>
              <span>Gateway</span>
            </div>

            {room101Live.map((asset, i) => (
              <LiveMarker
                key={asset.id}
                asset={asset}
                style={getPosition(asset, i, room101Live.length)}
              />
            ))}

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
          <div className={`mini-room warehouse${warehouseLive.length ? ' has-live' : ''}`}>
            <span className="mini-room-label">Warehouse C</span>
            {warehouseLive.map((asset, i) => {
              const angle = (i / Math.max(warehouseLive.length, 1)) * Math.PI * 2;
              const style = {
                left: `${50 + Math.cos(angle) * 22}%`,
                top: `${58 + Math.sin(angle) * 16}%`,
              };
              return <LiveMarker key={asset.id} asset={asset} style={style} />;
            })}
          </div>
        </div>

        {/* Live assets at other locations — place near map center-bottom if any */}
        {otherLive.map((asset, i) => (
          <LiveMarker
            key={asset.id}
            asset={asset}
            style={{
              left: `${30 + (i % 4) * 12}%`,
              top: `${48 + Math.floor(i / 4) * 10}%`,
            }}
          />
        ))}

        {demoAssets.map((asset) => {
          const pos = getPosition(asset, 0, 1, { reserveBottom: hasRfid });
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

        {hasRfid && (
          <div className="rfid-locations-strip" aria-label="RFID locations">
            {rfidRooms.map((loc) => {
              const label = formatRfidRoomLabel(loc);
              return (
                <div
                  key={`rfid-loc-${loc.location}`}
                  className="rfid-location-box"
                  title={`${label}: ${loc.count} RFID asset(s)`}
                >
                  {label}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
