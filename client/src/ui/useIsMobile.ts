import { useEffect, useState } from "react";

const QUERY = "(max-width: 640px), (pointer: coarse)";

// Return true when the user is on a phone-sized viewport or a coarse-pointer
// device (tablets with large screens included). Used to swap the floating
// draggable panel layout for a mobile-friendly bottom sheet.
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(QUERY).matches;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(QUERY);
    const update = () => setIsMobile(mq.matches);
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return isMobile;
}
