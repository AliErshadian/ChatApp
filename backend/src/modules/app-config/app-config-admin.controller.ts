import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../admin/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { AppConfigAdminService } from './app-config-admin.service';
import { UpdateAppFeaturesDto } from './dto/app-config.dto';

@Controller('admin/settings/features')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AppConfigAdminController {
  constructor(private readonly appConfigAdmin: AppConfigAdminService) {}

  @Get()
  getFeatures() {
    return this.appConfigAdmin.getFeatures();
  }

  @Put()
  updateFeatures(@CurrentUser() actor: User, @Body() dto: UpdateAppFeaturesDto) {
    return this.appConfigAdmin.updateFeatures(actor.id, dto);
  }
}
