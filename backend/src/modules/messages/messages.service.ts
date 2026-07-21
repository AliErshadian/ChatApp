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
import { MessageThreadRead } from './entities/message-thread-read.entity';
import { Poll } from './entities/poll.entity';
import { PollOption } from './entities/poll-option.entity';
import { PollVote } from './entities/poll-vote.entity';
import { Story } from '../stories/entities/story.entity';
import { ConversationMember } from '../conversations/entities/conversation-member.entity';
import { ConversationType } from '../conversations/entities/conversation.entity';
import { ConversationsService } from '../conversations/conversations.service';
import { SanitizationService } from '../../common/services/sanitization.service';
import { CreatePollDto, SendMessageDto } from './dto/message.dto';
import { isPollContentType, isTextContentType, POLL_CONTENT_TYPE, SCREEN_SHARE_CONTENT_TYPE } from './message-media.util';
import { buildMessageSearchTsQuery } from './message-search.util';
import { resolveMentionUserIds } from './mention.util';
import { MessageRealtimePublisher } from './message-realtime.publisher';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit-action';
import { StorageService } from '../../storage/storage.service';
import { randomUUID } from 'crypto';

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

export interface PollOptionPayload {
  id: string;
  text: string;
  position: number;
  voteCount: number;
  votedByMe: boolean;
}

export interface PollPayload {
  id: string;
  question: string;
  anonymous: boolean;
  allowsMultiple: boolean;
  closed: boolean;
  resultsVisible: boolean;
  totalVoters: number;
  totalVotes: number;
  options: PollOptionPayload[];
  myOptionIds: string[];
  canClose: boolean;
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
  attachmentId?: string;
  clientMessageId?: string;
  sequence: string;
  createdAt: Date;
  editedAt?: Date;
  deletedForEveryone?: boolean;
  status?: MessageStatus;
  reactions?: ReactionSummary[];
  mentions?: MentionSummary[];
  replyTo?: MessageReplyPreview;
  threadRootId?: string;
  replyCount?: number;
  latestReplyAt?: Date;
  unreadReplyCount?: number;
  /** Present on thread replies so clients can sync the root reply chip. */
  thread?: { replyCount: number; latestReplyAt?: Date };
  forwardedFrom?: MessageForwardedFrom;
  sender?: { id: string; displayName: string; username: string };
  poll?: PollPayload;
  storyId?: string;
  story?: {
    id: string;
    caption?: string;
    mediaUrl: string;
    mimeType: string;
    authorId: string;
  };
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
    @InjectRepository(MessageThreadRead)
    private readonly threadReadRepo: Repository<MessageThreadRead>,
    @InjectRepository(Poll)
    private readonly pollRepo: Repository<Poll>,
    @InjectRepository(PollOption)
    private readonly pollOptionRepo: Repository<PollOption>,
    @InjectRepository(PollVote)
    private readonly pollVoteRepo: Repository<PollVote>,
    @InjectRepository(Story)
    private readonly storyRepo: Repository<Story>,
    @InjectRepository(ConversationMember)
    private readonly memberRepo: Repository<ConversationMember>,
    private readonly conversationsService: ConversationsService,
    private readonly sanitization: SanitizationService,
    private readonly messagePublisher: MessageRealtimePublisher,
    private readonly audit: AuditService,
    private readonly storageService: StorageService,
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

    let threadRootId: string | undefined;
    if (dto.threadRootId) {
      threadRootId = await this.resolveThreadRoot(
        dto.conversationId,
        userId,
        dto.threadRootId,
      );
      if (!replyToMessageId) {
        replyToMessageId = threadRootId;
      }
    }

    const message = this.messageRepo.create({
      conversationId: dto.conversationId,
      senderId: userId,
      content,
      clientMessageId: dto.clientMessageId,
      replyToMessageId,
      threadRootId,
    });

    const saved = await this.messageRepo.save(message);
    if (threadRootId) {
      await this.bumpThreadMeta(threadRootId);
      await this.markThreadRead(threadRootId, userId);
    }
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
        threadRootId,
      },
    });

    return this.toPayloadWithThreadMeta(withSender!, userId, 'sent');
  }

  async sendStoryReply(
    userId: string,
    conversationId: string,
    storyId: string,
    rawContent: string,
  ): Promise<MessagePayload> {
    await this.conversationsService.assertCanSendMessage(conversationId, userId);

    const content = this.sanitization.sanitizeMessage(rawContent);
    if (!content) throw new ConflictException('Message content is empty');

    const message = this.messageRepo.create({
      conversationId,
      senderId: userId,
      content,
      storyId,
    });

    const saved = await this.messageRepo.save(message);
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
        conversationId,
        preview: this.auditPreview(content),
        contentType: 'text',
        storyId,
      },
    });

    const payload = await this.enrichPayloadWithStory(
      await this.toPayloadWithThreadMeta(withSender!, userId, 'sent'),
    );
    await this.messagePublisher.publishNewMessage(payload, userId);
    return payload;
  }

  async sendAttachment(
    userId: string,
    conversationId: string,
    file: Express.Multer.File,
    options: {
      clientMessageId?: string;
      replyToMessageId?: string;
      threadRootId?: string;
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
        const attachmentId = this.storageService.findAttachmentByMessageContent(existing.content);
        return this.toPayload(existing, userId, 'sent', [], [], attachmentId);
      }
    }

    let replyToMessageId: string | undefined;
    if (options.replyToMessageId) {
      replyToMessageId = await this.resolveReplyTarget(
        conversationId,
        userId,
        options.replyToMessageId,
      );
    }

    let threadRootId: string | undefined;
    if (options.threadRootId) {
      threadRootId = await this.resolveThreadRoot(conversationId, userId, options.threadRootId);
      if (!replyToMessageId) {
        replyToMessageId = threadRootId;
      }
    }

    const caption = options.caption
      ? this.sanitization.sanitizeMessage(options.caption)
      : undefined;

    const attachment = await this.storageService.upload(userId, file, {
      conversationId,
    });
    const content = this.storageService.buildMessageContent(attachment.id);

    const message = this.messageRepo.create({
      conversationId,
      senderId: userId,
      content,
      contentType: attachment.mimeType,
      fileName: attachment.originalName,
      fileSize: attachment.size,
      caption: caption || undefined,
      clientMessageId: options.clientMessageId,
      replyToMessageId,
      threadRootId,
    });

    const saved = await this.messageRepo.save(message);
    if (threadRootId) {
      await this.bumpThreadMeta(threadRootId);
      await this.markThreadRead(threadRootId, userId);
    }
    await this.storageService.linkToMessage(attachment.id, saved.id, conversationId);
    const mentionSource = [caption].filter(Boolean).join(' ');
    if (mentionSource) {
      await this.resolveAndSaveMentions(saved.id, conversationId, mentionSource);
    }
    const withSender = await this.messageRepo.findOne({
      where: { id: saved.id },
      relations: [...this.messageRelations],
    });

    const payload = await this.toPayloadWithThreadMeta(
      withSender!,
      userId,
      'sent',
      [],
      [],
      attachment.id,
    );
    await this.messagePublisher.publishNewMessage(payload, userId);

    this.audit.record({
      action: AuditAction.MESSAGE_SEND_ATTACHMENT,
      userId,
      resourceType: 'message',
      resourceId: saved.id,
      metadata: {
        conversationId,
        contentType: attachment.mimeType,
        fileName: attachment.originalName,
        attachmentId: attachment.id,
      },
    });

    return payload;
  }

  async createPoll(
    userId: string,
    conversationId: string,
    dto: CreatePollDto,
  ): Promise<MessagePayload> {
    await this.conversationsService.assertCanSendMessage(conversationId, userId);
    const conversationType = await this.conversationsService.getConversationType(conversationId);
    if (conversationType !== ConversationType.GROUP) {
      throw new ForbiddenException('Polls are only available in groups');
    }

    const question = this.sanitization.sanitizeMessage(dto.question)?.trim();
    if (!question) throw new BadRequestException('Question is required');

    const optionTexts = dto.options
      .map((option) => this.sanitization.sanitizeMessage(option)?.trim() ?? '')
      .filter(Boolean);
    if (optionTexts.length < 2) {
      throw new BadRequestException('Polls need at least 2 options');
    }
    if (optionTexts.length > 10) {
      throw new BadRequestException('Polls can have at most 10 options');
    }

    if (dto.clientMessageId) {
      const existing = await this.messageRepo.findOne({
        where: {
          conversationId,
          senderId: userId,
          clientMessageId: dto.clientMessageId,
        },
        relations: [...this.messageRelations],
      });
      if (existing) {
        return this.enrichPayloadWithPoll(
          this.toPayload(existing, userId, 'sent'),
          userId,
        );
      }
    }

    const message = this.messageRepo.create({
      conversationId,
      senderId: userId,
      content: question,
      contentType: POLL_CONTENT_TYPE,
      clientMessageId: dto.clientMessageId,
    });
    const saved = await this.messageRepo.save(message);

    const poll = await this.pollRepo.save(
      this.pollRepo.create({
        messageId: saved.id,
        question,
        anonymous: Boolean(dto.anonymous),
        allowsMultiple: Boolean(dto.allowsMultiple),
      }),
    );

    await this.pollOptionRepo.save(
      optionTexts.map((text, position) =>
        this.pollOptionRepo.create({
          pollId: poll.id,
          text,
          position,
        }),
      ),
    );

    const withSender = await this.messageRepo.findOne({
      where: { id: saved.id },
      relations: [...this.messageRelations],
    });
    const payload = await this.enrichPayloadWithPoll(
      this.toPayload(withSender!, userId, 'sent'),
      userId,
    );
    await this.messagePublisher.publishNewMessage(payload, userId);

    this.audit.record({
      action: AuditAction.MESSAGE_SEND,
      userId,
      resourceType: 'message',
      resourceId: saved.id,
      metadata: {
        conversationId,
        contentType: POLL_CONTENT_TYPE,
        preview: this.auditPreview(question),
        pollId: poll.id,
      },
    });

    return payload;
  }

  async createScreenShareAnnouncement(input: {
    userId: string;
    conversationId: string;
    sessionId: string;
    presenterName: string;
  }): Promise<MessagePayload> {
    await this.conversationsService.assertMember(input.conversationId, input.userId);

    const body = JSON.stringify({
      sessionId: input.sessionId,
      status: 'active',
      presenterId: input.userId,
      presenterName: input.presenterName,
    });

    const message = this.messageRepo.create({
      conversationId: input.conversationId,
      senderId: input.userId,
      content: body,
      contentType: SCREEN_SHARE_CONTENT_TYPE,
    });
    const saved = await this.messageRepo.save(message);
    const withSender = await this.messageRepo.findOne({
      where: { id: saved.id },
      relations: [...this.messageRelations],
    });
    const payload = this.toPayload(withSender!, input.userId, 'sent');
    await this.messagePublisher.publishNewMessage(payload, input.userId);

    this.audit.record({
      action: AuditAction.MESSAGE_SEND,
      userId: input.userId,
      resourceType: 'message',
      resourceId: saved.id,
      metadata: {
        conversationId: input.conversationId,
        contentType: SCREEN_SHARE_CONTENT_TYPE,
        sessionId: input.sessionId,
        preview: 'Screen share started',
      },
    });

    return payload;
  }

  async endScreenShareAnnouncement(sessionId: string, actorUserId?: string | null) {
    const message = await this.messageRepo
      .createQueryBuilder('m')
      .where('m.content_type = :ct', { ct: SCREEN_SHARE_CONTENT_TYPE })
      .andWhere(`m.content LIKE :needle`, {
        needle: `%"sessionId":"${sessionId}"%`,
      })
      .orderBy('m.created_at', 'DESC')
      .getOne();

    if (!message || message.deletedAt) return null;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(message.content) as Record<string, unknown>;
    } catch {
      parsed = { sessionId };
    }
    if (parsed.status === 'ended') return null;

    message.content = JSON.stringify({
      ...parsed,
      sessionId,
      status: 'ended',
      endedAt: new Date().toISOString(),
      endedBy: actorUserId ?? null,
    });
    await this.messageRepo.save(message);

    const memberIds = await this.conversationsService.getMemberUserIds(message.conversationId);
    await Promise.all(
      memberIds.map(async (memberId) => {
        const payload = await this.getEnrichedMessagePayload(message.id, memberId);
        await this.messagePublisher.publishMessageUpdateToUser(memberId, payload);
      }),
    );

    return message.id;
  }

  async votePoll(
    userId: string,
    conversationId: string,
    pollId: string,
    optionId: string,
  ): Promise<MessagePayload> {
    await this.conversationsService.assertMember(conversationId, userId);

    const poll = await this.pollRepo.findOne({
      where: { id: pollId },
      relations: ['message', 'options'],
    });
    if (!poll || poll.message.conversationId !== conversationId) {
      throw new NotFoundException('Poll not found');
    }
    if (poll.message.deletedAt) {
      throw new ConflictException('Cannot vote on a deleted poll');
    }
    if (poll.closedAt) {
      throw new ConflictException('This poll is closed');
    }

    const option = poll.options?.find((o) => o.id === optionId);
    if (!option) {
      throw new BadRequestException('Invalid poll option');
    }

    const existingOnOption = await this.pollVoteRepo.findOne({
      where: { pollId, userId, optionId },
    });

    if (poll.allowsMultiple) {
      if (existingOnOption) {
        await this.pollVoteRepo.remove(existingOnOption);
      } else {
        await this.pollVoteRepo.save(
          this.pollVoteRepo.create({ pollId, optionId, userId }),
        );
      }
    } else if (existingOnOption) {
      await this.pollVoteRepo.remove(existingOnOption);
    } else {
      await this.pollVoteRepo.delete({ pollId, userId });
      await this.pollVoteRepo.save(
        this.pollVoteRepo.create({ pollId, optionId, userId }),
      );
    }

    await this.broadcastPollMessageUpdate(conversationId, poll.messageId);
    return this.getEnrichedMessagePayload(poll.messageId, userId);
  }

  async closePoll(
    userId: string,
    conversationId: string,
    pollId: string,
  ): Promise<MessagePayload> {
    await this.conversationsService.assertMember(conversationId, userId);

    const poll = await this.pollRepo.findOne({
      where: { id: pollId },
      relations: ['message'],
    });
    if (!poll || poll.message.conversationId !== conversationId) {
      throw new NotFoundException('Poll not found');
    }

    if (poll.message.senderId !== userId) {
      throw new ForbiddenException('Only the poll sender can close this poll');
    }
    if (poll.closedAt) {
      return this.getEnrichedMessagePayload(poll.messageId, userId);
    }

    poll.closedAt = new Date();
    poll.closedBy = userId;
    await this.pollRepo.save(poll);

    await this.broadcastPollMessageUpdate(conversationId, poll.messageId);
    return this.getEnrichedMessagePayload(poll.messageId, userId);
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

      const copied = await this.copyMessageContentForForward(
        source,
        userId,
        targetConversationId,
      );

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

      if (copied.attachmentId) {
        await this.storageService.linkToMessage(
          copied.attachmentId,
          saved.id,
          targetConversationId,
        );
      }

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
      .andWhere('message.thread_root_id IS NULL')
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
    const unreadByRoot = await this.computeUnreadReplyCounts(
      reversed.map((m) => m.id),
      userId,
    );

    return {
      messages: await Promise.all(
        reversed.map(async (m) =>
          this.enrichPayloadWithStory(
            await this.enrichPayloadWithPoll(
              this.toPayload(
                m,
                userId,
                m.senderId === userId ? statuses.get(m.id) : undefined,
                reactions.get(m.id) ?? [],
                mentions.get(m.id) ?? [],
                undefined,
                unreadByRoot.get(m.id) ?? 0,
              ),
              userId,
            ),
          ),
        ),
      ),
      nextCursor: messages.length === limit ? messages[0]?.sequence : null,
    };
  }

  async getThread(conversationId: string, rootMessageId: string, userId: string) {
    await this.conversationsService.assertMember(conversationId, userId);

    const root = await this.messageRepo
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
      .where('message.id = :rootMessageId', { rootMessageId })
      .andWhere('message.conversation_id = :conversationId', { conversationId })
      .andWhere('message.thread_root_id IS NULL')
      .andWhere('hidden.id IS NULL')
      .getOne();

    if (!root) throw new NotFoundException('Thread not found');

    const replies = await this.messageRepo
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
      .where('message.thread_root_id = :rootMessageId', { rootMessageId })
      .andWhere('message.conversation_id = :conversationId', { conversationId })
      .andWhere('hidden.id IS NULL')
      .orderBy('message.sequence', 'ASC')
      .getMany();

    const firstUnreadMessageId = await this.findFirstUnreadThreadReplyId(
      rootMessageId,
      userId,
      replies,
    );

    await this.markThreadRead(rootMessageId, userId);

    const all = [root, ...replies];
    const statuses = await this.computeStatusesForMessages(all, userId);
    const reactionMap = await this.computeReactionsForMessages(
      all.map((m) => m.id),
      userId,
    );
    const mentionMap = await this.computeMentionsForMessages(all.map((m) => m.id));

    const toThreadPayload = async (m: Message) =>
      this.enrichPayloadWithPoll(
        this.toPayload(
          m,
          userId,
          m.senderId === userId ? statuses.get(m.id) : undefined,
          reactionMap.get(m.id) ?? [],
          mentionMap.get(m.id) ?? [],
          undefined,
          m.id === rootMessageId ? 0 : undefined,
        ),
        userId,
      );

    return {
      root: await toThreadPayload(root),
      replies: await Promise.all(replies.map(toThreadPayload)),
      firstUnreadMessageId,
    };
  }

  async searchThread(
    conversationId: string,
    rootMessageId: string,
    userId: string,
    query: string,
    limit = 40,
  ) {
    await this.conversationsService.assertMember(conversationId, userId);

    const root = await this.messageRepo.findOne({
      where: { id: rootMessageId, conversationId },
    });
    if (!root || root.threadRootId) {
      throw new NotFoundException('Thread not found');
    }

    const q = query.trim();
    if (q.length < 2) {
      return { items: [], total: 0 };
    }

    const tsQuery = buildMessageSearchTsQuery(q);
    if (!tsQuery) {
      return { items: [], total: 0 };
    }

    const capped = Math.min(Math.max(limit, 1), 100);

    const qb = this.messageRepo
      .createQueryBuilder('message')
      .leftJoinAndSelect('message.sender', 'sender')
      .leftJoin(
        MessageUserHidden,
        'hidden',
        'hidden.message_id = message.id AND hidden.user_id = :userId',
        { userId },
      )
      .where('message.conversation_id = :conversationId', { conversationId })
      .andWhere(
        '(message.id = :rootMessageId OR message.thread_root_id = :rootMessageId)',
        { rootMessageId },
      )
      .andWhere('message.deleted_at IS NULL')
      .andWhere('hidden.id IS NULL')
      .andWhere(`message.search_vector @@ to_tsquery('simple', :tsQuery)`, { tsQuery })
      .orderBy(
        `ts_rank(message.search_vector, to_tsquery('simple', :tsQuery))`,
        'DESC',
      )
      .addOrderBy('message.created_at', 'DESC')
      .take(capped)
      .setParameter('tsQuery', tsQuery);

    const messages = await qb.getMany();

    return {
      items: messages.map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        senderId: m.senderId,
        content: m.content,
        contentType: m.contentType,
        fileName: m.fileName,
        caption: m.caption,
        createdAt: m.createdAt,
        threadRootId: m.threadRootId ?? undefined,
        isRoot: m.id === rootMessageId,
        sender: m.sender
          ? {
              id: m.sender.id,
              displayName: m.sender.displayName,
              username: m.sender.username,
            }
          : undefined,
        snippet: this.auditPreview(
          isTextContentType(m.contentType) ? m.content : m.fileName || m.caption || 'File',
          160,
        ),
      })),
      total: messages.length,
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

    if (saved.threadRootId) {
      await this.refreshThreadMeta(saved.threadRootId);
    }

    const status = await this.computeStatus(saved.id, saved.senderId, saved.conversationId);
    const reactions = await this.getReactionsForMessage(saved.id, userId);

    this.audit.record({
      action: AuditAction.MESSAGE_DELETE,
      userId,
      resourceType: 'message',
      resourceId: messageId,
      metadata: { conversationId: message.conversationId, scope: 'everyone' },
    });

    const withRelations = await this.messageRepo.findOne({
      where: { id: saved.id },
      relations: [...this.messageRelations],
    });

    let payload = this.toPayload(withRelations ?? saved, userId, status, reactions);
    if (saved.threadRootId) {
      const root = await this.messageRepo.findOne({
        where: { id: saved.threadRootId },
        select: ['id', 'replyCount', 'latestReplyAt'],
      });
      if (root) {
        payload = {
          ...payload,
          thread: {
            replyCount: root.replyCount ?? 0,
            latestReplyAt: root.latestReplyAt ?? undefined,
          },
        };
      }
    }

    return {
      messageId,
      scope: 'everyone',
      message: payload,
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

  /** Resolve Slack thread root; nested replies always hang under the absolute root. */
  private async resolveThreadRoot(
    conversationId: string,
    userId: string,
    threadRootId: string,
  ): Promise<string> {
    const target = await this.messageRepo.findOne({ where: { id: threadRootId } });
    if (!target || target.conversationId !== conversationId) {
      throw new BadRequestException('Thread root not found in this conversation');
    }

    await this.conversationsService.assertMember(conversationId, userId);

    const hidden = await this.hiddenRepo.findOne({
      where: { messageId: threadRootId, userId },
    });
    if (hidden) {
      throw new BadRequestException('Cannot reply in a hidden thread');
    }

    return target.threadRootId ?? target.id;
  }

  private async bumpThreadMeta(threadRootId: string): Promise<void> {
    await this.messageRepo
      .createQueryBuilder()
      .update(Message)
      .set({
        replyCount: () => 'reply_count + 1',
        latestReplyAt: () => 'NOW()',
      })
      .where('id = :threadRootId', { threadRootId })
      .execute();
  }

  private async refreshThreadMeta(threadRootId: string): Promise<void> {
    const row = await this.messageRepo
      .createQueryBuilder('message')
      .select('COUNT(*)', 'count')
      .addSelect('MAX(message.created_at)', 'latest')
      .where('message.thread_root_id = :threadRootId', { threadRootId })
      .andWhere('message.deleted_at IS NULL')
      .getRawOne<{ count: string; latest: Date | string | null }>();

    const count = Number(row?.count ?? 0);
    await this.messageRepo
      .createQueryBuilder()
      .update(Message)
      .set({
        replyCount: count,
        latestReplyAt: count > 0 && row?.latest ? new Date(row.latest) : () => 'NULL',
      })
      .where('id = :threadRootId', { threadRootId })
      .execute();
  }

  async markThreadRead(threadRootId: string, userId: string): Promise<void> {
    await this.threadReadRepo.upsert(
      {
        threadRootId,
        userId,
        lastReadAt: new Date(),
      },
      ['threadRootId', 'userId'],
    );
  }

  private async findFirstUnreadThreadReplyId(
    threadRootId: string,
    userId: string,
    replies: Message[],
  ): Promise<string | null> {
    if (replies.length === 0) return null;

    const tread = await this.threadReadRepo.findOne({
      where: { threadRootId, userId },
    });
    const lastReadAt = tread?.lastReadAt ? new Date(tread.lastReadAt).getTime() : null;

    const sorted = [...replies].sort((a, b) => {
      const seq = Number(a.sequence) - Number(b.sequence);
      if (seq !== 0) return seq;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    for (const reply of sorted) {
      if (reply.senderId === userId) continue;
      if (reply.deletedAt) continue;
      if (lastReadAt === null || new Date(reply.createdAt).getTime() > lastReadAt) {
        return reply.id;
      }
    }

    return null;
  }

  async listUnreadThreads(conversationId: string, userId: string) {
    await this.conversationsService.assertMember(conversationId, userId);

    const rows = await this.messageRepo
      .createQueryBuilder('message')
      .select('message.thread_root_id', 'threadRootId')
      .addSelect('COUNT(*)', 'unreadCount')
      .addSelect('MAX(message.created_at)', 'latestReplyAt')
      .leftJoin(
        MessageThreadRead,
        'tread',
        'tread.thread_root_id = message.thread_root_id AND tread.user_id = :userId',
        { userId },
      )
      .leftJoin(
        MessageUserHidden,
        'hidden',
        'hidden.message_id = message.id AND hidden.user_id = :userId',
        { userId },
      )
      .where('message.conversation_id = :conversationId', { conversationId })
      .andWhere('message.thread_root_id IS NOT NULL')
      .andWhere('message.deleted_at IS NULL')
      .andWhere('message.sender_id != :userId', { userId })
      .andWhere('hidden.id IS NULL')
      .andWhere('(tread.last_read_at IS NULL OR message.created_at > tread.last_read_at)')
      .groupBy('message.thread_root_id')
      .orderBy('MAX(message.created_at)', 'DESC')
      .getRawMany<{ threadRootId: string; unreadCount: string; latestReplyAt: Date | string }>();

    return {
      items: rows.map((row) => ({
        threadRootId: row.threadRootId,
        unreadCount: Number(row.unreadCount) || 0,
        latestReplyAt:
          row.latestReplyAt instanceof Date
            ? row.latestReplyAt.toISOString()
            : String(row.latestReplyAt),
      })),
      total: rows.length,
    };
  }

  private async computeUnreadReplyCounts(
    rootMessageIds: string[],
    userId: string,
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (rootMessageIds.length === 0) return map;

    const rows = await this.messageRepo
      .createQueryBuilder('message')
      .select('message.thread_root_id', 'threadRootId')
      .addSelect('COUNT(*)', 'count')
      .leftJoin(
        MessageThreadRead,
        'tread',
        'tread.thread_root_id = message.thread_root_id AND tread.user_id = :userId',
        { userId },
      )
      .leftJoin(
        MessageUserHidden,
        'hidden',
        'hidden.message_id = message.id AND hidden.user_id = :userId',
        { userId },
      )
      .where('message.thread_root_id IN (:...rootMessageIds)', { rootMessageIds })
      .andWhere('message.deleted_at IS NULL')
      .andWhere('message.sender_id != :userId', { userId })
      .andWhere('hidden.id IS NULL')
      .andWhere('(tread.last_read_at IS NULL OR message.created_at > tread.last_read_at)')
      .groupBy('message.thread_root_id')
      .getRawMany<{ threadRootId: string; count: string }>();

    for (const row of rows) {
      map.set(row.threadRootId, Number(row.count) || 0);
    }

    return map;
  }

  private async copyMessageContentForForward(
    source: Message,
    userId: string,
    targetConversationId: string,
  ): Promise<{
    content: string;
    contentType: string;
    fileName?: string;
    fileSize?: string;
    caption?: string;
    attachmentId?: string;
  }> {
    if (isTextContentType(source.contentType)) {
      return {
        content: source.content,
        contentType: source.contentType,
        caption: source.caption,
      };
    }

    const attachmentId = this.storageService.findAttachmentByMessageContent(source.content);
    if (attachmentId) {
      const copied = await this.storageService.copyAttachmentForConversation(
        attachmentId,
        userId,
        targetConversationId,
      );
      return {
        content: this.storageService.buildMessageContent(copied.id),
        contentType: copied.mimeType,
        fileName: copied.originalName,
        fileSize: copied.size,
        caption: source.caption,
        attachmentId: copied.id,
      };
    }

    const { join, extname } = await import('path');
    const { existsSync, mkdirSync, copyFileSync } = await import('fs');

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
    attachmentId?: string,
    unreadReplyCount?: number,
  ): MessagePayload {
    const deletedForEveryone = !!message.deletedAt;
    const resolvedMentions =
      mentions.length > 0 ? mentions : this.toMentionSummaries(message);
    const resolvedAttachmentId = isPollContentType(message.contentType)
      ? undefined
      : attachmentId ?? this.storageService.findAttachmentByMessageContent(message.content);

    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      content: deletedForEveryone ? '' : message.content,
      contentType: message.contentType,
      fileName: message.fileName,
      fileSize: message.fileSize,
      caption: message.caption,
      attachmentId: resolvedAttachmentId,
      clientMessageId: message.clientMessageId,
      sequence: message.sequence,
      createdAt: message.createdAt,
      editedAt: message.editedAt ?? undefined,
      deletedForEveryone,
      status: message.senderId === viewerId ? status : undefined,
      reactions,
      mentions: resolvedMentions.length > 0 ? resolvedMentions : undefined,
      replyTo: message.replyTo ? this.toReplyPreview(message.replyTo) : undefined,
      threadRootId: message.threadRootId ?? undefined,
      replyCount: message.threadRootId ? undefined : message.replyCount ?? 0,
      latestReplyAt: message.threadRootId ? undefined : message.latestReplyAt ?? undefined,
      unreadReplyCount: message.threadRootId
        ? undefined
        : unreadReplyCount !== undefined
          ? unreadReplyCount
          : undefined,
      forwardedFrom: this.toForwardedFrom(message),
      sender: message.sender
        ? {
            id: message.sender.id,
            displayName: message.sender.displayName,
            username: message.sender.username,
          }
        : undefined,
      storyId: message.storyId ?? undefined,
    };
  }

  private async getEnrichedMessagePayload(
    messageId: string,
    viewerId: string,
  ): Promise<MessagePayload> {
    const message = await this.messageRepo.findOne({
      where: { id: messageId },
      relations: [...this.messageRelations],
    });
    if (!message) throw new NotFoundException('Message not found');
    const status =
      message.senderId === viewerId
        ? await this.computeStatus(message.id, message.senderId, message.conversationId)
        : undefined;
    const reactions = await this.getReactionsForMessage(message.id, viewerId);
    return this.enrichPayloadWithStory(
      await this.enrichPayloadWithPoll(
        this.toPayload(message, viewerId, status, reactions),
        viewerId,
      ),
    );
  }

  private async broadcastPollMessageUpdate(conversationId: string, messageId: string) {
    const memberIds = await this.conversationsService.getMemberUserIds(conversationId);
    await Promise.all(
      memberIds.map(async (memberId) => {
        const payload = await this.getEnrichedMessagePayload(messageId, memberId);
        await this.messagePublisher.publishMessageUpdateToUser(memberId, payload);
      }),
    );
  }

  private async enrichPayloadWithPoll(
    payload: MessagePayload,
    viewerId: string,
  ): Promise<MessagePayload> {
    if (payload.deletedForEveryone || !isPollContentType(payload.contentType)) {
      return payload;
    }

    const poll = await this.buildPollPayload(payload.id, payload.senderId, viewerId);
    if (!poll) return payload;
    return { ...payload, poll };
  }

  private async enrichPayloadWithStory(payload: MessagePayload): Promise<MessagePayload> {
    if (!payload.storyId || payload.deletedForEveryone) return payload;

    const story = await this.storyRepo.findOne({
      where: { id: payload.storyId },
      relations: ['attachment'],
    });
    if (!story) return payload;

    return {
      ...payload,
      story: {
        id: story.id,
        caption: story.caption ?? undefined,
        mediaUrl: story.attachment?.url ?? `/api/v1/attachments/${story.attachmentId}/content`,
        mimeType: story.attachment?.mimeType ?? 'application/octet-stream',
        authorId: story.authorId,
      },
    };
  }

  private async buildPollPayload(
    messageId: string,
    messageSenderId: string,
    viewerId: string,
  ): Promise<PollPayload | null> {
    const poll = await this.pollRepo.findOne({
      where: { messageId },
      relations: ['options', 'message'],
    });
    if (!poll) return null;

    const options = [...(poll.options ?? [])].sort((a, b) => a.position - b.position);
    const votes = await this.pollVoteRepo.find({ where: { pollId: poll.id } });
    const myOptionIds = votes.filter((v) => v.userId === viewerId).map((v) => v.optionId);
    const closed = Boolean(poll.closedAt);
    const resultsVisible = closed || myOptionIds.length > 0;
    const totalVoters = new Set(votes.map((v) => v.userId)).size;

    const canClose = !closed && messageSenderId === viewerId;

    return {
      id: poll.id,
      question: poll.question,
      anonymous: poll.anonymous,
      allowsMultiple: poll.allowsMultiple,
      closed,
      resultsVisible,
      totalVoters,
      totalVotes: votes.length,
      myOptionIds,
      canClose,
      options: options.map((option) => {
        const voteCount = votes.filter((v) => v.optionId === option.id).length;
        return {
          id: option.id,
          text: option.text,
          position: option.position,
          voteCount: resultsVisible ? voteCount : 0,
          votedByMe: myOptionIds.includes(option.id),
        };
      }),
    };
  }

  private async toPayloadWithThreadMeta(
    message: Message,
    viewerId?: string,
    status?: MessageStatus,
    reactions: ReactionSummary[] = [],
    mentions: MentionSummary[] = [],
    attachmentId?: string,
  ): Promise<MessagePayload> {
    const payload = this.toPayload(
      message,
      viewerId,
      status,
      reactions,
      mentions,
      attachmentId,
    );
    if (!message.threadRootId) return payload;

    const root = await this.messageRepo.findOne({
      where: { id: message.threadRootId },
      select: ['id', 'replyCount', 'latestReplyAt'],
    });
    if (!root) return payload;

    return {
      ...payload,
      thread: {
        replyCount: root.replyCount ?? 0,
        latestReplyAt: root.latestReplyAt ?? undefined,
      },
    };
  }

  private auditPreview(content: string, max = 120): string {
    const trimmed = content.trim();
    if (trimmed.length <= max) return trimmed;
    return `${trimmed.slice(0, max)}…`;
  }

  async searchMessages(userId: string, query: string, limit = 40) {
    const q = query.trim();
    if (q.length < 2) {
      return { items: [], total: 0 };
    }

    const tsQuery = buildMessageSearchTsQuery(q);
    if (!tsQuery) {
      return { items: [], total: 0 };
    }

    const cappedLimit = Math.min(50, Math.max(1, limit));

    const matched = await this.messageRepo
      .createQueryBuilder('message')
      .leftJoin(
        MessageUserHidden,
        'hidden',
        'hidden.message_id = message.id AND hidden.user_id = :userId',
        { userId },
      )
      .where('message.deletedAt IS NULL')
      .andWhere('hidden.id IS NULL')
      .andWhere(
        `EXISTS (
          SELECT 1 FROM conversation_members cm
          WHERE cm.conversation_id = message.conversation_id
            AND cm.user_id = :userId
        )`,
        { userId },
      )
      .andWhere(
        `NOT EXISTS (
          SELECT 1 FROM conversation_user_hidden cuh
          WHERE cuh.conversation_id = message.conversation_id
            AND cuh.user_id = :userId
        )`,
        { userId },
      )
      .andWhere(`message.search_vector @@ to_tsquery('simple', :tsQuery)`, { tsQuery })
      .orderBy('message.createdAt', 'DESC')
      .take(cappedLimit)
      .getMany();

    if (matched.length === 0) {
      return { items: [], total: 0 };
    }

    const ids = matched.map((row) => row.id);
    const rows = await this.messageRepo.find({
      where: { id: In(ids) },
      relations: ['conversation', 'sender'],
    });
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    const orderedRows = ids
      .map((id) => rowsById.get(id))
      .filter((row): row is Message => row != null);

    const conversationIds = [...new Set(orderedRows.map((row) => row.conversationId))];
    const memberships =
      conversationIds.length > 0
        ? await this.memberRepo.find({
            where: { conversationId: In(conversationIds) },
            relations: ['user'],
          })
        : [];

    const membersByConversation = new Map<string, typeof memberships>();
    for (const membership of memberships) {
      const list = membersByConversation.get(membership.conversationId) ?? [];
      list.push(membership);
      membersByConversation.set(membership.conversationId, list);
    }

    const items = orderedRows.map((message) => {
      const conversation = message.conversation;
      const members = membersByConversation.get(message.conversationId) ?? [];
      let conversationName = conversation?.name ?? 'Conversation';

      if (conversation?.type === ConversationType.DIRECT) {
        const peer = members.find((member) => member.userId !== userId)?.user;
        conversationName = peer?.displayName ?? peer?.username ?? conversationName;
      }

      const previewSource = isTextContentType(message.contentType)
        ? message.content
        : message.caption || message.fileName || message.content;

      return {
        id: message.id,
        conversationId: message.conversationId,
        conversationType: conversation?.type ?? 'direct',
        conversationName,
        senderId: message.senderId,
        senderDisplayName: message.sender?.displayName ?? 'Unknown',
        senderUsername: message.sender?.username ?? '',
        content: message.content,
        contentType: message.contentType,
        fileName: message.fileName,
        caption: message.caption,
        createdAt: message.createdAt.toISOString(),
        snippet: this.buildSearchSnippet(previewSource, q),
      };
    });

    return { items, total: items.length };
  }

  private buildSearchSnippet(text: string, query: string, radius = 48): string {
    const source = text.replace(/\s+/g, ' ').trim();
    if (!source) return '';

    const lowerSource = source.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const index = lowerSource.indexOf(lowerQuery);

    if (index < 0) {
      return source.length > radius * 2 ? `${source.slice(0, radius * 2)}…` : source;
    }

    const start = Math.max(0, index - radius);
    const end = Math.min(source.length, index + lowerQuery.length + radius);
    const prefix = start > 0 ? '…' : '';
    const suffix = end < source.length ? '…' : '';
    return `${prefix}${source.slice(start, end)}${suffix}`;
  }
}
