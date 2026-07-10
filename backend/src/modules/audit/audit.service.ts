import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';
import type { AuditActionType } from './audit-action';
import { User } from '../users/entities/user.entity';

export interface AuditRecordInput {
  action: AuditActionType;
  userId?: string;
  actorUserId?: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuditLogSummary {
  id: string;
  userId: string | null;
  userEmail: string | null;
  userDisplayName: string | null;
  userUsername: string | null;
  actorUserId: string | null;
  actorEmail: string | null;
  actorDisplayName: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
}

export interface PaginatedAuditLogs {
  items: AuditLogSummary[];
  total: number;
  page: number;
  limit: number;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  record(input: AuditRecordInput): void {
    void this.persist(input).catch((err) => {
      this.logger.warn(
        `Failed to write audit log (${input.action}): ${err instanceof Error ? err.message : err}`,
      );
    });
  }

  async list(options: {
    page?: number;
    limit?: number;
    userId?: string;
    action?: string;
    category?: string;
    from?: string;
    to?: string;
    q?: string;
  }): Promise<PaginatedAuditLogs> {
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(100, Math.max(1, options.limit ?? 30));
    const skip = (page - 1) * limit;

    const qb = this.auditRepo
      .createQueryBuilder('log')
      .orderBy('log.createdAt', 'DESC');

    if (options.userId) {
      qb.andWhere('(log.userId = :userId OR log.actorUserId = :userId)', {
        userId: options.userId,
      });
    }

    if (options.action?.trim()) {
      qb.andWhere('log.action = :action', { action: options.action.trim() });
    } else if (options.category?.trim()) {
      qb.andWhere('log.action LIKE :category', { category: `${options.category.trim()}.%` });
    }

    if (options.from) {
      qb.andWhere('log.createdAt >= :from', { from: new Date(options.from) });
    }

    if (options.to) {
      qb.andWhere('log.createdAt <= :to', { to: new Date(options.to) });
    }

    if (options.q?.trim()) {
      const q = `%${options.q.trim().toLowerCase()}%`;
      qb.leftJoin(User, 'auditUser', 'auditUser.id = log.userId')
        .leftJoin(User, 'auditActor', 'auditActor.id = log.actorUserId')
        .andWhere(
          `(LOWER(auditUser.email) LIKE :q OR LOWER(auditUser.username) LIKE :q OR LOWER(auditUser.displayName) LIKE :q
            OR LOWER(auditActor.email) LIKE :q OR LOWER(auditActor.username) LIKE :q OR LOWER(auditActor.displayName) LIKE :q
            OR LOWER(log.action) LIKE :q OR LOWER(log.resourceId) LIKE :q)`,
          { q },
        );
    }

    const [rows, total] = await qb.skip(skip).take(limit).getManyAndCount();

    const userIds = new Set<string>();
    for (const row of rows) {
      if (row.userId) userIds.add(row.userId);
      if (row.actorUserId) userIds.add(row.actorUserId);
    }

    const users =
      userIds.size > 0
        ? await this.userRepo.find({ where: { id: In([...userIds]) } })
        : [];
    const usersById = new Map(users.map((user) => [user.id, user]));

    return {
      items: rows.map((row) => this.toSummary(row, usersById)),
      total,
      page,
      limit,
    };
  }

  private async persist(input: AuditRecordInput) {
    await this.auditRepo.save(
      this.auditRepo.create({
        userId: input.userId ?? null,
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        resourceType: input.resourceType ?? null,
        resourceId: input.resourceId ?? null,
        metadata: this.sanitizeMetadata(input.metadata ?? {}),
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      }),
    );
  }

  private sanitizeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
    const blocked = new Set(['password', 'refreshToken', 'accessToken', 'token']);
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (blocked.has(key)) continue;
      out[key] = value;
    }
    return out;
  }

  private toSummary(row: AuditLog, usersById: Map<string, User>): AuditLogSummary {
    const user = row.userId ? usersById.get(row.userId) : undefined;
    const actor = row.actorUserId ? usersById.get(row.actorUserId) : undefined;

    return {
      id: row.id,
      userId: row.userId ?? null,
      userEmail: user?.email ?? null,
      userDisplayName: user?.displayName ?? null,
      userUsername: user?.username ?? null,
      actorUserId: row.actorUserId ?? null,
      actorEmail: actor?.email ?? null,
      actorDisplayName: actor?.displayName ?? null,
      action: row.action,
      resourceType: row.resourceType ?? null,
      resourceId: row.resourceId ?? null,
      metadata: row.metadata ?? {},
      ipAddress: row.ipAddress ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
