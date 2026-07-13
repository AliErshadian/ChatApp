import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Avatar } from './Avatar';
import { api, Conversation, Message, MessageSearchResult, MessageStatus, User, ConversationUpdatedEvent } from '../services/api';
import { realtime } from '../services/realtime';
import { useAuth } from '../context/AuthContext';
import { usePresence } from '../context/PresenceContext';
import { MessageBubble } from './MessageBubble';
import { MessageReplyQuote } from './MessageReplyQuote';
import { ProfilePanel } from './ProfilePanel';
import { ContactsPanel } from './ContactsPanel';
import { CallsPanel } from './CallsPanel';
import { ConversationInfoPanel } from './ConversationInfoPanel';
import { FileManagementPanel } from './FileManagementPanel';
import { VoiceCallModal } from './VoiceCallModal';
import { ChannelJoinBanner } from './ChannelJoinBanner';
import { mergeMessageStatus, mergeOutgoingServerMessage } from '../utils/messageStatus';
import { ConversationListItem } from './ConversationListItem';
import { NewGroupModal } from './NewGroupModal';
import { AppNav } from './AppNav';
import { ForwardDestinationModal } from './ForwardDestinationModal';
import { GlobalSearchModal } from './GlobalSearchModal';
import { SidebarSearchPanel } from './SidebarSearchPanel';
import { MentionAutocomplete } from './MentionAutocomplete';
import { InAppNotifications } from './InAppNotifications';
import { bumpConversationFromMessage, reorderConversations } from '../utils/conversationList';
import { canSendInConversation, getDirectPeer, isMultiMemberConversation, partitionChannels } from '../utils/conversation';
import { detectActiveMentionQuery, insertMention } from '../utils/mentions';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useSwipeBack } from '../hooks/useSwipeBack';
import {
  loadIgnoredContactPrompts,
  saveIgnoredContactPrompts,
} from '../utils/ignoredContactPrompts';
import { formatTypingIndicator } from '../utils/typingIndicator';
import { formatLastSeen } from '../utils/time';
import { createClientMessageId } from '../utils/uuid';
import { takePendingInviteToken } from '../utils/channelInvite';
import { ATTACHMENT_ACCEPT, getMessagePreviewText } from '../utils/messageMedia';
import { remapVoiceMessageMeta, setVoiceMessageMeta, getVoiceMessageMeta } from '../utils/voiceMessageCache';
import { normalizeVoiceMimeType } from '../utils/voiceMessage';
import type { VoiceRecordingResult } from '../hooks/useVoiceRecorder';
import { VoiceRecorderControl } from './VoiceRecorderControl';
import { isMessagesNearBottom, scrollToMessageById } from '../utils/messageScroll';
import { getConversationMentionLabel, buildMentionNotificationText, buildNewChatNotificationText, buildAddedToConversationText } from '../utils/conversationLabel';
import { isMessageInView } from '../utils/isMessageInView';
import type { InAppNotification } from '../utils/inAppNotification';
import { buildNewSessionNotificationText } from '../utils/sessionDisplay';
import { filterConversationsBySearch, isSearchQueryActive } from '../utils/search';
import { useVoiceCall } from '../hooks/useVoiceCall';

export function ChatPage() {
  const { user, logout } = useAuth();
  const { getPresence, getLastSeen, refreshPresence } = usePresence();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [replyingToMessage, setReplyingToMessage] = useState<Message | null>(null);
  const [forwardingMessage, setForwardingMessage] = useState<Message | null>(null);
  const [mentionQuery, setMentionQuery] = useState<{ start: number; query: string } | null>(null);
  const [mentionGlowIds, setMentionGlowIds] = useState<Set<string>>(new Set());
  const [composerCaret, setComposerCaret] = useState(0);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [sidebarList, setSidebarList] = useState<'chats' | 'channels'>('chats');
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [messageSearchResults, setMessageSearchResults] = useState<MessageSearchResult[]>([]);
  const [messageSearchLoading, setMessageSearchLoading] = useState(false);
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showContacts, setShowContacts] = useState(false);
  const [showCalls, setShowCalls] = useState(false);
  const [showNewChatPicker, setShowNewChatPicker] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [showConversationInfo, setShowConversationInfo] = useState(false);
  const [showFileManagement, setShowFileManagement] = useState(false);
  const [callError, setCallError] = useState('');
  const { startCall } = useVoiceCall();
  const [showNewChannel, setShowNewChannel] = useState(false);
  const [channelName, setChannelName] = useState('');
  const [firstUnreadMessageId, setFirstUnreadMessageId] = useState<string | null>(null);
  const [contactIds, setContactIds] = useState<Set<string>>(new Set());
  const [ignoredContactIds, setIgnoredContactIds] = useState<Set<string>>(() =>
    loadIgnoredContactPrompts(),
  );
  const [contactActionBusy, setContactActionBusy] = useState(false);
  const [deleteChatBusy, setDeleteChatBusy] = useState(false);
  const [sendError, setSendError] = useState('');
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [lastSeenTick, setLastSeenTick] = useState(0);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [swipeTransition, setSwipeTransition] = useState(false);
  const [pendingChannelInvite, setPendingChannelInvite] = useState<{
    token: string;
    channelName: string;
    conversationId: string;
    conversationType?: 'channel' | 'group';
  } | null>(null);
  const [inviteJoinBusy, setInviteJoinBusy] = useState(false);
  const [pendingBelowCount, setPendingBelowCount] = useState(0);
  const [inAppNotifications, setInAppNotifications] = useState<InAppNotification[]>([]);
  const pendingFirstMessageIdRef = useRef<string | null>(null);
  const activeChatMessageIdsRef = useRef<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const composerInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const chatMainRef = useRef<HTMLElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const scrollIntentRef = useRef<{ kind: 'unread' | 'bottom' | 'mention'; messageId?: string } | null>(null);
  const shouldScrollToBottomRef = useRef(false);
  const lastReadAtOnOpenRef = useRef<string | undefined>();
  const activeIdRef = useRef<string | null>(null);
  const userIdRef = useRef<string | undefined>(undefined);
  const pendingStatusRef = useRef<Map<string, MessageStatus>>(new Map());
  const inAppNotificationTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const selfInitiatedConversationIdsRef = useRef<Set<string>>(new Set());
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const isPanelOpenRef = useRef(false);
  activeIdRef.current = activeId;
  userIdRef.current = user?.id;
  isPanelOpenRef.current = isPanelOpen;

  const activeConversation = conversations.find((c) => c.id === activeId);
  const activePeer =
    activeConversation && user ? getDirectPeer(activeConversation, user.id) : undefined;
  const canSendInActiveChat = useMemo(() => {
    if (!activeConversation || !user) return true;
    return canSendInConversation(activeConversation, user.id);
  }, [activeConversation, user]);

  const handleStartVoiceCall = useCallback(async () => {
    if (!activeConversation || !activePeer) return;
    setCallError('');
    try {
      await startCall(activeConversation.id, {
        id: activePeer.userId,
        displayName: activePeer.displayName ?? activeConversation.name,
        username: activePeer.username,
      });
    } catch (err) {
      setCallError(err instanceof Error ? err.message : 'Failed to start call');
    }
  }, [activeConversation, activePeer, startCall]);

  const isMobile = useMediaQuery('(max-width: 768px)');
  const isPanelVisible =
    isPanelOpen &&
    (activeConversation || showProfile || showContacts || showCalls || showNewChatPicker || pendingChannelInvite);

  const typingIndicatorText = useMemo(() => {
    if (!activeConversation || typingUsers.size === 0) return null;
    return formatTypingIndicator([...typingUsers], activeConversation.members);
  }, [activeConversation, typingUsers]);

  const presenceUserIds = useMemo(() => {
    if (!user) return [];
    const ids = new Set<string>();
    for (const conversation of conversations) {
      if (conversation.type === 'direct') {
        const peer = getDirectPeer(conversation, user.id);
        if (peer) ids.add(peer.userId);
      }
    }
    return [...ids];
  }, [conversations, user]);

  useEffect(() => {
    refreshPresence(presenceUserIds);
  }, [presenceUserIds, refreshPresence]);

  useEffect(() => {
    if (!activePeer || activeConversation?.type !== 'direct') return;
    if (getPresence(activePeer.userId) === 'online') return;

    const interval = window.setInterval(() => {
      setLastSeenTick((tick) => tick + 1);
    }, 30_000);

    return () => window.clearInterval(interval);
  }, [activePeer, activeConversation?.type, getPresence]);

  const directChatSubtitle = useMemo(() => {
    if (!activePeer || activeConversation?.type !== 'direct') return null;
    if (getPresence(activePeer.userId) === 'online') return 'Online';
    return formatLastSeen(getLastSeen(activePeer.userId));
  }, [activePeer, activeConversation?.type, getPresence, getLastSeen, lastSeenTick]);

  const refreshContacts = useCallback(async () => {
    try {
      const contacts = await api.listContacts();
      setContactIds(new Set(contacts.map((c) => c.id)));
    } catch {
      // Keep existing contact list on failure.
    }
  }, []);

  const applyMessageUpdate = useCallback((updated: Message) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id === updated.id) {
          return { ...m, ...updated, status: m.status ?? updated.status };
        }
        if (updated.deletedForEveryone && m.replyTo?.id === updated.id) {
          return {
            ...m,
            replyTo: {
              ...m.replyTo,
              content: '',
              deletedForEveryone: true,
            },
          };
        }
        return m;
      }),
    );

    setConversations((prev) =>
      reorderConversations(
        prev.map((c) => {
          if (c.id !== updated.conversationId || c.lastMessage?.id !== updated.id) return c;
          return {
            ...c,
            lastMessage: {
              id: updated.id,
              content: updated.deletedForEveryone ? '' : updated.content,
              senderId: updated.senderId,
              senderName: updated.sender?.displayName ?? c.lastMessage?.senderName,
              createdAt: updated.createdAt,
              deletedForEveryone: updated.deletedForEveryone,
            },
          };
        }),
      ),
    );
  }, []);

  const handleEditMessage = useCallback(async (messageId: string, content: string) => {
    if (!activeIdRef.current) return;
    try {
      const updated = await realtime.editMessage(messageId, content);
      applyMessageUpdate(updated);
    } catch {
      const updated = await api.editMessage(activeIdRef.current, messageId, content);
      applyMessageUpdate(updated);
    }
  }, [applyMessageUpdate]);

  const dismissInAppNotification = useCallback((id: string) => {
    setInAppNotifications((prev) => prev.filter((item) => item.id !== id));
    const timer = inAppNotificationTimersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      inAppNotificationTimersRef.current.delete(id);
    }
  }, []);

  const addInAppNotification = useCallback(
    (item: InAppNotification) => {
      setInAppNotifications((prev) => {
        if (prev.some((entry) => entry.id === item.id)) return prev;
        const next = [...prev, item];
        return next.length > 5 ? next.slice(-5) : next;
      });

      if (inAppNotificationTimersRef.current.has(item.id)) return;
      const timer = setTimeout(() => {
        dismissInAppNotification(item.id);
      }, 8000);
      inAppNotificationTimersRef.current.set(item.id, timer);
    },
    [dismissInAppNotification],
  );

  const dismissMentionGlow = useCallback((messageId: string) => {
    setMentionGlowIds((prev) => {
      if (!prev.has(messageId)) return prev;
      const next = new Set(prev);
      next.delete(messageId);
      return next;
    });
    dismissInAppNotification(`mention:${messageId}`);
  }, [dismissInAppNotification]);

  const maybeShowMentionInAppNotification = useCallback(
    (msg: Message, isActive: boolean, nearBottom: boolean) => {
      if (msg.senderId === userIdRef.current) return;
      if (document.hidden) return;

      const mentionedMe = msg.mentions?.some((mention) => mention.userId === userIdRef.current);
      if (!mentionedMe) return;
      if (isActive && nearBottom) return;
      if (isActive && isMessageInView(msg.id, messagesScrollRef.current)) return;

      const conversation = conversationsRef.current.find((c) => c.id === msg.conversationId);
      const conversationLabel = getConversationMentionLabel(conversation, userIdRef.current);
      addInAppNotification({
        id: `mention:${msg.id}`,
        kind: 'mention',
        messageId: msg.id,
        conversationId: msg.conversationId,
        conversationList: conversation?.type === 'channel' ? 'channels' : 'chats',
        text: buildMentionNotificationText(conversationLabel),
      });
    },
    [addInAppNotification],
  );

  const maybeShowNewChatInAppNotification = useCallback(
    (msg: Message, isActive: boolean) => {
      if (msg.senderId === userIdRef.current) return;
      if (document.hidden) return;
      if (isActive) return;
      if (conversationsRef.current.some((c) => c.id === msg.conversationId)) return;

      const senderName = msg.sender?.displayName ?? msg.sender?.username ?? 'Someone';
      addInAppNotification({
        id: `conv:${msg.conversationId}`,
        kind: 'new_chat',
        conversationId: msg.conversationId,
        conversationList: 'chats',
        text: buildNewChatNotificationText(senderName),
      });
    },
    [addInAppNotification],
  );

  const maybeShowConversationInAppNotification = useCallback(
    (conversation: Conversation) => {
      if (document.hidden) return;

      const isActive =
        conversation.id === activeIdRef.current && isPanelOpenRef.current;
      if (isActive) return;
      if (conversationsRef.current.some((c) => c.id === conversation.id)) return;
      if (selfInitiatedConversationIdsRef.current.has(conversation.id)) {
        selfInitiatedConversationIdsRef.current.delete(conversation.id);
        return;
      }

      const membership = conversation.members.find((m) => m.userId === userIdRef.current);
      if (!membership) return;
      if (conversation.type !== 'direct' && membership.role === 'owner') return;

      if (conversation.type === 'direct') {
        addInAppNotification({
          id: `conv:${conversation.id}`,
          kind: 'new_chat',
          conversationId: conversation.id,
          conversationList: 'chats',
          text: buildNewChatNotificationText(conversation.name),
        });
        return;
      }

      addInAppNotification({
        id: `conv:${conversation.id}`,
        kind: 'added_to_conversation',
        conversationId: conversation.id,
        conversationList: conversation.type === 'channel' ? 'channels' : 'chats',
        text: buildAddedToConversationText(conversation),
      });
    },
    [addInAppNotification],
  );

  const maybeShowNewSessionInAppNotification = useCallback(
    (data: {
      sessionId: string;
      deviceLabel: string;
      ipAddress: string | null;
    }) => {
      if (document.hidden) return;
      if (data.sessionId === api.getSessionId()) return;

      addInAppNotification({
        id: `session:${data.sessionId}`,
        kind: 'new_session',
        sessionId: data.sessionId,
        text: buildNewSessionNotificationText(data.deviceLabel, data.ipAddress),
      });
    },
    [addInAppNotification],
  );

  const clearPendingBelow = useCallback(() => {
    setPendingBelowCount(0);
    pendingFirstMessageIdRef.current = null;
  }, []);

  const trackPendingBelow = useCallback((messageId: string) => {
    if (!pendingFirstMessageIdRef.current) {
      pendingFirstMessageIdRef.current = messageId;
    }
    setPendingBelowCount((count) => count + 1);
  }, []);

  const scrollToPendingBelow = useCallback(() => {
    const messageId = pendingFirstMessageIdRef.current;
    if (messageId) {
      document
        .getElementById(`msg-${messageId}`)
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    clearPendingBelow();
  }, [clearPendingBelow]);

  const cancelEditMessage = useCallback(() => {
    setEditingMessageId(null);
    setInput('');
    setSendError('');
  }, []);

  const cancelReplyMessage = useCallback(() => {
    setReplyingToMessage(null);
    setSendError('');
  }, []);

  const scrollToMessage = useCallback((messageId: string) => {
    scrollToMessageById(messageId, { block: 'center', behavior: 'smooth' });
  }, []);

  const loadMessagesUntilTarget = useCallback(
    async (
      conversationId: string,
      targetMessageId?: string,
      initialPage?: Awaited<ReturnType<typeof api.getMessages>>,
    ) => {
      const firstPage = initialPage ?? (await api.getMessages(conversationId));
      let loadedMessages = firstPage.messages;
      let cursor = firstPage.nextCursor ?? undefined;

      if (targetMessageId && !loadedMessages.some((m) => m.id === targetMessageId) && cursor) {
        for (let page = 0; page < 20 && cursor; page += 1) {
          const res = await api.getMessages(conversationId, cursor);
          loadedMessages = [...res.messages, ...loadedMessages];
          if (res.messages.some((m) => m.id === targetMessageId)) break;
          cursor = res.nextCursor ?? undefined;
        }
      }

      return loadedMessages;
    },
    [],
  );

  const startEditMessage = useCallback((messageId: string, content: string) => {
    cancelReplyMessage();
    setEditingMessageId(messageId);
    setInput(content);
    setSendError('');
    window.requestAnimationFrame(() => {
      composerInputRef.current?.focus();
      scrollToMessage(messageId);
    });
  }, [cancelReplyMessage, scrollToMessage]);

  const startReplyMessage = useCallback((message: Message) => {
    cancelEditMessage();
    setReplyingToMessage(message);
    setSendError('');
    window.requestAnimationFrame(() => {
      composerInputRef.current?.focus();
      scrollToMessage(message.id);
    });
  }, [cancelEditMessage, scrollToMessage]);

  const startForwardMessage = useCallback((message: Message) => {
    setForwardingMessage(message);
  }, []);

  const handleForwardMessage = useCallback(
    async (targetConversationIds: string[]) => {
      if (!forwardingMessage || !activeId) return;

      const { messages: forwarded } = await api.forwardMessage(
        activeId,
        forwardingMessage.id,
        targetConversationIds,
      );

      setForwardingMessage(null);
      setConversations((prev) => {
        const next = [...prev];
        for (const msg of forwarded) {
          const index = next.findIndex((c) => c.id === msg.conversationId);
          if (index >= 0) {
            next[index] = bumpConversationFromMessage(next[index], msg);
          }
        }
        return reorderConversations(next);
      });

      const active = activeIdRef.current;
      const forActive = forwarded.filter((msg) => msg.conversationId === active);
      if (forActive.length > 0 && isPanelOpenRef.current) {
        setMessages((prev) => {
          const existing = new Set(prev.map((m) => m.id));
          const toAdd = forActive.filter((m) => !existing.has(m.id));
          return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
        });
      }
    },
    [activeId, forwardingMessage],
  );

  const handleSaveEdit = useCallback(async () => {
    if (!editingMessageId) return;
    const content = input.trim();
    const original = messages.find((m) => m.id === editingMessageId);
    if (!content || !original) {
      cancelEditMessage();
      return;
    }
    if (content === original.content) {
      cancelEditMessage();
      return;
    }

    setEditBusy(true);
    setSendError('');
    try {
      await handleEditMessage(editingMessageId, content);
      cancelEditMessage();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to edit message');
    } finally {
      setEditBusy(false);
    }
  }, [editingMessageId, input, messages, cancelEditMessage, handleEditMessage]);

  const handleDeleteMessage = useCallback(async (messageId: string, scope: 'me' | 'everyone') => {
    if (!activeIdRef.current) return;
    const applyDelete = (result: { message?: Message; messageId: string; scope: 'me' | 'everyone' }) => {
      if (result.scope === 'me') {
        setMessages((prev) => prev.filter((m) => m.id !== result.messageId));
        return;
      }
      if (result.message) applyMessageUpdate(result.message);
    };

    try {
      applyDelete(await realtime.deleteMessage(messageId, scope));
    } catch {
      applyDelete(await api.deleteMessage(activeIdRef.current, messageId, scope));
    }
  }, [applyMessageUpdate]);

  const applyReactionUpdate = useCallback((update: {
    messageId: string;
    reactions: Message['reactions'];
  }) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === update.messageId ? { ...m, reactions: update.reactions } : m,
      ),
    );
  }, []);

  const handleReactionMessage = useCallback(async (messageId: string, emoji: string) => {
    if (!activeIdRef.current) return;
    const apply = (result: { messageId: string; reactions: Message['reactions'] }) => {
      applyReactionUpdate(result);
    };
    try {
      apply(await realtime.toggleReaction(messageId, emoji));
    } catch {
      apply(await api.toggleReaction(activeIdRef.current, messageId, emoji));
    }
  }, [applyReactionUpdate]);

  const applyConversationHidden = useCallback((conversationId: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== conversationId));
    if (activeIdRef.current === conversationId) {
      setActiveId(null);
      setIsPanelOpen(false);
      setMessages([]);
      setShowConversationInfo(false);
      setShowFileManagement(false);
      setTypingUsers(new Set());
    }
  }, []);

  const applyConversationUpdate = useCallback((update: ConversationUpdatedEvent) => {
    setConversations((prev) =>
      prev.map((c) => {
        if (
          c.id !== update.conversationId ||
          (c.type !== 'channel' && c.type !== 'group')
        ) {
          return c;
        }

        const mergedMembers = update.members.map((member) => {
          const existing = c.members.find((m) => m.userId === member.userId);
          return {
            ...member,
            lastReadAt: existing?.lastReadAt,
          };
        });

        return {
          ...c,
          name: update.name ?? c.name,
          description: update.description ?? c.description,
          avatarUrl: update.avatarUrl ?? c.avatarUrl,
          isPublic: update.isPublic ?? c.isPublic,
          members: mergedMembers,
        };
      }),
    );
  }, []);

  const applyConversationCreated = useCallback((conversation: Conversation) => {
    setConversations((prev) => {
      if (prev.some((c) => c.id === conversation.id)) {
        return reorderConversations(
          prev.map((c) => (c.id === conversation.id ? { ...c, ...conversation } : c)),
        );
      }
      return reorderConversations([conversation, ...prev]);
    });
  }, []);

  const applyConversationMessagesDeleted = useCallback(
    (update: { conversationId: string; messageIds: string[] }) => {
      const idSet = new Set(update.messageIds);
      setMessages((prev) =>
        prev.map((m) => {
          if (idSet.has(m.id)) {
            return { ...m, content: '', deletedForEveryone: true };
          }
          if (m.replyTo && idSet.has(m.replyTo.id)) {
            return {
              ...m,
              replyTo: {
                ...m.replyTo,
                content: '',
                deletedForEveryone: true,
              },
            };
          }
          return m;
        }),
      );
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== update.conversationId || !c.lastMessage || !idSet.has(c.lastMessage.id)) {
            return c;
          }
          return {
            ...c,
            lastMessage: {
              ...c.lastMessage,
              content: '',
              deletedForEveryone: true,
            },
          };
        }),
      );
    },
    [],
  );

  const applyStatusUpdate = useCallback((messageId: string, status: MessageStatus) => {
    setMessages((prev) => {
      const index = prev.findIndex((m) => m.id === messageId);
      if (index === -1) {
        pendingStatusRef.current.set(messageId, mergeMessageStatus(
          pendingStatusRef.current.get(messageId),
          status,
        ));
        return prev;
      }
      const next = [...prev];
      next[index] = {
        ...next[index],
        status: mergeMessageStatus(next[index].status, status),
      };
      return next;
    });
  }, []);

  const confirmOutgoing = useCallback((serverMsg: Message, clientMessageId?: string) => {
    const pending = pendingStatusRef.current.get(serverMsg.id);
    if (pending) pendingStatusRef.current.delete(serverMsg.id);
    activeChatMessageIdsRef.current.add(serverMsg.id);

    setMessages((prev) => {
      const idx = prev.findIndex(
        (m) =>
          (clientMessageId && m.clientMessageId === clientMessageId) ||
          m.id === serverMsg.id ||
          (serverMsg.clientMessageId && m.clientMessageId === serverMsg.clientMessageId),
      );

      if (idx === -1) {
        if (serverMsg.conversationId !== activeIdRef.current) return prev;
        return [...prev, { ...serverMsg, status: mergeMessageStatus('sent', pending) }];
      }

      const next = [...prev];
      next[idx] = mergeOutgoingServerMessage(next[idx], serverMsg, pending);
      return next;
    });
  }, []);

  const loadConversations = useCallback(async () => {
    const list = await api.listConversations();
    setConversations(reorderConversations(list));
  }, []);


  const loadConversationsRef = useRef(loadConversations);
  loadConversationsRef.current = loadConversations;

  const openConversation = useCallback((
    id: string,
    preferredList?: 'chats' | 'channels',
    options?: { mentionMessageId?: string },
  ) => {
    setShowProfile(false);
    setShowContacts(false);
    setShowNewChatPicker(false);
    setShowConversationInfo(false);
    setShowFileManagement(false);

    const conv = conversationsRef.current.find((c) => c.id === id);
    const list =
      preferredList ??
      (conv?.type === 'channel' ? 'channels' : 'chats');
    if (list) setSidebarList(list);

    setConversations((prev) => {
      const current = prev.find((c) => c.id === id);
      const membership = current?.members.find((m) => m.userId === userIdRef.current);
      lastReadAtOnOpenRef.current = membership?.lastReadAt;
      return prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c));
    });
    setActiveId(id);
    setIsPanelOpen(true);
    setMentionQuery(null);
    if (options?.mentionMessageId) {
      scrollIntentRef.current = { kind: 'mention', messageId: options.mentionMessageId };
      setMentionGlowIds(new Set([options.mentionMessageId]));
    } else {
      setMentionGlowIds(new Set());
    }
  }, []);

  const goToInAppNotification = useCallback(
    (item: InAppNotification) => {
      dismissInAppNotification(item.id);

      if (item.kind === 'new_session') {
        setShowProfile(true);
        setShowContacts(false);
        setShowNewChatPicker(false);
        setShowConversationInfo(false);
        setShowFileManagement(false);
        setPendingChannelInvite(null);
        setIsPanelOpen(true);
        return;
      }

      const isActive =
        item.conversationId === activeIdRef.current && isPanelOpenRef.current;
      if (item.kind === 'mention' && item.messageId && item.conversationId) {
        if (isActive) {
          setMentionGlowIds((prev) => new Set(prev).add(item.messageId!));
          scrollToMessage(item.messageId);
          return;
        }

        openConversation(item.conversationId, item.conversationList, {
          mentionMessageId: item.messageId,
        });
        return;
      }

      if (isActive || !item.conversationId) return;
      openConversation(item.conversationId, item.conversationList);
    },
    [dismissInAppNotification, openConversation, scrollToMessage],
  );

  const handleInviteToken = useCallback(
    async (token: string) => {
      try {
        const status = await api.getInviteStatus(token);
        setShowProfile(false);
        setShowContacts(false);
        setShowNewChatPicker(false);
        setShowConversationInfo(false);
        setShowFileManagement(false);

        if (status.isMember) {
          const visible = conversations.find((c) => c.id === status.conversationId);
          const inviteList = status.conversationType === 'group' ? 'chats' : 'channels';
          if (visible) {
            setPendingChannelInvite(null);
            openConversation(visible.id, inviteList);
            return;
          }

          selfInitiatedConversationIdsRef.current.add(status.conversationId);
          const conversation = await api.joinChannelByInvite(token);
          setConversations((prev) => {
            const exists = prev.some((c) => c.id === conversation.id);
            const next = exists
              ? prev.map((c) => (c.id === conversation.id ? { ...c, ...conversation } : c))
              : [conversation, ...prev];
            return reorderConversations(next);
          });
          setPendingChannelInvite(null);
          openConversation(conversation.id, inviteList);
          return;
        }

        const inviteList = status.conversationType === 'group' ? 'chats' : 'channels';
        setSidebarList(inviteList);
        setPendingChannelInvite({
          token,
          channelName: status.channelName,
          conversationId: status.conversationId,
          conversationType: status.conversationType,
        });
        setActiveId(null);
        setIsPanelOpen(true);
      } catch {
        // Ignore invalid or expired invites.
      }
    },
    [conversations, openConversation],
  );

  const dismissChannelInvite = useCallback(() => {
    setPendingChannelInvite(null);
    if (isMobile && !activeIdRef.current) {
      setIsPanelOpen(false);
    }
  }, [isMobile]);

  const confirmChannelInvite = useCallback(async () => {
    if (!pendingChannelInvite) return;
    setInviteJoinBusy(true);
    try {
      selfInitiatedConversationIdsRef.current.add(pendingChannelInvite.conversationId);
      const conversation = await api.joinChannelByInvite(pendingChannelInvite.token);
      setConversations((prev) => {
        const exists = prev.some((c) => c.id === conversation.id);
        const next = exists
          ? prev.map((c) => (c.id === conversation.id ? { ...c, ...conversation } : c))
          : [conversation, ...prev];
        return reorderConversations(next);
      });
      setPendingChannelInvite(null);
      const inviteList =
        conversation.type === 'group' || pendingChannelInvite.conversationType === 'group'
          ? 'chats'
          : 'channels';
      openConversation(conversation.id, inviteList);
    } catch {
      // Keep the prompt open on failure.
    } finally {
      setInviteJoinBusy(false);
    }
  }, [pendingChannelInvite, openConversation]);

  const openProfile = useCallback(() => {
    setShowProfile(true);
    setShowContacts(false);
    setShowCalls(false);
    setShowNewChatPicker(false);
    setPendingChannelInvite(null);
    setIsPanelOpen(true);
  }, []);

  const openContacts = useCallback(() => {
    setShowContacts(true);
    setShowProfile(false);
    setShowCalls(false);
    setShowNewChatPicker(false);
    setPendingChannelInvite(null);
    setIsPanelOpen(true);
  }, []);

  const openCalls = useCallback(() => {
    setShowCalls(true);
    setShowProfile(false);
    setShowContacts(false);
    setShowNewChatPicker(false);
    setPendingChannelInvite(null);
    setIsPanelOpen(true);
  }, []);

  const openNewChatPicker = useCallback(() => {
    setShowProfile(false);
    setShowContacts(false);
    setShowCalls(false);
    setShowNewChatPicker(true);
    setShowConversationInfo(false);
    setShowFileManagement(false);
    setIsPanelOpen(true);
  }, []);

  const closeNewChatPicker = useCallback(() => {
    setShowNewChatPicker(false);
    if (isMobile && !activeIdRef.current) {
      setIsPanelOpen(false);
    }
  }, [isMobile]);

  const switchSidebarList = useCallback(
    (list: 'chats' | 'channels') => {
      setSidebarList(list);
      setShowProfile(false);
      setShowContacts(false);
      setShowCalls(false);
      setShowNewChatPicker(false);
      setShowConversationInfo(false);
      setShowFileManagement(false);
      setPendingChannelInvite(null);

      const activeConv = conversations.find((c) => c.id === activeIdRef.current);
      const mismatched =
        activeConv &&
        ((list === 'chats' && activeConv.type === 'channel') ||
          (list === 'channels' && activeConv.type === 'direct'));

      if (mismatched) {
        setActiveId(null);
        setIsPanelOpen(false);
        return;
      }

      if (isMobile || !activeIdRef.current) {
        setIsPanelOpen(false);
      }
    },
    [isMobile, conversations],
  );

  const openChats = useCallback(() => switchSidebarList('chats'), [switchSidebarList]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setShowGlobalSearch(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const openChannels = useCallback(() => switchSidebarList('channels'), [switchSidebarList]);

  const closeChatPanel = useCallback(() => {
    setIsPanelOpen(false);
    setShowProfile(false);
    setShowContacts(false);
    setShowCalls(false);
    setShowNewChatPicker(false);
    setPendingChannelInvite(null);
    setShowConversationInfo(false);
    setShowFileManagement(false);
    setTypingUsers(new Set());
  }, []);

  const handleSwipeBack = useCallback(() => {
    if (showFileManagement) {
      setShowFileManagement(false);
      return;
    }
    if (showConversationInfo) {
      setShowConversationInfo(false);
      return;
    }
    if (pendingChannelInvite) {
      dismissChannelInvite();
      return;
    }
    closeChatPanel();
  }, [showFileManagement, showConversationInfo, pendingChannelInvite, dismissChannelInvite, closeChatPanel]);

  const handleSwipeRelease = useCallback(
    (offset: number, width: number) => {
      const shouldClose = offset > width * 0.33;
      setSwipeTransition(true);
      setSwipeOffset(shouldClose ? width : 0);

      window.setTimeout(
        () => {
          setSwipeTransition(false);
          if (shouldClose) {
            handleSwipeBack();
          }
          setSwipeOffset(0);
        },
        shouldClose ? 220 : 180,
      );
    },
    [handleSwipeBack],
  );

  useSwipeBack(chatMainRef, {
    enabled: isMobile && isPanelOpen && !showConversationInfo && !showFileManagement && !pendingChannelInvite,
    onOffset: setSwipeOffset,
    onRelease: handleSwipeRelease,
  });

  useEffect(() => {
    if (!isPanelOpen) {
      setSwipeOffset(0);
      setSwipeTransition(false);
    }
  }, [isPanelOpen]);

  useEffect(() => {
    loadConversations();
    refreshContacts();
  }, [loadConversations, refreshContacts]);

  useEffect(() => {
    if (!user) return;

    const token = takePendingInviteToken();
    if (token) void handleInviteToken(token);

    const onInvite = (event: Event) => {
      const detail = (event as CustomEvent<{ token: string }>).detail;
      if (detail?.token) void handleInviteToken(detail.token);
    };

    window.addEventListener('chatapp:invite', onInvite);
    return () => window.removeEventListener('chatapp:invite', onInvite);
  }, [user, handleInviteToken]);

  useEffect(() => {
    if (!isPanelOpen || showProfile || showContacts || !activeId) return;
    refreshContacts();
  }, [activeId, isPanelOpen, showProfile, showContacts, refreshContacts]);

  const acknowledgeIncoming = useCallback((msg: Message, isActiveConversation: boolean) => {
    if (msg.senderId === userIdRef.current) return;
    realtime.markDelivered(msg.id);
    if (isActiveConversation) {
      realtime.markRead(msg.id);
    }
  }, []);

  useEffect(() => {
    if (!activeId || !isPanelOpen) {
      if (activeId) realtime.leaveConversation(activeId);
      return;
    }
    realtime.joinConversation(activeId);
    const lastReadAt = lastReadAtOnOpenRef.current;
    setMessages([]);
    setFirstUnreadMessageId(null);
    activeChatMessageIdsRef.current = new Set();
    clearPendingBelow();
    setEditingMessageId(null);
    setReplyingToMessage(null);
    setInput('');

    api.getMessages(activeId).then(async (firstPage) => {
      const mentionTarget =
        scrollIntentRef.current?.kind === 'mention'
          ? scrollIntentRef.current.messageId
          : undefined;

      let loadedMessages = firstPage.messages;
      if (
        mentionTarget &&
        !loadedMessages.some((m) => m.id === mentionTarget) &&
        firstPage.nextCursor
      ) {
        loadedMessages = await loadMessagesUntilTarget(activeId, mentionTarget, firstPage);
      }

      const firstUnread = mentionTarget
        ? undefined
        : loadedMessages.find(
            (m) =>
              m.senderId !== userIdRef.current &&
              (!lastReadAt || new Date(m.createdAt) > new Date(lastReadAt)),
          );

      if (mentionTarget) {
        scrollIntentRef.current = loadedMessages.some((m) => m.id === mentionTarget)
          ? { kind: 'mention', messageId: mentionTarget }
          : { kind: 'bottom' };
      } else {
        scrollIntentRef.current = firstUnread
          ? { kind: 'unread', messageId: firstUnread.id }
          : { kind: 'bottom' };
      }

      setFirstUnreadMessageId(firstUnread?.id ?? null);
      setMessages(loadedMessages);
      activeChatMessageIdsRef.current = new Set(loadedMessages.map((message) => message.id));

      requestAnimationFrame(() => {
        loadedMessages.forEach((msg) => {
          if (msg.senderId !== userIdRef.current) {
            realtime.markDelivered(msg.id);
            realtime.markRead(msg.id);
          }
        });
      });
    });
    return () => realtime.leaveConversation(activeId);
  }, [activeId, isPanelOpen, clearPendingBelow, loadMessagesUntilTarget]);

  useEffect(() => {
    const container = messagesScrollRef.current;
    if (!container || !activeId) return;

    const handleScroll = () => {
      if (isMessagesNearBottom(container)) {
        clearPendingBelow();
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [activeId, clearPendingBelow]);

  // Realtime listeners — mount once, use refs to avoid stale closures
  useEffect(() => {
    const unsubMsg = realtime.onMessage((msg) => {
      const isActive =
        msg.conversationId === activeIdRef.current && isPanelOpenRef.current;
      let nearBottom = isMessagesNearBottom(messagesScrollRef.current);

      if (msg.senderId === userIdRef.current && msg.clientMessageId) {
        confirmOutgoing(msg, msg.clientMessageId);
      } else if (isActive) {
        if (activeChatMessageIdsRef.current.has(msg.id)) {
          return;
        }
        activeChatMessageIdsRef.current.add(msg.id);

        nearBottom = isMessagesNearBottom(messagesScrollRef.current);
        if (nearBottom) {
          shouldScrollToBottomRef.current = true;
          clearPendingBelow();
          setFirstUnreadMessageId(null);
        } else if (msg.senderId !== userIdRef.current) {
          trackPendingBelow(msg.id);
        }

        setMessages((prev) => [...prev, msg]);

        const mentionedMe = msg.mentions?.some((mention) => mention.userId === userIdRef.current);
        if (mentionedMe && msg.senderId !== userIdRef.current) {
          setMentionGlowIds((prev) => new Set(prev).add(msg.id));
        }
      }

      acknowledgeIncoming(msg, isActive);
      setConversations((prev) => {
        if (!prev.some((c) => c.id === msg.conversationId)) {
          void loadConversationsRef.current();
          return prev;
        }

        const isActiveConv =
          msg.conversationId === activeIdRef.current && isPanelOpenRef.current;
        const isIncoming = msg.senderId !== userIdRef.current;

        return reorderConversations(
          prev.map((c) => {
            if (c.id !== msg.conversationId) return c;
            const bumped = bumpConversationFromMessage(c, msg);
            if (isIncoming && !isActiveConv) {
              return { ...bumped, unreadCount: (c.unreadCount ?? 0) + 1 };
            }
            return bumped;
          }),
        );
      });
      maybeShowMentionInAppNotification(msg, isActive, nearBottom);
      maybeShowNewChatInAppNotification(msg, isActive);
      if (msg.senderId !== userIdRef.current && document.hidden) {
        const mentionedMe = msg.mentions?.some((mention) => mention.userId === userIdRef.current);
        const isActive =
          msg.conversationId === activeIdRef.current && isPanelOpenRef.current;

        if (mentionedMe && !isActive) {
          window.electronAPI?.notify(
            `${msg.sender?.displayName ?? 'Someone'} mentioned you`,
            getMessagePreviewText(msg).slice(0, 100),
          );
        } else if (!mentionedMe) {
          window.electronAPI?.notify(
            msg.sender?.displayName ?? 'New message',
            getMessagePreviewText(msg).slice(0, 100),
          );
        }
      }
    });

    const unsubAck = realtime.onAck((data) => {
      if (data.message) {
        confirmOutgoing(data.message, data.clientMessageId);
        setConversations((prev) =>
          reorderConversations(
            prev.map((c) =>
              c.id === data.message!.conversationId
                ? bumpConversationFromMessage(c, data.message!)
                : c,
            ),
          ),
        );
      }
    });

    const unsubStatus = realtime.onStatus((update) => {
      if (!isPanelOpenRef.current || update.conversationId !== activeIdRef.current) return;
      applyStatusUpdate(update.messageId, update.status);
    });

    const unsubTyping = realtime.onTyping((data) => {
      if (!isPanelOpenRef.current || data.conversationId !== activeIdRef.current || data.userId === userIdRef.current) return;
      setTypingUsers((prev) => {
        const next = new Set(prev);
        if (data.isTyping) next.add(data.userId);
        else next.delete(data.userId);
        return next;
      });
    });

    const unsubUpdated = realtime.onMessageUpdated((message) => {
      applyMessageUpdate(message);
    });

    const unsubHidden = realtime.onMessageHidden(({ messageId }) => {
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
    });

    const unsubReaction = realtime.onReaction((update) => {
      if (!isPanelOpenRef.current || update.conversationId !== activeIdRef.current) return;
      applyReactionUpdate(update);
    });

    const unsubConvHidden = realtime.onConversationHidden(({ conversationId }) => {
      applyConversationHidden(conversationId);
    });

    const unsubConvDeleted = realtime.onConversationMessagesDeleted((update) => {
      applyConversationMessagesDeleted(update);
    });

    const unsubConvUpdated = realtime.onConversationUpdated((update) => {
      applyConversationUpdate(update);
    });

    const unsubConvCreated = realtime.onConversationCreated((conversation) => {
      maybeShowConversationInAppNotification(conversation);
      applyConversationCreated(conversation);
    });

    return () => {
      unsubMsg();
      unsubAck();
      unsubStatus();
      unsubTyping();
      unsubUpdated();
      unsubHidden();
      unsubReaction();
      unsubConvHidden();
      unsubConvDeleted();
      unsubConvUpdated();
      unsubConvCreated();
    };
  }, [
    acknowledgeIncoming,
    applyConversationCreated,
    applyConversationHidden,
    applyConversationMessagesDeleted,
    applyConversationUpdate,
    applyMessageUpdate,
    applyReactionUpdate,
    applyStatusUpdate,
    confirmOutgoing,
    clearPendingBelow,
    trackPendingBelow,
    maybeShowMentionInAppNotification,
    maybeShowNewChatInAppNotification,
    maybeShowConversationInAppNotification,
  ]);

  useEffect(() => {
    return realtime.onSessionCreated(maybeShowNewSessionInAppNotification);
  }, [maybeShowNewSessionInAppNotification]);

  useEffect(() => {
    return () => {
      for (const timer of inAppNotificationTimersRef.current.values()) {
        clearTimeout(timer);
      }
      inAppNotificationTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const intent = scrollIntentRef.current;
    if (intent) {
      if (intent.kind === 'unread' && intent.messageId) {
        const messageId = intent.messageId;
        scrollToMessageById(messageId, {
          block: 'start',
          behavior: 'auto',
          onComplete: (scrolled) => {
            if (scrolled) scrollIntentRef.current = null;
          },
        });
      } else if (intent.kind === 'mention' && intent.messageId) {
        const messageId = intent.messageId;
        scrollToMessageById(messageId, {
          block: 'center',
          behavior: 'smooth',
          onComplete: (scrolled) => {
            if (scrolled) scrollIntentRef.current = null;
          },
        });
      } else if (intent.kind === 'bottom') {
        scrollIntentRef.current = null;
        requestAnimationFrame(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
        });
      }
      return;
    }

    if (shouldScrollToBottomRef.current) {
      shouldScrollToBottomRef.current = false;
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || !activeId || !canSendInActiveChat) return;
    const content = input.trim();
    const clientMessageId = createClientMessageId();
    const replyTarget = replyingToMessage;
    const replyPreview = replyTarget
      ? {
          id: replyTarget.id,
          senderId: replyTarget.senderId,
          content: replyTarget.deletedForEveryone ? '' : replyTarget.content,
          contentType: replyTarget.contentType,
          fileName: replyTarget.fileName,
          caption: replyTarget.caption,
          deletedForEveryone: replyTarget.deletedForEveryone,
          sender: replyTarget.sender,
        }
      : undefined;

    setInput('');
    setReplyingToMessage(null);
    setSendError('');

    const optimistic: Message = {
      id: clientMessageId,
      conversationId: activeId,
      senderId: user!.id,
      content,
      contentType: 'text/plain',
      clientMessageId,
      sequence: '0',
      createdAt: new Date().toISOString(),
      status: 'sending',
      replyTo: replyPreview,
      sender: { id: user!.id, displayName: user!.displayName, username: user!.username },
    };
    setMessages((prev) => [...prev, optimistic]);
    activeChatMessageIdsRef.current.add(clientMessageId);
    shouldScrollToBottomRef.current = true;
    clearPendingBelow();
    setFirstUnreadMessageId(null);
    setConversations((prev) =>
      reorderConversations(
        prev.map((c) =>
          c.id === activeId ? bumpConversationFromMessage(c, optimistic) : c,
        ),
      ),
    );

    try {
      const sent = await realtime.sendMessage(
        activeId,
        content,
        clientMessageId,
        replyTarget?.id,
      );
      confirmOutgoing(sent, clientMessageId);
    } catch (err) {
      setMessages((prev) => {
        const existing = prev.find((m) => m.clientMessageId === clientMessageId);
        if (!existing || existing.id !== clientMessageId) return prev;
        return prev.filter((m) => m.clientMessageId !== clientMessageId);
      });
      setInput(content);
      if (replyTarget) setReplyingToMessage(replyTarget);
      setSendError(err instanceof Error ? err.message : 'Failed to send message');
    }
  };

  const handleAttachmentSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activeId || !canSendInActiveChat || editingMessageId || attachmentBusy) return;

    const caption = input.trim() || undefined;
    const clientMessageId = createClientMessageId();
    const replyTarget = replyingToMessage;
    const previewUrl = URL.createObjectURL(file);
    const replyPreview = replyTarget
      ? {
          id: replyTarget.id,
          senderId: replyTarget.senderId,
          content: replyTarget.deletedForEveryone ? '' : replyTarget.content,
          contentType: replyTarget.contentType,
          fileName: replyTarget.fileName,
          caption: replyTarget.caption,
          deletedForEveryone: replyTarget.deletedForEveryone,
          sender: replyTarget.sender,
        }
      : undefined;

    setInput('');
    setReplyingToMessage(null);
    setSendError('');
    setAttachmentBusy(true);

    const optimistic: Message = {
      id: clientMessageId,
      conversationId: activeId,
      senderId: user!.id,
      content: previewUrl,
      contentType: file.type || 'application/octet-stream',
      fileName: file.name,
      fileSize: String(file.size),
      caption,
      clientMessageId,
      sequence: '0',
      createdAt: new Date().toISOString(),
      status: 'sending',
      replyTo: replyPreview,
      sender: { id: user!.id, displayName: user!.displayName, username: user!.username },
    };

    setMessages((prev) => [...prev, optimistic]);
    activeChatMessageIdsRef.current.add(clientMessageId);
    shouldScrollToBottomRef.current = true;
    clearPendingBelow();
    setFirstUnreadMessageId(null);
    setConversations((prev) =>
      reorderConversations(
        prev.map((c) =>
          c.id === activeId ? bumpConversationFromMessage(c, optimistic) : c,
        ),
      ),
    );

    try {
      const sent = await api.sendMessageAttachment(activeId, file, {
        caption,
        clientMessageId,
        replyToMessageId: replyTarget?.id,
      });
      confirmOutgoing(sent, clientMessageId);
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.clientMessageId !== clientMessageId));
      setInput(caption ?? '');
      if (replyTarget) setReplyingToMessage(replyTarget);
      setSendError(err instanceof Error ? err.message : 'Failed to send attachment');
    } finally {
      URL.revokeObjectURL(previewUrl);
      setAttachmentBusy(false);
    }
  };

  const handleVoiceSend = async (recording: VoiceRecordingResult) => {
    if (!activeId || !canSendInActiveChat || editingMessageId || attachmentBusy) {
      URL.revokeObjectURL(recording.previewUrl);
      return;
    }

    const clientMessageId = createClientMessageId();
    const replyTarget = replyingToMessage;
    const file = recording.file;
    const previewUrl = recording.previewUrl;

    setReplyingToMessage(null);
    setSendError('');
    setAttachmentBusy(true);
    setVoiceMessageMeta(clientMessageId, {
      peaks: recording.peaks,
      durationMs: recording.durationMs,
    });

    const replyPreview = replyTarget
      ? {
          id: replyTarget.id,
          senderId: replyTarget.senderId,
          content: replyTarget.deletedForEveryone ? '' : replyTarget.content,
          contentType: replyTarget.contentType,
          fileName: replyTarget.fileName,
          caption: replyTarget.caption,
          deletedForEveryone: replyTarget.deletedForEveryone,
          sender: replyTarget.sender,
        }
      : undefined;

    const optimistic: Message = {
      id: clientMessageId,
      conversationId: activeId,
      senderId: user!.id,
      content: previewUrl,
      contentType: normalizeVoiceMimeType(file.type || 'audio/webm'),
      fileName: file.name,
      fileSize: String(file.size),
      clientMessageId,
      sequence: '0',
      createdAt: new Date().toISOString(),
      status: 'sending',
      replyTo: replyPreview,
      sender: { id: user!.id, displayName: user!.displayName, username: user!.username },
    };

    setMessages((prev) => [...prev, optimistic]);
    activeChatMessageIdsRef.current.add(clientMessageId);
    shouldScrollToBottomRef.current = true;
    clearPendingBelow();
    setFirstUnreadMessageId(null);
    setConversations((prev) =>
      reorderConversations(
        prev.map((c) =>
          c.id === activeId ? bumpConversationFromMessage(c, optimistic) : c,
        ),
      ),
    );

    try {
      const sent = await api.sendMessageAttachment(activeId, file, {
        clientMessageId,
        replyToMessageId: replyTarget?.id,
      });
      const voiceMeta = getVoiceMessageMeta(clientMessageId);
      remapVoiceMessageMeta(clientMessageId, sent.id);
      if (voiceMeta && sent.attachmentId) {
        setVoiceMessageMeta(sent.attachmentId, voiceMeta);
      }
      confirmOutgoing(sent, clientMessageId);
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.clientMessageId !== clientMessageId));
      if (replyTarget) setReplyingToMessage(replyTarget);
      setSendError(err instanceof Error ? err.message : 'Failed to send voice message');
    } finally {
      URL.revokeObjectURL(previewUrl);
      setAttachmentBusy(false);
    }
  };

  const handleComposerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingMessageId) {
      void handleSaveEdit();
      return;
    }
    void handleSend();
  };

  const handleInputChange = (value: string, caret = composerCaret) => {
    if (!canSendInActiveChat) return;
    setInput(value);
    setComposerCaret(caret);
    if (activeConversation && user && isMultiMemberConversation(activeConversation)) {
      setMentionQuery(detectActiveMentionQuery(value, caret));
    } else {
      setMentionQuery(null);
    }
    if (sendError) setSendError('');
    if (editingMessageId || !activeId) return;
    realtime.setTyping(activeId, true);
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      realtime.setTyping(activeId, false);
    }, 2000);
  };

  const handleMentionSelect = useCallback(
    (member: { username?: string; displayName?: string }) => {
      if (!member.username || !mentionQuery) return;

      const { value, caret } = insertMention(input, composerCaret, mentionQuery.start, {
        username: member.username,
        displayName: member.displayName,
      });
      setInput(value);
      setComposerCaret(caret);
      setMentionQuery(null);
      window.requestAnimationFrame(() => {
        const el = composerInputRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(caret, caret);
      });
    },
    [composerCaret, input, mentionQuery],
  );

  const handleGroupCreated = useCallback(
    (group: Conversation) => {
      selfInitiatedConversationIdsRef.current.add(group.id);
      applyConversationCreated(group);
      openConversation(group.id, 'chats');
      setShowNewGroup(false);
    },
    [applyConversationCreated, openConversation],
  );

  const createChannel = async () => {
    if (!channelName.trim()) return;
    const ch = await api.createChannel(channelName.trim());
    selfInitiatedConversationIdsRef.current.add(ch.id);
    setConversations((prev) => reorderConversations([ch, ...prev]));
    openConversation(ch.id, 'channels');
    setShowNewChannel(false);
    setChannelName('');
  };

  const startDM = async (targetUser: User) => {
    setShowNewChatPicker(false);

    const existing = conversations.find(
      (c) =>
        c.type === 'direct' &&
        c.members.some((m) => m.userId === targetUser.id),
    );
    if (existing) {
      openConversation(existing.id, 'chats');
      return;
    }

    const dm = await api.createDirect(targetUser.id);
    selfInitiatedConversationIdsRef.current.add(dm.id);
    setConversations((prev) => {
      const exists = prev.find((c) => c.id === dm.id);
      const next = exists ? prev : [dm, ...prev];
      return reorderConversations(next);
    });
    setContactIds((prev) => new Set(prev).add(targetUser.id));
    openConversation(dm.id, 'chats');
  };

  const handleAddUnknownContact = async () => {
    if (!activePeer) return;
    setContactActionBusy(true);
    try {
      await api.addContact(activePeer.userId);
      setContactIds((prev) => new Set(prev).add(activePeer.userId));
    } finally {
      setContactActionBusy(false);
    }
  };

  const handleIgnoreUnknownContact = () => {
    if (!activePeer) return;
    const next = new Set(ignoredContactIds);
    next.add(activePeer.userId);
    setIgnoredContactIds(next);
    saveIgnoredContactPrompts(next);
  };

  const chatConversations = useMemo(
    () =>
      reorderConversations(
        conversations.filter((c) => c.type === 'direct' || c.type === 'group'),
      ),
    [conversations],
  );
  const channelConversations = useMemo(
    () => reorderConversations(conversations.filter((c) => c.type === 'channel')),
    [conversations],
  );
  const { owned: ownedChannels, joined: joinedChannels } = useMemo(
    () => (user ? partitionChannels(channelConversations, user.id) : { owned: [], joined: [] }),
    [channelConversations, user],
  );
  const sidebarConversations =
    sidebarList === 'channels' ? channelConversations : chatConversations;

  const filteredSidebarConversations = useMemo(
    () => filterConversationsBySearch(sidebarConversations, sidebarSearch, user?.id),
    [sidebarConversations, sidebarSearch, user?.id],
  );
  const filteredOwnedChannels = useMemo(
    () => filterConversationsBySearch(ownedChannels, sidebarSearch, user?.id),
    [ownedChannels, sidebarSearch, user?.id],
  );
  const filteredJoinedChannels = useMemo(
    () => filterConversationsBySearch(joinedChannels, sidebarSearch, user?.id),
    [joinedChannels, sidebarSearch, user?.id],
  );
  const allSearchConversations = useMemo(
    () => filterConversationsBySearch(conversations, sidebarSearch, user?.id),
    [conversations, sidebarSearch, user?.id],
  );
  const sidebarSearchConversations = useMemo(() => {
    const byId = new Map<string, Conversation>();
    for (const conversation of allSearchConversations) {
      byId.set(conversation.id, conversation);
    }
    for (const result of messageSearchResults) {
      if (byId.has(result.conversationId)) continue;
      const conversation = conversations.find((item) => item.id === result.conversationId);
      if (conversation) byId.set(conversation.id, conversation);
    }
    return reorderConversations([...byId.values()]);
  }, [allSearchConversations, messageSearchResults, conversations]);
  const sidebarSearchActive = isSearchQueryActive(sidebarSearch);
  const sidebarMessageSearchQuery = sidebarSearch.trim();

  useEffect(() => {
    const q = sidebarSearch.trim();
    if (q.length < 2) {
      setMessageSearchResults([]);
      setMessageSearchLoading(false);
      return;
    }

    setMessageSearchLoading(true);
    const timer = window.setTimeout(() => {
      api
        .searchMessages(q, 40)
        .then((res) => setMessageSearchResults(res.items))
        .catch(() => setMessageSearchResults([]))
        .finally(() => setMessageSearchLoading(false));
    }, 300);

    return () => window.clearTimeout(timer);
  }, [sidebarSearch]);

  const countUnreadConversations = useCallback(
    (list: Conversation[]) =>
      list.filter((c) => {
        const unread = c.unreadCount ?? 0;
        if (unread <= 0) return false;
        if (isPanelOpen && c.id === activeId) return false;
        return true;
      }).length,
    [isPanelOpen, activeId],
  );

  const chatsNavBadge = useMemo(
    () => countUnreadConversations(chatConversations),
    [chatConversations, countUnreadConversations],
  );

  const channelsNavBadge = useMemo(
    () => countUnreadConversations(channelConversations),
    [channelConversations, countUnreadConversations],
  );

  const activeNavTab = showProfile
    ? 'profile'
    : showContacts
      ? 'contacts'
      : showCalls
        ? 'calls'
        : sidebarList === 'channels'
          ? 'channels'
          : 'chats';

  const handleDeleteChat = useCallback(
    async (conversationId: string, scope: 'me' | 'everyone') => {
      setDeleteChatBusy(true);
      try {
        const result = await realtime
          .deleteConversation(conversationId, scope)
          .catch(() => api.deleteConversation(conversationId, scope));
        applyConversationHidden(conversationId);
        if (result.scope === 'everyone' && result.deletedMessageIds.length > 0) {
          applyConversationMessagesDeleted({
            conversationId,
            messageIds: result.deletedMessageIds,
          });
        }
      } finally {
        setDeleteChatBusy(false);
        setShowConversationInfo(false);
        setShowFileManagement(false);
      }
    },
    [applyConversationHidden, applyConversationMessagesDeleted],
  );

  const handleLeaveChannel = useCallback(
    async (conversationId: string, newOwnerId?: string) => {
      setDeleteChatBusy(true);
      try {
        await api.leaveChannel(conversationId, newOwnerId);
        realtime.leaveConversation(conversationId);
        applyConversationHidden(conversationId);
      } finally {
        setDeleteChatBusy(false);
        setShowConversationInfo(false);
        setShowFileManagement(false);
      }
    },
    [applyConversationHidden],
  );

  const handleTogglePin = useCallback(async (conversationId: string, currentlyPinned: boolean) => {
    const updated = currentlyPinned
      ? await api.unpinConversation(conversationId)
      : await api.pinConversation(conversationId);

    setConversations((prev) =>
      reorderConversations(
        prev.map((c) =>
          c.id === conversationId
            ? {
                ...c,
                ...updated,
                isPinned: !!updated.isPinned,
                pinnedAt: updated.isPinned ? updated.pinnedAt : undefined,
              }
            : c,
        ),
      ),
    );
  }, []);

  const renderSidebarItem = (c: Conversation) => {
    const unread = c.unreadCount ?? 0;
    const showUnread = unread > 0 && !(isPanelOpen && c.id === activeId);

    return (
      <ConversationListItem
        key={c.id}
        conversation={c}
        currentUserId={user!.id}
        isActive={c.id === activeId}
        isSelected={c.id === activeId && !isPanelOpen}
        showUnread={showUnread}
        unreadCount={unread}
        deleteBusy={deleteChatBusy}
        onClick={() => openConversation(c.id)}
        onTogglePin={() => handleTogglePin(c.id, !!c.isPinned)}
        onDeleteChat={(scope) => handleDeleteChat(c.id, scope)}
        onLeaveChannel={
          c.type === 'channel' || c.type === 'group'
            ? (newOwnerId) => handleLeaveChannel(c.id, newOwnerId)
            : undefined
        }
      />
    );
  };

  const getConversationSidebarActions = useCallback(
    (conversation: Conversation) => ({
      deleteBusy: deleteChatBusy,
      onTogglePin: () => handleTogglePin(conversation.id, !!conversation.isPinned),
      onDeleteChat: (scope: 'me' | 'everyone') => handleDeleteChat(conversation.id, scope),
      onLeaveChannel:
        conversation.type === 'channel' || conversation.type === 'group'
          ? (newOwnerId?: string) => handleLeaveChannel(conversation.id, newOwnerId)
          : undefined,
    }),
    [deleteChatBusy, handleDeleteChat, handleLeaveChannel, handleTogglePin],
  );

  const jumpToFileMessage = useCallback(
    async (messageId: string) => {
      if (!activeConversation) return;
      setShowFileManagement(false);
      setMentionGlowIds(new Set([messageId]));

      if (messagesRef.current.some((message) => message.id === messageId)) {
        scrollIntentRef.current = { kind: 'mention', messageId };
        scrollToMessage(messageId);
        return;
      }

      const loadedMessages = await loadMessagesUntilTarget(activeConversation.id, messageId);
      activeChatMessageIdsRef.current = new Set(loadedMessages.map((message) => message.id));
      scrollIntentRef.current = loadedMessages.some((message) => message.id === messageId)
        ? { kind: 'mention', messageId }
        : { kind: 'bottom' };
      setMessages(loadedMessages);
    },
    [activeConversation, loadMessagesUntilTarget, scrollToMessage],
  );

  const jumpToSearchMessage = useCallback(
    async (conversationId: string, messageId: string, conversationType: Conversation['type']) => {
      setSidebarSearch('');
      setMessageSearchResults([]);
      setShowGlobalSearch(false);
      setMentionGlowIds(new Set([messageId]));

      const preferredList = conversationType === 'channel' ? 'channels' : 'chats';
      const isSameOpenChat =
        conversationId === activeIdRef.current && isPanelOpenRef.current;

      if (!isSameOpenChat) {
        openConversation(conversationId, preferredList, { mentionMessageId: messageId });
        return;
      }

      if (messagesRef.current.some((message) => message.id === messageId)) {
        scrollIntentRef.current = { kind: 'mention', messageId };
        scrollToMessage(messageId);
        return;
      }

      const loadedMessages = await loadMessagesUntilTarget(conversationId, messageId);
      activeChatMessageIdsRef.current = new Set(loadedMessages.map((message) => message.id));
      scrollIntentRef.current = loadedMessages.some((message) => message.id === messageId)
        ? { kind: 'mention', messageId }
        : { kind: 'bottom' };
      setMessages(loadedMessages);
    },
    [loadMessagesUntilTarget, openConversation, scrollToMessage],
  );

  return (
    <div className={`chat-layout ${isPanelVisible ? 'panel-open' : ''}`}>
      {!isMobile && (
        <AppNav
          variant="rail"
          activeTab={activeNavTab}
          displayName={user?.displayName}
          avatarUrl={user?.avatarUrl}
          chatsUnreadCount={chatsNavBadge}
          channelsUnreadCount={channelsNavBadge}
          onChats={openChats}
          onChannels={openChannels}
          onCalls={openCalls}
          onContacts={openContacts}
          onProfile={openProfile}
          onLogout={logout}
        />
      )}

      <div className="chat-layout-body">
      <aside className="sidebar">
        <header className="sidebar-header">
          <h2>{sidebarList === 'channels' ? 'Channels' : 'Chats'}</h2>
          <button
            type="button"
            className="icon-btn sidebar-search-btn"
            onClick={() => setShowGlobalSearch(true)}
            title="Search (Ctrl+K)"
            aria-label="Search"
          >
            ⌕
          </button>
        </header>

        <div className="sidebar-search">
          <input
            type="search"
            value={sidebarSearch}
            onChange={(e) => setSidebarSearch(e.target.value)}
            placeholder="Search chats, groups, channels, messages..."
            aria-label="Search chats, groups, channels, and messages"
          />
          {sidebarSearchActive && (
            <button
              type="button"
              className="sidebar-search-clear"
              onClick={() => setSidebarSearch('')}
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        <div className="sidebar-actions">
          {sidebarList === 'channels' ? (
            <button className="sidebar-action-primary" onClick={() => setShowNewChannel(true)}>
              + Channel
            </button>
          ) : (
            <div className="sidebar-actions-row">
              <button className="sidebar-action-primary" onClick={openNewChatPicker}>
                + New Chat
              </button>
              <button className="sidebar-action-secondary" onClick={() => setShowNewGroup(true)}>
                + New Group
              </button>
            </div>
          )}
        </div>

        <div className={`conversation-list${sidebarSearchActive ? ' conversation-list-search-mode' : ''}`}>
          {sidebarSearchActive ? (
            <SidebarSearchPanel
              conversations={sidebarSearchConversations}
              messageResults={messageSearchResults}
              messageLoading={messageSearchLoading}
              messageQuery={sidebarMessageSearchQuery}
              currentUserId={user!.id}
              activeConversationId={activeId}
              onOpenConversation={(conversationId) => {
                const conv = conversations.find((c) => c.id === conversationId);
                openConversation(
                  conversationId,
                  conv?.type === 'channel' ? 'channels' : 'chats',
                );
              }}
              onOpenMessage={jumpToSearchMessage}
              renderConversationActions={getConversationSidebarActions}
            />
          ) : sidebarList === 'channels' ? (
            channelConversations.length === 0 ? (
              <div className="conversation-list-empty">
                <p>No channels yet</p>
                <span>Create a channel to get started</span>
              </div>
            ) : filteredOwnedChannels.length === 0 && filteredJoinedChannels.length === 0 ? (
              <div className="conversation-list-empty">
                <p>No channels match your search</p>
              </div>
            ) : (
              <>
                {filteredOwnedChannels.length > 0 && (
                  <section className="conversation-list-section">
                    <div className="conversation-list-header">
                      <span>My Channels</span>
                      <span className="conversation-count">{filteredOwnedChannels.length}</span>
                    </div>
                    {filteredOwnedChannels.map((c) => renderSidebarItem(c))}
                  </section>
                )}
                {filteredJoinedChannels.length > 0 && (
                  <section className="conversation-list-section">
                    <div className="conversation-list-header">
                      <span>Joined</span>
                      <span className="conversation-count">{filteredJoinedChannels.length}</span>
                    </div>
                    {filteredJoinedChannels.map((c) => renderSidebarItem(c))}
                  </section>
                )}
              </>
            )
          ) : sidebarConversations.length === 0 ? (
            <div className="conversation-list-empty">
              <p>No conversations yet</p>
              <span>Use New Chat or New Group to start messaging</span>
            </div>
          ) : filteredSidebarConversations.length === 0 ? (
            <div className="conversation-list-empty">
              <p>No chats match your search</p>
            </div>
          ) : (
            <>
              <div className="conversation-list-header">
                <span>Chats</span>
                <span className="conversation-count">{filteredSidebarConversations.length}</span>
              </div>
              {filteredSidebarConversations.map((c) => renderSidebarItem(c))}
            </>
          )}
        </div>
      </aside>

      <main
        ref={chatMainRef}
        className={[
          'chat-main',
          isPanelVisible ? 'open' : '',
          swipeOffset > 0 ? 'swiping-back' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{
          transform: swipeOffset > 0 ? `translate3d(${swipeOffset}px, 0, 0)` : undefined,
          transition: swipeTransition ? 'transform 0.2s ease-out' : undefined,
        }}
      >
        {showProfile ? (
          <ProfilePanel onClose={closeChatPanel} isMobile={isMobile} />
        ) : showCalls ? (
          <CallsPanel
            onClose={closeChatPanel}
            isMobile={isMobile}
            onMessage={startDM}
          />
        ) : showContacts ? (
          <ContactsPanel
            onClose={closeChatPanel}
            isMobile={isMobile}
            onMessage={startDM}
          />
        ) : showNewChatPicker ? (
          <ContactsPanel
            variant="picker"
            onClose={closeNewChatPicker}
            isMobile={isMobile}
            onMessage={startDM}
          />
        ) : pendingChannelInvite ? (
          <>
            <header className="chat-header">
              <button
                className="icon-btn close-chat-btn"
                onClick={dismissChannelInvite}
                title={isMobile ? 'Back to conversations' : 'Close'}
                aria-label={isMobile ? 'Back to conversations' : 'Close'}
              >
                {isMobile ? '←' : '✕'}
              </button>
              <div className="chat-header-info">
                <h3>
                  {pendingChannelInvite.conversationType === 'group' ? '' : '#'}
                  {pendingChannelInvite.channelName}
                </h3>
                <span className="member-count">
                  {pendingChannelInvite.conversationType === 'group' ? 'Group invite' : 'Channel invite'}
                </span>
              </div>
            </header>

            <div className="chat-body">
              <ChannelJoinBanner
                channelName={pendingChannelInvite.channelName}
                busy={inviteJoinBusy}
                onJoin={() => void confirmChannelInvite()}
                onDecline={dismissChannelInvite}
              />
              <div className="channel-invite-preview-empty">
                <div className="empty-state-icon">
                  {pendingChannelInvite.conversationType === 'group' ? '👥' : '#'}
                </div>
                <h3>
                  {pendingChannelInvite.conversationType === 'group' ? '' : '#'}
                  {pendingChannelInvite.channelName}
                </h3>
                <p>
                  {pendingChannelInvite.conversationType === 'group'
                    ? 'Join the group to start chatting'
                    : 'Join the channel to start chatting'}
                </p>
              </div>
            </div>
          </>
        ) : isPanelOpen && activeConversation ? (
          <>
            <header className="chat-header">
              <button
                className="icon-btn close-chat-btn"
                onClick={closeChatPanel}
                title={isMobile ? 'Back to conversations' : 'Close chat'}
                aria-label={isMobile ? 'Back to conversations' : 'Close chat'}
              >
                {isMobile ? '←' : '✕'}
              </button>
              {activeConversation.type === 'direct' ? (
                <Avatar
                  name={activePeer?.displayName ?? activeConversation.name}
                  avatarUrl={activePeer?.avatarUrl}
                  size="sm"
                  presence={activePeer ? getPresence(activePeer.userId) : undefined}
                />
              ) : (
                <Avatar
                  name={activeConversation.name}
                  avatarUrl={activeConversation.avatarUrl}
                  size="sm"
                />
              )}
              <button
                type="button"
                className="chat-header-info chat-header-btn"
                onClick={() => setShowConversationInfo(true)}
                title="View details"
              >
                <h3>
                  {activeConversation.type === 'channel' ? '#' : ''}
                  {activeConversation.name}
                </h3>
                <span
                  className={[
                    'member-count',
                    directChatSubtitle === 'Online' ? 'member-count--online' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {activeConversation.type === 'direct'
                    ? directChatSubtitle
                    : `${activeConversation.members.length} members`}
                </span>
              </button>
              {activeConversation.type === 'direct' && activePeer && (
                <button
                  type="button"
                  className="icon-btn chat-header-call-btn"
                  onClick={() => void handleStartVoiceCall()}
                  title="Voice call"
                  aria-label="Voice call"
                >
                  📞
                </button>
              )}
              <button
                type="button"
                className="icon-btn chat-header-files-btn"
                onClick={() => setShowFileManagement(true)}
                title="Shared files"
                aria-label="Shared files"
              >
                📁
              </button>
            </header>

            <div className="chat-body">
              <div className="messages" ref={messagesScrollRef}>
              {messages.map((m) => (
                <MessageBubble
                  key={m.clientMessageId ?? m.id}
                  message={m}
                  isOwn={m.senderId === user?.id}
                  isFirstUnread={firstUnreadMessageId === m.id}
                  isBeingEdited={editingMessageId === m.id}
                  showMentionGlow={mentionGlowIds.has(m.id)}
                  scrollRootRef={messagesScrollRef}
                  onMentionGlowConsumed={() => dismissMentionGlow(m.id)}
                  allowMessageMenu={Boolean(activeConversation)}
                  canSendActions={canSendInActiveChat}
                  onStartEdit={startEditMessage}
                  onReply={startReplyMessage}
                  onForward={startForwardMessage}
                  onScrollToMessage={scrollToMessage}
                  onDelete={handleDeleteMessage}
                  onReaction={handleReactionMessage}
                />
              ))}
              {typingIndicatorText && (
                <div className="typing-indicator">{typingIndicatorText}</div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {pendingBelowCount > 0 && (
              <div className="new-messages-fab-wrap">
                <button
                  type="button"
                  className="new-messages-fab"
                  onClick={scrollToPendingBelow}
                  aria-label={`${pendingBelowCount} new messages below`}
                >
                  <span className="new-messages-fab-arrow" aria-hidden>
                    ↓
                  </span>
                  <span className="new-messages-fab-count">
                    {pendingBelowCount > 99 ? '99+' : pendingBelowCount}
                  </span>
                </button>
              </div>
            )}

            <footer className="composer">
              {canSendInActiveChat ? (
                <>
                  {editingMessageId && (
                    <div className="composer-edit-banner">
                      <span>Editing message</span>
                      <button
                        type="button"
                        className="composer-edit-cancel"
                        onClick={cancelEditMessage}
                        disabled={editBusy}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                  {replyingToMessage && !editingMessageId && (
                    <div className="composer-reply-banner">
                      <div className="composer-reply-preview">
                        <span className="composer-reply-label">Replying to</span>
                        <MessageReplyQuote
                          replyTo={{
                            id: replyingToMessage.id,
                            senderId: replyingToMessage.senderId,
                            content: replyingToMessage.deletedForEveryone
                              ? ''
                              : replyingToMessage.content,
                            contentType: replyingToMessage.contentType,
                            fileName: replyingToMessage.fileName,
                            caption: replyingToMessage.caption,
                            deletedForEveryone: replyingToMessage.deletedForEveryone,
                            sender: replyingToMessage.sender,
                          }}
                          compact
                        />
                      </div>
                      <button
                        type="button"
                        className="composer-edit-cancel"
                        onClick={cancelReplyMessage}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                  <form className={`composer-form ${voiceRecording ? 'voice-active' : ''}`} onSubmit={handleComposerSubmit}>
                    {!voiceRecording && (
                      <>
                        <button
                          type="button"
                          className="composer-attach-btn"
                          onClick={() => attachmentInputRef.current?.click()}
                          disabled={attachmentBusy || editBusy || !!editingMessageId}
                          aria-label="Attach file"
                          title="Attach photo, video, audio, or document"
                        >
                          📎
                        </button>
                        <input
                          ref={attachmentInputRef}
                          type="file"
                          className="avatar-file-input"
                          accept={ATTACHMENT_ACCEPT}
                          onChange={(e) => void handleAttachmentSelect(e)}
                        />
                        <div className="composer-input-wrap">
                          <MentionAutocomplete
                            open={Boolean(mentionQuery && activeConversation && user)}
                            members={activeConversation?.members ?? []}
                            currentUserId={user!.id}
                            query={mentionQuery?.query ?? ''}
                            onSelect={handleMentionSelect}
                            onClose={() => setMentionQuery(null)}
                          />
                          <input
                            ref={composerInputRef}
                            value={input}
                            onChange={(e) =>
                              handleInputChange(e.target.value, e.target.selectionStart ?? e.target.value.length)
                            }
                            onClick={(e) =>
                              handleInputChange(
                                e.currentTarget.value,
                                e.currentTarget.selectionStart ?? e.currentTarget.value.length,
                              )
                            }
                            onKeyUp={(e) =>
                              handleInputChange(
                                e.currentTarget.value,
                                e.currentTarget.selectionStart ?? e.currentTarget.value.length,
                              )
                            }
                            placeholder={
                              editingMessageId
                                ? 'Edit your message'
                                : attachmentBusy
                                  ? 'Sending attachment...'
                                  : isMultiMemberConversation(activeConversation)
                                    ? `Message ${activeConversation.name} (@ to mention)`
                                    : `Message ${activeConversation.name}`
                            }
                            disabled={attachmentBusy}
                            enterKeyHint={editingMessageId ? 'done' : 'send'}
                          />
                        </div>
                      </>
                    )}
                    {editingMessageId || input.trim() ? (
                      <button type="submit" disabled={!input.trim() || editBusy || attachmentBusy}>
                        {editBusy ? 'Saving...' : editingMessageId ? 'Save' : 'Send'}
                      </button>
                    ) : (
                      <VoiceRecorderControl
                        disabled={attachmentBusy || editBusy || !!editingMessageId}
                        onRecordingChange={setVoiceRecording}
                        onSend={handleVoiceSend}
                        onError={(message) => setSendError(message)}
                      />
                    )}
                  </form>
                </>
              ) : (
                <p className="composer-readonly-notice">
                  Only the channel owner can send messages in this channel.
                </p>
              )}
              {sendError && <p className="composer-error">{sendError}</p>}
            </footer>

              {showFileManagement && (
                <FileManagementPanel
                  conversationId={activeConversation.id}
                  currentUserId={user!.id}
                  onClose={() => setShowFileManagement(false)}
                  onOpenMessage={(messageId) => void jumpToFileMessage(messageId)}
                />
              )}

              {showConversationInfo && (
                <ConversationInfoPanel
                  conversation={activeConversation}
                  currentUserId={user!.id}
                  onClose={() => setShowConversationInfo(false)}
                  onOpenFiles={() => {
                    setShowConversationInfo(false);
                    setShowFileManagement(true);
                  }}
                  isContact={!activePeer || contactIds.has(activePeer.userId)}
                  contactPromptIgnored={
                    activePeer ? ignoredContactIds.has(activePeer.userId) : false
                  }
                  contactActionBusy={contactActionBusy}
                  onAddContact={handleAddUnknownContact}
                  onIgnoreContact={handleIgnoreUnknownContact}
                  onDeleteChat={
                    activeConversation.type === 'direct'
                      ? (scope) => handleDeleteChat(activeConversation.id, scope)
                      : undefined
                  }
                  onLeaveChannel={
                    activeConversation.type === 'channel' || activeConversation.type === 'group'
                      ? (newOwnerId) => handleLeaveChannel(activeConversation.id, newOwnerId)
                      : undefined
                  }
                  onChannelAvatarUpdated={(avatarUrl) => {
                    setConversations((prev) =>
                      prev.map((c) =>
                        c.id === activeConversation.id ? { ...c, avatarUrl } : c,
                      ),
                    );
                  }}
                  deleteChatBusy={deleteChatBusy}
                />
              )}
            </div>
          </>
        ) : (
          <div className="empty-state">
            <div className="empty-state-icon">💬</div>
            <h3>Welcome to ChatApp</h3>
            <p>Select a conversation from the sidebar to start chatting</p>
            {activeId && !isPanelOpen && (
              <button
                className="reopen-chat-btn"
                onClick={() => {
                  if (activeId) {
                    const conv = conversations.find((c) => c.id === activeId);
                    const membership = conv?.members.find((m) => m.userId === user?.id);
                    lastReadAtOnOpenRef.current = membership?.lastReadAt;
                  }
                  setIsPanelOpen(true);
                  setConversations((prev) =>
                    prev.map((c) =>
                      c.id === activeId ? { ...c, unreadCount: 0 } : c,
                    ),
                  );
                }}
              >
                Reopen last chat
              </button>
            )}
          </div>
        )}
      </main>
      </div>

      {isMobile && (
        <AppNav
          variant="bottom"
          activeTab={activeNavTab}
          displayName={user?.displayName}
          avatarUrl={user?.avatarUrl}
          chatsUnreadCount={chatsNavBadge}
          channelsUnreadCount={channelsNavBadge}
          onChats={openChats}
          onChannels={openChannels}
          onCalls={openCalls}
          onContacts={openContacts}
          onProfile={openProfile}
          onLogout={logout}
        />
      )}

      {showNewGroup && (
        <NewGroupModal
          open={showNewGroup}
          onClose={() => setShowNewGroup(false)}
          onCreated={(group) => handleGroupCreated(group)}
        />
      )}

      {showNewChannel && (
        <div className="modal-overlay" onClick={() => setShowNewChannel(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Create Channel</h3>
            <input
              placeholder="Channel name"
              value={channelName}
              onChange={(e) => setChannelName(e.target.value)}
              autoFocus
            />
            <div className="modal-actions">
              <button onClick={() => setShowNewChannel(false)}>Cancel</button>
              <button onClick={createChannel}>Create</button>
            </div>
          </div>
        </div>
      )}

      {forwardingMessage && activeId && user && (
        <ForwardDestinationModal
          open
          message={forwardingMessage}
          conversations={conversations}
          currentUserId={user.id}
          sourceConversationId={activeId}
          onClose={() => setForwardingMessage(null)}
          onForward={handleForwardMessage}
        />
      )}

      {user && (
        <GlobalSearchModal
          open={showGlobalSearch}
          conversations={conversations}
          currentUserId={user.id}
          onClose={() => setShowGlobalSearch(false)}
          onOpenConversation={(conversationId, preferredList) =>
            openConversation(conversationId, preferredList)
          }
          onMessageUser={(targetUser) => void startDM(targetUser)}
          onOpenMessage={jumpToSearchMessage}
        />
      )}

      <InAppNotifications
        items={inAppNotifications}
        onDismiss={dismissInAppNotification}
        onClick={goToInAppNotification}
      />

      <VoiceCallModal />

      {callError && (
        <div className="voice-call-error-toast" role="alert">
          <span>{callError}</span>
          <button type="button" className="voice-call-error-dismiss" onClick={() => setCallError('')}>
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
