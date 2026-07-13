export type VoiceCallPhase =
  | 'idle'
  | 'outgoing'
  | 'incoming'
  | 'connecting'
  | 'active'
  | 'ended';

export type VoiceCallEndReason =
  | 'ended'
  | 'rejected'
  | 'cancelled'
  | 'busy'
  | 'timeout'
  | 'unavailable'
  | 'error';

export interface VoiceCallPeer {
  id: string;
  displayName: string;
  username?: string;
}

export interface VoiceCallState {
  phase: VoiceCallPhase;
  callId: string | null;
  conversationId: string | null;
  peer: VoiceCallPeer | null;
  role: 'caller' | 'callee' | null;
  muted: boolean;
  speakerOn: boolean;
  speakerSupported: boolean;
  audioOutputPickerSupported: boolean;
  error: string | null;
  endReason: VoiceCallEndReason | null;
}

export const INITIAL_VOICE_CALL_STATE: VoiceCallState = {
  phase: 'idle',
  callId: null,
  conversationId: null,
  peer: null,
  role: null,
  muted: false,
  speakerOn: false,
  speakerSupported: false,
  audioOutputPickerSupported: false,
  error: null,
  endReason: null,
};

export interface CallIncomingEvent {
  callId: string;
  conversationId: string;
  caller: VoiceCallPeer;
}

export interface CallAcceptedEvent {
  callId: string;
  conversationId: string;
  acceptedBy: string;
}

export interface CallEndedEvent {
  callId: string;
  conversationId: string;
  reason: VoiceCallEndReason;
  endedBy?: string;
}

export interface CallSignalEvent {
  callId: string;
  type: 'offer' | 'answer' | 'ice';
  payload: unknown;
  fromUserId: string;
}
