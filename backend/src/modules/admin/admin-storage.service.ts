import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
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

const FILE_CATEGORIES: Array<{ id: string; label: string; relativePath: string }> = [
  { id: 'avatars', label: 'User avatars', relativePath: 'avatars' },
  { id: 'channel_avatars', label: 'Channel & group photos', relativePath: 'channel-avatars' },
  { id: 'message_attachments', label: 'Message attachments', relativePath: 'message-attachments' },
];

const KIND_LABELS: Record<string, string> = {
  text: 'Text messages',
  image: 'Images',
  video: 'Videos',
  audio: 'Audio',
  document: 'Documents',
};

@Injectable()
export class AdminStorageService {
  private readonly uploadsRoot = join(process.cwd(), 'uploads');

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
  ) {}

  async getStorageStats(): Promise<AdminStorageStats> {
    const [database, files, messages] = await Promise.all([
      this.getDatabaseStats(),
      Promise.resolve(this.getFileStats()),
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

  private getFileStats(): AdminStorageStats['files'] {
    const categories: StorageFileCategory[] = [];
    let totalBytes = 0;

    for (const category of FILE_CATEGORIES) {
      const dir = join(this.uploadsRoot, category.relativePath);
      const stats = this.scanDirectory(dir);
      categories.push({
        id: category.id,
        label: category.label,
        bytes: stats.bytes,
        fileCount: stats.fileCount,
      });
      totalBytes += stats.bytes;
    }

    const otherDir = this.uploadsRoot;
    if (existsSync(otherDir)) {
      let otherBytes = 0;
      let otherFiles = 0;
      for (const entry of readdirSync(otherDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (FILE_CATEGORIES.some((c) => c.relativePath === entry.name)) continue;
        const nested = this.scanDirectory(join(otherDir, entry.name));
        otherBytes += nested.bytes;
        otherFiles += nested.fileCount;
      }
      if (otherBytes > 0 || otherFiles > 0) {
        categories.push({
          id: 'other',
          label: 'Other uploads',
          bytes: otherBytes,
          fileCount: otherFiles,
        });
        totalBytes += otherBytes;
      }
    }

    return { totalBytes, categories };
  }

  private scanDirectory(dir: string): { bytes: number; fileCount: number } {
    if (!existsSync(dir)) return { bytes: 0, fileCount: 0 };

    let bytes = 0;
    let fileCount = 0;

    const walk = (current: string) => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const fullPath = join(current, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
          continue;
        }
        if (!entry.isFile()) continue;
        try {
          bytes += statSync(fullPath).size;
          fileCount += 1;
        } catch {
          // ignore unreadable files
        }
      }
    };

    walk(dir);
    return { bytes, fileCount };
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
