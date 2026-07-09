export function isMessagesNearBottom(
  container: HTMLElement | null,
  thresholdPx = 120,
): boolean {
  if (!container) return true;
  const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
  return distance <= thresholdPx;
}
