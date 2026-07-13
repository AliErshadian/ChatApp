import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConversationsModule } from '../conversations/conversations.module';
import { UsersModule } from '../users/users.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { CallRegistryService } from './call-registry.service';
import { CallSignalingService } from './call-signaling.service';
import { CallsController } from './calls.controller';
import { CallsHistoryService } from './calls-history.service';
import { CallsIceService } from './calls-ice.service';
import { CallRecord } from './entities/call-record.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([CallRecord]),
    ConversationsModule,
    UsersModule,
    forwardRef(() => RealtimeModule),
  ],
  controllers: [CallsController],
  providers: [CallRegistryService, CallSignalingService, CallsHistoryService, CallsIceService],
  exports: [CallSignalingService],
})
export class CallsModule {}
