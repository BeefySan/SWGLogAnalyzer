import { useEffect, useRef } from "react";

export type RafHoverOptions = {
  /** Convert x (px) within container to a time (seconds or ms) */
  xToTime: (x: number) => number;
  /** Sorted ascending array of timestamps (same units as xToTime output) used to find nearest point */
  times?: number[];
  /** Called only when nearest index OR hover time changes meaningfully */
  onUpdate?: (info: { x: number; time: number; index: number }) => void;
  /** Min px movement before we recompute (default 1) */
  minDeltaPx?: number;
};

/**
 * Adds a highly-performant passive pointermove handler that coalesces updates via requestAnimationFrame.
 * Avoids re-render storms by invoking a callback only when values actually change.
 */
export function useRafHover(container: React.RefObject<HTMLElement>, opts: RafHoverOptions) {
  const { xToTime, times = [], onUpdate, minDeltaPx = 1 } = opts;
  const rafId = useRef<number | null>(null);
  const lastX = useRef<number | null>(null);
  const lastIndex = useRef<number | null>(null);
  const lastTime = useRef<number | null>(null);
  const pendingX = useRef<number | null>(null);

  function binarySearchNearest(arr: number[], t: number): number {
    if (arr.length === 0) return -1;
    let lo = 0, hi = arr.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    // lo is first >= t; choose closer of lo-1 and lo
    let best = lo;
    if (lo > 0 && Math.abs(arr[lo - 1] - t) <= Math.abs(arr[lo] - t)) best = lo - 1;
    return best;
  }

  useEffect(() => {
    const el = container.current;
    if (!el) return;

    let rect = el.getBoundingClientRect();
    let running = true;

    const updateRect = () => { rect = el.getBoundingClientRect(); };

    const schedule = () => {
      if (rafId.current != null) return;
      rafId.current = requestAnimationFrame(() => {
        rafId.current = null;
        const x = pendingX.current;
        if (x == null) return;
        // snap to container
        const clampedX = Math.max(0, Math.min(x - rect.left, rect.width));
        if (lastX.current != null && Math.abs(clampedX - lastX.current) < minDeltaPx) return;
        const time = xToTime(clampedX);
        let idx = -1;
        if (times && times.length) idx = binarySearchNearest(times, time);

        const changed = (lastIndex.current !== idx) || (lastTime.current == null || Math.abs((lastTime.current as number) - time) > 1e-6);
        if (changed) {
          lastX.current = clampedX;
          lastTime.current = time;
          lastIndex.current = idx;
          onUpdate?.({ x: clampedX, time, index: idx });
        }
      });
    };

    const onPointerMove = (e: PointerEvent) => {
      pendingX.current = e.clientX;
      schedule();
    };

    const onPointerEnter = (e: PointerEvent) => {
      pendingX.current = e.clientX;
      schedule();
    };

    const onResize = () => updateRect();
    const onScroll = () => updateRect();

    el.addEventListener("pointermove", onPointerMove, { passive: true });
    el.addEventListener("pointerenter", onPointerEnter, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });

    // keep rect fresh if layout changes (e.g., panel resize)
    const ro = new ResizeObserver(updateRect);
    ro.observe(el);

    return () => {
      running = false;
      if (rafId.current != null) cancelAnimationFrame(rafId.current);
      el.removeEventListener("pointermove", onPointerMove as any);
      el.removeEventListener("pointerenter", onPointerEnter as any);
      window.removeEventListener("resize", onResize as any);
      window.removeEventListener("scroll", onScroll as any);
      ro.disconnect();
    };
  }, [container, xToTime, onUpdate, minDeltaPx, times && times.length]);
}