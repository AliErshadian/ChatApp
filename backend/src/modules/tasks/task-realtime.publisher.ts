import { Injectable } from '@nestjs/common';

export type TaskRealtimeEvent = 'task:updated' | 'task:deleted';

@Injectable()
export class TaskRealtimePublisher {
  private emit?: (event: TaskRealtimeEvent, userIds: string[], data: unknown) => Promise<void>;

  setEmitter(
    emit: (event: TaskRealtimeEvent, userIds: string[], data: unknown) => Promise<void>,
  ) {
    this.emit = emit;
  }

  async publishUpdated(userIds: string[], task: unknown) {
    if (!this.emit || userIds.length === 0) return;
    await this.emit('task:updated', userIds, task);
  }

  async publishDeleted(userIds: string[], taskId: string) {
    if (!this.emit || userIds.length === 0) return;
    await this.emit('task:deleted', userIds, { taskId });
  }
}
