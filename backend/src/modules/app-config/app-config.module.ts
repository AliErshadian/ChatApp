import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfiguration } from './entities/app-configuration.entity';
import { AppConfigService } from './app-config.service';
import { AppConfigController } from './app-config.controller';
import { AppConfigAdminController } from './app-config-admin.controller';
import { AppConfigAdminService } from './app-config-admin.service';
import { AdminGuard } from '../admin/guards/admin.guard';

@Module({
  imports: [TypeOrmModule.forFeature([AppConfiguration])],
  controllers: [AppConfigController, AppConfigAdminController],
  providers: [AppConfigService, AppConfigAdminService, AdminGuard],
  exports: [AppConfigService],
})
export class AppConfigModule {}
