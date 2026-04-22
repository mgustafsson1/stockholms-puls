import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefCallback } from "react";
import { useIsMobile } from "./useIsMobile";

type Anchor =
  | { left: number; top: number }
  | { right: number; top: number }
  | { left: number; bottom: number }
  | { right: number; bottom: number };

interface Options {
  storageKey: string;
  defaultAnchor: Anchor;
}

type Pos = { x: number; y: number };

interface Result {
  style: CSSProperties;
  ref: RefCallback<HTMLElement>;
  handlers: {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
  };
  dragging: boolean;
}

function loadStored(key: string): Pos | null {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    if (!raw) return null;
    const p = JSON.parse(raw) as Pos;
    return Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
  } catch {
    return null;
  }
}

export function useDraggable({ storageKey, defaultAnchor }: Options): Result {
  const key = `panel-pos:${storageKey}`;
  const [pos, setPos] = useState<Pos | null>(() => loadStored(key));
  const [dragging, setDragging] = useState(false);
  const dragState = useRef<{ startX: number; startY: number; basePos: Pos } | null>(null);
  const elementRef = useRef<HTMLElement | null>(null);
  const isMobile = useIsMobile();

  const setRef = useCallback<RefCallback<HTMLElement>>((el) => {
    elementRef.current = el;
  }, []);

  useLayoutEffect(() => {
    if (pos) return;
    const el = elementRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const x = "left" in defaultAnchor ? defaultAnchor.left : vw - defaultAnchor.right - rect.width;
    const y = "top" in defaultAnchor ? defaultAnchor.top : vh - defaultAnchor.bottom - rect.height;
    setPos({ x: Math.round(x), y: Math.round(y) });
  });

  useEffect(() => {
    if (!pos) return;
    try {
      localStorage.setItem(key, JSON.stringify(pos));
    } catch {}
  }, [key, pos]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest("button, input, textarea, select, a, [data-nodrag]")) return;
      if (!pos) return;
      dragState.current = { startX: e.clientX, startY: e.clientY, basePos: pos };
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
    },
    [pos]
  );

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const d = dragState.current;
    if (!d) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const nx = Math.max(-160, Math.min(vw - 60, d.basePos.x + (e.clientX - d.startX)));
    const ny = Math.max(0, Math.min(vh - 60, d.basePos.y + (e.clientY - d.startY)));
    setPos({ x: nx, y: ny });
  }, []);

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    dragState.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDragging(false);
  }, []);

  // Mobile short-circuit: panels flow in a bottom-sheet container rather than
  // floating free, so return an empty style (lets the CSS class-based layout
  // take over) and no-op handlers so a stray touch can't wrench a panel to
  // an off-screen position.
  if (isMobile) {
    return {
      style: {},
      ref: setRef,
      handlers: {
        onPointerDown: () => {},
        onPointerMove: () => {},
        onPointerUp: () => {},
        onPointerCancel: () => {},
      },
      dragging: false,
    };
  }

  const style: CSSProperties = pos
    ? {
        position: "fixed",
        left: pos.x,
        top: pos.y,
        right: "auto",
        bottom: "auto",
        cursor: dragging ? "grabbing" : "grab",
        userSelect: dragging ? "none" : undefined,
        touchAction: "none",
      }
    : {
        position: "fixed",
        ...("left" in defaultAnchor ? { left: defaultAnchor.left } : { right: defaultAnchor.right }),
        ...("top" in defaultAnchor ? { top: defaultAnchor.top } : { bottom: defaultAnchor.bottom }),
        cursor: "grab",
        touchAction: "none",
      };

  return {
    style,
    ref: setRef,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
    dragging,
  };
}
