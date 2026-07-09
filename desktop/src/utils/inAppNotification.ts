export type InAppNotificationKind = 'mention' | 'new_chat' | 'added_to_conversation';

export interface InAppNotification {
  id: string;
  kind: InAppNotificationKind;
  conversationId: string;
  conversationList?: 'chats' | 'channels';
  messageId?: string;
  text: string;
}
