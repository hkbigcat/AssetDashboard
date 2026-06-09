import { useCallback, useEffect, useState } from 'react';

const WS_URL = `ws://${window.location.hostname}:3001/ws`;
const API_URL = '/api/state';

export function useDashboard() {
  const [state, setState] = useState(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch(API_URL);
      if (!res.ok) throw new Error('Failed to fetch state');
      const data = await res.json();
      setState(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    fetchState();

    let ws;
    let reconnectTimer;

    function connect() {
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        setConnected(true);
        setError(null);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'init' || msg.type === 'update') {
            setState(msg.data);
          }
          if (msg.type === 'mqtt-status' && state) {
            setState((prev) => (prev ? { ...prev, mqtt: msg.data } : prev));
          }
        } catch {
          /* ignore malformed messages */
        }
      };

      ws.onclose = () => {
        setConnected(false);
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        setConnected(false);
      };
    }

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, [fetchState]);

  return { state, connected, error, refresh: fetchState };
}