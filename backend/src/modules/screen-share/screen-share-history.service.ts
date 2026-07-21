import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ScreenShareSession } from './entities/screen-share-session.entity';
import { ScreenShareParticipant } from './entities/screen-share-participant.entity';
import type { ConversationType } from '../conversations/entities/conversation.entity';
import type { ScreenShareSource } from './screen-share.types';

@Injectable()
export class ScreenShareHistoryService {
  constructor(
    @InjectRepository(ScreenShareSession)
    private readonly sessionRepo: Repository<ScreenShareSession>,
    @InjectRepository(ScreenShareParticipant)
    private readonly participantRepo: Repository<ScreenShareParticipant>,
  ) {}

  async createSession(input: {
    id: string;
    conversationId: string;
    conversationType: ConversationType;
    hostUserId: string;
  }) {
    const now = new Date();
    const session = this.sessionRepo.create({
      id: input.id,
      conversationId: input.conversationId,
      conversationType: input.conversationType,
      hostUserId: input.hostUserId,
      status: 'active',
      startedAt: now,
    });
    await this.sessionRepo.save(session);
    await this.upsertParticipant(input.id, input.hostUserId, 'presenter');
    return session;
  }

  async upsertParticipant(
    sessionId: string,
    userId: string,
    role: 'presenter' | 'viewer',
  ) {
    let row = await this.participantRepo.findOne({
      where: { sessionId, userId },
    });
    if (row) {
      row.role = role;
      row.leftAt = null;
      row.connectionState = 'joined';
      row.joinedAt = new Date();
      return this.participantRepo.save(row);
    }
    row = this.participantRepo.create({
      sessionId,
      userId,
      role,
      connectionState: 'joined',
      joinedAt: new Date(),
    });
    return this.participantRepo.save(row);
  }

  async markParticipantLeft(sessionId: string, userId: string) {
    const row = await this.participantRepo.findOne({
      where: { sessionId, userId, leftAt: IsNull() },
    });
    if (!row) return;
    row.leftAt = new Date();
    row.connectionState = 'left';
    await this.participantRepo.save(row);
  }

  async setScreenSource(sessionId: string, source: ScreenShareSource | null) {
    await this.sessionRepo.update({ id: sessionId }, { screenSource: source });
  }

  async endSession(sessionId: string) {
    const session = await this.sessionRepo.findOne({ where: { id: sessionId } });
    if (!session || session.status === 'ended') return session;
    const endedAt = new Date();
    session.status = 'ended';
    session.endedAt = endedAt;
    session.durationSeconds = Math.max(
      0,
      Math.floor((endedAt.getTime() - session.startedAt.getTime()) / 1000),
    );
    await this.sessionRepo.save(session);
    await this.participantRepo
      .createQueryBuilder()
      .update(ScreenShareParticipant)
      .set({ leftAt: endedAt, connectionState: 'left' })
      .where('session_id = :sessionId AND left_at IS NULL', { sessionId })
      .execute();
    return session;
  }
}
