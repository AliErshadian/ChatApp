import { Injectable } from '@nestjs/common';
import { MessagePayload } from './messages.service';

@Injectable()
export class MessageRealtimePublisher {
  private emitNewMessage?: (
    message: MessagePayload,
    senderId: string,
  ) => Promise<void>;

  setNewMessageEmitter(
    emit: (message: MessagePayload, senderId: string) => Promise<void>,
  ) {
    this.emitNewMessage = emit;
  }

  async publishNewMessage(message: MessagePayload, senderId: string) {
    if (this.emitNewMessage) {
      await this.emitNewMessage(message, senderId);
    }
  }
}
