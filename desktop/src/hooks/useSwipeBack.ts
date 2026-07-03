import { useEffect, useRef, type RefObject } from 'react';

interface Options {
  enabled: boolean;
  edgeWidth?: number;
  onOffset: (offset: number) => void;
  onRelease: (offset: number, width: number) => void;
}

export function useSwipeBack(
  ref: RefObject<HTMLElement | null>,
  { enabled, edgeWidth = 28, onOffset, onRelease }: Options,
) {
  const draggingRef = useRef(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const onOffsetRef = useRef(onOffset);
  const onReleaseRef = useRef(onRelease);

  onOffsetRef.current = onOffset;
  onReleaseRef.current = onRelease;

  useEffect(() => {
    if (!enabled) {
      onOffsetRef.current(0);
      return;
    }

    const el = ref.current;
    if (!el) return;

    const resetDrag = () => {
      draggingRef.current = false;
      startRef.current = null;
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      if (touch.clientX > edgeWidth) return;

      draggingRef.current = true;
      startRef.current = { x: touch.clientX, y: touch.clientY };
      onOffsetRef.current(0);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!draggingRef.current || !startRef.current) return;

      const touch = e.touches[0];
      const dx = touch.clientX - startRef.current.x;
      const dy = touch.clientY - startRef.current.y;

      if (dx < 6 && Math.abs(dy) > Math.abs(dx)) {
        resetDrag();
        onOffsetRef.current(0);
        return;
      }

      if (dx <= 0) {
        onOffsetRef.current(0);
        return;
      }

      if (Math.abs(dx) < Math.abs(dy) * 1.2) {
        resetDrag();
        onOffsetRef.current(0);
        return;
      }

      onOffsetRef.current(Math.min(dx, el.offsetWidth));
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!draggingRef.current || !startRef.current) {
        resetDrag();
        return;
      }

      const touch = e.changedTouches[0];
      const dx = Math.max(0, touch.clientX - startRef.current.x);
      const width = el.offsetWidth;
      resetDrag();
      onReleaseRef.current(dx, width);
    };

    const onTouchCancel = () => {
      if (draggingRef.current) {
        onReleaseRef.current(0, el.offsetWidth);
      }
      resetDrag();
      onOffsetRef.current(0);
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchCancel, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [enabled, edgeWidth, ref]);
}
