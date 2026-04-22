import { useCallback, useEffect, useState } from "react";
import { useIsMobile } from "./useIsMobile";

export function useCollapsible(storageKey: string, initial = false) {
  const key = `panel-collapsed:${storageKey}`;
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const v = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
      if (v === "true") return true;
      if (v === "false") return false;
    } catch {}
    return initial;
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, String(collapsed));
    } catch {}
  }, [key, collapsed]);

  const toggle = useCallback(() => setCollapsed((c) => !c), []);
  // On mobile the drawer menu only ever shows ONE panel at a time, so an
  // internal collapse toggle is redundant — and worse, a user's stored
  // collapsed state from desktop would hide the whole body. Force expanded.
  const isMobile = useIsMobile();
  return { collapsed: isMobile ? false : collapsed, toggle, setCollapsed };
}

export interface CollapseButtonProps {
  collapsed: boolean;
  onToggle: () => void;
  size?: number;
}

export function CollapseButton({ collapsed, onToggle, size = 26 }: CollapseButtonProps) {
  return (
    <button
      onClick={onToggle}
      aria-label={collapsed ? "Visa" : "Dölj"}
      data-nodrag
      data-collapse-toggle
      style={{
        background: "transparent",
        border: "1px solid rgba(255,255,255,0.14)",
        color: "#8b98ad",
        width: size,
        height: size,
        borderRadius: 6,
        cursor: "pointer",
        fontSize: 12,
        flexShrink: 0,
        lineHeight: 1,
      }}
    >
      {collapsed ? "▸" : "▾"}
    </button>
  );
}
