export interface MentionInAppNotification {
  messageId: string;
  conversationId: string;
  conversationLabel: string;
  conversationList?: 'chats' | 'channels';
}
