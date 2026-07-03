import type { MessageStatus } from './api';

const STATUS_RANK: Record<MessageStatus, number> = {
  sending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
};

export function mergeMessageStatus(
  current?: MessageStatus,
  incoming?: MessageStatus,
): MessageStatus {
  const cur = current ?? 'sending';
  const next = incoming ?? cur;
  return STATUS_RANK[next] > STATUS_RANK[cur] ? next : cur;
}

export function mergeOutgoingServerMessage(
  optimistic: Message,
  server: Message,
  pendingStatus?: MessageStatus,
): Message {
  return {
    ...server,
    clientMessageId: server.clientMessageId ?? optimistic.clientMessageId,
    status: mergeMessageStatus('sent', pendingStatus),
  };
}
