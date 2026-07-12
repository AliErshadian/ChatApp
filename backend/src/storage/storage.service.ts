import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import type { Response } from 'express';
import { ConversationsService } from '../modules/conversations/conversations.service';
import { MemberRole } from '../modules/conversations/entities/conversation-member.entity';
import { AuditService } from '../modules/audit/audit.service';
import { AuditAction } from '../modules/audit/audit-action';
import { buildStorageConfig } from './config/storage.config';
import { Attachment } from './entities/attachment.entity';
import { STORAGE_HOOKS, StorageHook, StorageUploadContext } from './interfaces/storage-hooks.interface';
import {
  IStorageProvider,
  STORAGE_PROVIDER,
} from './interfaces/storage-provider.interface';
import { StorageRepository } from './storage.repository';
import { AttachmentListKind } from './dto/list-conversation-attachments.dto';
import { buildObjectKey, buildStoredFileName } from './utils/file-name.util';
import { StorageCategory, validateMediaFile } from './utils/mime.util';

export interface AttachmentMetadata {
  id: string;
  originalName: string;
  fileName: string;
  bucket: string;
  mimeType: string;
  extension: string;
  size: string;
  checksum: string;
  url: string;
  uploadedBy: string;
  conversationId?: string;
  messageId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationAttachmentItem {
  id: string;
  originalName: string;
  mimeType: string;
  size: string;
  url: string;
  uploadedBy: string;
  messageId: string;
  caption?: string;
  createdAt: string;
  uploader: {
    id: string;
    displayName: string;
    username: string;
  };
}

export interface ConversationAttachmentListResponse {
  items: ConversationAttachmentItem[];
  nextCursor: string | null;
}

export interface PresignedDownloadResponse {
  url: string;
  expiresInSeconds: number;
  expiresAt: string;
}

export interface UploadAttachmentOptions {
  conversationId?: string;
  messageId?: string;
  forceCategory?: StorageCategory;
  allowedCategories?: StorageCategory[];
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly storageConfig: ReturnType<typeof buildStorageConfig>;

  constructor(
    private readonly configService: ConfigService,
    private readonly repository: StorageRepository,
    @Inject(STORAGE_PROVIDER)
    private readonly provider: IStorageProvider,
    @Inject(forwardRef(() => ConversationsService))
    private readonly conversationsService: ConversationsService,
    private readonly audit: AuditService,
    @Optional()
    @Inject(STORAGE_HOOKS)
    private readonly hooks: StorageHook[] = [],
  ) {
    this.storageConfig = buildStorageConfig(configService);
  }

  async upload(
    userId: string,
    file: Express.Multer.File,
    options: UploadAttachmentOptions = {},
  ): Promise<AttachmentMetadata> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('File is required');
    }

    const media = validateMediaFile(file, {
      forceCategory: options.forceCategory,
      allowedCategories: options.allowedCategories,
    });

    this.assertSizeLimit(media.category, file.size);

    if (options.conversationId) {
      await this.conversationsService.assertCanSendMessage(options.conversationId, userId);
    }

    const bucket = this.storageConfig.buckets[media.category];
    const objectKey = buildObjectKey(media.extension);
    const fileName = buildStoredFileName(media.extension);
    const checksum = createHash('sha256').update(file.buffer).digest('hex');

    const hookContext: StorageUploadContext = {
      userId,
      category: media.category,
      bucket,
      objectKey,
      mimeType: media.mimeType,
      size: file.size,
      buffer: file.buffer,
      conversationId: options.conversationId,
      messageId: options.messageId,
    };

    await this.runHooks('onBeforeUpload', hookContext);

    await this.provider.upload({
      bucket,
      objectKey,
      body: file.buffer,
      mimeType: media.mimeType,
      size: file.size,
      checksum,
    });

    const attachment = this.repository.create({
      originalName: media.originalName,
      fileName,
      bucket,
      objectKey,
      mimeType: media.mimeType,
      extension: media.extension,
      size: file.size,
      checksum,
      url: this.buildApiUrl('pending'),
      uploadedBy: userId,
      conversationId: options.conversationId,
      messageId: options.messageId,
    });

    const saved = await this.repository.save(attachment);
    saved.url = this.buildApiUrl(saved.id);
    await this.repository.save(saved);

    await this.runHooks('onAfterUpload', hookContext, saved.id);

    this.audit.record({
      action: AuditAction.ATTACHMENT_UPLOAD,
      userId,
      resourceType: 'attachment',
      resourceId: saved.id,
      metadata: {
        bucket,
        mimeType: media.mimeType,
        size: file.size,
        conversationId: options.conversationId,
      },
    });

    this.logger.log(
      {
        attachmentId: saved.id,
        userId,
        bucket,
        objectKey,
        size: file.size,
        category: media.category,
      },
      'Attachment uploaded',
    );

    return this.toMetadata(saved);
  }

  async getById(userId: string, attachmentId: string): Promise<AttachmentMetadata> {
    const attachment = await this.requireAttachment(attachmentId);
    await this.assertCanAccess(userId, attachment);
    return this.toMetadata(attachment);
  }

  async listForConversation(
    conversationId: string,
    userId: string,
    options: { cursor?: string; limit?: number; kind?: AttachmentListKind } = {},
  ): Promise<ConversationAttachmentListResponse> {
    await this.conversationsService.assertMember(conversationId, userId);

    const limit = Math.min(options.limit ?? 50, 100);
    const rows = await this.repository.listForConversation({
      conversationId,
      userId,
      cursor: options.cursor,
      limit,
      kind: options.kind,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: page.map((attachment) => this.toConversationItem(attachment)),
      nextCursor: hasMore ? page[page.length - 1]?.createdAt.toISOString() ?? null : null,
    };
  }

  async getPresignedDownloadUrl(
    userId: string,
    attachmentId: string,
  ): Promise<PresignedDownloadResponse> {
    const attachment = await this.requireAttachment(attachmentId);
    await this.assertCanAccess(userId, attachment);

    const expiresInSeconds = this.storageConfig.presignedUrlExpiresSeconds;
    const url = await this.provider.getPresignedDownloadUrl(
      attachment.bucket,
      attachment.objectKey,
      { expiresInSeconds },
    );

    this.audit.record({
      action: AuditAction.ATTACHMENT_DOWNLOAD,
      userId,
      resourceType: 'attachment',
      resourceId: attachment.id,
      metadata: {
        conversationId: attachment.conversationId,
        expiresInSeconds,
      },
    });

    return {
      url,
      expiresInSeconds,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    };
  }

  async streamAttachmentContent(
    userId: string,
    attachmentId: string,
    res: Response,
  ): Promise<void> {
    const attachment = await this.requireAttachment(attachmentId);
    await this.assertCanAccess(userId, attachment);

    const body = await this.provider.getObjectStream(attachment.bucket, attachment.objectKey);

    this.audit.record({
      action: AuditAction.ATTACHMENT_DOWNLOAD,
      userId,
      resourceType: 'attachment',
      resourceId: attachment.id,
      metadata: {
        conversationId: attachment.conversationId,
        proxied: true,
      },
    });

    res.setHeader('Content-Type', attachment.mimeType);
    if (attachment.size) {
      res.setHeader('Content-Length', attachment.size);
    }
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${attachment.originalName.replace(/"/g, '')}"`,
    );
    res.setHeader('Cache-Control', 'private, max-age=86400');

    await new Promise<void>((resolve, reject) => {
      body.on('error', reject);
      res.on('error', reject);
      res.on('finish', () => resolve());
      body.pipe(res);
    });
  }

  async delete(userId: string, attachmentId: string): Promise<void> {
    const attachment = await this.requireAttachment(attachmentId);
    await this.assertCanDelete(userId, attachment);

    await this.runDeleteHooks(attachment.id);

    await this.provider.deleteObject(attachment.bucket, attachment.objectKey);
    await this.repository.deleteById(attachment.id);

    this.audit.record({
      action: AuditAction.ATTACHMENT_DELETE,
      userId,
      resourceType: 'attachment',
      resourceId: attachment.id,
      metadata: {
        bucket: attachment.bucket,
        conversationId: attachment.conversationId,
      },
    });

    this.logger.log({ attachmentId, userId }, 'Attachment deleted');
  }

  async linkToMessage(attachmentId: string, messageId: string, conversationId: string) {
    const updated = await this.repository.updateMessageId(attachmentId, messageId);
    if (updated && !updated.conversationId) {
      updated.conversationId = conversationId;
      await this.repository.save(updated);
    }
    return updated ? this.toMetadata(updated) : undefined;
  }

  async copyAttachmentForConversation(
    sourceAttachmentId: string,
    userId: string,
    targetConversationId: string,
  ): Promise<AttachmentMetadata> {
    const source = await this.requireAttachment(sourceAttachmentId);
    await this.conversationsService.assertCanSendMessage(targetConversationId, userId);

    const objectKey = buildObjectKey(source.extension);
    const fileName = buildStoredFileName(source.extension);

    await this.provider.copy({
      sourceBucket: source.bucket,
      sourceKey: source.objectKey,
      destinationBucket: source.bucket,
      destinationKey: objectKey,
    });

    const copied = this.repository.create({
      originalName: source.originalName,
      fileName,
      bucket: source.bucket,
      objectKey,
      mimeType: source.mimeType,
      extension: source.extension,
      size: Number(source.size),
      checksum: source.checksum,
      url: this.buildApiUrl('pending'),
      uploadedBy: userId,
      conversationId: targetConversationId,
    });

    const saved = await this.repository.save(copied);
    saved.url = this.buildApiUrl(saved.id);
    await this.repository.save(saved);

    return this.toMetadata(saved);
  }

  findAttachmentByMessageContent(content: string): string | undefined {
    const normalized = content.replace(/\?.*$/, '');
    const match = normalized.match(/^\/api\/v1\/attachments\/([0-9a-f-]{36})(?:\/(?:download|content))?$/i);
    return match?.[1];
  }

  buildMessageContent(attachmentId: string): string {
    return this.buildApiUrl(attachmentId);
  }

  private buildApiUrl(attachmentId: string): string {
    return `/api/v1/attachments/${attachmentId}/content`;
  }

  private assertSizeLimit(category: StorageCategory, size: number) {
    const maxBytes = this.storageConfig.maxBytes[category];
    if (size > maxBytes) {
      throw new BadRequestException(`File exceeds maximum size for ${category} uploads`);
    }
  }

  private async requireAttachment(id: string): Promise<Attachment> {
    const attachment = await this.repository.findById(id);
    if (!attachment) {
      throw new NotFoundException('Attachment not found');
    }
    return attachment;
  }

  private async assertCanAccess(userId: string, attachment: Attachment) {
    if (attachment.uploadedBy === userId) return;

    if (attachment.conversationId) {
      await this.conversationsService.assertMember(attachment.conversationId, userId);
      return;
    }

    if (attachment.bucket === this.storageConfig.buckets.avatar) {
      return;
    }

    throw new ForbiddenException('You do not have access to this attachment');
  }

  private async assertCanDelete(userId: string, attachment: Attachment) {
    if (attachment.uploadedBy === userId) return;

    if (attachment.conversationId) {
      const member = await this.conversationsService.assertMember(
        attachment.conversationId,
        userId,
      );
      if (member.role === MemberRole.OWNER || member.role === MemberRole.ADMIN) return;
    }

    throw new ForbiddenException('You do not have permission to delete this attachment');
  }

  private async runHooks(
    method: 'onBeforeUpload' | 'onAfterUpload',
    context: StorageUploadContext,
    attachmentId?: string,
  ) {
    for (const hook of this.hooks) {
      const handler = hook[method];
      if (!handler) continue;
      if (method === 'onAfterUpload' && attachmentId) {
        await hook.onAfterUpload!(context, attachmentId);
      } else if (method === 'onBeforeUpload') {
        await hook.onBeforeUpload!(context);
      }
    }
  }

  private async runDeleteHooks(attachmentId: string) {
    for (const hook of this.hooks) {
      if (hook.onBeforeDelete) {
        await hook.onBeforeDelete(attachmentId);
      }
    }
  }

  private toMetadata(attachment: Attachment): AttachmentMetadata {
    return {
      id: attachment.id,
      originalName: attachment.originalName,
      fileName: attachment.fileName,
      bucket: attachment.bucket,
      mimeType: attachment.mimeType,
      extension: attachment.extension,
      size: attachment.size,
      checksum: attachment.checksum,
      url: attachment.url,
      uploadedBy: attachment.uploadedBy,
      conversationId: attachment.conversationId,
      messageId: attachment.messageId,
      createdAt: attachment.createdAt,
      updatedAt: attachment.updatedAt,
    };
  }

  private toConversationItem(attachment: Attachment): ConversationAttachmentItem {
    const uploader = attachment.uploader;
    return {
      id: attachment.id,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      size: attachment.size,
      url: attachment.url,
      uploadedBy: attachment.uploadedBy,
      messageId: attachment.messageId!,
      caption: attachment.message?.caption,
      createdAt: attachment.createdAt.toISOString(),
      uploader: {
        id: uploader?.id ?? attachment.uploadedBy,
        displayName: uploader?.displayName ?? 'Unknown',
        username: uploader?.username ?? 'unknown',
      },
    };
  }
}
