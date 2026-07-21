export type ScreenShareSource = 'screen' | 'window' | 'monitor' | 'application';

export interface ActiveScreenSession {
  sessionId: string;
  conversationId: string;
  hostUserId: string;
  kind: 'screen_share';
  presenting: boolean;
  screenSource: ScreenShareSource | null;
  participantIds: string[];
  presenterIds: string[];
  announcementMessageId: string | null;
  createdAt: number;
  lastActivityAt: number;
}

export interface ScreenParticipantInfo {
  id: string;
  displayName: string;
  username: string;
}

export interface ScreenSessionPayload {
  sessionId: string;
  conversationId: string;
  hostUserId: string;
  presenting: boolean;
  screenSource: ScreenShareSource | null;
  presenter: ScreenParticipantInfo | null;
  participants: ScreenParticipantInfo[];
  viewerCount: number;
  startedAt: string;
}

export const SCREEN_AUDIT = {
  STARTED: 'screen.started',
  ENDED: 'screen.ended',
  JOINED: 'screen.joined',
  LEFT: 'screen.left',
  PERMISSION_DENIED: 'screen.permission_denied',
  ICE_ERROR: 'screen.ice_error',
  CONNECTION_FAILURE: 'screen.connection_failure',
  DM_STARTED: 'screen.dm_started',
  DM_STOPPED: 'screen.dm_stopped',
} as const;
