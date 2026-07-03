import { Injectable } from '@nestjs/common';

@Injectable()
export class ConversationRealtimePublisher {
  private emit?: (conversationId: string) => Promise<void>;

  setEmitter(emit: (conversationId: string) => Promise<void>) {
    this.emit = emit;
  }

  async publishUpdated(conversationId: string) {
    if (this.emit) {
      await this.emit(conversationId);
    }
  }
}
