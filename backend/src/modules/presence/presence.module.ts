import { Module } from '@nestjs/common';
import { PresenceService } from './presence.service';
import { PresenceConnectionRegistry } from './presence-connection.registry';

@Module({
  providers: [PresenceService, PresenceConnectionRegistry],
  exports: [PresenceService, PresenceConnectionRegistry],
})
export class PresenceModule {}
