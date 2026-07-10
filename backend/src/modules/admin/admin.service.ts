import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { UserSession } from '../auth/entities/user-session.entity';
import { Conversation, ConversationType } from '../conversations/entities/conversation.entity';
import { Message } from '../messages/entities/message.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { AuthService, SessionSummary } from '../auth/auth.service';
import { UpdateAdminUserDto } from './dto/admin.dto';
import { AuditService, PaginatedAuditLogs } from '../audit/audit.service';
import { AuditAction } from '../audit/audit-action';

export interface AdminStats {
  users: { total: number; active: number; inactive: number; admins: number };
  conversations: { total: number; direct: number; channel: number; group: number };
  messages: { total: number; last24h: number };
  sessions: { active: number };
}

export interface AdminUserSummary {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  isActive: boolean;
  isAdmin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUserDetail extends AdminUserSummary {
  activeSessionCount: number;
}

export interface PaginatedUsers {
  items: AdminUserSummary[];
  total: number;
  page: number;
  limit: number;
}

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserSession)
    private readonly sessionRepo: Repository<UserSession>,
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepo: Repository<RefreshToken>,
    private readonly authService: AuthService,
    private readonly audit: AuditService,
  ) {}

  async getStats(): Promise<AdminStats> {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      activeUsers,
      adminUsers,
      totalConversations,
      directCount,
      channelCount,
      groupCount,
      totalMessages,
      messages24h,
    ] = await Promise.all([
      this.userRepo.count(),
      this.userRepo.count({ where: { isActive: true } }),
      this.userRepo.count({ where: { isAdmin: true } }),
      this.conversationRepo.count(),
      this.conversationRepo.count({ where: { type: ConversationType.DIRECT } }),
      this.conversationRepo.count({ where: { type: ConversationType.CHANNEL } }),
      this.conversationRepo.count({ where: { type: ConversationType.GROUP } }),
      this.messageRepo.count(),
      this.messageRepo
        .createQueryBuilder('m')
        .where('m.created_at >= :since', { since: since24h })
        .getCount(),
    ]);

    const activeSessions = await this.countActiveSessions();

    return {
      users: {
        total: totalUsers,
        active: activeUsers,
        inactive: totalUsers - activeUsers,
        admins: adminUsers,
      },
      conversations: {
        total: totalConversations,
        direct: directCount,
        channel: channelCount,
        group: groupCount,
      },
      messages: {
        total: totalMessages,
        last24h: messages24h,
      },
      sessions: { active: activeSessions },
    };
  }

  async listUsers(options: {
    page?: number;
    limit?: number;
    q?: string;
    isActive?: boolean;
  }): Promise<PaginatedUsers> {
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(100, Math.max(1, options.limit ?? 20));
    const skip = (page - 1) * limit;

    const qb = this.userRepo.createQueryBuilder('user').orderBy('user.created_at', 'DESC');

    if (options.q?.trim()) {
      const q = `%${options.q.trim().toLowerCase()}%`;
      qb.andWhere(
        '(LOWER(user.email) LIKE :q OR LOWER(user.username) LIKE :q OR LOWER(user.display_name) LIKE :q)',
        { q },
      );
    }

    if (options.isActive !== undefined) {
      qb.andWhere('user.is_active = :isActive', { isActive: options.isActive });
    }

    const [users, total] = await qb.skip(skip).take(limit).getManyAndCount();

    return {
      items: users.map((user) => this.toAdminSummary(user)),
      total,
      page,
      limit,
    };
  }

  async getUser(userId: string): Promise<AdminUserDetail> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const sessions = await this.authService.listSessions(userId);

    return {
      ...this.toAdminSummary(user),
      activeSessionCount: sessions.length,
    };
  }

  async updateUser(
    actorId: string,
    userId: string,
    dto: UpdateAdminUserDto,
  ): Promise<AdminUserSummary> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (userId === actorId) {
      if (dto.isActive === false) {
        throw new BadRequestException('Cannot deactivate your own account');
      }
      if (dto.isAdmin === false) {
        throw new BadRequestException('Cannot remove your own admin access');
      }
    }

    if (dto.isActive !== undefined) user.isActive = dto.isActive;
    if (dto.isAdmin !== undefined) user.isAdmin = dto.isAdmin;

    await this.userRepo.save(user);

    this.audit.record({
      action: AuditAction.ADMIN_USER_UPDATE,
      userId,
      actorUserId: actorId,
      resourceType: 'user',
      resourceId: userId,
      metadata: {
        isActive: dto.isActive,
        isAdmin: dto.isAdmin,
      },
    });

    return this.toAdminSummary(user);
  }

  async listUserSessions(userId: string): Promise<SessionSummary[]> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return this.authService.listSessions(userId);
  }

  async revokeUserSession(actorId: string, userId: string, sessionId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const result = await this.authService.revokeSession(userId, sessionId, { silent: true });
    this.audit.record({
      action: AuditAction.ADMIN_SESSION_REVOKE,
      userId,
      actorUserId: actorId,
      resourceType: 'session',
      resourceId: sessionId,
    });
    return result;
  }

  async revokeAllUserSessions(actorId: string, userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const sessions = await this.authService.listSessions(userId);
    for (const session of sessions) {
      await this.authService.revokeSession(userId, session.sessionId, { silent: true });
    }

    this.audit.record({
      action: AuditAction.ADMIN_SESSION_REVOKE_ALL,
      userId,
      actorUserId: actorId,
      metadata: { revoked: sessions.length },
    });

    return { success: true, revoked: sessions.length };
  }

  listAuditLogs(options: {
    page?: number;
    limit?: number;
    userId?: string;
    action?: string;
    category?: string;
    from?: string;
    to?: string;
    q?: string;
  }): Promise<PaginatedAuditLogs> {
    return this.audit.list(options);
  }

  toAdminSummary(user: User): AdminUserSummary {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      isActive: user.isActive,
      isAdmin: user.isAdmin,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  private async countActiveSessions(): Promise<number> {
    const sessions = await this.sessionRepo.find({
      where: { revokedAt: IsNull() },
    });

    let count = 0;
    for (const session of sessions) {
      const hasToken = await this.refreshTokenRepo.exist({
        where: {
          userId: session.userId,
          sessionFamilyId: session.id,
          revokedAt: IsNull(),
          expiresAt: MoreThan(new Date()),
        },
      });
      if (hasToken) count += 1;
    }

    return count;
  }
}
