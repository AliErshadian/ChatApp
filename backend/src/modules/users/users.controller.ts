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
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';

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
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
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
    return this.usersService.searchUsers(q ?? '').then((users) =>
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
