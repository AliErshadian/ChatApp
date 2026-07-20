import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { RealtimeSseService } from './realtime-sse.service';
import { RealtimeActionsService } from './realtime-actions.service';
import {
  RealtimeDeliveredDto,
  RealtimePresenceQueryDto,
  RealtimeReadDto,
  RealtimeTypingDto,
  SendMessageDto,
  RealtimeEditMessageDto,
  RealtimeDeleteMessageDto,
  RealtimeToggleReactionDto,
  DeleteConversationDto,
} from './dto/realtime.dto';

@Controller('realtime')
@UseGuards(JwtAuthGuard)
export class RealtimeController {
  constructor(
    private readonly sseService: RealtimeSseService,
    private readonly actions: RealtimeActionsService,
  ) {}

  @Get('stream')
  async stream(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.sseService.openStream(user.id, user.sessionId, res);

    req.on('close', () => {
      if (!res.writableEnded) {
        res.end();
      }
    });
  }

  @Post('conversations/:conversationId/join')
  joinConversation(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sseService.joinConversation(user.id, user.sessionId, conversationId);
  }

  @Post('conversations/:conversationId/leave')
  leaveConversation(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sseService.leaveConversation(user.id, user.sessionId, conversationId);
  }

  @Post('messages/send')
  sendMessage(@CurrentUser() user: AuthenticatedUser, @Body() dto: SendMessageDto) {
    return this.actions.sendMessage(user.id, user.sessionId, dto);
  }

  @Post('messages/delivered')
  markDelivered(@CurrentUser() user: AuthenticatedUser, @Body() dto: RealtimeDeliveredDto) {
    return this.actions.markDelivered(user.id, dto.messageId);
  }

  @Post('messages/read')
  markRead(@CurrentUser() user: AuthenticatedUser, @Body() dto: RealtimeReadDto) {
    return this.actions.markRead(user.id, dto.messageId);
  }

  @Post('typing')
  setTyping(@CurrentUser() user: AuthenticatedUser, @Body() dto: RealtimeTypingDto) {
    return this.actions.setTyping(user.id, dto.conversationId, dto.isTyping);
  }

  @Post('messages/edit')
  editMessage(@CurrentUser() user: AuthenticatedUser, @Body() body: RealtimeEditMessageDto) {
    return this.actions.editMessage(user.id, body.messageId, body.content);
  }

  @Post('messages/delete')
  deleteMessage(@CurrentUser() user: AuthenticatedUser, @Body() body: RealtimeDeleteMessageDto) {
    return this.actions.deleteMessage(user.id, user.sessionId, body.messageId, body.scope);
  }

  @Post('messages/reaction')
  toggleReaction(@CurrentUser() user: AuthenticatedUser, @Body() body: RealtimeToggleReactionDto) {
    return this.actions.toggleReaction(user.id, body.messageId, body.emoji);
  }

  @Delete('conversations/:conversationId')
  deleteConversation(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DeleteConversationDto,
  ) {
    return this.actions.deleteConversation(
      user.id,
      user.sessionId,
      conversationId,
      dto.scope,
    );
  }

  @Post('presence/heartbeat')
  heartbeat(@CurrentUser() user: AuthenticatedUser) {
    return this.actions.heartbeat(user.id);
  }

  @Post('presence/query')
  queryPresence(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RealtimePresenceQueryDto,
  ) {
    return this.actions.queryPresence(user.id, dto.userIds);
  }
}
