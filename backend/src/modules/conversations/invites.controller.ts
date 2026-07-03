import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { ConversationsService } from './conversations.service';

@Controller('invites')
export class InvitesController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get(':token/status')
  @UseGuards(JwtAuthGuard)
  status(@Param('token') token: string, @CurrentUser() user: User) {
    return this.conversationsService.getInviteStatus(token, user.id);
  }

  @Get(':token')
  preview(@Param('token') token: string) {
    return this.conversationsService.getInvitePreview(token);
  }

  @Post(':token/join')
  @UseGuards(JwtAuthGuard)
  join(@Param('token') token: string, @CurrentUser() user: User) {
    return this.conversationsService.joinByInvite(token, user.id);
  }
}
