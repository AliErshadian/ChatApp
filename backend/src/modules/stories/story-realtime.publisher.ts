import { Injectable } from '@nestjs/common';

export type StoryRealtimeEvent = 'story:created' | 'story:deleted';

@Injectable()
export class StoryRealtimePublisher {
  private emit?: (event: StoryRealtimeEvent, userIds: string[], data: unknown) => Promise<void>;

  setEmitter(
    emit: (event: StoryRealtimeEvent, userIds: string[], data: unknown) => Promise<void>,
  ) {
    this.emit = emit;
  }

  async publishCreated(userIds: string[], payload: unknown) {
    if (!this.emit || userIds.length === 0) return;
    await this.emit('story:created', userIds, payload);
  }

  async publishDeleted(userIds: string[], payload: { storyId: string; authorId: string }) {
    if (!this.emit || userIds.length === 0) return;
    await this.emit('story:deleted', userIds, payload);
  }
}
