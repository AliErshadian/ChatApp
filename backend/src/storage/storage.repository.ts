import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MessageUserHidden } from '../modules/messages/entities/message-user-hidden.entity';
import { AttachmentListKind } from './dto/list-conversation-attachments.dto';
import { Attachment } from './entities/attachment.entity';

export interface ListConversationAttachmentsParams {
  conversationId: string;
  userId: string;
  cursor?: string;
  limit: number;
  kind?: AttachmentListKind;
}

export interface CreateAttachmentInput {
  originalName: string;
  fileName: string;
  bucket: string;
  objectKey: string;
  mimeType: string;
  extension: string;
  size: number;
  checksum: string;
  url: string;
  uploadedBy: string;
  conversationId?: string;
  messageId?: string;
}

@Injectable()
export class StorageRepository {
  constructor(
    @InjectRepository(Attachment)
    private readonly attachmentRepo: Repository<Attachment>,
  ) {}

  create(input: CreateAttachmentInput) {
    return this.attachmentRepo.create({
      ...input,
      size: String(input.size),
    });
  }

  save(attachment: Attachment) {
    return this.attachmentRepo.save(attachment);
  }

  findById(id: string) {
    return this.attachmentRepo.findOne({ where: { id } });
  }

  async updateMessageId(id: string, messageId: string) {
    await this.attachmentRepo.update({ id }, { messageId });
    return this.findById(id);
  }

  async deleteById(id: string) {
    await this.attachmentRepo.delete({ id });
  }

  async listForConversation(params: ListConversationAttachmentsParams) {
    const qb = this.attachmentRepo
      .createQueryBuilder('attachment')
      .innerJoinAndSelect('attachment.message', 'message')
      .leftJoin(
        MessageUserHidden,
        'hidden',
        'hidden.messageId = message.id AND hidden.userId = :userId',
        { userId: params.userId },
      )
      .leftJoinAndSelect('attachment.uploader', 'uploader')
      .where('attachment.conversationId = :conversationId', {
        conversationId: params.conversationId,
      })
      .andWhere('attachment.messageId IS NOT NULL')
      .andWhere('message.deletedAt IS NULL')
      .andWhere('hidden.id IS NULL')
      .orderBy('attachment.createdAt', 'DESC')
      .take(params.limit + 1);

    if (params.cursor) {
      qb.andWhere('attachment.createdAt < :cursor', { cursor: new Date(params.cursor) });
    }

    switch (params.kind) {
      case 'mine':
        qb.andWhere('attachment.uploadedBy = :userId', { userId: params.userId });
        break;
      case 'shared':
        qb.andWhere('attachment.uploadedBy != :userId', { userId: params.userId });
        break;
      case 'image':
        qb.andWhere("attachment.mimeType LIKE 'image/%'");
        break;
      case 'video':
        qb.andWhere("attachment.mimeType LIKE 'video/%'");
        break;
      case 'audio':
        qb.andWhere("attachment.mimeType LIKE 'audio/%'");
        qb.andWhere("LOWER(attachment.originalName) NOT LIKE 'voice-%'");
        break;
      case 'voice':
        qb.andWhere("LOWER(attachment.originalName) LIKE 'voice-%'");
        break;
      case 'document':
        qb.andWhere("attachment.mimeType NOT LIKE 'image/%'");
        qb.andWhere("attachment.mimeType NOT LIKE 'video/%'");
        qb.andWhere("attachment.mimeType NOT LIKE 'audio/%'");
        break;
      default:
        break;
    }

    return qb.getMany();
  }
}
