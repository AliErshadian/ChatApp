import { BadRequestException } from '@nestjs/common';
import { extname } from 'path';

export type MessageMediaKind = 'image' | 'video' | 'audio' | 'document';

interface MediaRule {
  kind: MessageMediaKind;
  mimeTypes: Set<string>;
  extensions: Set<string>;
  maxBytes: number;
}

const MEDIA_RULES: MediaRule[] = [
  {
    kind: 'image',
    mimeTypes: new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
    extensions: new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']),
    maxBytes: 10 * 1024 * 1024,
  },
  {
    kind: 'video',
    mimeTypes: new Set(['video/mp4', 'video/webm', 'video/quicktime']),
    extensions: new Set(['.mp4', '.webm', '.mov']),
    maxBytes: 50 * 1024 * 1024,
  },
  {
    kind: 'audio',
    mimeTypes: new Set([
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/x-wav',
      'audio/ogg',
      'audio/mp4',
      'audio/aac',
      'audio/webm',
    ]),
    extensions: new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.webm']),
    maxBytes: 25 * 1024 * 1024,
  },
  {
    kind: 'document',
    mimeTypes: new Set([
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
      'application/zip',
      'application/x-zip-compressed',
    ]),
    extensions: new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.zip']),
    maxBytes: 25 * 1024 * 1024,
  },
];

function normalizeMimeType(mime: string): string {
  return (mime || '').toLowerCase().split(';')[0]?.trim() ?? '';
}

function isVoiceRecordingName(name: string): boolean {
  const base = name.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? '';
  return base.startsWith('voice-');
}

function resolveMessageMediaRule(file: Express.Multer.File): MediaRule | undefined {
  const ext = extname(file.originalname).toLowerCase();
  const mime = normalizeMimeType(file.mimetype);

  if (isVoiceRecordingName(file.originalname)) {
    return MEDIA_RULES.find((rule) => rule.kind === 'audio');
  }

  const mimeMatch = MEDIA_RULES.find((rule) => rule.mimeTypes.has(mime));
  if (mimeMatch) return mimeMatch;

  if (ext === '.webm' && mime.startsWith('audio/')) {
    return MEDIA_RULES.find((rule) => rule.kind === 'audio');
  }

  return MEDIA_RULES.find((rule) => rule.extensions.has(ext));
}

export function isTextContentType(contentType: string): boolean {
  return contentType === 'text/plain' || contentType.startsWith('text/');
}

export const POLL_CONTENT_TYPE = 'application/vnd.relay.poll+json';
const LEGACY_POLL_CONTENT_TYPE = 'application/vnd.chatapp.poll+json';

export const SCREEN_SHARE_CONTENT_TYPE = 'application/vnd.relay.screen-share+json';

export function isPollContentType(contentType: string): boolean {
  return contentType === POLL_CONTENT_TYPE || contentType === LEGACY_POLL_CONTENT_TYPE;
}

export function isScreenShareContentType(contentType: string): boolean {
  return contentType === SCREEN_SHARE_CONTENT_TYPE;
}

export function getMessageMediaKind(
  contentType: string,
): MessageMediaKind | 'text' | 'poll' | 'screen_share' {
  if (isPollContentType(contentType)) return 'poll';
  if (isScreenShareContentType(contentType)) return 'screen_share';
  if (isTextContentType(contentType)) return 'text';
  if (contentType.startsWith('image/')) return 'image';
  if (contentType.startsWith('video/')) return 'video';
  if (contentType.startsWith('audio/')) return 'audio';
  return 'document';
}

export function validateMessageMediaFile(file: Express.Multer.File) {
  const ext = extname(file.originalname).toLowerCase();
  const mime = normalizeMimeType(file.mimetype);

  const rule = resolveMessageMediaRule(file);

  if (!rule) {
    throw new BadRequestException('Unsupported file type');
  }

  if (file.size > rule.maxBytes) {
    throw new BadRequestException(`File is too large for ${rule.kind} uploads`);
  }

  const resolvedMime = rule.mimeTypes.has(mime)
    ? mime
    : mime.startsWith(`${rule.kind}/`)
      ? mime
      : [...rule.mimeTypes].find((type) => type.startsWith(`${rule.kind}/`)) ?? mime;

  return {
    kind: rule.kind,
    mimeType: resolvedMime || file.mimetype,
    ext: rule.extensions.has(ext) ? ext : `.${rule.kind}`,
    originalName: file.originalname.slice(0, 255),
  };
}
