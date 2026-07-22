const DEFAULT_API = 'http://localhost:3000/api/v1';
const DEFAULT_WS = 'http://localhost:3000';

/** Optional runtime override (set after install without rebuilding). */
const RUNTIME_API_KEY = 'relay.apiBase';
const RUNTIME_WS_KEY = 'relay.wsBase';

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

function readRuntimeOverrides(): { apiBase?: string; wsBase?: string } {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const apiBase = localStorage.getItem(RUNTIME_API_KEY)?.trim() || undefined;
    const wsBase = localStorage.getItem(RUNTIME_WS_KEY)?.trim() || undefined;
    return { apiBase, wsBase };
  } catch {
    return {};
  }
}

/**
 * Persist API/WS base URLs for the packaged Electron app (no rebuild needed).
 * Example: setServiceUrls('http://192.168.0.110:3000/api/v1', 'http://192.168.0.110:3000')
 */
export function setServiceUrls(apiBase: string, wsBase: string) {
  localStorage.setItem(RUNTIME_API_KEY, apiBase);
  localStorage.setItem(RUNTIME_WS_KEY, wsBase);
}

export function clearServiceUrlOverrides() {
  localStorage.removeItem(RUNTIME_API_KEY);
  localStorage.removeItem(RUNTIME_WS_KEY);
}

/**
 * When the UI is opened from another device (e.g. phone on LAN), use that host
 * for API/WebSocket instead of localhost from .env.
 *
 * Packaged Electron loads `file://` (empty hostname) — always use configured URLs,
 * never rewrite with an empty host (that produced `http://:3000/api/v1`).
 */
export function resolveServiceUrls() {
  const runtime = readRuntimeOverrides();
  const envApi = import.meta.env.VITE_API_URL as string | undefined;
  const envWs = import.meta.env.VITE_WS_URL as string | undefined;
  const configuredApi = runtime.apiBase || envApi || DEFAULT_API;
  const configuredWs = runtime.wsBase || envWs || DEFAULT_WS;

  if (typeof window === 'undefined') {
    return { apiBase: configuredApi, wsBase: configuredWs };
  }

  const { hostname, protocol, origin } = window.location;

  // Packaged Electron (`file://`) or missing host → use baked-in / runtime URLs.
  if (protocol === 'file:' || !hostname) {
    return { apiBase: configuredApi, wsBase: configuredWs };
  }

  // LAN dev over HTTPS: proxy API/WS through Vite (avoids mixed content on https://192.168.x.x).
  if (import.meta.env.DEV && protocol === 'https:' && !isLocalHostname(hostname)) {
    return {
      apiBase: `${origin}/api/v1`,
      wsBase: origin,
    };
  }

  if (isLocalHostname(hostname)) {
    return { apiBase: configuredApi, wsBase: configuredWs };
  }

  // Browser on a LAN IP (e.g. phone) — talk to API on the same host.
  try {
    const apiUrl = new URL(configuredApi);
    const wsUrl = new URL(configuredWs);
    const scheme = protocol === 'https:' ? 'https' : 'http';
    const apiPort = apiUrl.port || '3000';
    const wsPort = wsUrl.port || '3000';

    return {
      apiBase: `${scheme}://${hostname}:${apiPort}/api/v1`,
      wsBase: `${scheme}://${hostname}:${wsPort}`,
    };
  } catch {
    return { apiBase: configuredApi, wsBase: configuredWs };
  }
}

export function getServiceUrls() {
  return resolveServiceUrls();
}

export function isCurrentHostPrivateNetwork() {
  if (typeof window === 'undefined') return false;
  return isPrivateNetworkHostname(window.location.hostname);
}
