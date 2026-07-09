import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
  ParseUUIDPipe,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { join, extname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { ConversationsService } from './conversations.service';
import {
  CreateChannelDto,
  CreateGroupDto,
  CreateDirectDto,
  AddMembersDto,
  DeleteConversationDto,
  LeaveChannelDto,
} from './dto/conversation.dto';

const channelAvatarUploadDir = join(process.cwd(), 'uploads', 'channel-avatars');
if (!existsSync(channelAvatarUploadDir)) {
  mkdirSync(channelAvatarUploadDir, { recursive: true });
}

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
      storage: diskStorage({
        destination: channelAvatarUploadDir,
        filename: (_req, file, cb) => {
          const ext = extname(file.originalname).toLowerCase();
          cb(null, `tmp-${Date.now()}${ext}`);
        },
      }),
      limits: { fileSize: 2 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ext = extname(file.originalname).toLowerCase();
        if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
          cb(new BadRequestException('Only JPG, PNG, and WebP images are allowed'), false);
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
