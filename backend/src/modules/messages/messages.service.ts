import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Message } from './entities/message.entity';
import { MessageReadReceipt } from './entities/message-read-receipt.entity';
import { MessageDelivery } from './entities/message-delivery.entity';
import { MessageUserHidden } from './entities/message-user-hidden.entity';
import { MessageReaction } from './entities/message-reaction.entity';
import { MessageMention } from './entities/message-mention.entity';
import { ConversationMember } from '../conversations/entities/conversation-member.entity';
import { ConversationsService } from '../conversations/conversations.service';
import { SanitizationService } from '../../common/services/sanitization.service';
import { SendMessageDto } from './dto/message.dto';
import { validateMessageMediaFile, isTextContentType } from './message-media.util';
import { resolveMentionUserIds } from './mention.util';
import { MessageRealtimePublisher } from './message-realtime.publisher';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit-action';
import { randomUUID } from 'crypto';
import { join, extname } from 'path';
import { existsSync, mkdirSync, renameSync, copyFileSync } from 'fs';

export type MessageStatus = 'sent' | 'delivered' | 'read';

export interface ReactionSummary {
  emoji: string;
  count: number;
  reactedByMe: boolean;
}

export interface MentionSummary {
  userId: string;
  username: string;
  displayName: string;
}

export interface MessageReplyPreview {
  id: string;
  senderId: string;
  content: string;
  contentType?: string;
  fileName?: string;
  caption?: string;
  deletedForEveryone?: boolean;
  sender?: { id: string; displayName: string; username: string };
}

export interface MessageForwardedFrom {
  messageId: string;
  senderId: string;
  sender?: { id: string; displayName: string; username: string };
}

export interface MessagePayload {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  contentType: string;
  fileName?: string;
  fileSize?: string;
  caption?: string;
  clientMessageId?: string;
  sequence: string;
  createdAt: Date;
  editedAt?: Date;
  deletedForEveryone?: boolean;
  status?: MessageStatus;
  reactions?: ReactionSummary[];
  mentions?: MentionSummary[];
  replyTo?: MessageReplyPreview;
  forwardedFrom?: MessageForwardedFrom;
  sender?: { id: string; displayName: string; username: string };
}

export interface ReactionUpdatePayload {
  messageId: string;
  conversationId: string;
  reactions: ReactionSummary[];
}

export interface StatusUpdatePayload {
  messageId: string;
  conversationId: string;
  senderId: string;
  status: MessageStatus;
}

@Injectable()
export class MessagesService {
  private readonly messageRelations = [
    'sender',
    'replyTo',
    'replyTo.sender',
    'originalSender',
    'mentions',
    'mentions.user',
  ] as const;

  constructor(
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    @InjectRepository(MessageReadReceipt)
    private readonly receiptRepo: Repository<MessageReadReceipt>,
    @InjectRepository(MessageDelivery)
    private readonly deliveryRepo: Repository<MessageDelivery>,
    @InjectRepository(MessageUserHidden)
    private readonly hiddenRepo: Repository<MessageUserHidden>,
    @InjectRepository(MessageReaction)
    private readonly reactionRepo: Repository<MessageReaction>,
    @InjectRepository(MessageMention)
    private readonly mentionRepo: Repository<MessageMention>,
    @InjectRepository(ConversationMember)
    private readonly memberRepo: Repository<ConversationMember>,
    private readonly conversationsService: ConversationsService,
    private readonly sanitization: SanitizationService,
    private readonly messagePublisher: MessageRealtimePublisher,
    private readonly audit: AuditService,
  ) {}

  async send(userId: string, dto: SendMessageDto): Promise<MessagePayload> {
    await this.conversationsService.assertCanSendMessage(dto.conversationId, userId);

    const content = this.sanitization.sanitizeMessage(dto.content);
    if (!content) throw new ConflictException('Message content is empty');

    if (dto.clientMessageId) {
      const existing = await this.messageRepo.findOne({
        where: {
          conversationId: dto.conversationId,
          senderId: userId,
          clientMessageId: dto.clientMessageId,
        },
        relations: [...this.messageRelations],
      });
      if (existing) {
        return this.toPayload(existing, userId, 'sent');
      }
    }

    let replyToMessageId: string | undefined;
    if (dto.replyToMessageId) {
      replyToMessageId = await this.resolveReplyTarget(
        dto.conversationId,
        userId,
        dto.replyToMessageId,
      );
    }

    const message = this.messageRepo.create({
      conversationId: dto.conversationId,
      senderId: userId,
      content,
      clientMessageId: dto.clientMessageId,
      replyToMessageId,
    });

    const saved = await this.messageRepo.save(message);
    await this.resolveAndSaveMentions(saved.id, dto.conversationId, content);
    const withSender = await this.messageRepo.findOne({
      where: { id: saved.id },
      relations: [...this.messageRelations],
    });

    this.audit.record({
      action: AuditAction.MESSAGE_SEND,
      userId,
      resourceType: 'message',
      resourceId: saved.id,
      metadata: {
        conversationId: dto.conversationId,
        preview: this.auditPreview(content),
        contentType: 'text',
      },
    });

    return this.toPayload(withSender!, userId, 'sent');
  }

  async sendAttachment(
    userId: string,
    conversationId: string,
    file: Express.Multer.File,
    options: {
      clientMessageId?: string;
      replyToMessageId?: string;
      caption?: string;
    } = {},
  ): Promise<MessagePayload> {
    await this.conversationsService.assertCanSendMessage(conversationId, userId);

    if (options.clientMessageId) {
      const existing = await this.messageRepo.findOne({
        where: {
          conversationId,
          senderId: userId,
          clientMessageId: options.clientMessageId,
        },
        relations: [...this.messageRelations],
      });
      if (existing) {
        return this.toPayload(existing, userId, 'sent');
      }
    }

    const media = validateMessageMediaFile(file);

    let replyToMessageId: string | undefined;
    if (options.replyToMessageId) {
      replyToMessageId = await this.resolveReplyTarget(
        conversationId,
        userId,
        options.replyToMessageId,
      );
    }

    const caption = options.caption
      ? this.sanitization.sanitizeMessage(options.caption)
      : undefined;

    const storedName = `${randomUUID()}${media.ext}`;
    const attachmentDir = join(
      process.cwd(),
      'uploads',
      'message-attachments',
      conversationId,
    );
    if (!existsSync(attachmentDir)) {
      mkdirSync(attachmentDir, { recursive: true });
    }

    renameSync(file.path, join(attachmentDir, storedName));
    const content = `/uploads/message-attachments/${conversationId}/${storedName}`;

    const message = this.messageRepo.create({
      conversationId,
      senderId: userId,
      content,
      contentType: media.mimeType,
      fileName: media.originalName,
      fileSize: String(file.size),
      caption: caption || undefined,
      clientMessageId: options.clientMessageId,
      replyToMessageId,
    });

    const saved = await this.messageRepo.save(message);
    const mentionSource = [caption].filter(Boolean).join(' ');
    if (mentionSource) {
      await this.resolveAndSaveMentions(saved.id, conversationId, mentionSource);
    }
    const withSender = await this.messageRepo.findOne({
      where: { id: saved.id },
      relations: [...this.messageRelations],
    });

    const payload = this.toPayload(withSender!, userId, 'sent');
    await this.messagePublisher.publishNewMessage(payload, userId);

    this.audit.record({
      action: AuditAction.MESSAGE_SEND_ATTACHMENT,
      userId,
      resourceType: 'message',
      resourceId: saved.id,
      metadata: {
        conversationId,
        contentType: media.mimeType,
        fileName: media.originalName,
      },
    });

    return payload;
  }

  async forward(
    userId: string,
    sourceConversationId: string,
    messageId: string,
    targetConversationIds: string[],
  ): Promise<{ messages: MessagePayload[] }> {
    if (targetConversationIds.length === 0) {
      throw new BadRequestException('Select at least one destination');
    }

    const source = await this.messageRepo.findOne({
      where: { id: messageId, conversationId: sourceConversationId },
      relations: ['sender', 'originalSender'],
    });
    if (!source) throw new NotFoundException('Message not found');
    if (source.deletedAt) {
      throw new BadRequestException('Cannot forward a deleted message');
    }

    await this.conversationsService.assertMember(sourceConversationId, userId);

    const hidden = await this.hiddenRepo.findOne({
      where: { messageId, userId },
    });
    if (hidden) {
      throw new BadRequestException('Cannot forward a hidden message');
    }

    const originalSenderId = source.originalSenderId ?? source.senderId;
    const uniqueTargets = [...new Set(targetConversationIds)].filter(
      (id) => id !== sourceConversationId,
    );

    if (uniqueTargets.length === 0) {
      throw new BadRequestException('Select at least one other destination');
    }

    const payloads: MessagePayload[] = [];

    for (const targetConversationId of uniqueTargets) {
      await this.conversationsService.assertCanSendMessage(targetConversationId, userId);

      const copied = await this.copyMessageContentForForward(source, targetConversationId);

      const saved = await this.messageRepo.save(
        this.messageRepo.create({
          conversationId: targetConversationId,
          senderId: userId,
          content: copied.content,
          contentType: copied.contentType,
          fileName: copied.fileName,
          fileSize: copied.fileSize,
          caption: copied.caption,
          forwardedFromMessageId: messageId,
          originalSenderId,
        }),
      );

      const mentionSource = [
        isTextContentType(copied.contentType) ? copied.content : '',
        copied.caption ?? '',
      ]
        .filter(Boolean)
        .join(' ');
      if (mentionSource) {
        await this.resolveAndSaveMentions(saved.id, targetConversationId, mentionSource);
      }

      const withRelations = await this.messageRepo.findOne({
        where: { id: saved.id },
        relations: [...this.messageRelations],
      });

      const payload = this.toPayload(withRelations!, userId, 'sent');
      await this.messagePublisher.publishNewMessage(payload, userId);
      payloads.push(payload);
    }

    this.audit.record({
      action: AuditAction.MESSAGE_FORWARD,
      userId,
      resourceType: 'message',
      resourceId: messageId,
      metadata: {
        sourceConversationId,
        targetConversationIds: uniqueTargets,
        forwardedCount: payloads.length,
      },
    });

    return { messages: payloads };
  }

  async list(conversationId: string, userId: string, cursor?: string, limit = 50) {
    await this.conversationsService.assertMember(conversationId, userId);

    const qb = this.messageRepo
      .createQueryBuilder('message')
      .leftJoinAndSelect('message.sender', 'sender')
      .leftJoinAndSelect('message.replyTo', 'replyTo')
      .leftJoinAndSelect('replyTo.sender', 'replyToSender')
      .leftJoinAndSelect('message.originalSender', 'originalSender')
      .leftJoin(
        MessageUserHidden,
        'hidden',
        'hidden.message_id = message.id AND hidden.user_id = :userId',
        { userId },
      )
      .where('message.conversation_id = :conversationId', { conversationId })
      .andWhere('hidden.id IS NULL')
      .orderBy('message.sequence', 'DESC')
      .take(limit);

    if (cursor) {
      qb.andWhere('message.sequence < :cursor', { cursor });
    }

    const messages = await qb.getMany();
    const reversed = messages.reverse();
    const statuses = await this.computeStatusesForMessages(reversed, userId);
    const reactions = await this.computeReactionsForMessages(
      reversed.map((m) => m.id),
      userId,
    );
    const mentions = await this.computeMentionsForMessages(reversed.map((m) => m.id));

    return {
      messages: reversed.map((m) =>
        this.toPayload(
          m,
          userId,
          m.senderId === userId ? statuses.get(m.id) : undefined,
          reactions.get(m.id) ?? [],
          mentions.get(m.id) ?? [],
        ),
      ),
      nextCursor: messages.length === limit ? messages[0]?.sequence : null,
    };
  }

  async markDelivered(userId: string, messageId: string): Promise<StatusUpdatePayload> {
    const message = await this.messageRepo.findOne({ where: { id: messageId } });
    if (!message) throw new NotFoundException('Message not found');

    if (message.senderId === userId) {
      return {
        messageId,
        conversationId: message.conversationId,
        senderId: message.senderId,
        status: 'sent',
      };
    }

    await this.conversationsService.assertMember(message.conversationId, userId);
    await this.ensureDelivery(messageId, userId);

    const status = await this.computeStatus(message.id, message.senderId, message.conversationId);

    return {
      messageId: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      status,
    };
  }

  async markRead(userId: string, messageId: string): Promise<StatusUpdatePayload> {
    const message = await this.messageRepo.findOne({ where: { id: messageId } });
    if (!message) throw new NotFoundException('Message not found');

    if (message.senderId !== userId) {
      await this.conversationsService.assertMember(message.conversationId, userId);
      await this.ensureDelivery(messageId, userId);
      await this.ensureReadReceipt(messageId, userId);

      await this.memberRepo.update(
        { conversationId: message.conversationId, userId },
        { lastReadAt: new Date() },
      );
    }

    const status = await this.computeStatus(message.id, message.senderId, message.conversationId);

    return {
      messageId: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      status,
    };
  }

  /** Concurrent delivery ACKs are common; ignore duplicate (message_id, user_id). */
  private async ensureDelivery(messageId: string, userId: string): Promise<void> {
    await this.deliveryRepo
      .createQueryBuilder()
      .insert()
      .into(MessageDelivery)
      .values({ messageId, userId })
      .orIgnore()
      .execute();
  }

  /** Concurrent read receipts are common; ignore duplicate (message_id, user_id). */
  private async ensureReadReceipt(messageId: string, userId: string): Promise<void> {
    await this.receiptRepo
      .createQueryBuilder()
      .insert()
      .into(MessageReadReceipt)
      .values({ messageId, userId })
      .orIgnore()
      .execute();
  }

  async edit(userId: string, messageId: string, content: string): Promise<MessagePayload> {
    const message = await this.messageRepo.findOne({
      where: { id: messageId },
      relations: [...this.messageRelations],
    });
    if (!message) throw new NotFoundException('Message not found');

    await this.conversationsService.assertMember(message.conversationId, userId);
    if (message.senderId !== userId) {
      throw new ForbiddenException('Only the sender can edit this message');
    }
    if (message.deletedAt) {
      throw new ConflictException('Cannot edit a deleted message');
    }
    if (!isTextContentType(message.contentType)) {
      throw new ConflictException('Only text messages can be edited');
    }

    const sanitized = this.sanitization.sanitizeMessage(content);
    if (!sanitized) throw new ConflictException('Message content is empty');

    message.content = sanitized;
    message.editedAt = new Date();
    const saved = await this.messageRepo.save(message);
    await this.resolveAndSaveMentions(saved.id, message.conversationId, sanitized);

    const withRelations = await this.messageRepo.findOne({
      where: { id: saved.id },
      relations: [...this.messageRelations],
    });

    const status =
      saved.senderId === userId
        ? await this.computeStatus(saved.id, saved.senderId, saved.conversationId)
        : undefined;
    const reactions = await this.getReactionsForMessage(saved.id, userId);

    this.audit.record({
      action: AuditAction.MESSAGE_EDIT,
      userId,
      resourceType: 'message',
      resourceId: saved.id,
      metadata: {
        conversationId: message.conversationId,
        preview: this.auditPreview(sanitized),
      },
    });

    return this.toPayload(withRelations!, userId, status, reactions);
  }

  async toggleReaction(
    userId: string,
    messageId: string,
    emoji: string,
  ): Promise<ReactionUpdatePayload> {
    const normalized = this.normalizeEmoji(emoji);
    const message = await this.messageRepo.findOne({ where: { id: messageId } });
    if (!message) throw new NotFoundException('Message not found');
    if (message.deletedAt) throw new ConflictException('Cannot react to a deleted message');

    await this.conversationsService.assertMember(message.conversationId, userId);

    const existing = await this.reactionRepo.findOne({
      where: { messageId, userId, emoji: normalized },
    });

    if (existing) {
      await this.reactionRepo.remove(existing);
    } else {
      await this.reactionRepo.save({ messageId, userId, emoji: normalized });
    }

    const reactions = await this.getReactionsForMessage(messageId, userId);

    this.audit.record({
      action: AuditAction.MESSAGE_REACTION,
      userId,
      resourceType: 'message',
      resourceId: messageId,
      metadata: {
        conversationId: message.conversationId,
        emoji: normalized,
        removed: !!existing,
      },
    });

    return {
      messageId,
      conversationId: message.conversationId,
      reactions,
    };
  }

  private normalizeEmoji(emoji: string): string {
    const trimmed = emoji.trim();
    if (!trimmed || trimmed.length > 32) {
      throw new ConflictException('Invalid emoji');
    }
    const emojiPattern =
      /^(?:\p{Extended_Pictographic}(?:\uFE0F)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F)?)*)$/u;
    if (!emojiPattern.test(trimmed)) {
      throw new ConflictException('Only emoji reactions are allowed');
    }
    return trimmed;
  }

  private async getReactionsForMessage(
    messageId: string,
    viewerId: string,
  ): Promise<ReactionSummary[]> {
    const map = await this.computeReactionsForMessages([messageId], viewerId);
    return map.get(messageId) ?? [];
  }

  private async computeReactionsForMessages(
    messageIds: string[],
    viewerId: string,
  ): Promise<Map<string, ReactionSummary[]>> {
    const map = new Map<string, ReactionSummary[]>();
    if (messageIds.length === 0) return map;

    const rows = await this.reactionRepo
      .createQueryBuilder('reaction')
      .select('reaction.message_id', 'messageId')
      .addSelect('reaction.emoji', 'emoji')
      .addSelect('COUNT(*)', 'count')
      .addSelect('BOOL_OR(reaction.user_id = :viewerId)', 'reactedByMe')
      .where('reaction.message_id IN (:...messageIds)', { messageIds })
      .groupBy('reaction.message_id')
      .addGroupBy('reaction.emoji')
      .orderBy('MIN(reaction.created_at)', 'ASC')
      .setParameter('viewerId', viewerId)
      .getRawMany<{ messageId: string; emoji: string; count: string; reactedByMe: boolean }>();

    for (const row of rows) {
      const list = map.get(row.messageId) ?? [];
      list.push({
        emoji: row.emoji,
        count: Number(row.count),
        reactedByMe: row.reactedByMe,
      });
      map.set(row.messageId, list);
    }

    return map;
  }

  async delete(
    userId: string,
    messageId: string,
    scope: 'me' | 'everyone',
  ): Promise<{ message?: MessagePayload; messageId: string; scope: 'me' | 'everyone' }> {
    const message = await this.messageRepo.findOne({
      where: { id: messageId },
      relations: [...this.messageRelations],
    });
    if (!message) throw new NotFoundException('Message not found');

    await this.conversationsService.assertMember(message.conversationId, userId);

    if (scope === 'me') {
      const existing = await this.hiddenRepo.findOne({
        where: { messageId, userId },
      });
      if (!existing) {
        await this.hiddenRepo.save({ messageId, userId });
      }
      this.audit.record({
        action: AuditAction.MESSAGE_DELETE,
        userId,
        resourceType: 'message',
        resourceId: messageId,
        metadata: { conversationId: message.conversationId, scope: 'me' },
      });
      return { messageId, scope: 'me' };
    }

    if (message.senderId !== userId) {
      throw new ForbiddenException('Only the sender can delete for everyone');
    }
    if (message.deletedAt) {
      throw new ConflictException('Message already deleted for everyone');
    }

    message.deletedAt = new Date();
    const saved = await this.messageRepo.save(message);
    const status = await this.computeStatus(saved.id, saved.senderId, saved.conversationId);
    const reactions = await this.getReactionsForMessage(saved.id, userId);

    this.audit.record({
      action: AuditAction.MESSAGE_DELETE,
      userId,
      resourceType: 'message',
      resourceId: messageId,
      metadata: { conversationId: message.conversationId, scope: 'everyone' },
    });

    return {
      messageId,
      scope: 'everyone',
      message: this.toPayload(saved, userId, status, reactions),
    };
  }

  private async computeStatusesForMessages(
    messages: Message[],
    viewerId: string,
  ): Promise<Map<string, MessageStatus>> {
    const ownMessages = messages.filter((m) => m.senderId === viewerId);
    const map = new Map<string, MessageStatus>();
    if (ownMessages.length === 0) return map;

    const messageIds = ownMessages.map((m) => m.id);
    const conversationIds = [...new Set(ownMessages.map((m) => m.conversationId))];

    const members = await this.memberRepo.find({
      where: { conversationId: In(conversationIds) },
    });
    const membersByConv = new Map<string, string[]>();
    for (const m of members) {
      const list = membersByConv.get(m.conversationId) ?? [];
      list.push(m.userId);
      membersByConv.set(m.conversationId, list);
    }

    const deliveries = await this.deliveryRepo.find({
      where: { messageId: In(messageIds) },
    });
    const receipts = await this.receiptRepo.find({
      where: { messageId: In(messageIds) },
    });

    for (const msg of ownMessages) {
      const recipients = (membersByConv.get(msg.conversationId) ?? []).filter(
        (id) => id !== msg.senderId,
      );
      map.set(
        msg.id,
        this.resolveStatus(
          msg.id,
          recipients,
          deliveries.filter((d) => d.messageId === msg.id),
          receipts.filter((r) => r.messageId === msg.id),
        ),
      );
    }

    return map;
  }

  private async computeStatus(
    messageId: string,
    senderId: string,
    conversationId: string,
  ): Promise<MessageStatus> {
    const members = await this.memberRepo.find({ where: { conversationId } });
    const recipients = members.map((m) => m.userId).filter((id) => id !== senderId);

    const deliveries = await this.deliveryRepo.find({ where: { messageId } });
    const receipts = await this.receiptRepo.find({ where: { messageId } });

    return this.resolveStatus(messageId, recipients, deliveries, receipts);
  }

  private resolveStatus(
    _messageId: string,
    recipients: string[],
    deliveries: MessageDelivery[],
    receipts: MessageReadReceipt[],
  ): MessageStatus {
    if (recipients.length === 0) return 'sent';

    const deliveredTo = new Set(
      deliveries.map((d) => d.userId).filter((id) => recipients.includes(id)),
    );
    const readBy = new Set(
      receipts.map((r) => r.userId).filter((id) => recipients.includes(id)),
    );

    const allRead = recipients.every((id) => readBy.has(id));
    if (allRead && readBy.size > 0) return 'read';

    const allDelivered = recipients.every((id) => deliveredTo.has(id));
    if (allDelivered && deliveredTo.size > 0) return 'delivered';

    if (deliveredTo.size > 0 || readBy.size > 0) return 'delivered';

    return 'sent';
  }

  private async resolveAndSaveMentions(
    messageId: string,
    conversationId: string,
    content: string,
  ): Promise<void> {
    const members = await this.getMentionMembers(conversationId);
    const userIds = resolveMentionUserIds(content, members);
    await this.mentionRepo.delete({ messageId });

    if (userIds.length === 0) return;

    await this.mentionRepo.save(
      userIds.map((mentionedUserId) => ({
        messageId,
        userId: mentionedUserId,
      })),
    );
  }

  private async getMentionMembers(conversationId: string) {
    const members = await this.memberRepo.find({
      where: { conversationId },
      relations: ['user'],
    });

    return members
      .filter((member) => member.user)
      .map((member) => ({
        userId: member.userId,
        username: member.user!.username,
        displayName: member.user!.displayName,
      }));
  }

  private async computeMentionsForMessages(
    messageIds: string[],
  ): Promise<Map<string, MentionSummary[]>> {
    const map = new Map<string, MentionSummary[]>();
    if (messageIds.length === 0) return map;

    const rows = await this.mentionRepo.find({
      where: { messageId: In(messageIds) },
      relations: ['user'],
      order: { createdAt: 'ASC' },
    });

    for (const row of rows) {
      const list = map.get(row.messageId) ?? [];
      list.push({
        userId: row.userId,
        username: row.user?.username ?? '',
        displayName: row.user?.displayName ?? row.user?.username ?? 'Unknown',
      });
      map.set(row.messageId, list);
    }

    return map;
  }

  private toMentionSummaries(message: Message): MentionSummary[] {
    return (message.mentions ?? [])
      .filter((mention) => mention.user)
      .map((mention) => ({
        userId: mention.userId,
        username: mention.user!.username,
        displayName: mention.user!.displayName,
      }));
  }

  private async resolveReplyTarget(
    conversationId: string,
    userId: string,
    replyToMessageId: string,
  ): Promise<string> {
    const target = await this.messageRepo.findOne({ where: { id: replyToMessageId } });
    if (!target || target.conversationId !== conversationId) {
      throw new BadRequestException('Reply target not found in this conversation');
    }

    await this.conversationsService.assertMember(conversationId, userId);

    const hidden = await this.hiddenRepo.findOne({
      where: { messageId: replyToMessageId, userId },
    });
    if (hidden) {
      throw new BadRequestException('Cannot reply to a hidden message');
    }

    return replyToMessageId;
  }

  private async copyMessageContentForForward(
    source: Message,
    targetConversationId: string,
  ): Promise<{
    content: string;
    contentType: string;
    fileName?: string;
    fileSize?: string;
    caption?: string;
  }> {
    if (isTextContentType(source.contentType)) {
      return {
        content: source.content,
        contentType: source.contentType,
        caption: source.caption,
      };
    }

    const relativePath = source.content.replace(/^\//, '').split('?')[0];
    const sourcePath = join(process.cwd(), relativePath);
    if (!existsSync(sourcePath)) {
      throw new BadRequestException('Attachment file not found');
    }

    const ext = extname(relativePath) || extname(source.fileName ?? '');
    const storedName = `${randomUUID()}${ext}`;
    const targetDir = join(
      process.cwd(),
      'uploads',
      'message-attachments',
      targetConversationId,
    );
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    copyFileSync(sourcePath, join(targetDir, storedName));

    return {
      content: `/uploads/message-attachments/${targetConversationId}/${storedName}`,
      contentType: source.contentType,
      fileName: source.fileName,
      fileSize: source.fileSize,
      caption: source.caption,
    };
  }

  private toForwardedFrom(message: Message): MessageForwardedFrom | undefined {
    if (!message.forwardedFromMessageId) return undefined;

    const author = message.originalSender ?? message.sender;
    return {
      messageId: message.forwardedFromMessageId,
      senderId: message.originalSenderId ?? message.senderId,
      sender: author
        ? {
            id: author.id,
            displayName: author.displayName,
            username: author.username,
          }
        : undefined,
    };
  }

  private toReplyPreview(message: Message): MessageReplyPreview {
    const deletedForEveryone = !!message.deletedAt;

    return {
      id: message.id,
      senderId: message.senderId,
      content: deletedForEveryone ? '' : message.content,
      contentType: message.contentType,
      fileName: message.fileName,
      caption: message.caption,
      deletedForEveryone,
      sender: message.sender
        ? {
            id: message.sender.id,
            displayName: message.sender.displayName,
            username: message.sender.username,
          }
        : undefined,
    };
  }

  toPayload(
    message: Message,
    viewerId?: string,
    status?: MessageStatus,
    reactions: ReactionSummary[] = [],
    mentions: MentionSummary[] = [],
  ): MessagePayload {
    const deletedForEveryone = !!message.deletedAt;
    const resolvedMentions =
      mentions.length > 0 ? mentions : this.toMentionSummaries(message);

    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      content: deletedForEveryone ? '' : message.content,
      contentType: message.contentType,
      fileName: message.fileName,
      fileSize: message.fileSize,
      caption: message.caption,
      clientMessageId: message.clientMessageId,
      sequence: message.sequence,
      createdAt: message.createdAt,
      editedAt: message.editedAt ?? undefined,
      deletedForEveryone,
      status: message.senderId === viewerId ? status : undefined,
      reactions,
      mentions: resolvedMentions.length > 0 ? resolvedMentions : undefined,
      replyTo: message.replyTo ? this.toReplyPreview(message.replyTo) : undefined,
      forwardedFrom: this.toForwardedFrom(message),
      sender: message.sender
        ? {
            id: message.sender.id,
            displayName: message.sender.displayName,
            username: message.sender.username,
          }
        : undefined,
    };
  }

  private auditPreview(content: string, max = 120): string {
    const trimmed = content.trim();
    if (trimmed.length <= max) return trimmed;
    return `${trimmed.slice(0, max)}…`;
  }
}
