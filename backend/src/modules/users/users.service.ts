import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { join, extname } from 'path';
import { existsSync, unlinkSync, mkdirSync, renameSync } from 'fs';
import { User } from './entities/user.entity';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit-action';

export interface CreateUserInput {
  email: string;
  username: string;
  displayName: string;
  passwordHash: string;
}

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const AVATAR_DIR = join(process.cwd(), 'uploads', 'avatars');

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly audit: AuditService,
  ) {
    if (!existsSync(AVATAR_DIR)) {
      mkdirSync(AVATAR_DIR, { recursive: true });
    }
  }

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

  searchByUsername(username: string) {
    const normalized = username.trim().replace(/^@/, '');
    if (!normalized) {
      return Promise.resolve([]);
    }

    return this.userRepo
      .createQueryBuilder('user')
      .where('user.is_active = true')
      .andWhere('LOWER(user.username) = LOWER(:username)', { username: normalized })
      .getMany();
  }

  async updateAvatar(userId: string, file: Express.Multer.File) {
    const ext = extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new BadRequestException('Only JPG, PNG, and WebP images are allowed');
    }

    const user = await this.findById(userId);
    if (!user) throw new BadRequestException('User not found');

    if (user.avatarUrl) {
      const relativePath = user.avatarUrl.replace(/^\//, '').split('?')[0];
      const oldPath = join(process.cwd(), relativePath);
      if (existsSync(oldPath)) {
        try {
          unlinkSync(oldPath);
        } catch {
          // ignore cleanup errors
        }
      }
    }

    const filename = `${userId}${ext}`;
    const avatarPath = join(AVATAR_DIR, filename);
    renameSync(file.path, avatarPath);

    user.avatarUrl = `/uploads/avatars/${filename}?v=${Date.now()}`;
    await this.userRepo.save(user);

    this.audit.record({
      action: AuditAction.USER_AVATAR_UPDATE,
      userId,
      resourceType: 'user',
      resourceId: userId,
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
