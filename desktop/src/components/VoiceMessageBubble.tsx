import { useCallback, useEffect, useRef, useState } from 'react';
import { formatVoiceDuration } from '../utils/voiceMessage';
import {
  getVoiceMessageMeta,
  setVoiceMessageMeta,
  voiceMessageCacheKey,
} from '../utils/voiceMessageCache';
import { claimVoicePlayer, releaseVoicePlayer } from '../utils/voicePlayerRegistry';
import { decodeAudioBlob, isUsableDuration } from '../utils/voiceWaveform';
import { VoiceWaveform } from './VoiceWaveform';
import { Icon } from './Icon';
import { faPause, faPlay } from '@fortawesome/free-solid-svg-icons';

interface Props {
  messageId: string;
  clientMessageId?: string;
  attachmentId?: string;
  mediaUrl: string;
  isOwn: boolean;
}

function pickDuration(
  audioDuration: number,
  cachedDurationMs?: number,
  decodedDurationSec?: number,
): number {
  if (isUsableDuration(audioDuration)) return audioDuration;
  if (cachedDurationMs && cachedDurationMs > 0) return cachedDurationMs / 1000;
  if (decodedDurationSec && isUsableDuration(decodedDurationSec)) return decodedDurationSec;
  return 0;
}

export function VoiceMessageBubble({
  messageId,
  clientMessageId,
  attachmentId,
  mediaUrl,
  isOwn,
}: Props) {
  const playerId = attachmentId ?? messageId;
  const cacheKey = voiceMessageCacheKey({ id: messageId, clientMessageId, attachmentId });
  const cached = getVoiceMessageMeta(cacheKey);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number>();
  const decodedDurationRef = useRef(cached?.durationMs ? cached.durationMs / 1000 : 0);
  const [playing, setPlaying] = useState(false);
  const [durationSec, setDurationSec] = useState(
    cached?.durationMs ? cached.durationMs / 1000 : 0,
  );
  const [currentSec, setCurrentSec] = useState(0);
  const [peaks, setPeaks] = useState<number[]>(cached?.peaks ?? []);
  const [loadingPeaks, setLoadingPeaks] = useState(!cached?.peaks.length);

  const stopProgressLoop = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = undefined;
    }
  }, []);

  const syncDurationFromAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const next = pickDuration(audio.duration, cached?.durationMs, decodedDurationRef.current);
    if (next > 0) {
      setDurationSec(next);
    }
  }, [cached?.durationMs]);

  const syncProgress = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentSec(audio.currentTime);
    syncDurationFromAudio();
  }, [syncDurationFromAudio]);

  const startProgressLoop = useCallback(() => {
    stopProgressLoop();
    const tick = () => {
      syncProgress();
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [stopProgressLoop, syncProgress]);

  const pause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    stopProgressLoop();
    syncProgress();
    setPlaying(false);
  }, [stopProgressLoop, syncProgress]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onMetadata = () => syncDurationFromAudio();
    const onDurationChange = () => syncDurationFromAudio();
    const onEnded = () => {
      stopProgressLoop();
      setPlaying(false);
      setCurrentSec(0);
      releaseVoicePlayer(playerId);
    };

    audio.addEventListener('loadedmetadata', onMetadata);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('loadedmetadata', onMetadata);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('ended', onEnded);
    };
  }, [mediaUrl, playerId, stopProgressLoop, syncDurationFromAudio]);

  useEffect(() => {
    return () => {
      stopProgressLoop();
      releaseVoicePlayer(playerId);
    };
  }, [playerId, stopProgressLoop]);

  useEffect(() => {
    if (cached?.peaks.length) {
      setPeaks(cached.peaks);
      setLoadingPeaks(false);
      if (cached.durationMs) {
        decodedDurationRef.current = cached.durationMs / 1000;
        setDurationSec(cached.durationMs / 1000);
      }
      return;
    }

    let cancelled = false;
    setLoadingPeaks(true);

    void (async () => {
      try {
        const response = await fetch(mediaUrl);
        const blob = await response.blob();
        const decoded = await decodeAudioBlob(blob);
        if (cancelled) return;

        decodedDurationRef.current = decoded.durationSec;
        setPeaks(decoded.peaks);
        setDurationSec((prev) =>
          prev > 0 ? prev : pickDuration(0, cached?.durationMs, decoded.durationSec),
        );
        setVoiceMessageMeta(cacheKey, {
          peaks: decoded.peaks,
          durationMs: decoded.durationSec * 1000,
        });
      } catch {
        if (!cancelled) {
          setPeaks(Array.from({ length: 48 }, () => 0.2));
        }
      } finally {
        if (!cancelled) setLoadingPeaks(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cacheKey, mediaUrl, cached?.durationMs, cached?.peaks.length]);

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (playing) {
      pause();
      releaseVoicePlayer(playerId);
      return;
    }

    claimVoicePlayer(playerId, pause);
    try {
      if (audio.readyState < HTMLMediaElement.HAVE_METADATA) {
        audio.load();
      }
      await audio.play();
      setPlaying(true);
      startProgressLoop();
    } catch {
      releaseVoicePlayer(playerId);
      setPlaying(false);
      stopProgressLoop();
    }
  };

  const handleWaveformClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    const total = durationSec > 0 ? durationSec : decodedDurationRef.current;
    if (!audio || !total) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * total;
    setCurrentSec(audio.currentTime);
  };

  const effectiveDuration =
    durationSec > 0 ? durationSec : decodedDurationRef.current > 0 ? decodedDurationRef.current : 0;
  const progress = effectiveDuration > 0 ? Math.min(1, currentSec / effectiveDuration) : 0;
  const displayDuration = effectiveDuration;

  return (
    <div className={`voice-message ${isOwn ? 'own' : 'incoming'}`}>
      <audio ref={audioRef} src={mediaUrl} preload="metadata" playsInline className="voice-message-audio" />
      <button
        type="button"
        className="voice-message-play"
        onClick={(event) => {
          event.stopPropagation();
          void togglePlayback();
        }}
        aria-label={playing ? 'Pause voice message' : 'Play voice message'}
      >
        <Icon icon={playing ? faPause : faPlay} />
      </button>
      <div className="voice-message-body">
        <div
          className="voice-message-waveform-hit"
          onClick={(event) => {
            event.stopPropagation();
            handleWaveformClick(event);
          }}
          role="presentation"
        >
          <VoiceWaveform
            peaks={peaks.length ? peaks : Array.from({ length: 48 }, () => 0.12)}
            progress={progress}
          />
        </div>
        <span className="voice-message-duration">
          {playing || currentSec > 0
            ? formatVoiceDuration(currentSec)
            : formatVoiceDuration(displayDuration)}
        </span>
      </div>
      {loadingPeaks && <span className="voice-message-loading" aria-hidden />}
    </div>
  );
}
