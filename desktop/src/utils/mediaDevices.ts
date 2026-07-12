export function isMediaDevicesAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

export function getMediaDevicesUnavailableMessage(): string {
  if (typeof window === 'undefined') {
    return 'Microphone access is not available in this environment.';
  }

  if (window.isSecureContext) {
    return 'Microphone access is not available in this browser.';
  }

  const host = window.location.hostname;
  const isLanHost =
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host);

  if (isLanHost && window.location.protocol === 'http:') {
    const httpsUrl = `https://${window.location.host}${window.location.pathname}`;
    return `Voice calls need HTTPS on LAN. Open ${httpsUrl} (accept the security warning), or use localhost on this machine.`;
  }

  return 'Voice calls require a secure connection (HTTPS or localhost) for microphone access.';
}

export async function getUserAudioStream(): Promise<MediaStream> {
  if (!isMediaDevicesAvailable()) {
    throw new Error(getMediaDevicesUnavailableMessage());
  }

  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (error) {
    if (error instanceof DOMException) {
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        throw new Error('Microphone permission was denied. Allow microphone access and try again.', {
          cause: error,
        });
      }
      if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        throw new Error('No microphone was found on this device.', { cause: error });
      }
    }
    throw error instanceof Error ? error : new Error('Failed to access microphone');
  }
}
