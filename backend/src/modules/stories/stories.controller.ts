import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { StoriesService } from './stories.service';
import { CreateStoryCaptionDto, ReplyStoryDto } from './dto/story.dto';

@Controller('stories')
@UseGuards(JwtAuthGuard)
export class StoriesController {
  constructor(private readonly storiesService: StoriesService) {}

  @Get('feed')
  feed(@CurrentUser() user: User) {
    return this.storiesService.feed(user.id);
  }

  @Get('user/:userId')
  listForUser(
    @CurrentUser() user: User,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.storiesService.listForUser(user.id, userId);
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('media', {
      storage: memoryStorage(),
      limits: { fileSize: 100 * 1024 * 1024 },
    }),
  )
  create(
    @CurrentUser() user: User,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: CreateStoryCaptionDto,
  ) {
    if (!file) throw new BadRequestException('Story media file is required');
    return this.storiesService.create(user.id, file, body.caption);
  }

  /** Idempotent upsert — allow more than the global default while browsing stories. */
  @Post(':id/view')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  markViewed(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.storiesService.markViewed(user.id, id);
  }

  @Get(':id/viewers')
  viewers(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.storiesService.listViewers(user.id, id);
  }

  @Post(':id/like')
  like(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.storiesService.like(user.id, id);
  }

  @Delete(':id/like')
  unlike(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.storiesService.unlike(user.id, id);
  }

  @Post(':id/reply')
  reply(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplyStoryDto,
  ) {
    return this.storiesService.reply(user.id, id, dto.content);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.storiesService.remove(user.id, id);
  }
}
