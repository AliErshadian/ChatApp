import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Conversation } from './entities/conversation.entity';
import { ConversationMember } from './entities/conversation-member.entity';
import { DirectConversationPair } from './entities/direct-conversation-pair.entity';
import { ConversationUserHidden } from './entities/conversation-user-hidden.entity';
import { ChannelInvite } from './entities/channel-invite.entity';
import { Message } from '../messages/entities/message.entity';
import { MessageUserHidden } from '../messages/entities/message-user-hidden.entity';
import { ConversationsService } from './conversations.service';
import { ConversationRealtimePublisher } from './conversation-realtime.publisher';
import { ConversationsController } from './conversations.controller';
import { InvitesController } from './invites.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Conversation,
      ConversationMember,
      DirectConversationPair,
      ConversationUserHidden,
      ChannelInvite,
      Message,
      MessageUserHidden,
    ]),
  ],
  controllers: [ConversationsController, InvitesController],
  providers: [ConversationsService, ConversationRealtimePublisher],
  exports: [ConversationsService, ConversationRealtimePublisher],
})
export class ConversationsModule {}
