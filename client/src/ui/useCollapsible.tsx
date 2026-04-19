import { useCallback, useEffect, useState } from "react";

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
  return { collapsed, toggle, setCollapsed };
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
