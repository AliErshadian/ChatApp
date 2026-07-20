import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { DirectoryAdminService } from './directory-admin.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../admin/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import {
  UpdateDirectorySettingsDto,
  UpdateGroupMappingDto,
  UpsertGroupMappingDto,
} from './dto/directory.dto';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit-action';

@Controller('admin/settings/authentication')
@UseGuards(JwtAuthGuard, AdminGuard)
export class DirectoryAdminController {
  constructor(
    private readonly directoryAdmin: DirectoryAdminService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  getSettings() {
    return this.directoryAdmin.getSettings();
  }

  @Put()
  updateSettings(
    @CurrentUser() actor: User,
    @Body() dto: UpdateDirectorySettingsDto,
  ) {
    return this.directoryAdmin.updateSettings(actor.id, dto);
  }

  @Get('health')
  getHealth() {
    return this.directoryAdmin.getHealth();
  }

  @Get('statistics')
  getStatistics() {
    return this.directoryAdmin.getAuthStatistics();
  }

  @Post('test-connection')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  testConnection(@CurrentUser() actor: User) {
    return this.directoryAdmin.testConnection(actor.id);
  }

  @Get('preview/users')
  previewUsers(@Query('limit') limit?: string) {
    return this.directoryAdmin.previewUsers(
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  @Get('preview/groups')
  previewGroups(@Query('limit') limit?: string) {
    return this.directoryAdmin.previewGroups(
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async runSync(@CurrentUser() actor: User) {
    const result = await this.directoryAdmin.runManualSync(actor.id);
    this.audit.record({
      action: AuditAction.ADMIN_DIRECTORY_SYNC,
      userId: actor.id,
      actorUserId: actor.id,
      resourceType: 'directory_sync',
      metadata: result as unknown as Record<string, unknown>,
    });
    return result;
  }

  @Get('sync/history')
  syncHistory(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.directoryAdmin.listSyncHistory(
      page ? parseInt(page, 10) : undefined,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  @Get('audit')
  listAuthAudit(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('provider') provider?: 'local' | 'active_directory',
    @Query('success') success?: string,
    @Query('eventType') eventType?: string,
  ) {
    return this.directoryAdmin.listAuthAudit({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      provider,
      success:
        success === 'true' ? true : success === 'false' ? false : undefined,
      eventType,
    });
  }

  @Get('group-mappings')
  listGroupMappings() {
    return this.directoryAdmin.listGroupMappings();
  }

  @Post('group-mappings')
  createGroupMapping(@Body() dto: UpsertGroupMappingDto) {
    return this.directoryAdmin.createGroupMapping(dto);
  }

  @Patch('group-mappings/:id')
  updateGroupMapping(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGroupMappingDto,
  ) {
    return this.directoryAdmin.updateGroupMapping(id, dto);
  }

  @Delete('group-mappings/:id')
  @HttpCode(HttpStatus.OK)
  deleteGroupMapping(@Param('id', ParseUUIDPipe) id: string) {
    return this.directoryAdmin.deleteGroupMapping(id);
  }
}
