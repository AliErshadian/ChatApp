import { Injectable } from '@nestjs/common';

/**
 * Tracks active WebSocket connections per user (in-memory).
 * This is the source of truth for "online now", independent of Redis.
 */
@Injectable()
export class PresenceConnectionRegistry {
  private readonly connectionCounts = new Map<string, number>();

  register(userId: string): number {
    const next = (this.connectionCounts.get(userId) ?? 0) + 1;
    this.connectionCounts.set(userId, next);
    return next;
  }

  unregister(userId: string): number {
    const current = this.connectionCounts.get(userId) ?? 0;
    const next = Math.max(0, current - 1);
    if (next === 0) {
      this.connectionCounts.delete(userId);
    } else {
      this.connectionCounts.set(userId, next);
    }
    return next;
  }

  isOnline(userId: string): boolean {
    return (this.connectionCounts.get(userId) ?? 0) > 0;
  }

  getOnlineUserIds(userIds: string[]): string[] {
    return userIds.filter((id) => this.isOnline(id));
  }
}
