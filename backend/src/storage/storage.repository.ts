import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Attachment } from './entities/attachment.entity';

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
}
