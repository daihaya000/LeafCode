"use client";

import { useEffect } from "react";
import { reconcileHangTimeout } from "@/lib/hang-timeout";

/** Keep the browser warning threshold aligned with the server watchdog. */
export function HangTimeoutSync() {
  useEffect(() => {
    void reconcileHangTimeout();
  }, []);

  return null;
}
