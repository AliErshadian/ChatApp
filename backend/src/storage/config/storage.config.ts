import { ConfigService } from '@nestjs/config';
import { StorageCategory } from '../utils/mime.util';

export interface StorageConfig {
  endpoint: string;
  port: number;
  ssl: boolean;
  accessKey: string;
  secretKey: string;
  region: string;
  presignedUrlExpiresSeconds: number;
  buckets: Record<StorageCategory | 'backups', string>;
  maxBytes: Record<StorageCategory, number>;
}

function mbToBytes(mb: number): number {
  return Math.floor(mb * 1024 * 1024);
}

export function buildStorageConfig(config: ConfigService): StorageConfig {
  const rawEndpoint = config.get<string>('S3_ENDPOINT', '127.0.0.1');
  const endpoint = rawEndpoint === 'localhost' ? '127.0.0.1' : rawEndpoint;
  const port = config.get<number>('S3_PORT', 9000);
  const ssl = config.get<string>('S3_SSL', 'false') === 'true';

  return {
    endpoint,
    port,
    ssl,
    accessKey: config.get<string>('S3_ACCESS_KEY', 'minioadmin'),
    secretKey: config.get<string>('S3_SECRET_KEY', 'minioadmin'),
    region: config.get<string>('S3_REGION', 'us-east-1'),
    presignedUrlExpiresSeconds: config.get<number>('S3_PRESIGNED_URL_EXPIRES_SECONDS', 120),
    buckets: {
      avatar: config.get<string>('S3_BUCKET_AVATARS', 'avatars'),
      image: config.get<string>('S3_BUCKET_ATTACHMENTS', 'attachments'),
      video: config.get<string>('S3_BUCKET_VIDEOS', 'videos'),
      audio: config.get<string>('S3_BUCKET_VOICE', 'voice'),
      document: config.get<string>('S3_BUCKET_DOCUMENTS', 'documents'),
      backups: config.get<string>('S3_BUCKET_BACKUPS', 'backups'),
    },
    maxBytes: {
      avatar: mbToBytes(config.get<number>('STORAGE_MAX_AVATAR_MB', 5)),
      image: mbToBytes(config.get<number>('STORAGE_MAX_IMAGE_MB', 20)),
      document: mbToBytes(config.get<number>('STORAGE_MAX_DOCUMENT_MB', 100)),
      video: mbToBytes(config.get<number>('STORAGE_MAX_VIDEO_MB', 500)),
      audio: mbToBytes(config.get<number>('STORAGE_MAX_VOICE_MB', 50)),
    },
  };
}

export function buildS3EndpointUrl(config: StorageConfig): string {
  const protocol = config.ssl ? 'https' : 'http';
  const host = config.endpoint.includes('://') ? config.endpoint : `${protocol}://${config.endpoint}`;
  const parsed = new URL(host);
  if (!config.endpoint.includes('://') && config.port) {
    parsed.port = String(config.port);
  }
  return parsed.toString().replace(/\/$/, '');
}
