import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { ScreenShareSignalingService } from './screen-share-signaling.service';

@Controller('screen-share')
@UseGuards(JwtAuthGuard)
export class ScreenShareController {
  constructor(private readonly signaling: ScreenShareSignalingService) {}

  @Get('conversations/:conversationId/active')
  listActive(
    @CurrentUser() user: User,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ) {
    return this.signaling.listActiveForConversation(user.id, conversationId);
  }
}
