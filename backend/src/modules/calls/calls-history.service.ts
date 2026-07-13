import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UsersService } from '../users/users.service';
import { CallRecord } from './entities/call-record.entity';
import type { CallEndedPayload } from './call.types';
import {
  getCallHistoryCategory,
  getCallHistoryLabel,
  type CallHistoryCategory,
} from './call-history.util';

export interface RecordCallEndInput {
  callId: string;
  conversationId: string;
  callerId: string;
  calleeId: string;
  endReason: CallEndedPayload['reason'];
  endedBy?: string;
  startedAt: Date;
  answeredAt?: Date | null;
  endedAt: Date;
}

@Injectable()
export class CallsHistoryService {
  constructor(
    @InjectRepository(CallRecord)
    private readonly callRecordRepo: Repository<CallRecord>,
    private readonly usersService: UsersService,
  ) {}

  async recordCallEnd(input: RecordCallEndInput): Promise<void> {
    const durationSeconds =
      input.answeredAt && input.endReason === 'ended'
        ? Math.max(0, Math.round((input.endedAt.getTime() - input.answeredAt.getTime()) / 1000))
        : null;

    await this.callRecordRepo.save(
      this.callRecordRepo.create({
        callId: input.callId,
        conversationId: input.conversationId,
        callerId: input.callerId,
        calleeId: input.calleeId,
        endReason: input.endReason,
        endedBy: input.endedBy ?? null,
        startedAt: input.startedAt,
        answeredAt: input.answeredAt ?? null,
        endedAt: input.endedAt,
        durationSeconds,
      }),
    );
  }

  async list(
    userId: string,
    options: { filter?: CallHistoryCategory | 'all'; cursor?: string; limit?: number } = {},
  ) {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
    const filter = options.filter ?? 'all';

    const qb = this.callRecordRepo
      .createQueryBuilder('call')
      .leftJoinAndSelect('call.caller', 'caller')
      .leftJoinAndSelect('call.callee', 'callee')
      .where('(call.callerId = :userId OR call.calleeId = :userId)', { userId })
      .orderBy('call.endedAt', 'DESC')
      .addOrderBy('call.id', 'DESC')
      .take(limit + 1);

    if (options.cursor) {
      qb.andWhere('call.endedAt < :cursor', { cursor: new Date(options.cursor) });
    }

    this.applyFilter(qb, filter, userId);

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const items = page.map((row) => this.toHistoryItem(row, userId));
    const nextCursor = hasMore && items.length > 0 ? items[items.length - 1]!.endedAt : null;

    return {
      items,
      nextCursor,
    };
  }

  private applyFilter(
    qb: ReturnType<Repository<CallRecord>['createQueryBuilder']>,
    filter: CallHistoryCategory | 'all',
    userId: string,
  ) {
    switch (filter) {
      case 'incoming':
        qb.andWhere('call.calleeId = :userId', { userId })
          .andWhere('call.answeredAt IS NOT NULL')
          .andWhere("call.endReason = 'ended'");
        break;
      case 'outgoing':
        qb.andWhere('call.callerId = :userId', { userId })
          .andWhere('call.answeredAt IS NOT NULL')
          .andWhere("call.endReason = 'ended'");
        break;
      case 'cancelled':
        qb.andWhere('call.callerId = :userId', { userId }).andWhere("call.endReason = 'cancelled'");
        break;
      case 'missed':
        qb.andWhere('call.calleeId = :userId', { userId })
          .andWhere('call.answeredAt IS NULL')
          .andWhere(
            "(call.endReason IN ('timeout', 'cancelled') OR (call.endReason = 'rejected' AND (call.endedBy IS NULL OR call.endedBy != :userId)))",
            { userId },
          );
        break;
      case 'not_answered':
        qb.andWhere('call.callerId = :userId', { userId })
          .andWhere('call.answeredAt IS NULL')
          .andWhere("call.endReason IN ('timeout', 'rejected', 'busy', 'unavailable')");
        break;
      default:
        break;
    }
  }

  private toHistoryItem(record: CallRecord, userId: string) {
    const isCaller = record.callerId === userId;
    const peerUser = isCaller ? record.callee : record.caller;
    const category = getCallHistoryCategory(
      {
        callerId: record.callerId,
        calleeId: record.calleeId,
        endReason: record.endReason,
        endedBy: record.endedBy,
        answeredAt: record.answeredAt,
      },
      userId,
    );

    return {
      id: record.id,
      callId: record.callId,
      conversationId: record.conversationId,
      peer: this.usersService.toPublic(peerUser),
      category,
      label: getCallHistoryLabel(category, record.endReason, record.endedBy, userId),
      endReason: record.endReason,
      startedAt: record.startedAt.toISOString(),
      answeredAt: record.answeredAt?.toISOString() ?? null,
      endedAt: record.endedAt.toISOString(),
      durationSeconds: record.durationSeconds,
    };
  }
}
