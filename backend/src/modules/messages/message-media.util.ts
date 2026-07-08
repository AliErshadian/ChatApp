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

export function isTextContentType(contentType: string): boolean {
  return contentType === 'text/plain' || contentType.startsWith('text/');
}

export function getMessageMediaKind(contentType: string): MessageMediaKind | 'text' {
  if (isTextContentType(contentType)) return 'text';
  if (contentType.startsWith('image/')) return 'image';
  if (contentType.startsWith('video/')) return 'video';
  if (contentType.startsWith('audio/')) return 'audio';
  return 'document';
}

export function validateMessageMediaFile(file: Express.Multer.File) {
  const ext = extname(file.originalname).toLowerCase();
  const mime = (file.mimetype || '').toLowerCase();

  const rule = MEDIA_RULES.find(
    (candidate) => candidate.extensions.has(ext) || candidate.mimeTypes.has(mime),
  );

  if (!rule) {
    throw new BadRequestException('Unsupported file type');
  }

  if (file.size > rule.maxBytes) {
    throw new BadRequestException(`File is too large for ${rule.kind} uploads`);
  }

  const resolvedMime = rule.mimeTypes.has(mime)
    ? mime
    : [...rule.mimeTypes].find((type) => type.startsWith(`${rule.kind}/`)) ?? mime;

  return {
    kind: rule.kind,
    mimeType: resolvedMime || file.mimetype,
    ext: rule.extensions.has(ext) ? ext : `.${rule.kind}`,
    originalName: file.originalname.slice(0, 255),
  };
}
