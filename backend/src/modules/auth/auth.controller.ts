import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto, LoginDto, RefreshTokenDto } from './dto/auth.dto';
import { ProviderLoginDto } from '../directory/dto/directory.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';

/**
 * Auth HTTP surface.
 *
 * Tokens are Bearer / JSON-body only (no auth cookies), so classic CSRF
 * protection is intentionally not applied here. See docs/ARCHITECTURE.md §12 CSRF.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('providers')
  listProviders() {
    return this.authService.listAuthProviders();
  }

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.authService.register(dto, req.ip);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  login(@Body() dto: ProviderLoginDto, @Req() req: Request) {
    // Backward compatible: classic local email login still works via ProviderLoginDto
    return this.authService.loginWithProvider(dto, req.ip);
  }

  /** @deprecated Prefer POST /auth/login with provider field */
  @Post('login/local')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  loginLocal(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, req.ip);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    return this.authService.refresh(dto.refreshToken, dto.clientInfo, req.ip);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Body() dto: RefreshTokenDto) {
    return this.authService.logout(dto.refreshToken);
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  listSessions(@CurrentUser() user: User) {
    return this.authService.listSessions(user.id);
  }

  @Delete('sessions/others')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  revokeOtherSessions(
    @CurrentUser() user: User,
    @Query('except', ParseUUIDPipe) exceptSessionId: string,
  ) {
    return this.authService.revokeOtherSessions(user.id, exceptSessionId);
  }

  @Delete('sessions/:sessionId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  revokeSession(
    @CurrentUser() user: User,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ) {
    return this.authService.revokeSession(user.id, sessionId);
  }
}
