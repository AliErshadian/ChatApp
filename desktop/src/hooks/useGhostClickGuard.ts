import { useCallback, useRef } from 'react';

const DEFAULT_MS = 500;

export function useGhostClickGuard() {
  const suppressUntilRef = useRef(0);

  const arm = useCallback((durationMs = DEFAULT_MS) => {
    suppressUntilRef.current = Date.now() + durationMs;
  }, []);

  const isSuppressed = useCallback(() => Date.now() < suppressUntilRef.current, []);

  const guard = useCallback(
    (fn: () => void) => () => {
      if (isSuppressed()) return;
      fn();
    },
    [isSuppressed],
  );

  return { arm, isSuppressed, guard };
}
