export interface SessionClientInfo {
  clientType: string;
  platform: string;
  appName: string;
  deviceLabel: string;
  userAgent?: string;
}

function formatElectronPlatform(platform: string): string {
  if (platform === 'win32') return 'Windows';
  if (platform === 'darwin') return 'macOS';
  if (platform === 'linux') return 'Linux';
  return platform;
}

function detectBrowser(userAgent: string): string {
  if (userAgent.includes('Edg/')) return 'Edge';
  if (userAgent.includes('Chrome/')) return 'Chrome';
  if (userAgent.includes('Firefox/')) return 'Firefox';
  if (userAgent.includes('Safari/') && !userAgent.includes('Chrome')) return 'Safari';
  return 'Browser';
}

function detectBrowserPlatform(userAgent: string): string {
  if (userAgent.includes('Windows')) return 'Windows';
  if (userAgent.includes('Mac OS X') || userAgent.includes('Macintosh')) return 'macOS';
  if (userAgent.includes('Linux')) return 'Linux';
  if (userAgent.includes('Android')) return 'Android';
  if (userAgent.includes('iPhone') || userAgent.includes('iPad')) return 'iOS';
  return 'Unknown';
}

/** Telegram-style labels: "Chrome, Windows" / "RELAY, Windows" */
export function getClientSessionInfo(): SessionClientInfo {
  const userAgent = navigator.userAgent;

  if (window.electronAPI) {
    const platform = formatElectronPlatform(window.electronAPI.platform);
    return {
      clientType: 'electron',
      platform,
      appName: 'RELAY',
      deviceLabel: `RELAY, ${platform}`,
      userAgent,
    };
  }

  const platform = detectBrowserPlatform(userAgent);
  const browser = detectBrowser(userAgent);
  return {
    clientType: 'browser',
    platform,
    appName: browser,
    deviceLabel: `${browser}, ${platform}`,
    userAgent,
  };
}

export function getElectronClientSessionInfo(platform: string): SessionClientInfo {
  const formatted = formatElectronPlatform(platform);
  return {
    clientType: 'electron',
    platform: formatted,
    appName: 'RELAY',
    deviceLabel: `RELAY, ${formatted}`,
    userAgent: `RELAY Desktop (${formatted})`,
  };
}
