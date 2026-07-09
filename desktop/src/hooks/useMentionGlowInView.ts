import { RefObject, useEffect, useRef, useState } from 'react';

export function useMentionGlowInView(
  elementRef: RefObject<HTMLElement | null>,
  scrollRootRef: RefObject<HTMLElement | null> | undefined,
  enabled: boolean,
  onConsumed?: () => void,
) {
  const [glowActive, setGlowActive] = useState(false);
  const hasTriggeredRef = useRef(false);

  useEffect(() => {
    const element = elementRef.current;
    const root = scrollRootRef?.current;
    if (!element || !root) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        const visible = entry.isIntersecting;

        if (visible && enabled && !hasTriggeredRef.current) {
          hasTriggeredRef.current = true;
          setGlowActive(true);
          onConsumed?.();
        }

        if (!visible && hasTriggeredRef.current) {
          setGlowActive(false);
        }
      },
      { root, threshold: 0.35 },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, elementRef, scrollRootRef, onConsumed]);

  return glowActive;
}
