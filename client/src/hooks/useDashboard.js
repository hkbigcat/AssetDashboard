import { useCallback, useEffect, useState } from 'react';

function getApiBase() {
  return (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
}

function getApiUrl() {
  return `${getApiBase()}/api/state`;
}

function getWsUrl() {
  if (import.meta.env.VITE_WS_URL) {
    const base = import.meta.env.VITE_WS_URL.replace(/\/$/, '');
    return `${base}/ws`;
  }
  const apiBase = getApiBase();
  if (apiBase) {
    const url = new URL(apiBase);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${url.origin}/ws`;
  }
  return `ws://${window.location.hostname}:3001/ws`;
}

function getConfigError() {
  if (!import.meta.env.PROD) return null;

  const apiBase = getApiBase();
  if (!apiBase) {
    return 'VITE_API_URL is not set. In Vercel → Environment Variables, set VITE_API_URL to your backend URL (e.g. https://your-api.onrender.com), then redeploy.';
  }

  if (typeof window !== 'undefined') {
    try {
      const apiOrigin = new URL(apiBase).origin;
      if (apiOrigin === window.location.origin) {
        return 'VITE_API_URL points to this Vercel site. It must point to your separate backend API — deploy the server/ folder to Render or Railway.';
      }
    } catch {
      return 'VITE_API_URL is invalid. Use a full URL like https://your-api.onrender.com';
    }
  }

  return null;
}

export function useDashboard() {
  const [state, setState] = useState(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(() => getConfigError());

  const fetchState = useCallback(async () => {
    const configError = getConfigError();
    if (configError) {
      setError(configError);
      return;
    }

    try {
      const res = await fetch(getApiUrl());
      const text = await res.text();
      const contentType = res.headers.get('content-type') || '';

      if (!res.ok) {
        throw new Error(`API error ${res.status}: ${text.slice(0, 120)}`);
      }

      if (!contentType.includes('application/json') || text.trimStart().startsWith('<')) {
        throw new Error(
          'API returned HTML instead of JSON. VITE_API_URL must be your backend URL (deploy server/ to Render/Railway), not this Vercel frontend URL.'
        );
      }

      const data = JSON.parse(text);
      setState(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    fetchState();

    if (getConfigError()) return undefined;

    let ws;
    let reconnectTimer;

    function connect() {
      ws = new WebSocket(getWsUrl());

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