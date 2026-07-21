import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ConversationsService } from '../conversations/conversations.service';
import { ConversationType } from '../conversations/entities/conversation.entity';
import { UsersService } from '../users/users.service';
import { RealtimeBroadcastService } from '../realtime/realtime-broadcast.service';
import { CallRegistryService } from './call-registry.service';
import { CallsHistoryService } from './calls-history.service';
import { AppConfigService } from '../app-config/app-config.service';
import type {
  CallAcceptedPayload,
  CallEndedPayload,
  CallIncomingPayload,
  CallMediaType,
  CallSignalPayload,
} from './call.types';

@Injectable()
export class CallSignalingService {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly usersService: UsersService,
    private readonly registry: CallRegistryService,
    private readonly broadcast: RealtimeBroadcastService,
    private readonly history: CallsHistoryService,
    private readonly appConfig: AppConfigService,
  ) {}

  async invite(
    userId: string,
    sessionId: string,
    conversationId: string,
    mediaType: CallMediaType = 'audio',
  ): Promise<{ callId: string; conversationId: string; calleeId: string; mediaType: CallMediaType }> {
    if (this.registry.isUserBusy(userId)) {
      throw new ConflictException('You are already in a call');
    }

    const peerUserId = await this.assertDirectPeer(conversationId, userId);

    if (this.registry.isUserBusy(peerUserId)) {
      throw new ConflictException('User is busy');
    }

    const caller = await this.usersService.findById(userId);
    if (!caller) throw new NotFoundException('Caller not found');

    const normalizedMediaType: CallMediaType = mediaType === 'video' ? 'video' : 'audio';
    const features = await this.appConfig.getFeatures();
    if (normalizedMediaType === 'video' && !features.videoCallsEnabled) {
      throw new ForbiddenException('Video calls are disabled');
    }
    if (normalizedMediaType === 'audio' && !features.voiceCallsEnabled) {
      throw new ForbiddenException('Voice calls are disabled');
    }

    const callId = randomUUID();
    const call = this.registry.create({
      callId,
      conversationId,
      callerId: userId,
      calleeId: peerUserId,
      mediaType: normalizedMediaType,
    });

    const incoming: CallIncomingPayload = {
      callId,
      conversationId,
      mediaType: normalizedMediaType,
      caller: {
        id: caller.id,
        displayName: caller.displayName,
        username: caller.username,
      },
    };

    await this.broadcast.emitToUserExceptSession(peerUserId, sessionId, 'call:incoming', incoming);

    this.registry.scheduleRingTimeout(callId, () => {
      void this.endCall(callId, userId, 'timeout');
    });

    return { callId: call.callId, conversationId, calleeId: peerUserId, mediaType: normalizedMediaType };
  }

  async accept(
    userId: string,
    sessionId: string,
    callId: string,
  ): Promise<CallAcceptedPayload> {
    const call = this.requireCall(callId);
    this.assertParticipant(call, userId);

    if (call.calleeId !== userId) {
      throw new ForbiddenException('Only the callee can accept this call');
    }
    if (call.state !== 'ringing') {
      throw new BadRequestException('Call is not ringing');
    }

    this.registry.markActive(callId);

    const payload: CallAcceptedPayload = {
      callId,
      conversationId: call.conversationId,
      acceptedBy: userId,
    };

    await this.broadcast.emitToUserExceptSession(call.callerId, sessionId, 'call:accepted', payload);

    return payload;
  }

  async reject(
    userId: string,
    sessionId: string,
    callId: string,
  ): Promise<CallEndedPayload> {
    const call = this.requireCall(callId);
    this.assertParticipant(call, userId);

    if (call.calleeId !== userId) {
      throw new ForbiddenException('Only the callee can reject this call');
    }

    return this.endCall(callId, userId, 'rejected', sessionId);
  }

  async end(
    userId: string,
    sessionId: string,
    callId: string,
  ): Promise<CallEndedPayload> {
    const call = this.requireCall(callId);
    this.assertParticipant(call, userId);

    const reason =
      call.state === 'ringing' && call.callerId === userId ? 'cancelled' : 'ended';
    return this.endCall(callId, userId, reason, sessionId);
  }

  async forwardSignal(
    userId: string,
    sessionId: string,
    callId: string,
    type: 'offer' | 'answer' | 'ice',
    payload: unknown,
  ): Promise<{ success: true }> {
    const call = this.requireCall(callId);
    this.assertParticipant(call, userId);

    if (call.state === 'ended') {
      throw new BadRequestException('Call has ended');
    }

    const targetUserId = call.callerId === userId ? call.calleeId : call.callerId;
    const signal: CallSignalPayload = {
      callId,
      type,
      payload,
      fromUserId: userId,
    };

    await this.broadcast.emitToUserExceptSession(targetUserId, sessionId, 'call:signal', signal);

    return { success: true };
  }

  private async endCall(
    callId: string,
    endedBy: string,
    reason: CallEndedPayload['reason'],
    exceptSessionId?: string,
  ): Promise<CallEndedPayload> {
    const call = this.registry.remove(callId);
    if (!call) {
      throw new NotFoundException('Call not found');
    }

    const endedAt = new Date();
    const payload: CallEndedPayload = {
      callId,
      conversationId: call.conversationId,
      reason,
      endedBy,
    };

    await this.history.recordCallEnd({
      callId: call.callId,
      conversationId: call.conversationId,
      callerId: call.callerId,
      calleeId: call.calleeId,
      mediaType: call.mediaType,
      endReason: reason,
      endedBy,
      startedAt: new Date(call.createdAt),
      answeredAt: call.answeredAt ? new Date(call.answeredAt) : null,
      endedAt,
    });

    const targets = [call.callerId, call.calleeId];
    for (const userId of targets) {
      if (userId === endedBy && exceptSessionId) {
        await this.broadcast.emitToUserExceptSession(userId, exceptSessionId, 'call:ended', payload);
      } else {
        await this.broadcast.emitToUser(userId, 'call:ended', payload);
      }
    }

    return payload;
  }

  private requireCall(callId: string) {
    const call = this.registry.get(callId);
    if (!call || call.state === 'ended') {
      throw new NotFoundException('Call not found');
    }
    return call;
  }

  private assertParticipant(
    call: { callerId: string; calleeId: string },
    userId: string,
  ) {
    if (call.callerId !== userId && call.calleeId !== userId) {
      throw new ForbiddenException('Not a participant in this call');
    }
  }

  private async assertDirectPeer(conversationId: string, userId: string): Promise<string> {
    await this.conversationsService.assertMember(conversationId, userId);
    const conversationType = await this.conversationsService.getConversationType(conversationId);
    if (conversationType !== ConversationType.DIRECT) {
      throw new BadRequestException('Voice calls are only available in direct messages');
    }

    const memberIds = await this.conversationsService.getMemberUserIds(conversationId);
    const peerUserId = memberIds.find((id) => id !== userId);
    if (!peerUserId) {
      throw new BadRequestException('Direct conversation peer not found');
    }
    return peerUserId;
  }
}
