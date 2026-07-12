import { Module, forwardRef } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeController } from './realtime.controller';
import { MessagesModule } from '../messages/messages.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { PresenceModule } from '../presence/presence.module';
import { AuthModule } from '../auth/auth.module';
import { CallsModule } from '../calls/calls.module';
import { WsJwtGuard } from './guards/ws-jwt.guard';
import { WsRateLimitGuard } from '../../observability/ws-rate-limit.guard';
import { RealtimeEventBusService } from './realtime-event-bus.service';
import { RealtimeBroadcastService } from './realtime-broadcast.service';
import { RealtimeActionsService } from './realtime-actions.service';
import { RealtimeSseService } from './realtime-sse.service';

@Module({
  imports: [AuthModule, MessagesModule, ConversationsModule, PresenceModule, forwardRef(() => CallsModule)],
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
  exports: [RealtimeBroadcastService],
})
export class RealtimeModule {}
