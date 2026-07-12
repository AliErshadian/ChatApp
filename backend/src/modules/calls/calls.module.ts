import { Module, forwardRef } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module';
import { UsersModule } from '../users/users.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { CallRegistryService } from './call-registry.service';
import { CallSignalingService } from './call-signaling.service';
import { CallsController } from './calls.controller';
import { CallsIceService } from './calls-ice.service';

@Module({
  imports: [ConversationsModule, UsersModule, forwardRef(() => RealtimeModule)],
  controllers: [CallsController],
  providers: [CallRegistryService, CallSignalingService, CallsIceService],
  exports: [CallSignalingService],
})
export class CallsModule {}
