const DEFAULT_API = 'http://localhost:3000/api/v1';
const DEFAULT_WS = 'http://localhost:3000';

function isLocalHostname(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

function isPrivateNetworkHostname(hostname: string) {
  if (isLocalHostname(hostname)) return true;
  if (hostname.endsWith('.local')) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  return false;
}

/**
 * When the UI is opened from another device (e.g. phone on LAN), use that host
 * for API/WebSocket instead of localhost from .env.
 */
export function resolveServiceUrls() {
  const envApi = import.meta.env.VITE_API_URL as string | undefined;
  const envWs = import.meta.env.VITE_WS_URL as string | undefined;
  const configuredApi = envApi ?? DEFAULT_API;
  const configuredWs = envWs ?? DEFAULT_WS;

  if (typeof window === 'undefined') {
    return { apiBase: configuredApi, wsBase: configuredWs };
  }

  const { hostname, protocol, origin } = window.location;

  // LAN dev over HTTPS: proxy API/WS through Vite (avoids mixed content on https://192.168.x.x).
  // localhost (Electron on this machine) talks to the backend directly on :3000.
  if (import.meta.env.DEV && protocol === 'https:' && !isLocalHostname(hostname)) {
    return {
      apiBase: `${origin}/api/v1`,
      wsBase: origin,
    };
  }

  if (isLocalHostname(hostname)) {
    return { apiBase: configuredApi, wsBase: configuredWs };
  }

  const apiUrl = new URL(configuredApi);
  const wsUrl = new URL(configuredWs);
  const scheme = protocol === 'https:' ? 'https' : 'http';
  const apiPort = apiUrl.port || '3000';
  const wsPort = wsUrl.port || '3000';

  return {
    apiBase: `${scheme}://${hostname}:${apiPort}/api/v1`,
    wsBase: `${scheme}://${hostname}:${wsPort}`,
  };
}

export function getServiceUrls() {
  return resolveServiceUrls();
}

export function isCurrentHostPrivateNetwork() {
  if (typeof window === 'undefined') return false;
  return isPrivateNetworkHostname(window.location.hostname);
}
