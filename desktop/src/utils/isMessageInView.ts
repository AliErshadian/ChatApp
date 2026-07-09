export function isMessageInView(
  messageId: string,
  scrollRoot: HTMLElement | null,
  visibleRatioThreshold = 0.35,
): boolean {
  if (!scrollRoot) return false;
  const element = document.getElementById(`msg-${messageId}`);
  if (!element) return false;

  const rootRect = scrollRoot.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  const visibleHeight = Math.min(rect.bottom, rootRect.bottom) - Math.max(rect.top, rootRect.top);
  if (visibleHeight <= 0) return false;

  const visibleRatio = visibleHeight / rect.height;
  return visibleRatio >= visibleRatioThreshold;
}
