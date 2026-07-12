import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { buildStorageConfig } from '../../storage/config/storage.config';
import {
  IStorageProvider,
  STORAGE_PROVIDER,
} from '../../storage/interfaces/storage-provider.interface';
import { StorageCategory } from '../../storage/utils/mime.util';
import { Message } from '../messages/entities/message.entity';
import { getMessageMediaKind } from '../messages/message-media.util';

export interface StorageTableStat {
  name: string;
  bytes: number;
  approxRows: number;
}

export interface StorageFileCategory {
  id: string;
  label: string;
  bytes: number;
  fileCount: number;
}

export interface StorageMessageKind {
  kind: string;
  label: string;
  count: number;
  bytes: number;
}

export interface AdminStorageStats {
  totalBytes: number;
  database: {
    totalBytes: number;
    tables: StorageTableStat[];
  };
  files: {
    totalBytes: number;
    categories: StorageFileCategory[];
  };
  messages: {
    textCount: number;
    attachmentCount: number;
    attachmentBytes: number;
    byKind: StorageMessageKind[];
  };
}

const BUCKET_LABELS: Record<StorageCategory | 'backups', string> = {
  avatar: 'User avatars',
  image: 'Images',
  video: 'Videos',
  audio: 'Audio',
  document: 'Documents',
  backups: 'Backups',
};

const KIND_LABELS: Record<string, string> = {
  text: 'Text messages',
  image: 'Images',
  video: 'Videos',
  audio: 'Audio',
  document: 'Documents',
};

@Injectable()
export class AdminStorageService {
  private readonly logger = new Logger(AdminStorageService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    @Inject(STORAGE_PROVIDER)
    private readonly storageProvider: IStorageProvider,
    private readonly configService: ConfigService,
  ) {}

  async getStorageStats(): Promise<AdminStorageStats> {
    const [database, files, messages] = await Promise.all([
      this.getDatabaseStats(),
      this.getObjectStorageStats(),
      this.getMessageStats(),
    ]);

    return {
      totalBytes: database.totalBytes + files.totalBytes,
      database,
      files,
      messages,
    };
  }

  private async getDatabaseStats(): Promise<AdminStorageStats['database']> {
    const [sizeRow] = await this.dataSource.query<{ bytes: string }[]>(
      `SELECT pg_database_size(current_database())::bigint AS bytes`,
    );

    const tables = await this.dataSource.query<
      { name: string; bytes: string; approx_rows: string }[]
    >(
      `SELECT
         c.relname AS name,
         pg_total_relation_size(c.oid)::bigint AS bytes,
         GREATEST(c.reltuples, 0)::bigint AS approx_rows
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
       ORDER BY bytes DESC
       LIMIT 12`,
    );

    return {
      totalBytes: Number(sizeRow?.bytes ?? 0),
      tables: tables.map((row) => ({
        name: row.name,
        bytes: Number(row.bytes),
        approxRows: Number(row.approx_rows),
      })),
    };
  }

  private async getObjectStorageStats(): Promise<AdminStorageStats['files']> {
    const storageConfig = buildStorageConfig(this.configService);
    const bucketCategories = new Map<string, { id: string; label: string }>();

    for (const [category, bucket] of Object.entries(storageConfig.buckets)) {
      const label = BUCKET_LABELS[category as StorageCategory | 'backups'] ?? bucket;
      bucketCategories.set(bucket, { id: bucket, label });
    }

    const categories: StorageFileCategory[] = [];
    let totalBytes = 0;

    for (const [bucket, meta] of bucketCategories) {
      try {
        const stats = await this.storageProvider.getBucketStats(bucket);
        if (stats.objectCount === 0 && stats.bytes === 0) continue;

        categories.push({
          id: meta.id,
          label: meta.label,
          bytes: stats.bytes,
          fileCount: stats.objectCount,
        });
        totalBytes += stats.bytes;
      } catch (error) {
        this.logger.warn(
          `Failed to read MinIO stats for bucket "${bucket}"`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    categories.sort((a, b) => b.bytes - a.bytes);

    return { totalBytes, categories };
  }

  private async getMessageStats(): Promise<AdminStorageStats['messages']> {
    const rows = await this.messageRepo.query<
      { content_type: string; count: string; bytes: string }[]
    >(
      `SELECT
         content_type,
         COUNT(*)::int AS count,
         COALESCE(SUM(file_size), 0)::bigint AS bytes
       FROM messages
       WHERE deleted_at IS NULL
       GROUP BY content_type`,
    );

    const byKindMap = new Map<string, { count: number; bytes: number }>();
    let textCount = 0;
    let attachmentCount = 0;
    let attachmentBytes = 0;

    for (const row of rows) {
      const count = Number(row.count);
      const bytes = Number(row.bytes);
      const kind = getMessageMediaKind(row.content_type);

      if (kind === 'text') {
        textCount += count;
      } else {
        attachmentCount += count;
        attachmentBytes += bytes;
      }

      const current = byKindMap.get(kind) ?? { count: 0, bytes: 0 };
      current.count += count;
      current.bytes += bytes;
      byKindMap.set(kind, current);
    }

    const byKind: StorageMessageKind[] = ['text', 'image', 'video', 'audio', 'document']
      .map((kind) => {
        const data = byKindMap.get(kind);
        if (!data || data.count === 0) return null;
        return {
          kind,
          label: KIND_LABELS[kind] ?? kind,
          count: data.count,
          bytes: data.bytes,
        };
      })
      .filter((item): item is StorageMessageKind => item !== null);

    return { textCount, attachmentCount, attachmentBytes, byKind };
  }
}
