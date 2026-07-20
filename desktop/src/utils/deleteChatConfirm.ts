export function getDeleteChatConfirm(scope: 'me' | 'everyone') {
  if (scope === 'me') {
    return {
      title: 'Delete chat for you',
      message: 'This chat will be removed from your list. Messages will stay for others.',
      confirmLabel: 'Delete for me',
      danger: false,
    };
  }

  return {
    title: 'Delete for everyone',
    message:
      'All messages you sent will be deleted for everyone. This chat will be removed from your list.',
    confirmLabel: 'Delete for everyone',
    danger: true,
  };
}

export function getLeaveChannelConfirm() {
  return {
    title: 'Leave channel?',
    message:
      'You will leave this channel and it will be removed from your list. You can rejoin with an invite link.',
    confirmLabel: 'Leave channel',
    danger: true,
  };
}

export function getLogoutConfirm() {
  return {
    title: 'Sign out?',
    message: 'You will be signed out of RELAY on this device.',
    confirmLabel: 'Sign out',
    danger: true,
  };
}
