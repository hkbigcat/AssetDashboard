import AssetList from './components/AssetList';
import FloorMap from './components/FloorMap';
import RoomPanel from './components/RoomPanel';
import { useDashboard } from './hooks/useDashboard';

export default function App() {
  const { state, connected, error } = useDashboard();

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-brand">
          <div className="logo">⬡</div>
          <div>
            <h1>Star Green Media Technology Limited - Office Assets Location Dashboard</h1>
            <p className="subtitle">Real-time BLE beacon tracking via MQTT gateway</p>
          </div>
        </div>
        <div className="header-stats">
          <div className="header-stat">
            <span className="header-stat-value">{state?.liveCount ?? '—'}</span>
            <span className="header-stat-label">Live Assets</span>
          </div>
          <div className="header-stat">
            <span className="header-stat-value">{state?.rfidCount ?? '—'}</span>
            <span className="header-stat-label">RFID Assets</span>
          </div>
          <div className="header-stat">
            <span className="header-stat-value">{state?.demoCount ?? '—'}</span>
            <span className="header-stat-label">Demo Assets</span>
          </div>
          <div className={`ws-status ${connected ? 'on' : 'off'}`}>
            <span className="ws-dot" />
            {connected ? 'Live' : 'Reconnecting'}
          </div>
        </div>
      </header>

      {error && (
        <div className="error-banner">
          <strong>Cannot reach backend API.</strong> {error}
        </div>
      )}

      <main className="dashboard-grid">
        <RoomPanel room={state?.room} mqtt={state?.mqtt} />
        <FloorMap
          assets={state?.assets}
          room={state?.room}
          rfidLocations={state?.rfidLocations}
        />
        <AssetList assets={state?.assets} />
      </main>

      <footer className="app-footer">
        <span>Gateway: East Wing Room 101 · JSON-RAW · 30s interval · Port 1883</span>
        {state?.updatedAt && (
          <span>Updated {new Date(state.updatedAt).toLocaleString()}</span>
        )}
      </footer>
    </div>
  );
}