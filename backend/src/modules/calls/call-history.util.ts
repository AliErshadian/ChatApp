import type { CallEndedPayload } from './call.types';

export type CallHistoryCategory =
  | 'incoming'
  | 'outgoing'
  | 'missed'
  | 'cancelled'
  | 'not_answered';

export interface CallHistoryInput {
  callerId: string;
  calleeId: string;
  endReason: CallEndedPayload['reason'];
  endedBy?: string | null;
  answeredAt?: Date | null;
}

export function getCallHistoryCategory(
  record: CallHistoryInput,
  userId: string,
): CallHistoryCategory {
  const isCaller = record.callerId === userId;
  const answered = Boolean(record.answeredAt);

  if (answered && record.endReason === 'ended') {
    return isCaller ? 'outgoing' : 'incoming';
  }

  if (isCaller) {
    if (record.endReason === 'cancelled' || record.endReason === 'timeout') {
      return 'cancelled';
    }
    return 'not_answered';
  }

  if (record.endReason === 'rejected' && record.endedBy === userId) {
    return 'incoming';
  }

  return 'missed';
}

export function getCallHistoryLabel(
  category: CallHistoryCategory,
  endReason: CallEndedPayload['reason'],
  endedBy: string | null | undefined,
  userId: string,
): string {
  if (category === 'incoming' && endReason === 'rejected' && endedBy === userId) {
    return 'Declined';
  }

  switch (category) {
    case 'incoming':
      return 'Incoming';
    case 'outgoing':
      return 'Outgoing';
    case 'missed':
      return 'Missed';
    case 'cancelled':
      return 'Cancelled';
    case 'not_answered':
      return endReason === 'rejected' ? 'Declined' : 'Not answered';
    default:
      return 'Call';
  }
}
