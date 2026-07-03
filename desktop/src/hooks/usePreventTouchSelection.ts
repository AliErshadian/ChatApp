import { useEffect, type RefObject } from 'react';

export function usePreventTouchSelection<T extends HTMLElement>(
  ref: RefObject<T | null>,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;

    const preventSelect = (e: Event) => {
      e.preventDefault();
    };

    el.addEventListener('selectstart', preventSelect);
    el.addEventListener('dragstart', preventSelect);

    return () => {
      el.removeEventListener('selectstart', preventSelect);
      el.removeEventListener('dragstart', preventSelect);
    };
  }, [ref, enabled]);
}

export function clearTextSelection() {
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    selection.removeAllRanges();
  }
}
