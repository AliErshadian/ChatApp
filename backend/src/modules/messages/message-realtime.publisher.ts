import { Injectable } from '@nestjs/common';
import { MessagePayload } from './messages.service';

@Injectable()
export class MessageRealtimePublisher {
  private emitNewMessage?: (
    message: MessagePayload,
    senderId: string,
  ) => Promise<void>;

  private emitMessageUpdateToUser?: (
    userId: string,
    message: MessagePayload,
  ) => Promise<void>;

  setNewMessageEmitter(
    emit: (message: MessagePayload, senderId: string) => Promise<void>,
  ) {
    this.emitNewMessage = emit;
  }

  setMessageUpdateToUserEmitter(
    emit: (userId: string, message: MessagePayload) => Promise<void>,
  ) {
    this.emitMessageUpdateToUser = emit;
  }

  async publishNewMessage(message: MessagePayload, senderId: string) {
    if (this.emitNewMessage) {
      await this.emitNewMessage(message, senderId);
    }
  }

  async publishMessageUpdateToUser(userId: string, message: MessagePayload) {
    if (this.emitMessageUpdateToUser) {
      await this.emitMessageUpdateToUser(userId, message);
    }
  }
}
