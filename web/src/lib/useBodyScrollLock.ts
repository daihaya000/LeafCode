import { useEffect } from "react";

let activeLocks = 0;
let previousOverflow = "";

/** Prevent the page behind a modal from scrolling while preserving its prior style. */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    if (activeLocks === 0) previousOverflow = document.body.style.overflow;
    activeLocks += 1;
    document.body.style.overflow = "hidden";

    return () => {
      activeLocks = Math.max(0, activeLocks - 1);
      if (activeLocks === 0) document.body.style.overflow = previousOverflow;
    };
  }, [active]);
}
