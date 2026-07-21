export type ScreenShareSourceKind = 'screen' | 'window' | 'monitor' | 'application';

export interface ScreenCaptureSource {
  id: string;
  name: string;
  displayId?: string;
  kind: 'screen' | 'window';
  thumbnailDataUrl?: string;
  appIconDataUrl?: string | null;
}

export type ConnectionQualityLevel = 'good' | 'fair' | 'poor' | 'unknown';

/** Synthetic id used when the OS/Chromium picker chose the source via getDisplayMedia. */
export const SYSTEM_PICKER_SOURCE_ID = '__system_picker__';

export function mapSourceKind(source: ScreenCaptureSource): ScreenShareSourceKind {
  if (source.kind === 'screen') {
    return source.displayId ? 'monitor' : 'screen';
  }
  return 'window';
}

export async function listScreenCaptureSources(
  types: Array<'screen' | 'window'> = ['screen', 'window'],
): Promise<ScreenCaptureSource[]> {
  if (!window.electronAPI?.listScreenSources) {
    throw new Error(
      'Screen source list is unavailable. Restart the desktop app, or use the system picker.',
    );
  }
  return window.electronAPI.listScreenSources({ types });
}

export function canUseSystemDisplayPicker(): boolean {
  return typeof navigator.mediaDevices?.getDisplayMedia === 'function';
}

/**
 * Acquire a display media stream.
 * - With a concrete Electron source id → chromeMediaSource desktop capture
 * - With SYSTEM_PICKER_SOURCE_ID / no id → Chromium getDisplayMedia picker
 */
export async function getScreenShareStream(options?: {
  sourceId?: string;
  maxFps?: number;
}): Promise<MediaStream> {
  const maxFps = options?.maxFps ?? 15;
  const sourceId = options?.sourceId;
  const useSystemPicker = !sourceId || sourceId === SYSTEM_PICKER_SOURCE_ID;

  if (useSystemPicker) {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('Screen capture is not supported in this environment');
    }
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: maxFps, max: maxFps },
      },
      audio: false,
    });
    applyScreenTrackHints(stream);
    return stream;
  }

  const constraints: MediaStreamConstraints = {
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
        maxFrameRate: maxFps,
      },
    } as unknown as MediaTrackConstraints,
  };

  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  applyScreenTrackHints(stream);
  return stream;
}

export function applyScreenTrackHints(stream: MediaStream) {
  for (const track of stream.getVideoTracks()) {
    try {
      track.contentHint = 'detail';
      const params = track.getConstraints?.() ?? {};
      void track
        .applyConstraints({
          ...params,
          advanced: [{ width: 1920, height: 1080 }],
        } as MediaTrackConstraints)
        .catch(() => undefined);
    } catch {
      // ignore unsupported hints
    }
  }
}

export async function measureConnectionQuality(
  pc: RTCPeerConnection,
): Promise<{
  level: ConnectionQualityLevel;
  rttMs?: number;
  packetLoss?: number;
  bitrateKbps?: number;
}> {
  try {
    const stats = await pc.getStats();
    let rttMs: number | undefined;
    let packetsLost = 0;
    let packetsReceived = 0;
    let bytesReceived = 0;

    stats.forEach((report) => {
      if (
        report.type === 'candidate-pair' &&
        (report as RTCIceCandidatePairStats).state === 'succeeded'
      ) {
        const pair = report as RTCIceCandidatePairStats;
        if (typeof pair.currentRoundTripTime === 'number') {
          rttMs = pair.currentRoundTripTime * 1000;
        }
      }
      if (report.type === 'inbound-rtp' && (report as RTCInboundRtpStreamStats).kind === 'video') {
        const inbound = report as RTCInboundRtpStreamStats;
        packetsLost += inbound.packetsLost ?? 0;
        packetsReceived += inbound.packetsReceived ?? 0;
        bytesReceived += inbound.bytesReceived ?? 0;
      }
    });

    const total = packetsLost + packetsReceived;
    const packetLoss = total > 0 ? packetsLost / total : undefined;
    const bitrateKbps = bytesReceived > 0 ? undefined : undefined;

    let level: ConnectionQualityLevel = 'good';
    if ((rttMs != null && rttMs > 400) || (packetLoss != null && packetLoss > 0.08)) {
      level = 'poor';
    } else if ((rttMs != null && rttMs > 200) || (packetLoss != null && packetLoss > 0.03)) {
      level = 'fair';
    }

    return { level, rttMs, packetLoss, bitrateKbps };
  } catch {
    return { level: 'unknown' };
  }
}

export function formatShareDuration(startedAtMs: number, nowMs = Date.now()): string {
  const seconds = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
