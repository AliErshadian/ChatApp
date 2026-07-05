import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In, IsNull } from 'typeorm';
import {
  Conversation,
  ConversationType,
} from './entities/conversation.entity';
import { ConversationMember, MemberRole } from './entities/conversation-member.entity';
import { DirectConversationPair } from './entities/direct-conversation-pair.entity';
import { ConversationUserHidden } from './entities/conversation-user-hidden.entity';
import { ChannelInvite } from './entities/channel-invite.entity';
import { Message } from '../messages/entities/message.entity';
import { randomBytes } from 'crypto';
import { join, extname } from 'path';
import { existsSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import { MessageUserHidden } from '../messages/entities/message-user-hidden.entity';
import { CreateChannelDto, CreateGroupDto, CreateDirectDto } from './dto/conversation.dto';
import { ConversationRealtimePublisher } from './conversation-realtime.publisher';

@Injectable()
export class ConversationsService {
  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
    @InjectRepository(ConversationMember)
    private readonly memberRepo: Repository<ConversationMember>,
    @InjectRepository(DirectConversationPair)
    private readonly pairRepo: Repository<DirectConversationPair>,
    @InjectRepository(ConversationUserHidden)
    private readonly hiddenRepo: Repository<ConversationUserHidden>,
    @InjectRepository(ChannelInvite)
    private readonly inviteRepo: Repository<ChannelInvite>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    private readonly dataSource: DataSource,
    private readonly conversationPublisher: ConversationRealtimePublisher,
  ) {}

  async listForUser(userId: string) {
    const hiddenRows = await this.hiddenRepo.find({ where: { userId } });
    const hiddenIds = new Set(hiddenRows.map((h) => h.conversationId));

    const memberships = await this.memberRepo.find({
      where: { userId },
      relations: ['conversation', 'conversation.members', 'conversation.members.user'],
      order: { joinedAt: 'DESC' },
    });

    const visibleMemberships = memberships.filter(
      (m) => !hiddenIds.has(m.conversationId),
    );

    const summaries = await Promise.all(
      visibleMemberships.map(async (m) => {
        const unreadCount = await this.countUnread(
          userId,
          m.conversationId,
          m.lastReadAt,
        );
        return {
          ...this.toConversationSummary(m.conversation, userId),
          unreadCount,
        };
      }),
    );

    const lastMessages = await this.fetchLastMessages(
      summaries.map((s) => s.id),
      userId,
    );

    return summaries
      .map((s) => ({
        ...s,
        lastMessage: lastMessages.get(s.id),
      }))
      .sort((a, b) => this.compareByRecentActivity(a, b));
  }

  async getById(conversationId: string, userId: string) {
    await this.assertMember(conversationId, userId);
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId },
      relations: ['members', 'members.user'],
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    const member = await this.memberRepo.findOne({ where: { conversationId, userId } });
    const unreadCount = await this.countUnread(
      userId,
      conversationId,
      member?.lastReadAt,
    );
    const lastMessages = await this.fetchLastMessages([conversationId], userId);
    return {
      ...this.toConversationSummary(conversation, userId),
      unreadCount,
      lastMessage: lastMessages.get(conversationId),
    };
  }

  async createChannel(userId: string, dto: CreateChannelDto) {
    return this.dataSource.transaction(async (manager) => {
      const conversation = await manager.save(
        manager.create(Conversation, {
          type: ConversationType.CHANNEL,
          name: dto.name.trim(),
          description: dto.description,
          createdBy: userId,
        }),
      );

      const memberIds = new Set([userId, ...(dto.memberIds ?? [])]);
      const members = [...memberIds].map((uid) =>
        manager.create(ConversationMember, {
          conversationId: conversation.id,
          userId: uid,
          role: uid === userId ? MemberRole.OWNER : MemberRole.MEMBER,
        }),
      );
      await manager.save(members);

      const full = await manager.findOne(Conversation, {
        where: { id: conversation.id },
        relations: ['members', 'members.user'],
      });

      await this.ensureInvite(manager, conversation.id, userId);

      return this.toConversationSummary(full!, userId);
    });
  }

  async createGroup(userId: string, dto: CreateGroupDto) {
    const conversation = await this.dataSource.transaction(async (manager) => {
      const created = await manager.save(
        manager.create(Conversation, {
          type: ConversationType.GROUP,
          name: dto.name.trim(),
          description: dto.description,
          isPublic: dto.isPublic ?? false,
          createdBy: userId,
        }),
      );

      const memberIds = new Set([userId, ...(dto.memberIds ?? [])]);
      const members = [...memberIds].map((uid) =>
        manager.create(ConversationMember, {
          conversationId: created.id,
          userId: uid,
          role: uid === userId ? MemberRole.OWNER : MemberRole.MEMBER,
        }),
      );
      await manager.save(members);

      if (created.isPublic) {
        await this.ensureInvite(manager, created.id, userId);
      }

      return manager.findOne(Conversation, {
        where: { id: created.id },
        relations: ['members', 'members.user'],
      });
    });

    await this.publishConversationCreated(conversation!.id);
    return this.toConversationSummary(conversation!, userId);
  }

  private createInviteToken() {
    return randomBytes(24).toString('base64url');
  }

  private async ensureInvite(
    manager: DataSource['manager'],
    conversationId: string,
    createdBy: string,
  ) {
    const existing = await manager.findOne(ChannelInvite, {
      where: { conversationId },
    });
    if (existing) return existing;

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await manager.save(
          manager.create(ChannelInvite, {
            conversationId,
            token: this.createInviteToken(),
            createdBy,
          }),
        );
      } catch {
        // Retry on rare token collision.
      }
    }

    throw new ConflictException('Failed to create channel invite');
  }

  async getOrCreateInvite(conversationId: string, userId: string) {
    await this.assertMember(conversationId, userId);

    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId },
    });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    if (conversation.type === ConversationType.DIRECT) {
      throw new ForbiddenException('Invite links are not available for direct messages');
    }
    if (conversation.type === ConversationType.GROUP && !conversation.isPublic) {
      throw new ForbiddenException('Invite links are only available for public groups');
    }

    let invite = await this.inviteRepo.findOne({ where: { conversationId } });
    if (!invite) {
      invite = await this.ensureInvite(this.dataSource.manager, conversationId, userId);
    }

    return { token: invite.token };
  }

  async getInvitePreview(token: string) {
    const invite = await this.inviteRepo.findOne({
      where: { token },
      relations: ['conversation'],
    });
    if (
      !invite?.conversation ||
      (invite.conversation.type !== ConversationType.CHANNEL &&
        invite.conversation.type !== ConversationType.GROUP)
    ) {
      throw new NotFoundException('Invite not found');
    }

    const name =
      invite.conversation.type === ConversationType.GROUP
        ? invite.conversation.name ?? 'Group'
        : invite.conversation.name ?? 'Channel';

    return {
      channelName: name,
      conversationId: invite.conversationId,
      conversationType: invite.conversation.type,
    };
  }

  async getInviteStatus(token: string, userId: string) {
    const preview = await this.getInvitePreview(token);
    const isMember = !!(await this.memberRepo.findOne({
      where: { conversationId: preview.conversationId, userId },
    }));

    return {
      ...preview,
      isMember,
    };
  }

  async joinByInvite(token: string, userId: string) {
    const invite = await this.inviteRepo.findOne({
      where: { token },
      relations: ['conversation'],
    });
    if (
      !invite?.conversation ||
      (invite.conversation.type !== ConversationType.CHANNEL &&
        invite.conversation.type !== ConversationType.GROUP)
    ) {
      throw new NotFoundException('Invite not found');
    }

    if (
      invite.conversation.type === ConversationType.GROUP &&
      !invite.conversation.isPublic
    ) {
      throw new NotFoundException('Invite not found');
    }

    const conversationId = invite.conversationId;
    const existing = await this.memberRepo.findOne({
      where: { conversationId, userId },
    });

    if (existing) {
      await this.unhideConversation(conversationId, userId);
      await this.tryRestoreOrphanedOwner(conversationId, userId);
      await this.publishConversationUpdate(conversationId);
      return this.getById(conversationId, userId);
    }

    await this.memberRepo.save(
      this.memberRepo.create({
        conversationId,
        userId,
        role: MemberRole.MEMBER,
      }),
    );
    await this.unhideConversation(conversationId, userId);
    await this.tryRestoreOrphanedOwner(conversationId, userId);
    await this.publishConversationCreated(conversationId);

    return this.getById(conversationId, userId);
  }

  async getConversationUpdatePayload(conversationId: string) {
    const conversation = await this.conversationRepo.findOne({
      where: {
        id: conversationId,
        type: In([ConversationType.CHANNEL, ConversationType.GROUP]),
      },
      relations: ['members', 'members.user'],
    });
    if (!conversation) return null;

    const members = (conversation.members ?? []).map((m) => ({
      userId: m.userId,
      role: m.role,
      displayName: m.user?.displayName,
      username: m.user?.username,
      avatarUrl: m.user?.avatarUrl,
    }));

    const owner = members.find((m) => m.role === MemberRole.OWNER);

    return {
      conversationId,
      type: conversation.type,
      isPublic: conversation.isPublic,
      name: conversation.name,
      description: conversation.description,
      avatarUrl: conversation.avatarUrl,
      members,
      memberCount: members.length,
      ownerId: owner?.userId ?? null,
      memberUserIds: members.map((m) => m.userId),
    };
  }

  /** @deprecated use getConversationUpdatePayload */
  async getChannelUpdatePayload(conversationId: string) {
    return this.getConversationUpdatePayload(conversationId);
  }

  private async publishConversationUpdate(conversationId: string) {
    await this.conversationPublisher.publishUpdated(conversationId);
  }

  private async publishConversationCreated(conversationId: string) {
    await this.conversationPublisher.publishCreated(conversationId);
  }

  async updateChannelAvatar(
    conversationId: string,
    userId: string,
    file: Express.Multer.File,
  ) {
    const member = await this.assertMember(conversationId, userId);
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId },
    });
    if (
      !conversation ||
      (conversation.type !== ConversationType.CHANNEL &&
        conversation.type !== ConversationType.GROUP)
    ) {
      throw new ForbiddenException('Avatars are only available for channels and groups');
    }
    if (member.role !== MemberRole.OWNER) {
      throw new ForbiddenException('Only the owner can change the conversation photo');
    }

    const ext = extname(file.originalname).toLowerCase();
    const allowed = new Set(['.jpg', '.jpeg', '.png', '.webp']);
    if (!allowed.has(ext)) {
      throw new BadRequestException('Only JPG, PNG, and WebP images are allowed');
    }

    const channelAvatarDir = join(process.cwd(), 'uploads', 'channel-avatars');
    if (!existsSync(channelAvatarDir)) {
      mkdirSync(channelAvatarDir, { recursive: true });
    }

    if (conversation.avatarUrl) {
      const relativePath = conversation.avatarUrl.replace(/^\//, '').split('?')[0];
      const oldPath = join(process.cwd(), relativePath);
      if (existsSync(oldPath)) {
        try {
          unlinkSync(oldPath);
        } catch {
          // ignore cleanup errors
        }
      }
    }

    const filename = `${conversationId}${ext}`;
    renameSync(file.path, join(channelAvatarDir, filename));
    conversation.avatarUrl = `/uploads/channel-avatars/${filename}?v=${Date.now()}`;
    await this.conversationRepo.save(conversation);
    await this.publishConversationUpdate(conversationId);

    return {
      id: conversation.id,
      avatarUrl: conversation.avatarUrl,
    };
  }

  async createDirect(userId: string, dto: CreateDirectDto) {
    if (userId === dto.userId) {
      throw new ConflictException('Cannot create DM with yourself');
    }

    const [userA, userB] = [userId, dto.userId].sort();
    const existing = await this.pairRepo.findOne({ where: { userA, userB } });
    if (existing) {
      await this.unhideConversation(existing.conversationId, userId);
      return this.getById(existing.conversationId, userId);
    }

    return this.dataSource.transaction(async (manager) => {
      const conversation = await manager.save(
        manager.create(Conversation, {
          type: ConversationType.DIRECT,
          createdBy: userId,
        }),
      );

      await manager.save([
        manager.create(ConversationMember, {
          conversationId: conversation.id,
          userId: userA,
          role: MemberRole.MEMBER,
        }),
        manager.create(ConversationMember, {
          conversationId: conversation.id,
          userId: userB,
          role: MemberRole.MEMBER,
        }),
      ]);

      await manager.save(
        manager.create(DirectConversationPair, {
          conversationId: conversation.id,
          userA,
          userB,
        }),
      );

      const full = await manager.findOne(Conversation, {
        where: { id: conversation.id },
        relations: ['members', 'members.user'],
      });
      return this.toConversationSummary(full!, userId);
    });
  }

  async leaveChannel(conversationId: string, userId: string, newOwnerId?: string) {
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId },
    });
    if (
      !conversation ||
      (conversation.type !== ConversationType.CHANNEL &&
        conversation.type !== ConversationType.GROUP)
    ) {
      throw new ForbiddenException('Can only leave channels and groups');
    }

    const member = await this.assertMember(conversationId, userId);
    const members = await this.memberRepo.find({
      where: { conversationId },
      order: { joinedAt: 'ASC' },
    });

    if (member.role === MemberRole.OWNER) {
      if (newOwnerId) {
        if (newOwnerId === userId) {
          throw new BadRequestException('Cannot transfer ownership to yourself');
        }

        const successor = members.find((m) => m.userId === newOwnerId);
        if (!successor) {
          throw new BadRequestException('New owner must be a member');
        }

        successor.role = MemberRole.OWNER;
        await this.memberRepo.save(successor);
        await this.conversationRepo.update(conversationId, { pendingOwnerId: null });
      } else {
        await this.conversationRepo.update(conversationId, { pendingOwnerId: userId });
      }
    }

    await this.memberRepo.delete({ conversationId, userId });
    await this.hideConversation(conversationId, userId);
    await this.publishConversationUpdate(conversationId);

    return { conversationId, newOwnerId: newOwnerId ?? null };
  }

  async delete(
    userId: string,
    conversationId: string,
    scope: 'me' | 'everyone',
  ): Promise<{
    conversationId: string;
    scope: 'me' | 'everyone';
    deletedMessageIds: string[];
  }> {
    await this.assertMember(conversationId, userId);

    let deletedMessageIds: string[] = [];

    if (scope === 'everyone') {
      const ownMessages = await this.messageRepo.find({
        where: {
          conversationId,
          senderId: userId,
          deletedAt: IsNull(),
        },
        select: ['id'],
      });

      if (ownMessages.length > 0) {
        const now = new Date();
        deletedMessageIds = ownMessages.map((m) => m.id);
        await this.messageRepo.update(
          { id: In(deletedMessageIds) },
          { deletedAt: now },
        );
      }
    }

    await this.hideAllMessagesForUser(conversationId, userId);
    await this.hideConversation(conversationId, userId);

    return { conversationId, scope, deletedMessageIds };
  }

  private async hideAllMessagesForUser(conversationId: string, userId: string) {
    await this.messageRepo.query(
      `INSERT INTO message_user_hidden (message_id, user_id)
       SELECT m.id, $2
       FROM messages m
       WHERE m.conversation_id = $1
       ON CONFLICT (message_id, user_id) DO NOTHING`,
      [conversationId, userId],
    );
  }

  async hideConversation(conversationId: string, userId: string) {
    const existing = await this.hiddenRepo.findOne({
      where: { conversationId, userId },
    });
    if (!existing) {
      await this.hiddenRepo.save({ conversationId, userId });
    }
  }

  async unhideConversation(conversationId: string, userId: string) {
    await this.hiddenRepo.delete({ conversationId, userId });
  }

  async addMembers(conversationId: string, actorId: string, userIds: string[]) {
    const actor = await this.assertMember(conversationId, actorId);
    if (actor.role === MemberRole.MEMBER) {
      throw new ForbiddenException('Insufficient permissions');
    }

    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId },
    });
    if (
      !conversation ||
      (conversation.type !== ConversationType.CHANNEL &&
        conversation.type !== ConversationType.GROUP)
    ) {
      throw new ForbiddenException('Can only add members to channels and groups');
    }

    const existing = await this.memberRepo.find({
      where: { conversationId, userId: In(userIds) },
    });
    const existingIds = new Set(existing.map((e) => e.userId));
    const toAdd = userIds.filter((id) => !existingIds.has(id));

    if (toAdd.length === 0) return { added: [] };

    const members = toAdd.map((uid) =>
      this.memberRepo.create({
        conversationId,
        userId: uid,
        role: MemberRole.MEMBER,
      }),
    );
    await this.memberRepo.save(members);
    for (const uid of toAdd) {
      await this.unhideConversation(conversationId, uid);
      await this.tryRestoreOrphanedOwner(conversationId, uid);
    }
    await this.publishConversationUpdate(conversationId);
    if (toAdd.length > 0) {
      await this.publishConversationCreated(conversationId);
    }
    return { added: toAdd };
  }

  async removeMember(conversationId: string, actorId: string, targetUserId: string) {
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId },
    });
    if (!conversation || conversation.type !== ConversationType.GROUP) {
      throw new ForbiddenException('Can only remove members from groups');
    }

    const actor = await this.assertMember(conversationId, actorId);
    if (actor.role !== MemberRole.OWNER) {
      throw new ForbiddenException('Only the group owner can remove members');
    }

    if (targetUserId === actorId) {
      throw new BadRequestException('Use leave to exit the group yourself');
    }

    const target = await this.memberRepo.findOne({
      where: { conversationId, userId: targetUserId },
    });
    if (!target) throw new NotFoundException('Member not found');
    if (target.role === MemberRole.OWNER) {
      throw new BadRequestException('Cannot remove the group owner');
    }

    await this.memberRepo.delete({ conversationId, userId: targetUserId });
    await this.hideConversation(conversationId, targetUserId);
    await this.publishConversationUpdate(conversationId);
    await this.conversationPublisher.publishMemberRemoved(conversationId, targetUserId);

    return { conversationId, removedUserId: targetUserId };
  }

  private async tryRestoreOrphanedOwner(conversationId: string, userId: string) {
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId },
    });
    if (!conversation?.pendingOwnerId || conversation.pendingOwnerId !== userId) {
      return;
    }

    const hasOwner = await this.memberRepo.findOne({
      where: { conversationId, role: MemberRole.OWNER },
    });
    if (hasOwner) {
      await this.conversationRepo.update(conversationId, { pendingOwnerId: null });
      return;
    }

    const member = await this.memberRepo.findOne({
      where: { conversationId, userId },
    });
    if (!member) return;

    member.role = MemberRole.OWNER;
    await this.memberRepo.save(member);
    await this.conversationRepo.update(conversationId, { pendingOwnerId: null });
  }

  async assertMember(conversationId: string, userId: string): Promise<ConversationMember> {
    const member = await this.memberRepo.findOne({
      where: { conversationId, userId },
    });
    if (!member) throw new ForbiddenException('Not a member of this conversation');
    return member;
  }

  async assertCanSendMessage(conversationId: string, userId: string) {
    const member = await this.assertMember(conversationId, userId);
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId },
    });
    if (
      conversation?.type === ConversationType.CHANNEL &&
      member.role !== MemberRole.OWNER
    ) {
      throw new ForbiddenException('Only the channel owner can send messages');
    }
    return member;
  }

  async getMemberUserIds(conversationId: string): Promise<string[]> {
    const members = await this.memberRepo.find({ where: { conversationId } });
    return members.map((m) => m.userId);
  }

  async getRelatedUserIds(userId: string): Promise<string[]> {
    const memberships = await this.memberRepo.find({
      where: { userId },
      select: ['conversationId'],
    });
    const conversationIds = [...new Set(memberships.map((m) => m.conversationId))];
    if (conversationIds.length === 0) return [];

    const peers = await this.memberRepo.find({
      where: { conversationId: In(conversationIds) },
      select: ['userId'],
    });

    return [...new Set(peers.map((p) => p.userId).filter((id) => id !== userId))];
  }

  private async countUnread(
    userId: string,
    conversationId: string,
    lastReadAt?: Date,
  ): Promise<number> {
    const qb = this.messageRepo
      .createQueryBuilder('msg')
      .leftJoin(
        MessageUserHidden,
        'hidden',
        'hidden.message_id = msg.id AND hidden.user_id = :userId',
        { userId },
      )
      .where('msg.conversation_id = :conversationId', { conversationId })
      .andWhere('msg.sender_id != :userId', { userId })
      .andWhere('msg.deleted_at IS NULL')
      .andWhere('hidden.id IS NULL');

    if (lastReadAt) {
      qb.andWhere('msg.created_at > :lastReadAt', { lastReadAt });
    }

    return qb.getCount();
  }

  private async fetchLastMessages(conversationIds: string[], userId: string) {
    if (conversationIds.length === 0) {
      return new Map<
        string,
        {
          id: string;
          content: string;
          senderId: string;
          senderName: string;
          createdAt: Date;
          deletedForEveryone?: boolean;
        }
      >();
    }

    const rows: Array<{
      conversation_id: string;
      id: string;
      sender_id: string;
      content: string;
      created_at: Date;
      deleted_at: Date | null;
      sender_display_name: string;
    }> = await this.messageRepo.query(
      `SELECT DISTINCT ON (m.conversation_id)
        m.conversation_id,
        m.id,
        m.sender_id,
        m.content,
        m.created_at,
        m.deleted_at,
        u.display_name AS sender_display_name
      FROM messages m
      INNER JOIN users u ON u.id = m.sender_id
      LEFT JOIN message_user_hidden h ON h.message_id = m.id AND h.user_id = $2
      WHERE m.conversation_id = ANY($1::uuid[])
        AND h.id IS NULL
      ORDER BY m.conversation_id, m.created_at DESC`,
      [conversationIds, userId],
    );

    const map = new Map<
      string,
      {
        id: string;
        content: string;
        senderId: string;
        senderName: string;
        createdAt: Date;
        deletedForEveryone?: boolean;
      }
    >();

    for (const row of rows) {
      const deletedForEveryone = !!row.deleted_at;
      map.set(row.conversation_id, {
        id: row.id,
        content: deletedForEveryone ? '' : row.content,
        senderId: row.sender_id,
        senderName: row.sender_display_name,
        createdAt: row.created_at,
        deletedForEveryone,
      });
    }

    return map;
  }

  private compareByRecentActivity(
    a: { lastMessage?: { createdAt: Date }; updatedAt: Date },
    b: { lastMessage?: { createdAt: Date }; updatedAt: Date },
  ) {
    const aTime = new Date(a.lastMessage?.createdAt ?? a.updatedAt).getTime();
    const bTime = new Date(b.lastMessage?.createdAt ?? b.updatedAt).getTime();
    return bTime - aTime;
  }

  private toConversationSummary(conversation: Conversation, currentUserId: string) {
    const members = (conversation.members ?? []).map((m) => ({
      userId: m.userId,
      role: m.role,
      displayName: m.user?.displayName,
      username: m.user?.username,
      avatarUrl: m.user?.avatarUrl,
      lastReadAt: m.lastReadAt,
    }));

    let displayName = conversation.name;
    if (conversation.type === ConversationType.DIRECT) {
      const other = members.find((m) => m.userId !== currentUserId);
      displayName = other?.displayName ?? 'Direct Message';
    }

    return {
      id: conversation.id,
      type: conversation.type,
      name: displayName,
      description: conversation.description,
      avatarUrl: conversation.avatarUrl,
      isPublic: conversation.isPublic ?? false,
      members,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
  }
}
