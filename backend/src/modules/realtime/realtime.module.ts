import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { MessagesModule } from '../messages/messages.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { PresenceModule } from '../presence/presence.module';
import { AuthModule } from '../auth/auth.module';
import { WsJwtGuard } from './guards/ws-jwt.guard';

@Module({
  imports: [AuthModule, MessagesModule, ConversationsModule, PresenceModule],
  providers: [RealtimeGateway, WsJwtGuard],
})
export class RealtimeModule {}
