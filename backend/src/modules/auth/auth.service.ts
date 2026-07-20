import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { UsersService } from '../users/users.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { UserSession } from './entities/user-session.entity';
import { SessionRealtimePublisher } from './session-realtime.publisher';
import { SessionCacheService } from './session-cache.service';
import { LoginAttemptService } from './login-attempt.service';
import { LoginCaptchaService } from './login-captcha.service';
import { LOGIN_CAPTCHA_CODES } from './login-protection.constants';
import { LoginDto, RegisterDto, SessionClientInfoDto } from './dto/auth.dto';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit-action';
import {
  AUTH_SESSION_REQUIRED_MESSAGE,
  AUTH_SESSION_TERMINATED_MESSAGE,
} from './auth-session.constants';
import { AuthenticationManager } from './providers/authentication-manager.service';
import { AUTH_PROVIDER_IDS } from './providers/auth-provider.types';
import type { AuthenticationProviderId } from './providers/auth-provider.types';
import type { ProviderLoginDto } from '../directory/dto/directory.dto';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  sessionId: string;
}

export interface SessionSummary {
  sessionId: string;
  appName: string;
  deviceLabel: string;
  platform: string | null;
  clientType: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastActiveAt: string;
}

interface IssueTokenOptions {
  sessionId?: string;
  clientType?: string;
  platform?: string;
  appName?: string;
  deviceLabel?: string;
  userAgent?: string;
  ipAddress?: string;
  notifyNewSession?: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepo: Repository<RefreshToken>,
    @InjectRepository(UserSession)
    private readonly sessionRepo: Repository<UserSession>,
    private readonly sessionRealtime: SessionRealtimePublisher,
    private readonly sessionCache: SessionCacheService,
    private readonly loginAttempts: LoginAttemptService,
    private readonly loginCaptcha: LoginCaptchaService,
    private readonly audit: AuditService,
    private readonly authenticationManager: AuthenticationManager,
  ) {}

  async register(dto: RegisterDto, ipAddress?: string) {
    const { providers } = await this.authenticationManager.listPublicProviders();
    if (!providers.some((p) => p.id === AUTH_PROVIDER_IDS.LOCAL)) {
      throw new UnauthorizedException('Local registration is disabled');
    }

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

    const tokens = await this.issueTokensForAuth(user.id, user.email, {
      ...this.clientInfoToOptions(dto.clientInfo),
      ipAddress,
    });
    this.audit.record({
      action: AuditAction.AUTH_REGISTER,
      userId: user.id,
      ipAddress,
      userAgent: dto.clientInfo?.userAgent,
      metadata: { email: user.email, username: user.username },
    });
    return { user: this.usersService.toPublic(user), ...tokens };
  }

  async login(dto: LoginDto, ipAddress?: string) {
    return this.loginWithProvider(
      {
        provider: AUTH_PROVIDER_IDS.LOCAL,
        email: dto.email,
        password: dto.password,
        clientInfo: dto.clientInfo,
        captchaToken: dto.captchaToken,
        captchaAnswer: dto.captchaAnswer,
      },
      ipAddress,
    );
  }

  async loginWithProvider(dto: ProviderLoginDto, ipAddress?: string) {
    const identifier = (dto.username ?? dto.email ?? '').trim();
    if (!identifier) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const captchaConfig = this.loginCaptcha.getPublicConfig();
    const captchaRequired = await this.loginAttempts.isCaptchaRequired(ipAddress, identifier);

    if (captchaRequired) {
      if (!dto.captchaToken) {
        throw new BadRequestException({
          statusCode: 400,
          message: 'CAPTCHA verification required after multiple failed attempts',
          code: LOGIN_CAPTCHA_CODES.REQUIRED,
          captchaRequired: true,
          captchaProvider: captchaConfig.provider,
          ...(captchaConfig.turnstileSiteKey
            ? { turnstileSiteKey: captchaConfig.turnstileSiteKey }
            : {}),
        });
      }
      await this.loginCaptcha.assertValid({
        captchaToken: dto.captchaToken,
        captchaAnswer: dto.captchaAnswer,
      });
    }

    const preferredProvider: AuthenticationProviderId | undefined = dto.provider;

    try {
      const result = await this.authenticationManager.authenticate(
        {
          identifier,
          password: dto.password,
          preferredProvider,
        },
        {
          ipAddress,
          userAgent: dto.clientInfo?.userAgent,
        },
      );

      const user = await this.usersService.findById(result.userId);
      if (!user || !user.isActive) {
        throw new UnauthorizedException('Invalid credentials');
      }

      await this.loginAttempts.clearFailures(ipAddress, identifier);

      const tokens = await this.issueTokensForAuth(user.id, user.email, {
        ...this.clientInfoToOptions(dto.clientInfo),
        ipAddress,
      });

      this.audit.record({
        action: AuditAction.AUTH_LOGIN,
        userId: user.id,
        ipAddress,
        userAgent: dto.clientInfo?.userAgent,
        metadata: {
          email: user.email,
          provider: result.provider,
          deviceLabel: dto.clientInfo?.deviceLabel,
          appName: dto.clientInfo?.appName,
          created: result.created ?? false,
        },
      });

      return { user: this.usersService.toPublic(user), ...tokens };
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        const failure = await this.loginAttempts.recordFailure(ipAddress, identifier);
        this.audit.record({
          action: AuditAction.AUTH_LOGIN_FAILED,
          ipAddress,
          userAgent: dto.clientInfo?.userAgent,
          metadata: {
            identifier,
            provider: preferredProvider,
            captchaRequired: failure.captchaRequired,
            attempts: failure.attempts,
          },
        });
        throw new UnauthorizedException({
          statusCode: 401,
          message: 'Invalid credentials',
          code: 'INVALID_CREDENTIALS',
          captchaRequired: failure.captchaRequired,
          captchaProvider: captchaConfig.provider,
          ...(captchaConfig.turnstileSiteKey
            ? { turnstileSiteKey: captchaConfig.turnstileSiteKey }
            : {}),
        });
      }
      throw err;
    }
  }

  getLoginProtectionStatus(ipAddress?: string, identifier?: string) {
    return this.buildLoginProtectionStatus(ipAddress, identifier);
  }

  createLoginCaptchaChallenge() {
    return this.loginCaptcha.createChallenge();
  }

  private async buildLoginProtectionStatus(ipAddress?: string, identifier?: string) {
    const captchaConfig = this.loginCaptcha.getPublicConfig();
    const captchaRequired = await this.loginAttempts.isCaptchaRequired(
      ipAddress,
      identifier?.trim() || undefined,
    );
    return {
      captchaRequired,
      captchaProvider: captchaConfig.provider,
      threshold: this.loginAttempts.getThreshold(),
      ...(captchaConfig.turnstileSiteKey
        ? { turnstileSiteKey: captchaConfig.turnstileSiteKey }
        : {}),
    };
  }

  listAuthProviders() {
    return this.authenticationManager.listPublicProviders();
  }

  async refresh(refreshToken: string, clientInfo?: SessionClientInfoDto, ipAddress?: string) {
    const hash = this.hashToken(refreshToken);
    const stored = await this.refreshTokenRepo.findOne({
      where: { tokenHash: hash },
      relations: ['user'],
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    stored.revokedAt = new Date();
    stored.lastUsedAt = new Date();
    await this.refreshTokenRepo.save(stored);

    const user = stored.user;
    if (!user.isActive) {
      throw new UnauthorizedException(AUTH_SESSION_TERMINATED_MESSAGE);
    }

    const sessionActive = await this.isSessionActive(
      stored.sessionFamilyId,
      user.id,
    );
    if (!sessionActive) {
      throw new UnauthorizedException(AUTH_SESSION_TERMINATED_MESSAGE);
    }

    return this.issueTokens(user.id, user.email, {
      sessionId: stored.sessionFamilyId,
      clientType: clientInfo?.clientType ?? stored.clientType,
      platform: clientInfo?.platform ?? stored.platform,
      appName: clientInfo?.appName ?? undefined,
      deviceLabel: clientInfo?.deviceLabel ?? stored.deviceLabel,
      userAgent: clientInfo?.userAgent ?? stored.userAgent,
      ipAddress: ipAddress ?? stored.ipAddress,
      notifyNewSession: false,
    });
  }

  async logout(refreshToken: string) {
    const hash = this.hashToken(refreshToken);
    const stored = await this.refreshTokenRepo.findOne({ where: { tokenHash: hash } });
    if (stored) {
      await this.revokeSessionById(stored.userId, stored.sessionFamilyId);
      this.audit.record({
        action: AuditAction.AUTH_LOGOUT,
        userId: stored.userId,
        resourceType: 'session',
        resourceId: stored.sessionFamilyId,
      });
    }
    return { success: true };
  }

  async listSessions(userId: string): Promise<SessionSummary[]> {
    const sessions = await this.sessionRepo.find({
      where: { userId, revokedAt: IsNull() },
      order: { lastActiveAt: 'DESC' },
    });

    const active: SessionSummary[] = [];
    for (const session of sessions) {
      const hasToken = await this.refreshTokenRepo.exist({
        where: {
          userId,
          sessionFamilyId: session.id,
          revokedAt: IsNull(),
          expiresAt: MoreThan(new Date()),
        },
      });
      if (hasToken) {
        active.push(this.toSessionSummary(session));
      }
    }

    return this.dedupeSessionsByDevice(active);
  }

  private dedupeSessionsByDevice(sessions: SessionSummary[]): SessionSummary[] {
    const byDevice = new Map<string, SessionSummary>();
    for (const session of sessions) {
      const key = session.deviceLabel.toLowerCase();
      const current = byDevice.get(key);
      if (!current || session.lastActiveAt > current.lastActiveAt) {
        byDevice.set(key, session);
      }
    }
    return [...byDevice.values()].sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
  }

  async revokeSession(userId: string, sessionId: string, options?: { silent?: boolean }) {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, userId, revokedAt: IsNull() },
    });
    if (!session) throw new NotFoundException('Session not found');

    await this.revokeSessionById(userId, sessionId);
    if (!options?.silent) {
      this.audit.record({
        action: AuditAction.AUTH_SESSION_REVOKE,
        userId,
        resourceType: 'session',
        resourceId: sessionId,
      });
    }
    return { success: true };
  }

  async revokeOtherSessions(userId: string, currentSessionId: string) {
    const sessions = await this.sessionRepo.find({
      where: { userId, revokedAt: IsNull() },
    });

    let revoked = 0;
    for (const session of sessions) {
      if (session.id === currentSessionId) continue;
      await this.revokeSessionById(userId, session.id);
      revoked += 1;
    }

    if (revoked > 0) {
      this.audit.record({
        action: AuditAction.AUTH_SESSION_REVOKE_OTHERS,
        userId,
        metadata: { revoked, exceptSessionId: currentSessionId },
      });
    }

    return { success: true, revoked };
  }

  async revokeAllSessions(userId: string) {
    const sessions = await this.sessionRepo.find({
      where: { userId, revokedAt: IsNull() },
    });

    for (const session of sessions) {
      await this.revokeSessionById(userId, session.id);
    }

    return { success: true, revoked: sessions.length };
  }

  async validateAccessToken(payload: { sub: string; email: string; sid?: string }) {
    const sessionId = payload.sid?.trim();
    if (!sessionId) {
      throw new UnauthorizedException(AUTH_SESSION_REQUIRED_MESSAGE);
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user || !user.isActive) {
      throw new UnauthorizedException(AUTH_SESSION_TERMINATED_MESSAGE);
    }

    const sessionValid = await this.isSessionActive(sessionId, payload.sub);
    if (!sessionValid) {
      throw new UnauthorizedException(AUTH_SESSION_TERMINATED_MESSAGE);
    }

    void this.touchSession(sessionId);

    return user;
  }

  private async isSessionActive(sessionId: string, userId: string): Promise<boolean> {
    const cached = await this.sessionCache.getCachedUserId(sessionId);
    if (cached === 'revoked') return false;
    if (cached === userId) return true;
    if (cached !== null) {
      await this.sessionCache.markSessionRevoked(sessionId);
    }

    const active = await this.sessionRepo.exist({
      where: { id: sessionId, userId, revokedAt: IsNull() },
    });

    if (active) {
      await this.sessionCache.cacheValidSession(sessionId, userId);
      return true;
    }

    await this.sessionCache.markSessionRevoked(sessionId);
    return false;
  }

  private async touchSession(sessionId: string) {
    const shouldWrite = await this.sessionCache.shouldTouchSession(sessionId);
    if (!shouldWrite) return;

    await this.sessionRepo.update(
      { id: sessionId, revokedAt: IsNull() },
      { lastActiveAt: new Date() },
    );
  }

  private async revokeSessionById(userId: string, sessionId: string) {
    const now = new Date();
    await this.sessionRepo.update(
      { id: sessionId, userId, revokedAt: IsNull() },
      { revokedAt: now, lastActiveAt: now },
    );
    await this.refreshTokenRepo.update(
      { userId, sessionFamilyId: sessionId, revokedAt: IsNull() },
      { revokedAt: now, lastUsedAt: now },
    );
    await this.sessionCache.markSessionRevoked(sessionId);
    await this.sessionRealtime.publishTerminated(sessionId);
  }

  private async issueTokens(
    userId: string,
    email: string,
    options: IssueTokenOptions = {},
  ): Promise<TokenPair> {
    const accessExpiresIn = this.config.get<string>('JWT_ACCESS_EXPIRES_IN', '15m');
    const refreshExpiresIn = this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '7d');
    const sessionId = options.sessionId ?? randomUUID();
    const now = new Date();

    const deviceLabel =
      options.deviceLabel?.trim() || this.fallbackDeviceLabel(options.appName, options.platform);
    const appName = options.appName ?? this.inferAppName(options.clientType, deviceLabel);

    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, userId, revokedAt: IsNull() },
    });

    const isNewSession = !session;

    if (session) {
      session.deviceLabel = deviceLabel;
      session.appName = appName;
      session.clientType = options.clientType ?? session.clientType;
      session.platform = options.platform ?? session.platform;
      session.userAgent = options.userAgent ?? session.userAgent;
      session.ipAddress = options.ipAddress ?? session.ipAddress;
      session.lastActiveAt = now;
      await this.sessionRepo.save(session);
    } else {
      await this.sessionRepo.save(
        this.sessionRepo.create({
          id: sessionId,
          userId,
          deviceLabel,
          appName,
          clientType: options.clientType,
          platform: options.platform,
          userAgent: options.userAgent,
          ipAddress: options.ipAddress,
          lastActiveAt: now,
        }),
      );
    }

    await this.sessionCache.cacheValidSession(sessionId, userId);

    const accessToken = await this.jwtService.signAsync(
      { sub: userId, email, sid: sessionId },
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
      sessionFamilyId: sessionId,
      clientType: options.clientType,
      platform: options.platform,
      deviceLabel,
      userAgent: options.userAgent,
      ipAddress: options.ipAddress,
      lastUsedAt: now,
    });

    if (isNewSession && options.notifyNewSession) {
      await this.sessionRealtime.publishCreated(
        userId,
        {
          sessionId,
          deviceLabel,
          appName,
          platform: options.platform ?? null,
          ipAddress: options.ipAddress ?? null,
        },
        sessionId,
      );
    }

    return {
      accessToken,
      refreshToken,
      expiresIn: this.parseExpirySeconds(accessExpiresIn),
      sessionId,
    };
  }

  private async issueTokensForAuth(
    userId: string,
    email: string,
    options: IssueTokenOptions = {},
  ): Promise<TokenPair> {
    const { sessionId, isNewDevice } = await this.resolveSessionForDevice(userId, options);

    if (!isNewDevice) {
      await this.revokeRefreshTokensForSession(userId, sessionId);
    }

    return this.issueTokens(userId, email, {
      ...options,
      sessionId,
      notifyNewSession: isNewDevice,
    });
  }

  private async resolveSessionForDevice(
    userId: string,
    options: IssueTokenOptions,
  ): Promise<{ sessionId: string; isNewDevice: boolean }> {
    const deviceLabel =
      options.deviceLabel?.trim() || this.fallbackDeviceLabel(options.appName, options.platform);

    const where: {
      userId: string;
      revokedAt: ReturnType<typeof IsNull>;
      deviceLabel: string;
      clientType?: string;
    } = {
      userId,
      revokedAt: IsNull(),
      deviceLabel,
    };

    if (options.clientType) {
      where.clientType = options.clientType;
    }

    const matches = await this.sessionRepo.find({
      where,
      order: { lastActiveAt: 'DESC' },
    });

    if (matches.length === 0) {
      return { sessionId: randomUUID(), isNewDevice: true };
    }

    const [primary, ...duplicates] = matches;
    for (const duplicate of duplicates) {
      await this.revokeSessionById(userId, duplicate.id);
    }

    return { sessionId: primary.id, isNewDevice: false };
  }

  private async revokeRefreshTokensForSession(userId: string, sessionId: string) {
    const now = new Date();
    await this.refreshTokenRepo.update(
      { userId, sessionFamilyId: sessionId, revokedAt: IsNull() },
      { revokedAt: now, lastUsedAt: now },
    );
  }

  private clientInfoToOptions(clientInfo?: SessionClientInfoDto): IssueTokenOptions {
    if (!clientInfo) return {};
    return {
      clientType: clientInfo.clientType,
      platform: clientInfo.platform,
      appName: clientInfo.appName,
      deviceLabel: clientInfo.deviceLabel,
      userAgent: clientInfo.userAgent,
    };
  }

  private toSessionSummary(session: UserSession): SessionSummary {
    return {
      sessionId: session.id,
      appName: session.appName ?? this.inferAppName(session.clientType, session.deviceLabel),
      deviceLabel: session.deviceLabel,
      platform: session.platform ?? null,
      clientType: session.clientType ?? null,
      ipAddress: session.ipAddress ?? null,
      createdAt: session.createdAt.toISOString(),
      lastActiveAt: session.lastActiveAt.toISOString(),
    };
  }

  private inferAppName(clientType?: string, deviceLabel?: string): string {
    if (clientType === 'electron') return 'ChatApp';
    if (deviceLabel?.includes(',')) return deviceLabel.split(',')[0].trim();
    return 'Browser';
  }

  private fallbackDeviceLabel(appName?: string, platform?: string): string {
    const name = appName ?? 'ChatApp';
    if (platform) return `${name}, ${platform}`;
    return name;
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
