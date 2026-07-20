import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { DirectoryConfiguration } from './entities/directory-configuration.entity';
import { DirectoryGroupMapping } from './entities/directory-group-mapping.entity';
import { DirectorySyncHistory } from './entities/directory-sync-history.entity';
import { AuthenticationAuditLog } from './entities/authentication-audit-log.entity';
import { User } from '../users/entities/user.entity';
import { SecretEncryptionService } from '../../common/services/secret-encryption.service';
import { DirectoryConfigService } from './directory-config.service';
import { LdapClientService } from './ldap/ldap-client.service';
import { DirectoryUserProvisioningService } from './directory-user-provisioning.service';
import { DirectorySyncService } from './directory-sync.service';
import { DirectoryAdminService } from './directory-admin.service';
import { DirectoryAdminController } from './directory-admin.controller';
import { AuthenticationAuditService } from './authentication-audit.service';
import { AdminGuard } from '../admin/guards/admin.guard';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([
      DirectoryConfiguration,
      DirectoryGroupMapping,
      DirectorySyncHistory,
      AuthenticationAuditLog,
      User,
    ]),
  ],
  controllers: [DirectoryAdminController],
  providers: [
    SecretEncryptionService,
    DirectoryConfigService,
    LdapClientService,
    DirectoryUserProvisioningService,
    DirectorySyncService,
    DirectoryAdminService,
    AuthenticationAuditService,
    AdminGuard,
  ],
  exports: [
    DirectoryConfigService,
    LdapClientService,
    DirectoryUserProvisioningService,
    DirectorySyncService,
    AuthenticationAuditService,
    SecretEncryptionService,
  ],
})
export class DirectoryModule {}
