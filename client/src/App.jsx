import { useCallback, useEffect, useState } from 'react';
import AdminPage from './components/AdminPage';
import AssetList from './components/AssetList';
import DoorPanel from './components/DoorPanel';
import FloorMap from './components/FloorMap';
import RoomPanel from './components/RoomPanel';
import { getApiBase, useDashboard } from './hooks/useDashboard';

function normalizePath(pathname) {
  const path = (pathname || '/').replace(/\/+$/, '') || '/';
  return path;
}

function usePathname() {
  const [path, setPath] = useState(() => normalizePath(window.location.pathname));

  useEffect(() => {
    const onPop = () => setPath(normalizePath(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((to) => {
    const next = normalizePath(to);
    if (normalizePath(window.location.pathname) === next) return;
    window.history.pushState({}, '', next);
    setPath(next);
  }, []);

  return [path, navigate];
}

export default function App() {
  const { state, connected, error } = useDashboard();
  const [path, navigate] = usePathname();
  const [rfidScan, setRfidScan] = useState({ status: 'idle', message: '' });
  const isAdmin = path === '/admin';

  const readWestWingRfid = useCallback(async () => {
    setRfidScan({ status: 'reading', message: 'Reading tags at West Wing Hall…' });
    try {
      const res = await fetch(`${getApiBase()}/api/rfid/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(25000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `Read failed (${res.status})`);
      }
      const count = data.accepted ?? 0;
      setRfidScan({
        status: 'ok',
        message:
          count === 0
            ? 'West Wing Hall: no tags in range'
            : `West Wing Hall: ${count} asset${count === 1 ? '' : 's'}`,
      });
    } catch (err) {
      const message = err?.name === 'TimeoutError' ? 'RFID reader timed out' : err.message || 'Read failed';
      setRfidScan({ status: 'error', message });
    }
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-brand">
          <div className="logo">⬡</div>
          <div>
            <h1>Star Green Media Technology Limited - Office Assets Location Dashboard</h1>
            <p className="subtitle">
              {isAdmin
                ? 'Admin — gateway and sensor inventory'
                : 'Real-time BLE beacon tracking via MQTT gateway'}
            </p>
          </div>
        </div>
        <div className="header-stats">
          {!isAdmin && (
            <>
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
            </>
          )}
          {isAdmin && (
            <>
              <div className="header-stat">
                <span className="header-stat-value">{state?.admin?.gateways?.length ?? '—'}</span>
                <span className="header-stat-label">Gateways</span>
              </div>
              <div className="header-stat">
                <span className="header-stat-value">{state?.admin?.sensors?.length ?? '—'}</span>
                <span className="header-stat-label">Sensors</span>
              </div>
            </>
          )}
          {!isAdmin && (
            <div className="rfid-read">
              <button
                type="button"
                className="rfid-read-btn"
                onClick={readWestWingRfid}
                disabled={rfidScan.status === 'reading'}
              >
                {rfidScan.status === 'reading' ? 'Reading…' : 'Read West Wing RFID'}
              </button>
              {rfidScan.message && (
                <span className={`rfid-read-status ${rfidScan.status}`}>{rfidScan.message}</span>
              )}
            </div>
          )}
          <nav className="header-nav" aria-label="Primary">
            <button
              type="button"
              className={`nav-link${!isAdmin ? ' active' : ''}`}
              onClick={() => navigate('/')}
            >
              Dashboard
            </button>
            <button
              type="button"
              className={`nav-link${isAdmin ? ' active' : ''}`}
              onClick={() => navigate('/admin')}
            >
              Admin
            </button>
          </nav>
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

      {isAdmin ? (
        <main className="admin-main">
          <AdminPage admin={state?.admin} />
        </main>
      ) : (
        <main className="dashboard-grid">
          <RoomPanel room={state?.room} mqtt={state?.mqtt} />
          <FloorMap
            assets={state?.assets}
            room={state?.room}
            rfidLocations={state?.rfidLocations}
          />
          <DoorPanel doors={state?.doors} />
          <AssetList assets={state?.assets} />
        </main>
      )}

      <footer className="app-footer">
        <span>Gateway: East Wing Room 101 · JSON-RAW · 30s interval · Port 1883</span>
        {state?.updatedAt && (
          <span>Updated {new Date(state.updatedAt).toLocaleString()}</span>
        )}
      </footer>
    </div>
  );
}
