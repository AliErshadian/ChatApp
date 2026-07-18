import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit-action';
import { StorageService } from '../../storage/storage.service';

export interface CreateUserInput {
  email: string;
  username: string;
  displayName: string;
  passwordHash: string;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly audit: AuditService,
    private readonly storageService: StorageService,
  ) {}

  create(input: CreateUserInput) {
    const user = this.userRepo.create(input);
    return this.userRepo.save(user);
  }

  findById(id: string) {
    return this.userRepo.findOne({ where: { id } });
  }

  findByEmail(email: string) {
    return this.userRepo.findOne({ where: { email } });
  }

  findByUsername(username: string) {
    return this.userRepo.findOne({ where: { username } });
  }

  findByEmailWithPassword(email: string) {
    return this.userRepo
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email })
      .getOne();
  }

  searchUsers(query: string) {
    const normalized = query.trim().replace(/^@/, '');
    if (normalized.length < 2) {
      return Promise.resolve([]);
    }

    const pattern = `%${normalized.toLowerCase()}%`;

    return this.userRepo
      .createQueryBuilder('user')
      .where('user.is_active = true')
      .andWhere(
        `(LOWER(user.username) LIKE :pattern
          OR LOWER(user.display_name) LIKE :pattern
          OR LOWER(user.email) LIKE :pattern)`,
        { pattern },
      )
      .orderBy('user.username', 'ASC')
      .take(20)
      .getMany();
  }

  async updateMe(userId: string, input: { displayName: string }) {
    const user = await this.findById(userId);
    if (!user) throw new BadRequestException('User not found');

    const displayName = input.displayName.trim();
    if (displayName.length < 2) {
      throw new BadRequestException('Display name must be at least 2 characters');
    }

    user.displayName = displayName;
    await this.userRepo.save(user);

    this.audit.record({
      action: AuditAction.USER_PROFILE_UPDATE,
      userId,
      resourceType: 'user',
      resourceId: userId,
      metadata: { displayName },
    });

    return this.toPublic(user);
  }

  async updateAvatar(userId: string, file: Express.Multer.File) {
    const user = await this.findById(userId);
    if (!user) throw new BadRequestException('User not found');

    const previousAttachmentId = this.storageService.findAttachmentByMessageContent(
      user.avatarUrl?.split('?')[0] ?? '',
    );
    if (previousAttachmentId) {
      try {
        await this.storageService.delete(userId, previousAttachmentId);
      } catch {
        // ignore cleanup errors for stale references
      }
    }

    const attachment = await this.storageService.upload(userId, file, {
      forceCategory: 'avatar',
    });

    user.avatarUrl = `${attachment.url}?v=${Date.now()}`;
    await this.userRepo.save(user);

    this.audit.record({
      action: AuditAction.USER_AVATAR_UPDATE,
      userId,
      resourceType: 'user',
      resourceId: userId,
      metadata: { attachmentId: attachment.id },
    });

    return this.toPublic(user);
  }

  toPublic(user: User) {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
    };
  }
}
