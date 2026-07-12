import { BadRequestException } from '@nestjs/common';
import { extname } from 'path';

export type StorageCategory = 'avatar' | 'image' | 'video' | 'audio' | 'document';

interface MediaRule {
  category: StorageCategory;
  mimeTypes: Set<string>;
  extensions: Set<string>;
}

const MEDIA_RULES: MediaRule[] = [
  {
    category: 'image',
    mimeTypes: new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp']),
    extensions: new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']),
  },
  {
    category: 'video',
    mimeTypes: new Set(['video/mp4', 'video/quicktime', 'video/webm']),
    extensions: new Set(['.mp4', '.mov', '.webm']),
  },
  {
    category: 'audio',
    mimeTypes: new Set([
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/x-wav',
      'audio/webm',
      'audio/ogg',
    ]),
    extensions: new Set(['.mp3', '.wav', '.webm', '.ogg']),
  },
  {
    category: 'document',
    mimeTypes: new Set([
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/zip',
      'application/x-zip-compressed',
    ]),
    extensions: new Set(['.pdf', '.docx', '.xlsx', '.pptx', '.zip']),
  },
];

const AVATAR_RULE: MediaRule = {
  category: 'avatar',
  mimeTypes: new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp']),
  extensions: new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']),
};

export interface ValidatedMedia {
  category: StorageCategory;
  mimeType: string;
  extension: string;
  originalName: string;
}

function sanitizeOriginalName(name: string): string {
  return name
    .replace(/[/\\]/g, '_')
    .replace(/[^\w.\- ()[\]]/g, '_')
    .slice(0, 255);
}

function normalizeMimeType(mime: string): string {
  return (mime || '').toLowerCase().split(';')[0]?.trim() ?? '';
}

function isVoiceRecordingName(name: string): boolean {
  const base = name.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? '';
  return base.startsWith('voice-');
}

function resolveRule(
  mime: string,
  ext: string,
  allowedCategories?: StorageCategory[],
  originalName?: string,
): MediaRule | undefined {
  const rules = allowedCategories
    ? MEDIA_RULES.filter((rule) => allowedCategories.includes(rule.category))
    : MEDIA_RULES;

  const normalizedMime = normalizeMimeType(mime);

  if (originalName && isVoiceRecordingName(originalName)) {
    return rules.find((rule) => rule.category === 'audio');
  }

  const mimeMatch = rules.find((rule) => rule.mimeTypes.has(normalizedMime));
  if (mimeMatch) return mimeMatch;

  if (ext === '.webm' && normalizedMime.startsWith('audio/')) {
    return rules.find((rule) => rule.category === 'audio');
  }

  return rules.find((rule) => rule.extensions.has(ext));
}

export function validateMediaFile(
  file: Express.Multer.File,
  options: { allowedCategories?: StorageCategory[]; forceCategory?: StorageCategory } = {},
): ValidatedMedia {
  const ext = extname(file.originalname).toLowerCase();
  const mime = normalizeMimeType(file.mimetype);

  if (options.forceCategory === 'avatar') {
    if (!AVATAR_RULE.extensions.has(ext) && !AVATAR_RULE.mimeTypes.has(mime)) {
      throw new BadRequestException('Unsupported avatar file type');
    }
    const resolvedMime = AVATAR_RULE.mimeTypes.has(mime)
      ? mime
      : [...AVATAR_RULE.mimeTypes].find((type) => type.startsWith('image/')) ?? mime;

    return {
      category: 'avatar',
      mimeType: resolvedMime || file.mimetype,
      extension: AVATAR_RULE.extensions.has(ext) ? ext : '.png',
      originalName: sanitizeOriginalName(file.originalname),
    };
  }

  const rule = resolveRule(mime, ext, options.allowedCategories, file.originalname);
  if (!rule) {
    throw new BadRequestException('Unsupported file type');
  }

  const resolvedMime = rule.mimeTypes.has(mime)
    ? mime
    : mime.startsWith(`${rule.category}/`)
      ? mime
      : [...rule.mimeTypes].find((type) => type.startsWith(`${rule.category}/`)) ?? mime;

  return {
    category: rule.category,
    mimeType: resolvedMime || file.mimetype,
    extension: rule.extensions.has(ext) ? ext : `.${rule.category}`,
    originalName: sanitizeOriginalName(file.originalname),
  };
}

export function categoryToBucketEnvKey(category: StorageCategory): string {
  switch (category) {
    case 'avatar':
      return 'S3_BUCKET_AVATARS';
    case 'image':
      return 'S3_BUCKET_ATTACHMENTS';
    case 'video':
      return 'S3_BUCKET_VIDEOS';
    case 'audio':
      return 'S3_BUCKET_VOICE';
    case 'document':
      return 'S3_BUCKET_DOCUMENTS';
    default:
      return 'S3_BUCKET_ATTACHMENTS';
  }
}
