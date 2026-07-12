import {
  BadRequestException,
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
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../modules/users/entities/user.entity';
import { UploadFileDto } from './dto/upload-file.dto';
import { StorageService } from './storage.service';

@Controller('attachments')
@UseGuards(JwtAuthGuard)
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Post('upload')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 500 * 1024 * 1024 },
    }),
  )
  upload(
    @CurrentUser() user: User,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadFileDto,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    if (!dto.conversationId) {
      throw new BadRequestException('conversationId is required');
    }

    return this.storageService.upload(user.id, file, {
      conversationId: dto.conversationId,
      messageId: dto.messageId,
    });
  }

  @Get(':id')
  getById(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.storageService.getById(user.id, id);
  }

  @Get(':id/download')
  download(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.storageService.getPresignedDownloadUrl(user.id, id);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    await this.storageService.delete(user.id, id);
    return { success: true };
  }
}
