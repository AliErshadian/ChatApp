import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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
import { extname } from 'path';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { StorageService } from '../../storage/storage.service';
import { ConversationsService } from './conversations.service';
import { MemberRole } from './entities/conversation-member.entity';
import {
  CreateChannelDto,
  CreateGroupDto,
  CreateDirectDto,
  AddMembersDto,
  DeleteConversationDto,
  LeaveChannelDto,
  UpdateScreenSettingsDto,
  SetMemberRoleDto,
} from './dto/conversation.dto';

@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class ConversationsController {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly storageService: StorageService,
  ) {}

  @Get()
  list(@CurrentUser() user: User) {
    return this.conversationsService.listForUser(user.id);
  }

  @Get(':id/attachments')
  listAttachments(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('kind') kind?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 50;
    return this.storageService.listForConversation(id, user.id, {
      cursor,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 50,
      kind: kind as
        | 'all'
        | 'mine'
        | 'shared'
        | 'image'
        | 'video'
        | 'audio'
        | 'voice'
        | 'document'
        | undefined,
    });
  }

  @Get(':id')
  getOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.conversationsService.getById(id, user.id);
  }

  @Post('channels')
  createChannel(@CurrentUser() user: User, @Body() dto: CreateChannelDto) {
    return this.conversationsService.createChannel(user.id, dto);
  }

  @Post('groups')
  createGroup(@CurrentUser() user: User, @Body() dto: CreateGroupDto) {
    return this.conversationsService.createGroup(user.id, dto);
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

  @Delete(':id/members/:userId')
  removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: User,
  ) {
    return this.conversationsService.removeMember(id, user.id, userId);
  }

  @Patch(':id/members/:userId/role')
  setMemberRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: User,
    @Body() dto: SetMemberRoleDto,
  ) {
    return this.conversationsService.setMemberRole(
      user.id,
      id,
      userId,
      dto.role as MemberRole.ADMIN | MemberRole.MODERATOR | MemberRole.MEMBER,
    );
  }

  @Patch(':id/screen-settings')
  updateScreenSettings(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body() dto: UpdateScreenSettingsDto,
  ) {
    return this.conversationsService.updateScreenSettings(user.id, id, dto);
  }

  @Get(':id/invite')
  getInvite(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.conversationsService.getOrCreateInvite(id, user.id);
  }

  @Post(':id/leave')
  leave(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body() dto: LeaveChannelDto,
  ) {
    return this.conversationsService.leaveChannel(id, user.id, dto.newOwnerId);
  }

  @Post(':id/pin')
  pin(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.conversationsService.setPinned(id, user.id, true);
  }

  @Delete(':id/pin')
  unpin(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.conversationsService.setPinned(id, user.id, false);
  }

  @Post(':id/avatar')
  @UseInterceptors(
    FileInterceptor('avatar', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ext = extname(file.originalname).toLowerCase();
        if (!['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) {
          cb(new BadRequestException('Only JPG, PNG, WebP, and GIF images are allowed'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  uploadAvatar(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Avatar file is required');
    }
    return this.conversationsService.updateChannelAvatar(id, user.id, file);
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
