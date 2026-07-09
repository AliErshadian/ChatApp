import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Avatar } from './Avatar';
import { api, Conversation, Message, MessageStatus, User, ConversationUpdatedEvent } from '../services/api';
import { realtime } from '../services/realtime';
import { useAuth } from '../context/AuthContext';
import { usePresence } from '../context/PresenceContext';
import { MessageBubble } from './MessageBubble';
import { MessageReplyQuote } from './MessageReplyQuote';
import { ProfilePanel } from './ProfilePanel';
import { ContactsPanel } from './ContactsPanel';
import { ConversationInfoPanel } from './ConversationInfoPanel';
import { ChannelJoinBanner } from './ChannelJoinBanner';
import { mergeMessageStatus, mergeOutgoingServerMessage } from '../utils/messageStatus';
import { ConversationListItem } from './ConversationListItem';
import { NewGroupModal } from './NewGroupModal';
import { AppNav } from './AppNav';
import { bumpConversationFromMessage, reorderConversations } from '../utils/conversationList';
import { getDirectPeer, partitionChannels } from '../utils/conversation';
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
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [sidebarList, setSidebarList] = useState<'chats' | 'channels'>('chats');
  const [showProfile, setShowProfile] = useState(false);
  const [showContacts, setShowContacts] = useState(false);
  const [showNewChatPicker, setShowNewChatPicker] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [showConversationInfo, setShowConversationInfo] = useState(false);
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const composerInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const chatMainRef = useRef<HTMLElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const scrollIntentRef = useRef<{ kind: 'unread' | 'bottom'; messageId?: string } | null>(null);
  const shouldScrollToBottomRef = useRef(false);
  const lastReadAtOnOpenRef = useRef<string | undefined>();
  const activeIdRef = useRef<string | null>(null);
  const userIdRef = useRef<string | undefined>(undefined);
  const pendingStatusRef = useRef<Map<string, MessageStatus>>(new Map());

  const isPanelOpenRef = useRef(false);
  activeIdRef.current = activeId;
  userIdRef.current = user?.id;
  isPanelOpenRef.current = isPanelOpen;

  const activeConversation = conversations.find((c) => c.id === activeId);
  const activePeer =
    activeConversation && user ? getDirectPeer(activeConversation, user.id) : undefined;
  const canSendInActiveChat = useMemo(() => {
    if (!activeConversation || !user) return true;
    if (activeConversation.type !== 'channel') return true;
    const membership = activeConversation.members.find((m) => m.userId === user.id);
    return membership?.role === 'owner';
  }, [activeConversation, user]);
  const isMobile = useMediaQuery('(max-width: 768px)');
  const isPanelVisible =
    isPanelOpen &&
    (activeConversation || showProfile || showContacts || showNewChatPicker || pendingChannelInvite);

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
    document.getElementById(`msg-${messageId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, []);

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

  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;

  const loadConversationsRef = useRef(loadConversations);
  loadConversationsRef.current = loadConversations;

  const openConversation = useCallback((id: string, preferredList?: 'chats' | 'channels') => {
    setShowProfile(false);
    setShowContacts(false);
    setShowNewChatPicker(false);
    setShowConversationInfo(false);

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
  }, []);

  const handleInviteToken = useCallback(
    async (token: string) => {
      try {
        const status = await api.getInviteStatus(token);
        setShowProfile(false);
        setShowContacts(false);
        setShowNewChatPicker(false);
        setShowConversationInfo(false);

        if (status.isMember) {
          const visible = conversations.find((c) => c.id === status.conversationId);
          const inviteList = status.conversationType === 'group' ? 'chats' : 'channels';
          if (visible) {
            setPendingChannelInvite(null);
            openConversation(visible.id, inviteList);
            return;
          }

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
    setShowNewChatPicker(false);
    setPendingChannelInvite(null);
    setIsPanelOpen(true);
  }, []);

  const openContacts = useCallback(() => {
    setShowContacts(true);
    setShowProfile(false);
    setShowNewChatPicker(false);
    setPendingChannelInvite(null);
    setIsPanelOpen(true);
  }, []);

  const openNewChatPicker = useCallback(() => {
    setShowProfile(false);
    setShowContacts(false);
    setShowNewChatPicker(true);
    setShowConversationInfo(false);
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
      setShowNewChatPicker(false);
      setShowConversationInfo(false);
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

  const openChannels = useCallback(() => switchSidebarList('channels'), [switchSidebarList]);

  const closeChatPanel = useCallback(() => {
    setIsPanelOpen(false);
    setShowProfile(false);
    setShowContacts(false);
    setShowNewChatPicker(false);
    setPendingChannelInvite(null);
    setShowConversationInfo(false);
    setTypingUsers(new Set());
  }, []);

  const handleSwipeBack = useCallback(() => {
    if (showConversationInfo) {
      setShowConversationInfo(false);
      return;
    }
    if (pendingChannelInvite) {
      dismissChannelInvite();
      return;
    }
    closeChatPanel();
  }, [showConversationInfo, pendingChannelInvite, dismissChannelInvite, closeChatPanel]);

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
    enabled: isMobile && isPanelOpen && !showConversationInfo && !pendingChannelInvite,
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
    setEditingMessageId(null);
    setReplyingToMessage(null);
    setInput('');

    api.getMessages(activeId).then((res) => {
      const firstUnread = res.messages.find(
        (m) =>
          m.senderId !== userIdRef.current &&
          (!lastReadAt || new Date(m.createdAt) > new Date(lastReadAt)),
      );

      scrollIntentRef.current = firstUnread
        ? { kind: 'unread', messageId: firstUnread.id }
        : { kind: 'bottom' };
      setFirstUnreadMessageId(firstUnread?.id ?? null);
      setMessages(res.messages);

      requestAnimationFrame(() => {
        res.messages.forEach((msg) => {
          if (msg.senderId !== userIdRef.current) {
            realtime.markDelivered(msg.id);
            realtime.markRead(msg.id);
          }
        });
      });
    });
    return () => realtime.leaveConversation(activeId);
  }, [activeId, isPanelOpen]);

  // Realtime listeners — mount once, use refs to avoid stale closures
  useEffect(() => {
    const unsubMsg = realtime.onMessage((msg) => {
      const isActive =
        msg.conversationId === activeIdRef.current && isPanelOpenRef.current;

      if (msg.senderId === userIdRef.current && msg.clientMessageId) {
        confirmOutgoing(msg, msg.clientMessageId);
      } else if (isActive) {
        shouldScrollToBottomRef.current = true;
        setFirstUnreadMessageId(null);
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
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
      if (msg.senderId !== userIdRef.current && document.hidden) {
        window.electronAPI?.notify(
          msg.sender?.displayName ?? 'New message',
          getMessagePreviewText(msg).slice(0, 100),
        );
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
  ]);

  useEffect(() => {
    if (scrollIntentRef.current) {
      const intent = scrollIntentRef.current;
      scrollIntentRef.current = null;
      requestAnimationFrame(() => {
        if (intent.kind === 'unread' && intent.messageId) {
          document
            .getElementById(`msg-${intent.messageId}`)
            ?.scrollIntoView({ block: 'start', behavior: 'auto' });
        } else {
          messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
        }
      });
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
    shouldScrollToBottomRef.current = true;
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
    shouldScrollToBottomRef.current = true;
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

  const handleComposerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingMessageId) {
      void handleSaveEdit();
      return;
    }
    void handleSend();
  };

  const handleInputChange = (value: string) => {
    if (!canSendInActiveChat) return;
    setInput(value);
    if (sendError) setSendError('');
    if (editingMessageId || !activeId) return;
    realtime.setTyping(activeId, true);
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      realtime.setTyping(activeId, false);
    }, 2000);
  };

  const handleGroupCreated = useCallback(
    (group: Conversation) => {
      applyConversationCreated(group);
      openConversation(group.id, 'chats');
      setShowNewGroup(false);
    },
    [applyConversationCreated, openConversation],
  );

  const createChannel = async () => {
    if (!channelName.trim()) return;
    const ch = await api.createChannel(channelName.trim());
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
          onContacts={openContacts}
          onProfile={openProfile}
          onLogout={logout}
        />
      )}

      <div className="chat-layout-body">
      <aside className="sidebar">
        <header className="sidebar-header">
          <h2>{sidebarList === 'channels' ? 'Channels' : 'Chats'}</h2>
        </header>

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

        <div className="conversation-list">
          {sidebarList === 'channels' ? (
            channelConversations.length === 0 ? (
              <div className="conversation-list-empty">
                <p>No channels yet</p>
                <span>Create a channel to get started</span>
              </div>
            ) : (
              <>
                {ownedChannels.length > 0 && (
                  <section className="conversation-list-section">
                    <div className="conversation-list-header">
                      <span>My Channels</span>
                      <span className="conversation-count">{ownedChannels.length}</span>
                    </div>
                    {ownedChannels.map((c) => renderSidebarItem(c))}
                  </section>
                )}
                {joinedChannels.length > 0 && (
                  <section className="conversation-list-section">
                    <div className="conversation-list-header">
                      <span>Joined</span>
                      <span className="conversation-count">{joinedChannels.length}</span>
                    </div>
                    {joinedChannels.map((c) => renderSidebarItem(c))}
                  </section>
                )}
              </>
            )
          ) : sidebarConversations.length === 0 ? (
            <div className="conversation-list-empty">
              <p>No conversations yet</p>
              <span>Use New Chat or New Group to start messaging</span>
            </div>
          ) : (
            <>
              <div className="conversation-list-header">
                <span>Messages</span>
                <span className="conversation-count">{sidebarConversations.length}</span>
              </div>
              {sidebarConversations.map((c) => renderSidebarItem(c))}
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
            </header>

            <div className="chat-body">
              <div className="messages">
              {messages.map((m) => (
                <MessageBubble
                  key={m.clientMessageId ?? m.id}
                  message={m}
                  isOwn={m.senderId === user?.id}
                  isFirstUnread={firstUnreadMessageId === m.id}
                  isBeingEdited={editingMessageId === m.id}
                  allowMessageMenu={canSendInActiveChat}
                  onStartEdit={startEditMessage}
                  onReply={startReplyMessage}
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
                  <form className="composer-form" onSubmit={handleComposerSubmit}>
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
                    <input
                      ref={composerInputRef}
                      value={input}
                      onChange={(e) => handleInputChange(e.target.value)}
                      placeholder={
                        editingMessageId
                          ? 'Edit your message'
                          : attachmentBusy
                            ? 'Sending attachment...'
                            : `Message ${activeConversation.name}`
                      }
                      disabled={attachmentBusy}
                      enterKeyHint={editingMessageId ? 'done' : 'send'}
                    />
                    <button type="submit" disabled={!input.trim() || editBusy || attachmentBusy}>
                      {editBusy ? 'Saving...' : editingMessageId ? 'Save' : 'Send'}
                    </button>
                  </form>
                </>
              ) : (
                <p className="composer-readonly-notice">
                  Only the channel owner can send messages in this channel.
                </p>
              )}
              {sendError && <p className="composer-error">{sendError}</p>}
            </footer>

              {showConversationInfo && (
                <ConversationInfoPanel
                  conversation={activeConversation}
                  currentUserId={user!.id}
                  onClose={() => setShowConversationInfo(false)}
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
    </div>
  );
}
