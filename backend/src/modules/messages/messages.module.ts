import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Message } from './entities/message.entity';
import { MessageReadReceipt } from './entities/message-read-receipt.entity';
import { MessageDelivery } from './entities/message-delivery.entity';
import { MessageUserHidden } from './entities/message-user-hidden.entity';
import { MessageReaction } from './entities/message-reaction.entity';
import { ConversationMember } from '../conversations/entities/conversation-member.entity';
import { MessagesService } from './messages.service';
import { MessagesController } from './messages.controller';
import { ConversationsModule } from '../conversations/conversations.module';
import { SanitizationService } from '../../common/services/sanitization.service';
import { MessageRealtimePublisher } from './message-realtime.publisher';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Message,
      MessageReadReceipt,
      MessageDelivery,
      MessageUserHidden,
      MessageReaction,
      ConversationMember,
    ]),
    ConversationsModule,
  ],
  controllers: [MessagesController],
  providers: [MessagesService, SanitizationService, MessageRealtimePublisher],
  exports: [MessagesService, MessageRealtimePublisher],
})
export class MessagesModule {}
