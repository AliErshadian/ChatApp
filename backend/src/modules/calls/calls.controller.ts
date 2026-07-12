import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CallsIceService } from './calls-ice.service';

@Controller('calls')
@UseGuards(JwtAuthGuard)
export class CallsController {
  constructor(private readonly iceService: CallsIceService) {}

  @Get('ice-servers')
  getIceServers() {
    return { iceServers: this.iceService.getIceServers() };
  }
}
