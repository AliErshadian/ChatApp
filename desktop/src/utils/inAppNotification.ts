export type InAppNotificationKind =
  | 'mention'
  | 'new_chat'
  | 'added_to_conversation'
  | 'new_session';

export interface InAppNotification {
  id: string;
  kind: InAppNotificationKind;
  conversationId?: string;
  conversationList?: 'chats' | 'channels';
  messageId?: string;
  sessionId?: string;
  text: string;
}
