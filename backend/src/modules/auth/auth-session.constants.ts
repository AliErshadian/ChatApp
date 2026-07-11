export const AUTH_SESSION_TERMINATED_MESSAGE = 'Session terminated';
export const AUTH_SESSION_REQUIRED_MESSAGE = 'Session required';

export function isSessionAuthFailureMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return (
    normalized === AUTH_SESSION_TERMINATED_MESSAGE.toLowerCase() ||
    normalized === AUTH_SESSION_REQUIRED_MESSAGE.toLowerCase()
  );
}
