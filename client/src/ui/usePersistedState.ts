import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

// useState that persists itself to localStorage. Use for small UI prefs —
// scalar values like the currently-selected trend metric or alert filter —
// where a dedicated setter in the store would be overkill.
export function usePersistedState<T>(
  key: string,
  initial: T,
  validate: (v: unknown) => v is T = ((v: unknown): v is T => true) as (v: unknown) => v is T
): [T, Dispatch<SetStateAction<T>>] {
  const storageKey = `sl:${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      if (typeof localStorage === "undefined") return initial;
      const raw = localStorage.getItem(storageKey);
      if (raw == null) return initial;
      const parsed = JSON.parse(raw);
      return validate(parsed) ? parsed : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {}
  }, [storageKey, value]);

  return [value, setValue];
}
