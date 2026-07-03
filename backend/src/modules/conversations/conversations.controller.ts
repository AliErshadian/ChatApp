import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { ConversationsService } from './conversations.service';
import { CreateChannelDto, CreateDirectDto, AddMembersDto, DeleteConversationDto } from './dto/conversation.dto';

@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  list(@CurrentUser() user: User) {
    return this.conversationsService.listForUser(user.id);
  }

  @Get(':id')
  getOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.conversationsService.getById(id, user.id);
  }

  @Post('channels')
  createChannel(@CurrentUser() user: User, @Body() dto: CreateChannelDto) {
    return this.conversationsService.createChannel(user.id, dto);
  }

  @Post('direct')
  createDirect(@CurrentUser() user: User, @Body() dto: CreateDirectDto) {
    return this.conversationsService.createDirect(user.id, dto);
  }

  @Post(':id/members')
  addMembers(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body() dto: AddMembersDto,
  ) {
    return this.conversationsService.addMembers(id, user.id, dto.userIds);
  }

  @Get(':id/invite')
  getInvite(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.conversationsService.getOrCreateInvite(id, user.id);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body() dto: DeleteConversationDto,
  ) {
    return this.conversationsService.delete(user.id, id, dto.scope);
  }
}
