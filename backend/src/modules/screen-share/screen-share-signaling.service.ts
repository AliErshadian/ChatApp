import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ConversationsService } from '../conversations/conversations.service';
import { ConversationType } from '../conversations/entities/conversation.entity';
import { MemberRole } from '../conversations/entities/conversation-member.entity';
import { UsersService } from '../users/users.service';
import { RealtimeBroadcastService } from '../realtime/realtime-broadcast.service';
import { AppConfigService } from '../app-config/app-config.service';
import { MessagesService } from '../messages/messages.service';
import { ScreenShareRegistryService } from './screen-share-registry.service';
import { ScreenShareHistoryService } from './screen-share-history.service';
import { ScreenShareAuditService } from './screen-share-audit.service';
import {
  SCREEN_AUDIT,
  type ActiveScreenSession,
  type ScreenParticipantInfo,
  type ScreenSessionPayload,
  type ScreenShareSource,
} from './screen-share.types';

const START_ROLES = new Set<MemberRole>([
  MemberRole.OWNER,
  MemberRole.ADMIN,
  MemberRole.MODERATOR,
]);

@Injectable()
export class ScreenShareSignalingService implements OnModuleInit {
  private readonly logger = new Logger(ScreenShareSignalingService.name);

  constructor(
    private readonly conversations: ConversationsService,
    private readonly users: UsersService,
    private readonly broadcast: RealtimeBroadcastService,
    private readonly appConfig: AppConfigService,
    private readonly messages: MessagesService,
    private readonly registry: ScreenShareRegistryService,
    private readonly history: ScreenShareHistoryService,
    private readonly audit: ScreenShareAuditService,
  ) {}

  onModuleInit() {
    this.registry.setIdleEndHandler((sessionId) => {
      void this.endSessionInternal(sessionId, null, 'idle');
    });
  }

  private async features() {
    return this.appConfig.getFeatures();
  }

  private async assertScreenAllowed(
    conversationId: string,
    userId: string,
    action: 'create' | 'join',
  ) {
    const features = await this.features();
    if (!features.screenSharingEnabled) {
      this.audit.record({
        eventType: SCREEN_AUDIT.PERMISSION_DENIED,
        conversationId,
        actorUserId: userId,
        metadata: { reason: 'globally_disabled' },
      });
      throw new ForbiddenException('Screen sharing is disabled');
    }

    const conversation = await this.conversations.findConversationById(conversationId);
    if (!conversation) throw new NotFoundException('Conversation not found');

    if (conversation.type === ConversationType.CHANNEL) {
      this.audit.record({
        eventType: SCREEN_AUDIT.PERMISSION_DENIED,
        conversationId,
        actorUserId: userId,
        metadata: { reason: 'channels_not_supported' },
      });
      throw new ForbiddenException('Screen sharing is not available in channels');
    }

    if (conversation.type === ConversationType.DIRECT) {
      this.audit.record({
        eventType: SCREEN_AUDIT.PERMISSION_DENIED,
        conversationId,
        actorUserId: userId,
        metadata: { reason: 'use_in_call_path' },
      });
      throw new BadRequestException(
        'Direct chat screen share requires an active voice or video call',
      );
    }

    if (!features.screenSharingGroupsEnabled) {
      throw new ForbiddenException('Screen sharing in groups is disabled');
    }

    if (!conversation.screenSharingAllowed) {
      throw new ForbiddenException('Screen sharing is disabled for this group');
    }

    const member = await this.conversations.assertMember(conversationId, userId);

    if (action === 'create' && !START_ROLES.has(member.role)) {
      this.audit.record({
        eventType: SCREEN_AUDIT.PERMISSION_DENIED,
        conversationId,
        actorUserId: userId,
        metadata: { reason: 'insufficient_role', role: member.role },
      });
      throw new ForbiddenException(
        'Only owners, admins, or moderators can start screen sharing',
      );
    }

    return { conversation, member };
  }

  private async toParticipantInfo(userId: string): Promise<ScreenParticipantInfo | null> {
    const user = await this.users.findById(userId);
    if (!user) return null;
    return {
      id: user.id,
      displayName: user.displayName,
      username: user.username,
    };
  }

  private async buildPayload(session: ActiveScreenSession): Promise<ScreenSessionPayload> {
    const participants: ScreenParticipantInfo[] = [];
    for (const id of session.participantIds) {
      const info = await this.toParticipantInfo(id);
      if (info) participants.push(info);
    }
    const presenterId = session.presenterIds[0] ?? session.hostUserId;
    const presenter = await this.toParticipantInfo(presenterId);
    return {
      sessionId: session.sessionId,
      conversationId: session.conversationId,
      hostUserId: session.hostUserId,
      presenting: session.presenting,
      screenSource: session.screenSource,
      presenter,
      participants,
      viewerCount: Math.max(0, session.participantIds.length - session.presenterIds.length),
      startedAt: new Date(session.createdAt).toISOString(),
    };
  }

  async create(userId: string, conversationId: string) {
    const { conversation } = await this.assertScreenAllowed(conversationId, userId, 'create');
    const features = await this.features();

    const existing = await this.registry.listForConversation(conversationId);
    const activePresenting = existing.filter((s) => s.presenting || s.participantIds.length > 0);
    if (
      !conversation.screenAllowMultiplePresenters &&
      activePresenting.length >= conversation.screenMaxConcurrentShares
    ) {
      throw new BadRequestException('A screen share is already active in this group');
    }
    if (activePresenting.length >= conversation.screenMaxConcurrentShares) {
      throw new BadRequestException('Maximum concurrent screen shares reached for this group');
    }
    if ((await this.registry.countActive()) >= features.screenMaxConcurrentSessions) {
      throw new BadRequestException('Maximum concurrent screen share sessions reached');
    }

    const sessionId = randomUUID();
    await this.history.createSession({
      id: sessionId,
      conversationId,
      conversationType: conversation.type,
      hostUserId: userId,
    });

    const session: ActiveScreenSession = {
      sessionId,
      conversationId,
      hostUserId: userId,
      kind: 'screen_share',
      presenting: false,
      screenSource: null,
      participantIds: [userId],
      presenterIds: [userId],
      announcementMessageId: null,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };
    await this.registry.save(session);

    const payload = await this.buildPayload(session);
    await this.broadcast.emitToConversation(conversationId, 'screen:created', payload);

    this.audit.record({
      eventType: SCREEN_AUDIT.JOINED,
      sessionId,
      conversationId,
      actorUserId: userId,
      metadata: { as: 'host' },
    });

    return payload;
  }

  async join(userId: string, sessionId: string) {
    const session = await this.registry.get(sessionId);
    if (!session) throw new NotFoundException('Screen share session not found');

    await this.assertScreenAllowed(session.conversationId, userId, 'join');
    const conversation = await this.conversations.findConversationById(session.conversationId);
    if (!conversation) throw new NotFoundException('Conversation not found');

    if (
      !session.participantIds.includes(userId) &&
      session.participantIds.length >= conversation.screenMaxParticipants
    ) {
      throw new BadRequestException('Screen share participant limit reached');
    }

    await this.registry.addParticipant(sessionId, userId, false);
    await this.history.upsertParticipant(sessionId, userId, 'viewer');
    await this.registry.touch(sessionId);

    const updated = await this.registry.get(sessionId);
    if (!updated) throw new NotFoundException('Screen share session not found');

    const info = await this.toParticipantInfo(userId);
    const payload = await this.buildPayload(updated);

    await this.broadcast.emitToConversation(session.conversationId, 'participant:joined', {
      sessionId,
      participant: info,
      session: payload,
    });

    this.audit.record({
      eventType: SCREEN_AUDIT.JOINED,
      sessionId,
      conversationId: session.conversationId,
      actorUserId: userId,
    });

    return payload;
  }

  async leave(userId: string, sessionId: string) {
    const session = await this.registry.get(sessionId);
    if (!session) return { success: true };

    await this.conversations.assertMember(session.conversationId, userId);
    await this.registry.removeParticipant(sessionId, userId);
    await this.history.markParticipantLeft(sessionId, userId);

    const updated = await this.registry.get(sessionId);
    const info = await this.toParticipantInfo(userId);

    if (!updated || updated.participantIds.length === 0 || updated.hostUserId === userId) {
      await this.endSessionInternal(sessionId, userId, 'leave');
      return { success: true };
    }

    const payload = await this.buildPayload(updated);
    await this.broadcast.emitToConversation(session.conversationId, 'participant:left', {
      sessionId,
      participant: info,
      session: payload,
    });

    this.audit.record({
      eventType: SCREEN_AUDIT.LEFT,
      sessionId,
      conversationId: session.conversationId,
      actorUserId: userId,
    });

    return { success: true };
  }

  async start(
    userId: string,
    sessionId: string,
    screenSource: ScreenShareSource = 'screen',
  ) {
    const session = await this.registry.get(sessionId);
    if (!session) throw new NotFoundException('Screen share session not found');
    if (!session.presenterIds.includes(userId) && session.hostUserId !== userId) {
      throw new ForbiddenException('Only a presenter can start sharing');
    }

    await this.registry.setPresenting(sessionId, true, screenSource);
    await this.history.setScreenSource(sessionId, screenSource);
    const updated = await this.registry.get(sessionId);
    if (!updated) throw new NotFoundException('Screen share session not found');

    const presenter = await this.toParticipantInfo(userId);
    try {
      const announcement = await this.messages.createScreenShareAnnouncement({
        userId,
        conversationId: session.conversationId,
        sessionId,
        presenterName: presenter?.displayName ?? 'Someone',
      });
      updated.announcementMessageId = announcement.id;
      await this.registry.save(updated);
    } catch (err) {
      this.logger.warn(`Failed to post screen-share announcement: ${err}`);
    }

    const payload = await this.buildPayload(updated);
    await this.broadcast.emitToConversation(session.conversationId, 'screen:start', payload);

    this.audit.record({
      eventType: SCREEN_AUDIT.STARTED,
      sessionId,
      conversationId: session.conversationId,
      actorUserId: userId,
      metadata: { screenSource, messageId: updated.announcementMessageId },
    });

    return payload;
  }

  async stop(userId: string, sessionId: string) {
    const session = await this.registry.get(sessionId);
    if (!session) throw new NotFoundException('Screen share session not found');
    if (!session.presenterIds.includes(userId) && session.hostUserId !== userId) {
      throw new ForbiddenException('Only a presenter can stop sharing');
    }

    await this.registry.setPresenting(sessionId, false, null);
    const updated = await this.registry.get(sessionId);
    if (!updated) throw new NotFoundException('Screen share session not found');

    await this.messages.endScreenShareAnnouncement(sessionId, userId).catch((err) => {
      this.logger.warn(`Failed to end screen-share announcement: ${err}`);
    });

    const payload = await this.buildPayload(updated);
    await this.broadcast.emitToConversation(session.conversationId, 'screen:stop', payload);

    this.audit.record({
      eventType: SCREEN_AUDIT.ENDED,
      sessionId,
      conversationId: session.conversationId,
      actorUserId: userId,
      metadata: { reason: 'stopped' },
    });

    return payload;
  }

  async forwardWebrtc(
    userId: string,
    sessionId: string,
    targetUserId: string,
    type: 'offer' | 'answer' | 'ice',
    payload: unknown,
  ) {
    const session = await this.registry.get(sessionId);
    if (!session) throw new NotFoundException('Screen share session not found');
    if (!session.participantIds.includes(userId)) {
      throw new ForbiddenException('Not a session participant');
    }
    if (!session.participantIds.includes(targetUserId)) {
      throw new BadRequestException('Target is not a session participant');
    }
    await this.registry.touch(sessionId);

    const event =
      type === 'offer' ? 'webrtc:offer' : type === 'answer' ? 'webrtc:answer' : 'webrtc:ice';

    await this.broadcast.emitToUser(targetUserId, event, {
      sessionId,
      fromUserId: userId,
      type,
      payload,
    });

    return { success: true };
  }

  async forwardQuality(
    userId: string,
    sessionId: string,
    quality: { level: string; rttMs?: number; packetLoss?: number; bitrateKbps?: number },
  ) {
    const session = await this.registry.get(sessionId);
    if (!session) throw new NotFoundException('Screen share session not found');
    if (!session.participantIds.includes(userId)) {
      throw new ForbiddenException('Not a session participant');
    }
    await this.registry.touch(sessionId);
    await this.broadcast.emitToConversation(session.conversationId, 'screen:quality', {
      sessionId,
      fromUserId: userId,
      quality,
    });
    return { success: true };
  }

  async listActiveForConversation(userId: string, conversationId: string) {
    await this.conversations.assertMember(conversationId, userId);
    const sessions = await this.registry.listForConversation(conversationId);
    return Promise.all(sessions.map((s) => this.buildPayload(s)));
  }

  async assertDmScreenShareAllowed(userId: string, conversationId: string) {
    const features = await this.features();
    if (!features.screenSharingEnabled || !features.screenSharingDirectEnabled) {
      throw new ForbiddenException('Screen sharing in direct chats is disabled');
    }
    const conversation = await this.conversations.findConversationById(conversationId);
    if (!conversation || conversation.type !== ConversationType.DIRECT) {
      throw new BadRequestException('Invalid direct conversation');
    }
    await this.conversations.assertMember(conversationId, userId);
  }

  async auditDmScreen(input: {
    userId: string;
    conversationId: string;
    callId: string;
    started: boolean;
    screenSource?: ScreenShareSource;
  }) {
    this.audit.record({
      eventType: input.started ? SCREEN_AUDIT.DM_STARTED : SCREEN_AUDIT.DM_STOPPED,
      conversationId: input.conversationId,
      actorUserId: input.userId,
      metadata: {
        callId: input.callId,
        screenSource: input.screenSource,
      },
    });
  }

  private async endSessionInternal(
    sessionId: string,
    actorUserId: string | null,
    reason: string,
  ) {
    const session = await this.registry.remove(sessionId);
    if (!session) return;
    const ended = await this.history.endSession(sessionId);
    await this.messages.endScreenShareAnnouncement(sessionId, actorUserId).catch((err) => {
      this.logger.warn(`Failed to end screen-share announcement: ${err}`);
    });
    await this.broadcast.emitToConversation(session.conversationId, 'screen:ended', {
      sessionId,
      conversationId: session.conversationId,
      reason,
      durationSeconds: ended?.durationSeconds ?? null,
    });
    this.audit.record({
      eventType: SCREEN_AUDIT.ENDED,
      sessionId,
      conversationId: session.conversationId,
      actorUserId,
      metadata: { reason, durationSeconds: ended?.durationSeconds },
    });
    this.logger.log(`Screen session ${sessionId} ended (${reason})`);
  }
}
