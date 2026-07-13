import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { CallsHistoryService } from './calls-history.service';
import { CallsIceService } from './calls-ice.service';
import { ListCallHistoryDto } from './dto/list-call-history.dto';

@Controller('calls')
@UseGuards(JwtAuthGuard)
export class CallsController {
  constructor(
    private readonly iceService: CallsIceService,
    private readonly historyService: CallsHistoryService,
  ) {}

  @Get('ice-servers')
  getIceServers() {
    return { iceServers: this.iceService.getIceServers() };
  }

  @Get('history')
  listHistory(@CurrentUser() user: User, @Query() query: ListCallHistoryDto) {
    return this.historyService.list(user.id, query);
  }
}
