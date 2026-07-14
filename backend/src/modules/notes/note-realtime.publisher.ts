import { Injectable } from '@nestjs/common';

export type NoteRealtimeEvent = 'note:updated' | 'note:deleted';

@Injectable()
export class NoteRealtimePublisher {
  private emit?: (event: NoteRealtimeEvent, userIds: string[], data: unknown) => Promise<void>;

  setEmitter(
    emit: (event: NoteRealtimeEvent, userIds: string[], data: unknown) => Promise<void>,
  ) {
    this.emit = emit;
  }

  async publishUpdated(userIds: string[], note: unknown) {
    if (!this.emit || userIds.length === 0) return;
    await this.emit('note:updated', userIds, note);
  }

  async publishDeleted(userIds: string[], noteId: string) {
    if (!this.emit || userIds.length === 0) return;
    await this.emit('note:deleted', userIds, { noteId });
  }
}
