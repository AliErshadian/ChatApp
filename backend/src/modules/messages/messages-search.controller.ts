import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { MessagesService } from './messages.service';

@Controller('messages')
@UseGuards(JwtAuthGuard)
export class MessagesSearchController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get('search')
  search(
    @CurrentUser() user: User,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    return this.messagesService.searchMessages(
      user.id,
      q ?? '',
      limit ? parseInt(limit, 10) : undefined,
    );
  }
}
