import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Message } from './entities/message.entity';
import { MessageReadReceipt } from './entities/message-read-receipt.entity';
import { MessageDelivery } from './entities/message-delivery.entity';
import { MessageUserHidden } from './entities/message-user-hidden.entity';
import { MessageReaction } from './entities/message-reaction.entity';
import { MessageMention } from './entities/message-mention.entity';
import { MessageThreadRead } from './entities/message-thread-read.entity';
import { Poll } from './entities/poll.entity';
import { PollOption } from './entities/poll-option.entity';
import { PollVote } from './entities/poll-vote.entity';
import { Story } from '../stories/entities/story.entity';
import { ConversationMember } from '../conversations/entities/conversation-member.entity';
import { MessagesService } from './messages.service';
import { MessagesController } from './messages.controller';
import { MessagesSearchController } from './messages-search.controller';
import { PollsController } from './polls.controller';
import { ConversationsModule } from '../conversations/conversations.module';
import { SanitizationService } from '../../common/services/sanitization.service';
import { MessageRealtimePublisher } from './message-realtime.publisher';
import { StorageModule } from '../../storage/storage.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Message,
      MessageReadReceipt,
      MessageDelivery,
      MessageUserHidden,
      MessageReaction,
      MessageMention,
      MessageThreadRead,
      Poll,
      PollOption,
      PollVote,
      Story,
      ConversationMember,
    ]),
    ConversationsModule,
    StorageModule,
  ],
  controllers: [MessagesController, MessagesSearchController, PollsController],
  providers: [MessagesService, SanitizationService, MessageRealtimePublisher],
  exports: [MessagesService, MessageRealtimePublisher],
})
export class MessagesModule {}
