import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createVoiceFileName,
  MAX_VOICE_RECORD_MS,
  MIN_VOICE_RECORD_MS,
  normalizeVoiceMimeType,
  pickRecorderMimeType,
  VOICE_WAVEFORM_BARS,
} from '../utils/voiceMessage';
import { computeWaveformPeaks, normalizePeaks } from '../utils/voiceWaveform';
import { getMediaDevicesUnavailableMessage, getUserAudioStream } from '../utils/mediaDevices';

export type VoiceRecorderPhase = 'idle' | 'recording';

export interface VoiceRecordingResult {
  file: File;
  durationMs: number;
  peaks: number[];
  previewUrl: string;
}

export function useVoiceRecorder(options?: {
  onRecordingChange?: (recording: boolean) => void;
  onAutoSend?: (result: VoiceRecordingResult) => void;
}) {
  const [phase, setPhase] = useState<VoiceRecorderPhase>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [livePeaks, setLivePeaks] = useState<number[]>(() =>
    Array.from({ length: VOICE_WAVEFORM_BARS }, () => 0.08),
  );
  const [processing, setProcessing] = useState(false);

  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef('');
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>>();
  const rafRef = useRef<number>();
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const cleanupStream = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = undefined;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = undefined;
    }
    analyserRef.current = null;
    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  const resetIdle = useCallback(() => {
    cleanupStream();
    setPhase('idle');
    setElapsedMs(0);
    setLivePeaks(Array.from({ length: VOICE_WAVEFORM_BARS }, () => 0.08));
    setProcessing(false);
    options?.onRecordingChange?.(false);
  }, [cleanupStream, options]);

  const buildResult = useCallback(async (blob: Blob, durationMs: number): Promise<VoiceRecordingResult> => {
    const mimeType = normalizeVoiceMimeType(mimeTypeRef.current || blob.type || pickRecorderMimeType());
    const normalizedBlob =
      blob.type === mimeType ? blob : new Blob([blob], { type: mimeType });
    const file = new File([normalizedBlob], createVoiceFileName(mimeType), { type: mimeType });
    const previewUrl = URL.createObjectURL(normalizedBlob);
    let peaks: number[];
    try {
      peaks = await computeWaveformPeaks(normalizedBlob);
    } catch {
      peaks = Array.from({ length: VOICE_WAVEFORM_BARS }, () => 0.2);
    }
    return { file, durationMs, peaks, previewUrl };
  }, []);

  const finishRecording = useCallback(
    async (shouldSend: boolean): Promise<VoiceRecordingResult | null> => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        resetIdle();
        return null;
      }

      setProcessing(true);

      const durationMs = Math.max(0, Date.now() - startedAtRef.current);

      const blob = await new Promise<Blob | null>((resolve) => {
        recorder.addEventListener(
          'stop',
          () => {
            const type = normalizeVoiceMimeType(
              mimeTypeRef.current || recorder.mimeType || pickRecorderMimeType(),
            );
            if (!chunksRef.current.length) {
              resolve(null);
              return;
            }
            resolve(new Blob(chunksRef.current, { type }));
          },
          { once: true },
        );
        recorder.stop();
      });

      cleanupStream();
      setPhase('idle');
      options?.onRecordingChange?.(false);

      if (!shouldSend || !blob || durationMs < MIN_VOICE_RECORD_MS) {
        setProcessing(false);
        setElapsedMs(0);
        return null;
      }

      try {
        const result = await buildResult(blob, durationMs);
        setProcessing(false);
        setElapsedMs(0);
        return result;
      } catch {
        setProcessing(false);
        setElapsedMs(0);
        return null;
      }
    },
    [buildResult, cleanupStream, options, resetIdle],
  );

  const startRecording = useCallback(async () => {
    if (phaseRef.current !== 'idle' || processing) return false;

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(getMediaDevicesUnavailableMessage());
    }

    const mimeType = pickRecorderMimeType();
    if (!mimeType) {
      throw new Error('Voice recording is not supported in this browser');
    }

    const stream = await getUserAudioStream();
    const recorder = new MediaRecorder(stream, { mimeType });
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    streamRef.current = stream;
    recorderRef.current = recorder;
    mimeTypeRef.current = mimeType;
    chunksRef.current = [];
    startedAtRef.current = Date.now();
    audioContextRef.current = audioContext;
    analyserRef.current = analyser;

    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    });

    recorder.start(200);
    setPhase('recording');
    setElapsedMs(0);
    setLivePeaks(Array.from({ length: VOICE_WAVEFORM_BARS }, () => 0.08));
    options?.onRecordingChange?.(true);

    timerRef.current = setInterval(() => {
      const next = Date.now() - startedAtRef.current;
      setElapsedMs(next);
      if (next >= MAX_VOICE_RECORD_MS) {
        void finishRecording(true).then((result) => {
          if (result) options?.onAutoSend?.(result);
        });
      }
    }, 100);

    const sampleLivePeaks = () => {
      const analyserNode = analyserRef.current;
      if (!analyserNode) return;
      const bins = new Uint8Array(analyserNode.frequencyBinCount);
      analyserNode.getByteFrequencyData(bins);
      const chunk = Math.max(1, Math.floor(bins.length / VOICE_WAVEFORM_BARS));
      const nextPeaks: number[] = [];
      for (let i = 0; i < VOICE_WAVEFORM_BARS; i++) {
        let sum = 0;
        const start = i * chunk;
        for (let j = 0; j < chunk; j++) {
          sum += bins[start + j] ?? 0;
        }
        nextPeaks.push(sum / chunk / 255);
      }
      setLivePeaks(normalizePeaks(nextPeaks));
      rafRef.current = requestAnimationFrame(sampleLivePeaks);
    };
    rafRef.current = requestAnimationFrame(sampleLivePeaks);

    return true;
  }, [finishRecording, options, processing]);

  const cancelRecording = useCallback(async () => {
    if (phaseRef.current === 'idle') return;
    await finishRecording(false);
  }, [finishRecording]);

  const stopAndSend = useCallback(async () => {
    if (phaseRef.current !== 'recording') return null;
    return finishRecording(true);
  }, [finishRecording]);

  useEffect(() => {
    return () => {
      cleanupStream();
    };
  }, [cleanupStream]);

  return {
    phase,
    elapsedMs,
    livePeaks,
    processing,
    startRecording,
    cancelRecording,
    stopAndSend,
  };
}
