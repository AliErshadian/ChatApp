import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserContact } from './entities/user-contact.entity';
import { UsersService } from '../users/users.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit-action';

@Injectable()
export class ContactsService {
  constructor(
    @InjectRepository(UserContact)
    private readonly contactRepo: Repository<UserContact>,
    private readonly usersService: UsersService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string) {
    const contacts = await this.contactRepo.find({
      where: { userId },
      relations: ['contact'],
      order: { createdAt: 'DESC' },
    });

    return contacts.map((c) => ({
      ...this.usersService.toPublic(c.contact),
      addedAt: c.createdAt,
    }));
  }

  async add(userId: string, contactUserId: string) {
    if (userId === contactUserId) {
      throw new BadRequestException('Cannot add yourself as a contact');
    }

    const contactUser = await this.usersService.findById(contactUserId);
    if (!contactUser || !contactUser.isActive) {
      throw new NotFoundException('User not found');
    }

    const existing = await this.contactRepo.findOne({
      where: { userId, contactUserId },
    });
    if (existing) {
      throw new ConflictException('Contact already exists');
    }

    const contact = await this.contactRepo.save(
      this.contactRepo.create({ userId, contactUserId }),
    );

    this.audit.record({
      action: AuditAction.CONTACT_ADD,
      userId,
      resourceType: 'user',
      resourceId: contactUserId,
      metadata: { username: contactUser.username },
    });

    return {
      ...this.usersService.toPublic(contactUser),
      addedAt: contact.createdAt,
    };
  }

  async remove(userId: string, contactUserId: string) {
    const result = await this.contactRepo.delete({ userId, contactUserId });
    if (!result.affected) {
      throw new NotFoundException('Contact not found');
    }
    this.audit.record({
      action: AuditAction.CONTACT_REMOVE,
      userId,
      resourceType: 'user',
      resourceId: contactUserId,
    });
    return { removed: true };
  }
}
