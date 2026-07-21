import { Controller, Get } from '@nestjs/common';
import { AppConfigService } from './app-config.service';

@Controller('config')
export class AppConfigController {
  constructor(private readonly appConfig: AppConfigService) {}

  @Get('features')
  getFeatures() {
    return this.appConfig.getFeatures();
  }
}
