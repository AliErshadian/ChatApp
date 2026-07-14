export function isMessagesNearBottom(
  container: HTMLElement | null,
  thresholdPx = 120,
): boolean {
  if (!container) return true;
  const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
  return distance <= thresholdPx;
}

export function scrollToMessageById(
  messageId: string,
  options?: {
    block?: ScrollLogicalPosition;
    behavior?: ScrollBehavior;
    maxAttempts?: number;
    onComplete?: (scrolled: boolean) => void;
  },
): void {
  const block = options?.block ?? 'center';
  const behavior = options?.behavior ?? 'smooth';
  const maxAttempts = options?.maxAttempts ?? 24;

  const tryScroll = (attempt: number) => {
    const element = document.getElementById(`msg-${messageId}`);
    if (element) {
      element.scrollIntoView({ block, behavior });
      options?.onComplete?.(true);
      return;
    }
    if (attempt < maxAttempts) {
      requestAnimationFrame(() => tryScroll(attempt + 1));
      return;
    }
    options?.onComplete?.(false);
  };

  requestAnimationFrame(() => tryScroll(0));
}

/**
 * Scroll a specific messages container so the target (or its unread divider) sits near the top.
 * Prefer this over scrollIntoView for chat panes so we land on the first unread, not the last.
 */
export function scrollContainerToMessage(
  container: HTMLElement | null,
  messageId: string,
  options?: {
    behavior?: ScrollBehavior;
    maxAttempts?: number;
    alignToUnreadDivider?: boolean;
    topOffset?: number;
    onComplete?: (scrolled: boolean) => void;
  },
): void {
  const behavior = options?.behavior ?? 'smooth';
  const maxAttempts = options?.maxAttempts ?? 24;
  const topOffset = options?.topOffset ?? 12;
  const alignToUnreadDivider = options?.alignToUnreadDivider ?? true;

  if (!container) {
    scrollToMessageById(messageId, {
      block: 'start',
      behavior,
      maxAttempts,
      onComplete: options?.onComplete,
    });
    return;
  }

  const tryScroll = (attempt: number) => {
    const bubble = container.querySelector(`#msg-${CSS.escape(messageId)}`);
    if (!bubble) {
      if (attempt < maxAttempts) {
        requestAnimationFrame(() => tryScroll(attempt + 1));
        return;
      }
      options?.onComplete?.(false);
      return;
    }

    const group = bubble.closest('.message-group');
    const target =
      (alignToUnreadDivider
        ? (group?.querySelector('.unread-divider') as HTMLElement | null)
        : null) ?? (bubble as HTMLElement);

    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const nextTop = targetRect.top - containerRect.top + container.scrollTop - topOffset;
    container.scrollTo({ top: Math.max(0, nextTop), behavior });
    options?.onComplete?.(true);
  };

  requestAnimationFrame(() => tryScroll(0));
}

/** Pin a messages scroller to the latest message (end of the list). */
export function scrollContainerToBottom(
  container: HTMLElement | null,
  options?: {
    behavior?: ScrollBehavior;
    maxAttempts?: number;
    onComplete?: (scrolled: boolean) => void;
  },
): void {
  const behavior = options?.behavior ?? 'auto';
  const maxAttempts = options?.maxAttempts ?? 24;

  const tryScroll = (attempt: number) => {
    if (!container) {
      options?.onComplete?.(false);
      return;
    }

    const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
    container.scrollTo({ top: maxTop, behavior });

    // Layout may still be settling; retry until we're actually at the bottom.
    const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distance > 2 && attempt < maxAttempts) {
      requestAnimationFrame(() => tryScroll(attempt + 1));
      return;
    }
    options?.onComplete?.(true);
  };

  requestAnimationFrame(() => tryScroll(0));
}

export function findFirstUnreadMessageId(
  messages: Array<{
    id: string;
    senderId: string;
    createdAt: string;
    deletedForEveryone?: boolean;
  }>,
  viewerId: string | undefined,
  lastReadAt?: string | null,
): string | null {
  for (const message of messages) {
    if (!viewerId || message.senderId === viewerId) continue;
    if (message.deletedForEveryone) continue;
    if (!lastReadAt || new Date(message.createdAt) > new Date(lastReadAt)) {
      return message.id;
    }
  }
  return null;
}

/** True when the oldest loaded message is still unread for the viewer (need older pages). */
export function oldestLoadedIsUnread(
  messages: Array<{
    senderId: string;
    createdAt: string;
    deletedForEveryone?: boolean;
  }>,
  viewerId: string | undefined,
  lastReadAt?: string | null,
): boolean {
  const oldest = messages[0];
  if (!oldest || !viewerId) return false;
  if (oldest.senderId === viewerId || oldest.deletedForEveryone) return false;
  return !lastReadAt || new Date(oldest.createdAt) > new Date(lastReadAt);
}
