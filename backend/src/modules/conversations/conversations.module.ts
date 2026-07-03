import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Conversation } from './entities/conversation.entity';
import { ConversationMember } from './entities/conversation-member.entity';
import { DirectConversationPair } from './entities/direct-conversation-pair.entity';
import { ConversationUserHidden } from './entities/conversation-user-hidden.entity';
import { Message } from '../messages/entities/message.entity';
import { MessageUserHidden } from '../messages/entities/message-user-hidden.entity';
import { ConversationsService } from './conversations.service';
import { ConversationsController } from './conversations.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Conversation,
      ConversationMember,
      DirectConversationPair,
      ConversationUserHidden,
      Message,
      MessageUserHidden,
    ]),
  ],
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
