import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Delete,
  Post,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { MessagesService } from './messages.service';
import { MarkReadDto, EditMessageDto, DeleteMessageDto, ToggleReactionDto } from './dto/message.dto';

@Controller('conversations/:conversationId/messages')
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get()
  list(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @CurrentUser() user: User,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.messagesService.list(
      conversationId,
      user.id,
      cursor,
      limit ? parseInt(limit, 10) : 50,
    );
  }

  @Post('read')
  markRead(@CurrentUser() user: User, @Body() dto: MarkReadDto) {
    return this.messagesService.markRead(user.id, dto.messageId);
  }

  @Patch(':messageId')
  edit(
    @Param('conversationId', ParseUUIDPipe) _conversationId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @CurrentUser() user: User,
    @Body() dto: EditMessageDto,
  ) {
    return this.messagesService.edit(user.id, messageId, dto.content);
  }

  @Delete(':messageId')
  remove(
    @Param('conversationId', ParseUUIDPipe) _conversationId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @CurrentUser() user: User,
    @Body() dto: DeleteMessageDto,
  ) {
    return this.messagesService.delete(user.id, messageId, dto.scope);
  }

  @Post(':messageId/reactions')
  toggleReaction(
    @Param('conversationId', ParseUUIDPipe) _conversationId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @CurrentUser() user: User,
    @Body() dto: ToggleReactionDto,
  ) {
    return this.messagesService.toggleReaction(user.id, messageId, dto.emoji);
  }
}
