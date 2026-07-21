import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConversationsModule } from '../conversations/conversations.module';
import { UsersModule } from '../users/users.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AppConfigModule } from '../app-config/app-config.module';
import { MessagesModule } from '../messages/messages.module';
import { ScreenShareSession } from './entities/screen-share-session.entity';
import { ScreenShareParticipant } from './entities/screen-share-participant.entity';
import { ScreenShareAuditLog } from './entities/screen-share-audit-log.entity';
import { ScreenShareRegistryService } from './screen-share-registry.service';
import { ScreenShareHistoryService } from './screen-share-history.service';
import { ScreenShareAuditService } from './screen-share-audit.service';
import { ScreenShareSignalingService } from './screen-share-signaling.service';
import { ScreenShareController } from './screen-share.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ScreenShareSession,
      ScreenShareParticipant,
      ScreenShareAuditLog,
    ]),
    ConversationsModule,
    UsersModule,
    AppConfigModule,
    MessagesModule,
    forwardRef(() => RealtimeModule),
  ],
  controllers: [ScreenShareController],
  providers: [
    ScreenShareRegistryService,
    ScreenShareHistoryService,
    ScreenShareAuditService,
    ScreenShareSignalingService,
  ],
  exports: [ScreenShareSignalingService],
})
export class ScreenShareModule {}
