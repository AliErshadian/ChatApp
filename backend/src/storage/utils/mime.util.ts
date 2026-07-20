import { BadRequestException } from '@nestjs/common';
import { extractExtensions, scanUploadedFile, type SniffedContent } from './file-scan.util';

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

function categoryForSniffed(
  sniffed: SniffedContent,
  finalExt: string,
  declaredMime: string,
  originalName: string,
  allowedCategories?: StorageCategory[],
): StorageCategory | undefined {
  const rules = allowedCategories
    ? MEDIA_RULES.filter((rule) => allowedCategories.includes(rule.category))
    : MEDIA_RULES;

  // Voice notes: EBML/webm often sniffs as video/webm; prefer audio when named voice-* or declared audio/*
  if (
    (isVoiceRecordingName(originalName) || declaredMime.startsWith('audio/')) &&
    (finalExt === '.webm' || sniffed.mimeType.includes('webm') || sniffed.mimeType === 'audio/ogg')
  ) {
    const audio = rules.find((rule) => rule.category === 'audio');
    if (audio?.extensions.has(finalExt)) return 'audio';
  }

  if (sniffed.kind === 'image') {
    return rules.find((r) => r.category === 'image') ? 'image' : undefined;
  }
  if (sniffed.kind === 'video') {
    // .webm without audio hint → video
    if (finalExt === '.webm' && declaredMime.startsWith('audio/')) {
      return rules.find((r) => r.category === 'audio') ? 'audio' : undefined;
    }
    return rules.find((r) => r.category === 'video') ? 'video' : undefined;
  }
  if (sniffed.kind === 'audio') {
    return rules.find((r) => r.category === 'audio') ? 'audio' : undefined;
  }
  if (sniffed.kind === 'document' || sniffed.kind === 'archive') {
    return rules.find((r) => r.category === 'document') ? 'document' : undefined;
  }
  return undefined;
}

function resolveCanonicalMime(rule: MediaRule, sniffed: SniffedContent, declared: string): string {
  if (rule.mimeTypes.has(sniffed.mimeType)) return sniffed.mimeType;
  if (rule.category === 'audio' && sniffed.mimeType.includes('webm')) return 'audio/webm';
  if (rule.mimeTypes.has(declared)) return declared;
  return [...rule.mimeTypes][0] ?? sniffed.mimeType;
}

export function validateMediaFile(
  file: Express.Multer.File,
  options: { allowedCategories?: StorageCategory[]; forceCategory?: StorageCategory } = {},
): ValidatedMedia {
  const { finalExtension, sniffed } = scanUploadedFile(file);
  const declared = normalizeMimeType(file.mimetype);
  const originalName = sanitizeOriginalName(file.originalname);

  if (options.forceCategory === 'avatar') {
    if (sniffed.kind !== 'image' || !AVATAR_RULE.extensions.has(finalExtension)) {
      throw new BadRequestException('Unsupported avatar file type');
    }
    if (!AVATAR_RULE.mimeTypes.has(sniffed.mimeType) && !AVATAR_RULE.mimeTypes.has(declared)) {
      throw new BadRequestException('Unsupported avatar file type');
    }
    return {
      category: 'avatar',
      mimeType: sniffed.mimeType === 'image/jpeg' ? 'image/jpeg' : sniffed.mimeType,
      extension: finalExtension,
      originalName,
    };
  }

  const category = categoryForSniffed(
    sniffed,
    finalExtension,
    declared,
    file.originalname,
    options.allowedCategories,
  );
  if (!category) {
    throw new BadRequestException('Unsupported file type');
  }

  const rule = MEDIA_RULES.find((r) => r.category === category);
  if (!rule || !rule.extensions.has(finalExtension)) {
    throw new BadRequestException('File extension does not match content type');
  }

  // Require extension ∈ rule AND sniffed content aligns with category (already from scan)
  if (options.allowedCategories && !options.allowedCategories.includes(category)) {
    throw new BadRequestException('Unsupported file type for this upload');
  }

  return {
    category,
    mimeType: resolveCanonicalMime(rule, sniffed, declared),
    extension: finalExtension,
    originalName,
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

/** Re-export for callers that only need extension parsing. */
export { extractExtensions };
