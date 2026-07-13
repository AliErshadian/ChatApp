function isMobileLayout(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(max-width: 768px)').matches;
}

export function defaultSpeakerOn(): boolean {
  // Phones default to earpiece; desktop defaults to speakers.
  return !isMobileLayout();
}

export function isSpeakerRoutingSupported(): boolean {
  if (typeof document === 'undefined') return false;
  const audio = document.createElement('audio');
  return 'setSinkId' in audio;
}

export function isAudioOutputPickerSupported(): boolean {
  return typeof navigator !== 'undefined' && 'selectAudioOutput' in navigator.mediaDevices;
}

async function listAudioOutputs(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === 'audiooutput');
}

function pickSpeakerDeviceId(devices: MediaDeviceInfo[]): string {
  const speaker = devices.find(
    (device) =>
      /speaker|loudspeaker|headphone|headset|bluetooth/i.test(device.label) &&
      !/receiver|earpiece|handset/i.test(device.label),
  );
  return speaker?.deviceId || 'default';
}

function pickEarpieceDeviceId(devices: MediaDeviceInfo[]): string {
  const earpiece = devices.find((device) =>
    /receiver|earpiece|handset|phone/i.test(device.label),
  );
  return earpiece?.deviceId || 'default';
}

export async function applySpeakerRoute(
  audio: HTMLAudioElement,
  speakerOn: boolean,
): Promise<void> {
  if (!('setSinkId' in audio)) return;

  try {
    const outputs = await listAudioOutputs();
    const sinkId = speakerOn
      ? pickSpeakerDeviceId(outputs)
      : pickEarpieceDeviceId(outputs);
    await audio.setSinkId(sinkId);
  } catch {
    if (speakerOn) {
      try {
        await audio.setSinkId('');
      } catch {
        // Browser may not expose output routing on this device.
      }
    }
  }
}

export async function pickAudioOutputDevice(audio: HTMLAudioElement): Promise<boolean> {
  if (!isAudioOutputPickerSupported()) return false;

  try {
    const device = await (
      navigator.mediaDevices as MediaDevices & {
        selectAudioOutput: () => Promise<MediaDeviceInfo>;
      }
    ).selectAudioOutput();

    if ('setSinkId' in audio) {
      await audio.setSinkId(device.deviceId);
    }
    return true;
  } catch {
    return false;
  }
}
