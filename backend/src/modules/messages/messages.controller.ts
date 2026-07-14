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
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { MessagesService } from './messages.service';
import { MarkReadDto, EditMessageDto, DeleteMessageDto, ToggleReactionDto, ForwardMessageDto } from './dto/message.dto';

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

  @Post('attachment')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 500 * 1024 * 1024 },
    }),
  )
  sendAttachment(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @CurrentUser() user: User,
    @UploadedFile() file: Express.Multer.File,
    @Body()
    body: {
      caption?: string;
      clientMessageId?: string;
      replyToMessageId?: string;
      threadRootId?: string;
    },
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    return this.messagesService.sendAttachment(user.id, conversationId, file, {
      caption: body.caption,
      clientMessageId: body.clientMessageId,
      replyToMessageId: body.replyToMessageId,
      threadRootId: body.threadRootId,
    });
  }

  @Get('unread-threads')
  listUnreadThreads(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @CurrentUser() user: User,
  ) {
    return this.messagesService.listUnreadThreads(conversationId, user.id);
  }

  @Get(':messageId/thread')
  getThread(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @CurrentUser() user: User,
  ) {
    return this.messagesService.getThread(conversationId, messageId, user.id);
  }

  @Get(':messageId/thread/search')
  searchThread(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @CurrentUser() user: User,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    return this.messagesService.searchThread(
      conversationId,
      messageId,
      user.id,
      q ?? '',
      limit ? parseInt(limit, 10) : 40,
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

  @Post(':messageId/forward')
  forward(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @CurrentUser() user: User,
    @Body() dto: ForwardMessageDto,
  ) {
    return this.messagesService.forward(
      user.id,
      conversationId,
      messageId,
      dto.targetConversationIds,
    );
  }
}
