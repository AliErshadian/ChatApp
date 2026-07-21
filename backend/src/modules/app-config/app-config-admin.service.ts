import { Injectable } from '@nestjs/common';
import { AppConfigService, type AppFeaturesUpdate } from './app-config.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit-action';

@Injectable()
export class AppConfigAdminService {
  constructor(
    private readonly appConfig: AppConfigService,
    private readonly audit: AuditService,
  ) {}

  getFeatures() {
    return this.appConfig.getFeatures();
  }

  async updateFeatures(actorUserId: string, input: AppFeaturesUpdate) {
    const settings = await this.appConfig.updateFeatures(input);

    this.audit.record({
      action: AuditAction.ADMIN_APP_CONFIG_UPDATE,
      userId: actorUserId,
      actorUserId,
      resourceType: 'app_configuration',
      metadata: { fields: Object.keys(input) },
    });

    return settings;
  }
}
