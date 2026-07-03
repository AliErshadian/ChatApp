import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { UsersService } from '../users/users.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { RegisterDto, LoginDto } from './dto/auth.dto';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepo: Repository<RefreshToken>,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) throw new ConflictException('Email already registered');

    const existingUsername = await this.usersService.findByUsername(dto.username);
    if (existingUsername) throw new ConflictException('Username taken');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.usersService.create({
      email: dto.email,
      username: dto.username,
      displayName: dto.displayName,
      passwordHash,
    });

    const tokens = await this.issueTokens(user.id, user.email);
    return { user: this.usersService.toPublic(user), ...tokens };
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmailWithPassword(dto.email);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const tokens = await this.issueTokens(user.id, user.email);
    return { user: this.usersService.toPublic(user), ...tokens };
  }

  async refresh(refreshToken: string) {
    const hash = this.hashToken(refreshToken);
    const stored = await this.refreshTokenRepo.findOne({
      where: { tokenHash: hash },
      relations: ['user'],
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    stored.revokedAt = new Date();
    await this.refreshTokenRepo.save(stored);

    const user = stored.user;
    return this.issueTokens(user.id, user.email);
  }

  async logout(refreshToken: string) {
    const hash = this.hashToken(refreshToken);
    await this.refreshTokenRepo.update(
      { tokenHash: hash, revokedAt: undefined },
      { revokedAt: new Date() },
    );
    return { success: true };
  }

  async validateAccessToken(payload: { sub: string; email: string }) {
    const user = await this.usersService.findById(payload.sub);
    if (!user || !user.isActive) throw new UnauthorizedException();
    return user;
  }

  private async issueTokens(userId: string, email: string): Promise<TokenPair> {
    const accessExpiresIn = this.config.get<string>('JWT_ACCESS_EXPIRES_IN', '15m');
    const refreshExpiresIn = this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '7d');

    const accessToken = await this.jwtService.signAsync(
      { sub: userId, email },
      {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: accessExpiresIn,
      },
    );

    const refreshToken = randomBytes(48).toString('hex');
    const refreshExpiry = this.parseExpiry(refreshExpiresIn);

    await this.refreshTokenRepo.save({
      userId,
      tokenHash: this.hashToken(refreshToken),
      expiresAt: refreshExpiry,
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.parseExpirySeconds(accessExpiresIn),
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private parseExpiry(expiry: string): Date {
    const seconds = this.parseExpirySeconds(expiry);
    return new Date(Date.now() + seconds * 1000);
  }

  private parseExpirySeconds(expiry: string): number {
    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) return 900;
    const value = parseInt(match[1], 10);
    const unit = match[2];
    const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return value * (multipliers[unit] ?? 60);
  }
}
