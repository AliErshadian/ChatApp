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
