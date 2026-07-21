import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ScreenShareAuditLog } from './entities/screen-share-audit-log.entity';

@Injectable()
export class ScreenShareAuditService {
  private readonly logger = new Logger(ScreenShareAuditService.name);

  constructor(
    @InjectRepository(ScreenShareAuditLog)
    private readonly auditRepo: Repository<ScreenShareAuditLog>,
  ) {}

  record(input: {
    eventType: string;
    sessionId?: string | null;
    conversationId?: string | null;
    actorUserId?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    const row = this.auditRepo.create({
      eventType: input.eventType,
      sessionId: input.sessionId ?? null,
      conversationId: input.conversationId ?? null,
      actorUserId: input.actorUserId ?? null,
      metadata: input.metadata ?? {},
    });
    void this.auditRepo.save(row).catch((err) => {
      this.logger.warn(`Failed to write screen audit: ${err}`);
    });
    this.logger.log(
      JSON.stringify({
        event: input.eventType,
        sessionId: input.sessionId,
        conversationId: input.conversationId,
        actorUserId: input.actorUserId,
        ...input.metadata,
      }),
    );
  }
}
