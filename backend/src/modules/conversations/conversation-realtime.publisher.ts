import { Injectable } from '@nestjs/common';

@Injectable()
export class ConversationRealtimePublisher {
  private emitUpdated?: (conversationId: string) => Promise<void>;
  private emitCreated?: (conversationId: string) => Promise<void>;
  private emitMemberRemoved?: (
    conversationId: string,
    removedUserId: string,
  ) => Promise<void>;

  setEmitter(emit: (conversationId: string) => Promise<void>) {
    this.emitUpdated = emit;
  }

  setCreatedEmitter(emit: (conversationId: string) => Promise<void>) {
    this.emitCreated = emit;
  }

  setMemberRemovedEmitter(
    emit: (conversationId: string, removedUserId: string) => Promise<void>,
  ) {
    this.emitMemberRemoved = emit;
  }

  async publishUpdated(conversationId: string) {
    if (this.emitUpdated) {
      await this.emitUpdated(conversationId);
    }
  }

  async publishCreated(conversationId: string) {
    if (this.emitCreated) {
      await this.emitCreated(conversationId);
    }
  }

  async publishMemberRemoved(conversationId: string, removedUserId: string) {
    if (this.emitMemberRemoved) {
      await this.emitMemberRemoved(conversationId, removedUserId);
    }
  }
}
