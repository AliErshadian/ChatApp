import { VOICE_WAVEFORM_BARS } from './voiceMessage';

export async function computeWaveformPeaks(
  blob: Blob,
  barCount = VOICE_WAVEFORM_BARS,
): Promise<number[]> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioContext = new AudioContext();
  try {
    const buffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    return peaksFromAudioBuffer(buffer, barCount);
  } finally {
    await audioContext.close();
  }
}

export function peaksFromAudioBuffer(buffer: AudioBuffer, barCount = VOICE_WAVEFORM_BARS): number[] {
  const channel = buffer.getChannelData(0);
  if (!channel.length) return Array.from({ length: barCount }, () => 0.08);

  const blockSize = Math.max(1, Math.floor(channel.length / barCount));
  const peaks: number[] = [];

  for (let i = 0; i < barCount; i++) {
    let sum = 0;
    const start = i * blockSize;
    const end = Math.min(channel.length, start + blockSize);
    for (let j = start; j < end; j++) {
      sum += Math.abs(channel[j] ?? 0);
    }
    peaks.push(sum / (end - start));
  }

  const max = Math.max(...peaks, 0.001);
  return peaks.map((peak) => Math.max(0.08, peak / max));
}

export function normalizePeaks(peaks: number[]): number[] {
  if (!peaks.length) return [];
  const max = Math.max(...peaks, 0.001);
  return peaks.map((peak) => Math.max(0.08, peak / max));
}

export interface DecodedAudioMeta {
  peaks: number[];
  durationSec: number;
}

export async function decodeAudioBlob(
  blob: Blob,
  barCount = VOICE_WAVEFORM_BARS,
): Promise<DecodedAudioMeta> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioContext = new AudioContext();
  try {
    const buffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    return {
      peaks: peaksFromAudioBuffer(buffer, barCount),
      durationSec: buffer.duration,
    };
  } finally {
    await audioContext.close();
  }
}

export function isUsableDuration(seconds: number): boolean {
  return Number.isFinite(seconds) && seconds > 0 && seconds !== Infinity;
}
