export type CallMediaType = 'audio' | 'video';

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
  mediaType: CallMediaType;
  muted: boolean;
  cameraOff: boolean;
  speakerOn: boolean;
  speakerSupported: boolean;
  audioOutputPickerSupported: boolean;
  hasLocalVideo: boolean;
  hasRemoteVideo: boolean;
  isSharingScreen: boolean;
  remoteScreenActive: boolean;
  screenShareStartedAt: number | null;
  connectionQuality: 'good' | 'fair' | 'poor' | 'unknown';
  error: string | null;
  endReason: VoiceCallEndReason | null;
}

export const INITIAL_VOICE_CALL_STATE: VoiceCallState = {
  phase: 'idle',
  callId: null,
  conversationId: null,
  peer: null,
  role: null,
  mediaType: 'audio',
  muted: false,
  cameraOff: false,
  speakerOn: false,
  speakerSupported: false,
  audioOutputPickerSupported: false,
  hasLocalVideo: false,
  hasRemoteVideo: false,
  isSharingScreen: false,
  remoteScreenActive: false,
  screenShareStartedAt: null,
  connectionQuality: 'unknown',
  error: null,
  endReason: null,
};

export interface CallIncomingEvent {
  callId: string;
  conversationId: string;
  mediaType?: CallMediaType;
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

export interface StartCallOptions {
  video?: boolean;
}
