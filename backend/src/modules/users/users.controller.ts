import {
  Controller,
  Get,
  Post,
  Query,
  Param,
  UseGuards,
  NotFoundException,
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
import { User } from './entities/user.entity';
import { UsersService } from './users.service';

const avatarDir = join(process.cwd(), 'uploads', 'avatars');
if (!existsSync(avatarDir)) {
  mkdirSync(avatarDir, { recursive: true });
}

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  me(@CurrentUser() user: User) {
    return this.usersService.toPublic(user);
  }

  @Post('me/avatar')
  @UseInterceptors(
    FileInterceptor('avatar', {
      storage: diskStorage({
        destination: avatarDir,
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
    @CurrentUser() user: User,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Avatar file is required');
    }
    return this.usersService.updateAvatar(user.id, file);
  }

  @Get('search')
  search(@Query('q') q: string, @CurrentUser() _user: User) {
    return this.usersService.searchByUsername(q ?? '').then((users) =>
      users.map((u) => this.usersService.toPublic(u)),
    );
  }

  @Get(':id')
  async getById(@Param('id', ParseUUIDPipe) id: string) {
    const user = await this.usersService.findById(id);
    if (!user || !user.isActive) {
      throw new NotFoundException('User not found');
    }
    return this.usersService.toPublic(user);
  }
}
