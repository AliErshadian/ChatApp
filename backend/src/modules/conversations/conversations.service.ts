import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
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
import { MessageUserHidden } from '../messages/entities/message-user-hidden.entity';
import { CreateChannelDto, CreateDirectDto } from './dto/conversation.dto';

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

      await this.ensureInviteForChannel(manager, conversation.id, userId);

      return this.toConversationSummary(full!, userId);
    });
  }

  private createInviteToken() {
    return randomBytes(24).toString('base64url');
  }

  private async ensureInviteForChannel(
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
    if (!conversation || conversation.type !== ConversationType.CHANNEL) {
      throw new ForbiddenException('Invite links are only available for channels');
    }

    let invite = await this.inviteRepo.findOne({ where: { conversationId } });
    if (!invite) {
      invite = await this.ensureInviteForChannel(
        this.dataSource.manager,
        conversationId,
        userId,
      );
    }

    return { token: invite.token };
  }

  async getInvitePreview(token: string) {
    const invite = await this.inviteRepo.findOne({
      where: { token },
      relations: ['conversation'],
    });
    if (!invite?.conversation || invite.conversation.type !== ConversationType.CHANNEL) {
      throw new NotFoundException('Invite not found');
    }

    return {
      channelName: invite.conversation.name ?? 'Channel',
      conversationId: invite.conversationId,
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
    if (!invite?.conversation || invite.conversation.type !== ConversationType.CHANNEL) {
      throw new NotFoundException('Invite not found');
    }

    const conversationId = invite.conversationId;
    const existing = await this.memberRepo.findOne({
      where: { conversationId, userId },
    });

    if (existing) {
      await this.unhideConversation(conversationId, userId);
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

    return this.getById(conversationId, userId);
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

  async leaveChannel(conversationId: string, userId: string) {
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId },
    });
    if (!conversation || conversation.type !== ConversationType.CHANNEL) {
      throw new ForbiddenException('Can only leave channels');
    }

    const member = await this.assertMember(conversationId, userId);
    const members = await this.memberRepo.find({
      where: { conversationId },
      order: { joinedAt: 'ASC' },
    });

    if (member.role === MemberRole.OWNER) {
      const remaining = members.filter((m) => m.userId !== userId);
      if (remaining.length > 0) {
        const nextOwner =
          remaining.find((m) => m.role === MemberRole.ADMIN) ?? remaining[0];
        nextOwner.role = MemberRole.OWNER;
        await this.memberRepo.save(nextOwner);
      }
    }

    await this.memberRepo.delete({ conversationId, userId });
    await this.hideConversation(conversationId, userId);

    return { conversationId };
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
    if (!conversation || conversation.type !== ConversationType.CHANNEL) {
      throw new ForbiddenException('Can only add members to channels');
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
    return { added: toAdd };
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
      members,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
  }
}
