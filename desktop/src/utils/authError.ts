export function extractApiErrorMessage(body: unknown, status: number): string {
  if (!body || typeof body !== 'object') {
    return `Request failed (${status})`;
  }

  const record = body as Record<string, unknown>;
  const message = record.message;

  if (typeof message === 'string' && message.trim()) {
    return message.trim();
  }

  if (Array.isArray(message)) {
    const parts = message.filter((part): part is string => typeof part === 'string' && part.trim());
    if (parts.length > 0) return parts.join(' ');
  }

  return `Request failed (${status})`;
}

export function isSessionAuthFailure(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return normalized === 'session terminated' || normalized === 'session required';
}

type AuthMode = 'login' | 'register';

const LOGIN_MESSAGES: Record<string, string> = {
  'Invalid credentials': 'Incorrect email or password. Please try again.',
};

const REGISTER_MESSAGES: Record<string, string> = {
  'Email already registered': 'This email is already registered. Try signing in instead.',
  'Username taken': 'This username is already taken. Please choose another.',
};

function mapKnownMessage(message: string, mode: AuthMode): string {
  const table = mode === 'login' ? LOGIN_MESSAGES : REGISTER_MESSAGES;
  return table[message] ?? message;
}

export function formatAuthError(error: unknown, mode: AuthMode): string {
  if (error instanceof Error) {
    const status = (error as Error & { status?: number }).status;
    const raw = error.message.trim();

    if (raw.startsWith('Cannot reach server')) {
      return raw;
    }

    if (status === 429 || /too many/i.test(raw)) {
      return 'Too many attempts. Please wait a minute and try again.';
    }

    if (status === 401 && mode === 'login') {
      return LOGIN_MESSAGES['Invalid credentials'];
    }

    if (/timed out/i.test(raw)) {
      return 'The server took too long to respond. Check that the API is running and try again.';
    }

    if (status === 409) {
      return mapKnownMessage(raw, 'register');
    }

    if (status === 400) {
      if (/password/i.test(raw) && /length|short|least/i.test(raw)) {
        return 'Password must be at least 8 characters.';
      }
      if (/email/i.test(raw)) {
        return 'Please enter a valid email address.';
      }
      if (/username/i.test(raw)) {
        return 'Username must be 3–64 characters and use only letters, numbers, or underscores.';
      }
      return mapKnownMessage(raw, mode);
    }

    return mapKnownMessage(raw, mode);
  }

  return mode === 'login'
    ? 'Could not sign in. Please try again.'
    : 'Could not create your account. Please try again.';
}
