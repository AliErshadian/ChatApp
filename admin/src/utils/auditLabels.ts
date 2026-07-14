const ACTION_LABELS: Record<string, string> = {
  'auth.register': 'Registered account',
  'auth.login': 'Signed in',
  'auth.login_failed': 'Failed sign-in',
  'auth.logout': 'Signed out',
  'auth.session_revoke': 'Revoked session',
  'auth.session_revoke_others': 'Revoked other sessions',
  'user.avatar_update': 'Updated avatar',
  'contact.add': 'Added contact',
  'contact.remove': 'Removed contact',
  'conversation.create_direct': 'Started direct chat',
  'conversation.create_channel': 'Created channel',
  'conversation.create_group': 'Created group',
  'conversation.join_invite': 'Joined via invite',
  'conversation.leave': 'Left conversation',
  'conversation.delete': 'Deleted conversation',
  'conversation.add_members': 'Added members',
  'conversation.remove_member': 'Removed member',
  'conversation.avatar_update': 'Updated conversation photo',
  'conversation.pin': 'Pinned conversation',
  'conversation.unpin': 'Unpinned conversation',
  'message.send': 'Sent message',
  'message.send_attachment': 'Sent attachment',
  'message.edit': 'Edited message',
  'message.delete': 'Deleted message',
  'message.reaction': 'Reacted to message',
  'message.forward': 'Forwarded message',
  'admin.user_update': 'Admin updated user',
  'admin.session_revoke': 'Admin revoked session',
  'admin.session_revoke_all': 'Admin revoked all sessions',
  'task.create': 'Created task',
  'task.update': 'Updated task',
  'task.complete': 'Completed task',
  'task.reopen': 'Reopened task',
  'task.delete': 'Deleted task',
  'task.assign': 'Assigned task',
  'task.accept': 'Accepted task',
  'task.reject': 'Rejected task',
  'task.cancel_assignment': 'Cancelled task assignment',
};

export const AUDIT_ACTIONS = Object.entries(ACTION_LABELS).map(([value, label]) => ({
  value,
  label,
}));

export const AUDIT_DATE_PRESETS = [
  { value: '', label: 'All time' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
] as const;

export function auditDateRange(preset: string): { from?: string; to?: string } {
  if (!preset) return {};
  const now = Date.now();
  const offsets: Record<string, number> = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  };
  const ms = offsets[preset];
  if (!ms) return {};
  return { from: new Date(now - ms).toISOString() };
}

export const AUDIT_CATEGORIES = [
  { value: '', label: 'All categories' },
  { value: 'auth', label: 'Authentication' },
  { value: 'user', label: 'Profile' },
  { value: 'contact', label: 'Contacts' },
  { value: 'conversation', label: 'Conversations' },
  { value: 'message', label: 'Messages' },
  { value: 'task', label: 'Tasks' },
  { value: 'admin', label: 'Admin actions' },
];

export function formatAuditAction(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export function formatAuditDetails(metadata: Record<string, unknown>): string {
  const parts: string[] = [];

  if (typeof metadata.email === 'string') parts.push(metadata.email);
  if (typeof metadata.preview === 'string') parts.push(`"${metadata.preview}"`);
  if (typeof metadata.name === 'string') parts.push(metadata.name);
  if (typeof metadata.fileName === 'string') parts.push(metadata.fileName);
  if (typeof metadata.scope === 'string') parts.push(`scope: ${metadata.scope}`);
  if (typeof metadata.emoji === 'string') {
    parts.push(metadata.removed ? `removed ${metadata.emoji}` : metadata.emoji);
  }
  if (typeof metadata.revoked === 'number') parts.push(`${metadata.revoked} session(s)`);
  if (metadata.isActive !== undefined || metadata.isAdmin !== undefined) {
    const flags: string[] = [];
    if (metadata.isActive !== undefined) flags.push(`active=${String(metadata.isActive)}`);
    if (metadata.isAdmin !== undefined) flags.push(`admin=${String(metadata.isAdmin)}`);
    parts.push(flags.join(', '));
  }
  if (Array.isArray(metadata.addedUserIds) && metadata.addedUserIds.length > 0) {
    parts.push(`${metadata.addedUserIds.length} user(s) added`);
  }
  if (typeof metadata.forwardedCount === 'number') {
    parts.push(`${metadata.forwardedCount} destination(s)`);
  }
  if (typeof metadata.deviceLabel === 'string') parts.push(metadata.deviceLabel);
  if (typeof metadata.appName === 'string') parts.push(metadata.appName);
  if (typeof metadata.contentType === 'string') parts.push(metadata.contentType);
  if (typeof metadata.peerUserId === 'string') parts.push(`peer ${metadata.peerUserId.slice(0, 8)}…`);
  if (typeof metadata.deletedMessageCount === 'number') {
    parts.push(`${metadata.deletedMessageCount} message(s)`);
  }

  return parts.join(' · ') || '—';
}

export function formatAuditMetadata(metadata: Record<string, unknown>): string {
  if (!metadata || Object.keys(metadata).length === 0) return '{}';
  return JSON.stringify(metadata, null, 2);
}
