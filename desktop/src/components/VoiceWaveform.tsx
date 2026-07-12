import type { CSSProperties } from 'react';
import { formatVoiceDuration } from '../utils/voiceMessage';
import { normalizePeaks } from '../utils/voiceWaveform';

const BAR_AREA_HEIGHT_PX = 28;

interface Props {
  peaks: number[];
  progress?: number;
  variant?: 'live' | 'playback';
}

function WaveformBars({
  peaks,
  tone,
}: {
  peaks: number[];
  tone: 'muted' | 'accent' | 'live';
}) {
  const normalized = normalizePeaks(peaks);

  return (
    <div className={`voice-waveform-bars voice-waveform-bars-${tone}`}>
      {normalized.map((peak, index) => (
        <span
          key={index}
          className="voice-waveform-bar"
          style={{ height: `${Math.max(3, Math.round(peak * BAR_AREA_HEIGHT_PX))}px` }}
        />
      ))}
    </div>
  );
}

export function VoiceWaveform({ peaks, progress = 0, variant = 'playback' }: Props) {
  const clampedProgress = Math.min(1, Math.max(0, progress));

  if (variant === 'live') {
    return (
      <div className="voice-waveform voice-waveform-live" aria-hidden>
        <WaveformBars peaks={peaks} tone="live" />
      </div>
    );
  }

  return (
    <div
      className="voice-waveform voice-waveform-playback"
      style={{ '--voice-progress': String(clampedProgress) } as CSSProperties}
      aria-hidden
    >
      <div className="voice-waveform-track voice-waveform-track-muted">
        <WaveformBars peaks={peaks} tone="muted" />
      </div>
      <div className="voice-waveform-track voice-waveform-track-accent">
        <WaveformBars peaks={peaks} tone="accent" />
      </div>
    </div>
  );
}

interface TimerProps {
  elapsedMs: number;
}

export function VoiceRecordingTimer({ elapsedMs }: TimerProps) {
  return (
    <span className="voice-recording-timer" aria-live="polite">
      {formatVoiceDuration(elapsedMs / 1000)}
    </span>
  );
}
