import {
  Body,
  Controller,
  Param,
  Post,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { MessagesService } from './messages.service';
import { CreatePollDto, VotePollDto } from './dto/message.dto';

@Controller('conversations/:conversationId/polls')
@UseGuards(JwtAuthGuard)
export class PollsController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post()
  create(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @CurrentUser() user: User,
    @Body() dto: CreatePollDto,
  ) {
    return this.messagesService.createPoll(user.id, conversationId, dto);
  }

  @Post(':pollId/vote')
  vote(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('pollId', ParseUUIDPipe) pollId: string,
    @CurrentUser() user: User,
    @Body() dto: VotePollDto,
  ) {
    return this.messagesService.votePoll(user.id, conversationId, pollId, dto.optionId);
  }

  @Post(':pollId/close')
  close(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('pollId', ParseUUIDPipe) pollId: string,
    @CurrentUser() user: User,
  ) {
    return this.messagesService.closePoll(user.id, conversationId, pollId);
  }
}
