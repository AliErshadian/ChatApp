import { Conversation, MessageSearchResult } from '../services/api';
import { ConversationListItem } from './ConversationListItem';
import { MessageSearchResultItem } from './MessageSearchResultItem';

interface Props {
  conversations: Conversation[];
  messageResults: MessageSearchResult[];
  messageLoading: boolean;
  messageQuery: string;
  currentUserId: string;
  activeConversationId: string | null;
  onOpenConversation: (conversationId: string) => void;
  onOpenMessage: (conversationId: string, messageId: string, conversationType: Conversation['type']) => void;
  renderConversationActions: (conversation: Conversation) => {
    deleteBusy: boolean;
    onTogglePin: () => void;
    onDeleteChat: (scope: 'me' | 'everyone') => void;
    onLeaveChannel?: (newOwnerId?: string) => void;
  };
}

export function SidebarSearchPanel({
  conversations,
  messageResults,
  messageLoading,
  messageQuery,
  currentUserId,
  activeConversationId,
  onOpenConversation,
  onOpenMessage,
  renderConversationActions,
}: Props) {
  return (
    <div className="sidebar-search-results">
      <section className="sidebar-search-section sidebar-search-section-conversations">
        <div className="conversation-list-header">
          <span>Conversations</span>
          <span className="conversation-count">{conversations.length}</span>
        </div>
        {conversations.length === 0 ? (
          <div className="sidebar-search-empty">No matching chats, groups, or channels</div>
        ) : (
          <div className="sidebar-search-conversation-list">
            {conversations.map((conversation) => {
              const actions = renderConversationActions(conversation);
              return (
                <ConversationListItem
                  key={conversation.id}
                  conversation={conversation}
                  currentUserId={currentUserId}
                  isActive={conversation.id === activeConversationId}
                  isSelected={false}
                  showUnread={false}
                  unreadCount={0}
                  deleteBusy={actions.deleteBusy}
                  onClick={() => onOpenConversation(conversation.id)}
                  onTogglePin={actions.onTogglePin}
                  onDeleteChat={actions.onDeleteChat}
                  onLeaveChannel={actions.onLeaveChannel}
                />
              );
            })}
          </div>
        )}
      </section>

      <section className="sidebar-search-section sidebar-search-section-messages">
        <div className="conversation-list-header">
          <span>Messages</span>
          <span className="conversation-count">
            {messageLoading ? '…' : messageResults.length}
          </span>
        </div>
        {messageQuery.length < 2 ? (
          <div className="sidebar-search-empty">Type at least 2 characters to search message content</div>
        ) : messageLoading ? (
          <div className="sidebar-search-empty">Searching messages...</div>
        ) : messageResults.length === 0 ? (
          <div className="sidebar-search-empty">No matching messages</div>
        ) : (
          <ul className="sidebar-message-results">
            {messageResults.map((result) => (
              <li key={result.id}>
                <MessageSearchResultItem
                  result={result}
                  onClick={() =>
                    onOpenMessage(result.conversationId, result.id, result.conversationType)
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
