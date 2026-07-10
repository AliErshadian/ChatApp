import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from './guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { UpdateAdminUserDto } from './dto/admin.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('me')
  me(@CurrentUser() user: User) {
    return this.adminService.toAdminSummary(user);
  }

  @Get('stats')
  getStats() {
    return this.adminService.getStats();
  }

  @Get('storage')
  getStorage() {
    return this.adminService.getStorageStats();
  }

  @Get('users')
  listUsers(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('q') q?: string,
    @Query('isActive') isActive?: string,
    @Query('isAdmin') isAdmin?: string,
    @Query('sortBy') sortBy?: 'createdAt' | 'displayName' | 'email' | 'updatedAt',
    @Query('sortDir') sortDir?: 'asc' | 'desc',
  ) {
    return this.adminService.listUsers({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      q,
      isActive:
        isActive === 'true' ? true : isActive === 'false' ? false : undefined,
      isAdmin:
        isAdmin === 'true' ? true : isAdmin === 'false' ? false : undefined,
      sortBy,
      sortDir,
    });
  }

  @Get('users/:userId')
  getUser(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.adminService.getUser(userId);
  }

  @Patch('users/:userId')
  updateUser(
    @CurrentUser() actor: User,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateAdminUserDto,
  ) {
    return this.adminService.updateUser(actor.id, userId, dto);
  }

  @Get('users/:userId/sessions')
  listUserSessions(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.adminService.listUserSessions(userId);
  }

  @Delete('users/:userId/sessions/:sessionId')
  @HttpCode(HttpStatus.OK)
  revokeUserSession(
    @CurrentUser() actor: User,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ) {
    return this.adminService.revokeUserSession(actor.id, userId, sessionId);
  }

  @Delete('users/:userId/sessions')
  @HttpCode(HttpStatus.OK)
  revokeAllUserSessions(
    @CurrentUser() actor: User,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.adminService.revokeAllUserSessions(actor.id, userId);
  }

  @Get('audit-logs')
  listAuditLogs(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('userId') userId?: string,
    @Query('action') action?: string,
    @Query('category') category?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('q') q?: string,
  ) {
    return this.adminService.listAuditLogs({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      userId,
      action,
      category,
      from,
      to,
      q,
    });
  }
}
