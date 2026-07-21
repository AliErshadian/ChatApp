import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.constants';
import type { ActiveScreenSession, ScreenShareSource } from './screen-share.types';

const KEY_PREFIX = 'screen:session:';
const CONV_KEY_PREFIX = 'screen:conv:';
const IDLE_TTL_MS = 2 * 60 * 1000;

@Injectable()
export class ScreenShareRegistryService implements OnModuleDestroy {
  private readonly logger = new Logger(ScreenShareRegistryService.name);
  private readonly local = new Map<string, ActiveScreenSession>();
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private onIdleEnd: ((sessionId: string) => void) | null = null;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {
    this.idleTimer = setInterval(() => void this.sweepIdle(), 30_000);
  }

  onModuleDestroy() {
    if (this.idleTimer) clearInterval(this.idleTimer);
  }

  setIdleEndHandler(handler: (sessionId: string) => void) {
    this.onIdleEnd = handler;
  }

  private redisKey(sessionId: string) {
    return `${KEY_PREFIX}${sessionId}`;
  }

  private convKey(conversationId: string) {
    return `${CONV_KEY_PREFIX}${conversationId}`;
  }

  async save(session: ActiveScreenSession): Promise<void> {
    this.local.set(session.sessionId, session);
    try {
      await this.redis.set(
        this.redisKey(session.sessionId),
        JSON.stringify(session),
        'PX',
        IDLE_TTL_MS * 3,
      );
      await this.redis.sadd(this.convKey(session.conversationId), session.sessionId);
    } catch (err) {
      this.logger.warn(`Redis save failed for screen session ${session.sessionId}: ${err}`);
    }
  }

  async get(sessionId: string): Promise<ActiveScreenSession | null> {
    const local = this.local.get(sessionId);
    if (local) return local;
    try {
      const raw = await this.redis.get(this.redisKey(sessionId));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as ActiveScreenSession;
      this.local.set(sessionId, parsed);
      return parsed;
    } catch {
      return null;
    }
  }

  async touch(sessionId: string): Promise<void> {
    const session = await this.get(sessionId);
    if (!session) return;
    session.lastActivityAt = Date.now();
    await this.save(session);
  }

  async remove(sessionId: string): Promise<ActiveScreenSession | null> {
    const session = await this.get(sessionId);
    this.local.delete(sessionId);
    try {
      await this.redis.del(this.redisKey(sessionId));
      if (session) {
        await this.redis.srem(this.convKey(session.conversationId), sessionId);
      }
    } catch {
      // ignore
    }
    return session;
  }

  async listForConversation(conversationId: string): Promise<ActiveScreenSession[]> {
    const localMatches = [...this.local.values()].filter(
      (s) => s.conversationId === conversationId,
    );
    try {
      const ids = await this.redis.smembers(this.convKey(conversationId));
      const sessions: ActiveScreenSession[] = [];
      for (const id of ids) {
        const s = await this.get(id);
        if (s) sessions.push(s);
      }
      if (sessions.length > 0) return sessions;
    } catch {
      // fall through
    }
    return localMatches;
  }

  async countActive(): Promise<number> {
    return this.local.size;
  }

  async addParticipant(sessionId: string, userId: string, asPresenter: boolean): Promise<ActiveScreenSession | null> {
    const session = await this.get(sessionId);
    if (!session) return null;
    if (!session.participantIds.includes(userId)) {
      session.participantIds.push(userId);
    }
    if (asPresenter && !session.presenterIds.includes(userId)) {
      session.presenterIds.push(userId);
    }
    session.lastActivityAt = Date.now();
    await this.save(session);
    return session;
  }

  async removeParticipant(sessionId: string, userId: string): Promise<ActiveScreenSession | null> {
    const session = await this.get(sessionId);
    if (!session) return null;
    session.participantIds = session.participantIds.filter((id) => id !== userId);
    session.presenterIds = session.presenterIds.filter((id) => id !== userId);
    if (session.hostUserId === userId || session.presenterIds.length === 0) {
      session.presenting = false;
    }
    session.lastActivityAt = Date.now();
    await this.save(session);
    return session;
  }

  async setPresenting(
    sessionId: string,
    presenting: boolean,
    screenSource: ScreenShareSource | null,
  ): Promise<ActiveScreenSession | null> {
    const session = await this.get(sessionId);
    if (!session) return null;
    session.presenting = presenting;
    session.screenSource = screenSource;
    session.lastActivityAt = Date.now();
    await this.save(session);
    return session;
  }

  private async sweepIdle() {
    const now = Date.now();
    for (const [id, session] of this.local) {
      const idle =
        session.participantIds.length === 0 ||
        (!session.presenting && now - session.lastActivityAt > IDLE_TTL_MS) ||
        now - session.lastActivityAt > IDLE_TTL_MS * 2;
      if (idle && now - session.lastActivityAt > IDLE_TTL_MS) {
        this.logger.log(`Ending idle screen session ${id}`);
        this.onIdleEnd?.(id);
      }
    }
  }
}
