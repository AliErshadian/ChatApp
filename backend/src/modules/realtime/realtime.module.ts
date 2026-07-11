import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeController } from './realtime.controller';
import { MessagesModule } from '../messages/messages.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { PresenceModule } from '../presence/presence.module';
import { AuthModule } from '../auth/auth.module';
import { WsJwtGuard } from './guards/ws-jwt.guard';
import { WsRateLimitGuard } from '../../observability/ws-rate-limit.guard';
import { RealtimeEventBusService } from './realtime-event-bus.service';
import { RealtimeBroadcastService } from './realtime-broadcast.service';
import { RealtimeActionsService } from './realtime-actions.service';
import { RealtimeSseService } from './realtime-sse.service';

@Module({
  imports: [AuthModule, MessagesModule, ConversationsModule, PresenceModule],
  controllers: [RealtimeController],
  providers: [
    RealtimeGateway,
    RealtimeEventBusService,
    RealtimeBroadcastService,
    RealtimeActionsService,
    RealtimeSseService,
    WsJwtGuard,
    WsRateLimitGuard,
  ],
})
export class RealtimeModule {}
