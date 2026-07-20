import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthenticationAuditLog } from './entities/authentication-audit-log.entity';
import type { AuthenticationProviderId } from '../auth/providers/auth-provider.types';

export const AuthAuditEvent = {
  LOGIN_SUCCESS: 'login.success',
  LOGIN_FAILED: 'login.failed',
  PROVIDER_ENABLED: 'provider.enabled',
  PROVIDER_DISABLED: 'provider.disabled',
  CONFIG_CHANGED: 'config.changed',
  CONNECTION_TEST: 'connection.test',
  CONNECTION_ERROR: 'connection.error',
  SYNC_STARTED: 'sync.started',
  SYNC_COMPLETED: 'sync.completed',
  SYNC_FAILED: 'sync.failed',
} as const;

export type AuthAuditEventType =
  (typeof AuthAuditEvent)[keyof typeof AuthAuditEvent];

export interface AuthAuditInput {
  provider: AuthenticationProviderId;
  eventType: AuthAuditEventType | string;
  success: boolean;
  username?: string;
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
  errorCode?: string;
  message?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuthenticationAuditService {
  constructor(
    @InjectRepository(AuthenticationAuditLog)
    private readonly auditRepo: Repository<AuthenticationAuditLog>,
  ) {}

  record(input: AuthAuditInput): void {
    void this.auditRepo
      .save(
        this.auditRepo.create({
          provider: input.provider,
          eventType: input.eventType,
          success: input.success,
          username: input.username?.slice(0, 255),
          userId: input.userId,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
          errorCode: input.errorCode,
          message: input.message?.slice(0, 2000),
          metadata: input.metadata ?? {},
        }),
      )
      .catch(() => {
        // fire-and-forget
      });
  }

  async list(params: {
    page?: number;
    limit?: number;
    provider?: AuthenticationProviderId;
    success?: boolean;
    eventType?: string;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 25));
    const qb = this.auditRepo
      .createQueryBuilder('log')
      .orderBy('log.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (params.provider) {
      qb.andWhere('log.provider = :provider', { provider: params.provider });
    }
    if (params.success !== undefined) {
      qb.andWhere('log.success = :success', { success: params.success });
    }
    if (params.eventType) {
      qb.andWhere('log.event_type = :eventType', { eventType: params.eventType });
    }

    const [items, total] = await qb.getManyAndCount();
    return {
      items: items.map((log) => ({
        id: log.id,
        provider: log.provider,
        eventType: log.eventType,
        success: log.success,
        username: log.username,
        userId: log.userId,
        ipAddress: log.ipAddress,
        errorCode: log.errorCode,
        message: log.message,
        metadata: log.metadata,
        createdAt: log.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
    };
  }

  async getStatistics() {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await this.auditRepo
      .createQueryBuilder('log')
      .select('log.provider', 'provider')
      .addSelect('log.success', 'success')
      .addSelect('COUNT(*)', 'count')
      .where('log.created_at >= :since', { since: since24h })
      .andWhere('log.event_type IN (:...events)', {
        events: [AuthAuditEvent.LOGIN_SUCCESS, AuthAuditEvent.LOGIN_FAILED],
      })
      .groupBy('log.provider')
      .addGroupBy('log.success')
      .getRawMany<{ provider: string; success: boolean; count: string }>();

    const stats = {
      last24h: {
        localSuccess: 0,
        localFailed: 0,
        adSuccess: 0,
        adFailed: 0,
      },
    };

    for (const row of rows) {
      const count = parseInt(row.count, 10) || 0;
      if (row.provider === 'local') {
        if (row.success) stats.last24h.localSuccess = count;
        else stats.last24h.localFailed = count;
      } else if (row.provider === 'active_directory') {
        if (row.success) stats.last24h.adSuccess = count;
        else stats.last24h.adFailed = count;
      }
    }

    return stats;
  }
}
