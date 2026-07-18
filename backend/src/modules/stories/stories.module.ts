import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Story } from './entities/story.entity';
import { StoryView } from './entities/story-view.entity';
import { StoryLike } from './entities/story-like.entity';
import { StoriesController } from './stories.controller';
import { StoriesService } from './stories.service';
import { StoryRealtimePublisher } from './story-realtime.publisher';
import { ContactsModule } from '../contacts/contacts.module';
import { UsersModule } from '../users/users.module';
import { StorageModule } from '../../storage/storage.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { MessagesModule } from '../messages/messages.module';
import { SanitizationService } from '../../common/services/sanitization.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Story, StoryView, StoryLike]),
    ContactsModule,
    UsersModule,
    StorageModule,
    forwardRef(() => ConversationsModule),
    forwardRef(() => MessagesModule),
  ],
  controllers: [StoriesController],
  providers: [StoriesService, StoryRealtimePublisher, SanitizationService],
  exports: [StoriesService, StoryRealtimePublisher],
})
export class StoriesModule {}
