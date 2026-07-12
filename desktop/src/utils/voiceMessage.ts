import { Message } from '../services/api';

export const VOICE_MESSAGE_PREFIX = 'voice-';
export const MIN_VOICE_RECORD_MS = 500;
export const MAX_VOICE_RECORD_MS = 5 * 60 * 1000;
export const VOICE_WAVEFORM_BARS = 48;

export function isVoiceMessage(message: Pick<Message, 'fileName' | 'contentType'>): boolean {
  return message.fileName?.toLowerCase().startsWith(VOICE_MESSAGE_PREFIX) ?? false;
}

export function normalizeVoiceMimeType(mimeType: string): string {
  const base = (mimeType || '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (!base || base === 'application/octet-stream') return 'audio/webm';
  if (base.startsWith('video/webm')) return 'audio/webm';
  if (base.startsWith('audio/')) return base;
  return 'audio/webm';
}

export function pickRecorderMimeType(): string {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4',
  ];
  for (const type of types) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return 'audio/webm';
}

export function voiceFileExtension(mimeType: string): string {
  const normalized = normalizeVoiceMimeType(mimeType);
  if (normalized.includes('ogg')) return 'ogg';
  if (normalized.includes('mp4')) return 'm4a';
  return 'webm';
}

export function createVoiceFileName(mimeType: string): string {
  return `${VOICE_MESSAGE_PREFIX}${Date.now()}.${voiceFileExtension(mimeType)}`;
}

export function formatVoiceDuration(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = Math.floor(safe % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
