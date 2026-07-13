export type CallState = 'ringing' | 'active' | 'ended';

export type CallMediaType = 'audio' | 'video';

export interface ActiveCall {
  callId: string;
  conversationId: string;
  callerId: string;
  calleeId: string;
  mediaType: CallMediaType;
  state: CallState;
  createdAt: number;
  answeredAt?: number;
  ringTimeout?: ReturnType<typeof setTimeout>;
}

export interface CallParticipantInfo {
  id: string;
  displayName: string;
  username: string;
}

export interface CallIncomingPayload {
  callId: string;
  conversationId: string;
  mediaType: CallMediaType;
  caller: CallParticipantInfo;
}

export interface CallAcceptedPayload {
  callId: string;
  conversationId: string;
  acceptedBy: string;
}

export interface CallEndedPayload {
  callId: string;
  conversationId: string;
  reason: 'ended' | 'rejected' | 'cancelled' | 'busy' | 'timeout' | 'unavailable';
  endedBy?: string;
}

export interface CallSignalPayload {
  callId: string;
  type: 'offer' | 'answer' | 'ice';
  payload: unknown;
  fromUserId: string;
}
