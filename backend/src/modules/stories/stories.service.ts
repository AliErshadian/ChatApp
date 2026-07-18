import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, Repository } from 'typeorm';
import { Story } from './entities/story.entity';
import { StoryView } from './entities/story-view.entity';
import { StoryLike } from './entities/story-like.entity';
import { UserContact } from '../contacts/entities/user-contact.entity';
import { ContactsService } from '../contacts/contacts.service';
import { UsersService } from '../users/users.service';
import { StorageService } from '../../storage/storage.service';
import { ConversationsService } from '../conversations/conversations.service';
import { MessagesService } from '../messages/messages.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit-action';
import { SanitizationService } from '../../common/services/sanitization.service';
import { StoryRealtimePublisher } from './story-realtime.publisher';

const STORY_TTL_MS = 24 * 60 * 60 * 1000;

export interface StoryItemPayload {
  id: string;
  authorId: string;
  caption?: string;
  mediaUrl: string;
  mimeType: string;
  createdAt: string;
  expiresAt: string;
  viewedByMe: boolean;
  likedByMe: boolean;
  viewCount?: number;
  likeCount?: number;
}

export interface StoryFeedRing {
  userId: string;
  displayName: string;
  username: string;
  avatarUrl?: string;
  hasUnseen: boolean;
  storyCount: number;
  latestCreatedAt: string;
}

@Injectable()
export class StoriesService {
  constructor(
    @InjectRepository(Story)
    private readonly storyRepo: Repository<Story>,
    @InjectRepository(StoryView)
    private readonly viewRepo: Repository<StoryView>,
    @InjectRepository(StoryLike)
    private readonly likeRepo: Repository<StoryLike>,
    private readonly contacts: ContactsService,
    private readonly users: UsersService,
    private readonly storage: StorageService,
    private readonly conversations: ConversationsService,
    private readonly messages: MessagesService,
    private readonly audit: AuditService,
    private readonly sanitization: SanitizationService,
    private readonly realtime: StoryRealtimePublisher,
  ) {}

  async create(userId: string, file: Express.Multer.File, caption?: string) {
    if (!file) throw new BadRequestException('Story media file is required');

    const attachment = await this.storage.upload(userId, file, {
      allowedCategories: ['image', 'video'],
    });

    const now = new Date();
    const story = await this.storyRepo.save(
      this.storyRepo.create({
        authorId: userId,
        attachmentId: attachment.id,
        caption: caption?.trim() ? this.sanitization.sanitizeMessage(caption.trim()) : undefined,
        expiresAt: new Date(now.getTime() + STORY_TTL_MS),
      }),
    );

    this.audit.record({
      action: AuditAction.STORY_CREATE,
      userId,
      resourceType: 'story',
      resourceId: story.id,
      metadata: { attachmentId: attachment.id, mimeType: attachment.mimeType },
    });

    const payload = await this.toItemPayload(story, userId, attachment.mimeType, attachment.url);
    const audience = await this.audienceUserIds(userId);
    await this.realtime.publishCreated(audience, {
      story: payload,
      author: this.users.toPublic(await this.requireUser(userId)),
    });

    return payload;
  }

  async feed(viewerId: string): Promise<StoryFeedRing[]> {
    const now = new Date();
    const active = await this.storyRepo
      .createQueryBuilder('story')
      .leftJoin(
        UserContact,
        'uc',
        'uc.userId = story.authorId AND uc.contactUserId = :viewerId',
        { viewerId },
      )
      .where('story.expiresAt > :now', { now })
      .andWhere('(story.authorId = :viewerId OR uc.contactUserId IS NOT NULL)', { viewerId })
      .orderBy('story.createdAt', 'DESC')
      .getMany();

    if (active.length === 0) {
      const me = await this.requireUser(viewerId);
      return [
        {
          userId: me.id,
          displayName: me.displayName,
          username: me.username,
          avatarUrl: me.avatarUrl,
          hasUnseen: false,
          storyCount: 0,
          latestCreatedAt: me.createdAt?.toISOString?.() ?? new Date().toISOString(),
        },
      ];
    }

    const storyIds = active.map((s) => s.id);
    const myViews = await this.viewRepo.find({
      where: { viewerId, storyId: In(storyIds) },
      select: ['storyId'],
    });
    const viewed = new Set(myViews.map((v) => v.storyId));

    const byAuthor = new Map<string, Story[]>();
    for (const story of active) {
      const list = byAuthor.get(story.authorId) ?? [];
      list.push(story);
      byAuthor.set(story.authorId, list);
    }

    const authorIds = [...byAuthor.keys()];
    const authors = await Promise.all(authorIds.map((id) => this.users.findById(id)));
    const authorMap = new Map(
      authors.filter(Boolean).map((u) => [u!.id, u!] as const),
    );

    const rings: StoryFeedRing[] = [];
    for (const authorId of authorIds) {
      const stories = byAuthor.get(authorId)!;
      const author = authorMap.get(authorId);
      if (!author) continue;
      const hasUnseen =
        authorId !== viewerId && stories.some((s) => !viewed.has(s.id));
      rings.push({
        userId: author.id,
        displayName: author.displayName,
        username: author.username,
        avatarUrl: author.avatarUrl,
        hasUnseen,
        storyCount: stories.length,
        latestCreatedAt: stories[0].createdAt.toISOString(),
      });
    }

    rings.sort((a, b) => {
      if (a.userId === viewerId) return -1;
      if (b.userId === viewerId) return 1;
      if (a.hasUnseen !== b.hasUnseen) return a.hasUnseen ? -1 : 1;
      return b.latestCreatedAt.localeCompare(a.latestCreatedAt);
    });

    if (!rings.some((r) => r.userId === viewerId)) {
      const me = await this.requireUser(viewerId);
      rings.unshift({
        userId: me.id,
        displayName: me.displayName,
        username: me.username,
        avatarUrl: me.avatarUrl,
        hasUnseen: false,
        storyCount: 0,
        latestCreatedAt: new Date().toISOString(),
      });
    }

    return rings;
  }

  async listForUser(viewerId: string, authorId: string): Promise<StoryItemPayload[]> {
    await this.assertCanViewAuthor(viewerId, authorId);

    const stories = await this.storyRepo.find({
      where: { authorId, expiresAt: MoreThan(new Date()) },
      relations: ['attachment'],
      order: { createdAt: 'ASC' },
    });

    const views = await this.viewRepo.find({
      where: { viewerId, storyId: In(stories.map((s) => s.id)) },
      select: ['storyId'],
    });
    const viewed = new Set(views.map((v) => v.storyId));

    const likes = await this.likeRepo.find({
      where: { userId: viewerId, storyId: In(stories.map((s) => s.id)) },
      select: ['storyId'],
    });
    const liked = new Set(likes.map((l) => l.storyId));

    const payloads: StoryItemPayload[] = [];
    for (const story of stories) {
      const mimeType = story.attachment?.mimeType ?? 'application/octet-stream';
      const mediaUrl = story.attachment?.url ?? `/api/v1/attachments/${story.attachmentId}/content`;
      const item = await this.toItemPayload(
        story,
        viewerId,
        mimeType,
        mediaUrl,
        viewed.has(story.id),
        liked.has(story.id),
      );
      if (viewerId === authorId) {
        item.viewCount = await this.viewRepo.count({ where: { storyId: story.id } });
        item.likeCount = await this.likeRepo.count({ where: { storyId: story.id } });
      }
      payloads.push(item);
    }
    return payloads;
  }

  async markViewed(viewerId: string, storyId: string) {
    const story = await this.requireActiveStory(storyId);
    await this.assertCanViewAuthor(viewerId, story.authorId);

    if (viewerId === story.authorId) {
      return { success: true, viewedAt: new Date().toISOString() };
    }

    const existing = await this.viewRepo.findOne({ where: { storyId, viewerId } });
    if (existing) {
      return { success: true, viewedAt: existing.viewedAt.toISOString() };
    }

    const saved = await this.viewRepo.save(
      this.viewRepo.create({ storyId, viewerId }),
    );
    return { success: true, viewedAt: saved.viewedAt.toISOString() };
  }

  async listViewers(userId: string, storyId: string) {
    const story = await this.requireStory(storyId);
    if (story.authorId !== userId) {
      throw new ForbiddenException('Only the story owner can list viewers');
    }

    const views = await this.viewRepo.find({
      where: { storyId },
      relations: ['viewer'],
      order: { viewedAt: 'DESC' },
    });

    const likes = await this.likeRepo.find({
      where: { storyId },
      select: ['userId', 'likedAt'],
    });
    const likedAtByUser = new Map(likes.map((like) => [like.userId, like.likedAt] as const));

    const rows = views.map((view) => {
      const likedAt = likedAtByUser.get(view.viewerId);
      return {
        ...this.users.toPublic(view.viewer),
        viewedAt: view.viewedAt.toISOString(),
        liked: Boolean(likedAt),
        likedAt: likedAt?.toISOString(),
      };
    });

    // Likers first, then most recent view.
    rows.sort((a, b) => {
      if (a.liked !== b.liked) return a.liked ? -1 : 1;
      return b.viewedAt.localeCompare(a.viewedAt);
    });

    return rows;
  }

  async like(userId: string, storyId: string) {
    const story = await this.requireActiveStory(storyId);
    await this.assertCanViewAuthor(userId, story.authorId);

    if (userId === story.authorId) {
      throw new BadRequestException('Cannot like your own story');
    }

    const existing = await this.likeRepo.findOne({ where: { storyId, userId } });
    if (existing) {
      return { success: true, liked: true, likedAt: existing.likedAt.toISOString() };
    }

    // Ensure a view row exists so likers always appear in the viewers list.
    const viewed = await this.viewRepo.findOne({ where: { storyId, viewerId: userId } });
    if (!viewed) {
      await this.viewRepo.save(this.viewRepo.create({ storyId, viewerId: userId }));
    }

    const saved = await this.likeRepo.save(this.likeRepo.create({ storyId, userId }));
    this.audit.record({
      action: AuditAction.STORY_LIKE,
      userId,
      resourceType: 'story',
      resourceId: storyId,
    });

    return { success: true, liked: true, likedAt: saved.likedAt.toISOString() };
  }

  async unlike(userId: string, storyId: string) {
    const story = await this.requireActiveStory(storyId);
    await this.assertCanViewAuthor(userId, story.authorId);

    await this.likeRepo.delete({ storyId, userId });
    this.audit.record({
      action: AuditAction.STORY_UNLIKE,
      userId,
      resourceType: 'story',
      resourceId: storyId,
    });

    return { success: true, liked: false };
  }

  async remove(userId: string, storyId: string) {
    const story = await this.requireStory(storyId);
    if (story.authorId !== userId) {
      throw new ForbiddenException('Only the story owner can delete this story');
    }

    const attachmentId = story.attachmentId;
    await this.storyRepo.remove(story);

    try {
      await this.storage.delete(userId, attachmentId);
    } catch {
      // Story row is gone; ignore stale attachment cleanup failures.
    }

    this.audit.record({
      action: AuditAction.STORY_DELETE,
      userId,
      resourceType: 'story',
      resourceId: storyId,
    });

    const audience = await this.audienceUserIds(userId);
    await this.realtime.publishDeleted(audience, { storyId, authorId: userId });
    return { success: true };
  }

  async reply(viewerId: string, storyId: string, content: string) {
    const story = await this.requireActiveStory(storyId);
    await this.assertCanViewAuthor(viewerId, story.authorId);

    if (viewerId === story.authorId) {
      throw new BadRequestException('Cannot reply to your own story');
    }

    const conversation = await this.conversations.createDirect(viewerId, {
      userId: story.authorId,
    });

    const message = await this.messages.sendStoryReply(
      viewerId,
      conversation.id,
      storyId,
      content,
    );

    this.audit.record({
      action: AuditAction.STORY_REPLY,
      userId: viewerId,
      resourceType: 'story',
      resourceId: storyId,
      metadata: { conversationId: conversation.id, messageId: message.id },
    });

    return { conversationId: conversation.id, message };
  }

  /** Used by StorageService ACL. */
  async canAccessAttachment(userId: string, attachmentId: string): Promise<boolean> {
    const story = await this.storyRepo.findOne({
      where: { attachmentId },
      select: ['id', 'authorId', 'expiresAt'],
    });
    if (!story) return false;
    if (story.expiresAt.getTime() <= Date.now()) {
      return story.authorId === userId;
    }
    try {
      await this.assertCanViewAuthor(userId, story.authorId);
      return true;
    } catch {
      return false;
    }
  }

  private async audienceUserIds(authorId: string): Promise<string[]> {
    const contactIds = await this.contacts.listContactUserIds(authorId);
    return [...new Set([authorId, ...contactIds])];
  }

  private async assertCanViewAuthor(viewerId: string, authorId: string) {
    if (viewerId === authorId) return;
    const allowed = await this.contacts.isContact(authorId, viewerId);
    if (!allowed) {
      throw new ForbiddenException('You cannot view this story');
    }
  }

  private async requireActiveStory(storyId: string) {
    const story = await this.requireStory(storyId);
    if (story.expiresAt.getTime() <= Date.now()) {
      throw new NotFoundException('Story expired');
    }
    return story;
  }

  private async requireStory(storyId: string) {
    const story = await this.storyRepo.findOne({
      where: { id: storyId },
      relations: ['attachment'],
    });
    if (!story) throw new NotFoundException('Story not found');
    return story;
  }

  private async requireUser(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private async toItemPayload(
    story: Story,
    viewerId: string,
    mimeType: string,
    mediaUrl: string,
    viewedByMe?: boolean,
    likedByMe?: boolean,
  ): Promise<StoryItemPayload> {
    let viewed = viewedByMe;
    if (viewed === undefined) {
      if (viewerId === story.authorId) {
        viewed = true;
      } else {
        const row = await this.viewRepo.findOne({
          where: { storyId: story.id, viewerId },
          select: ['storyId'],
        });
        viewed = !!row;
      }
    }

    let liked = likedByMe;
    if (liked === undefined) {
      if (viewerId === story.authorId) {
        liked = false;
      } else {
        const row = await this.likeRepo.findOne({
          where: { storyId: story.id, userId: viewerId },
          select: ['storyId'],
        });
        liked = !!row;
      }
    }

    return {
      id: story.id,
      authorId: story.authorId,
      caption: story.caption ?? undefined,
      mediaUrl,
      mimeType,
      createdAt: story.createdAt.toISOString(),
      expiresAt: story.expiresAt.toISOString(),
      viewedByMe: viewed,
      likedByMe: liked,
    };
  }
}
