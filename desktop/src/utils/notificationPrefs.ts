const STORAGE_KEY = 'chatapp.inAppAlertsEnabled';

export function getInAppAlertsEnabled(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return true;
    return raw === '1' || raw === 'true';
  } catch {
    return true;
  }
}

export function setInAppAlertsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // Ignore quota / private mode failures.
  }
}
