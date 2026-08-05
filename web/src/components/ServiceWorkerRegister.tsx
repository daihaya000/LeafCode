"use client";

import { useEffect } from "react";

const BUILD_COMMIT = process.env.NEXT_PUBLIC_BUILD_COMMIT?.trim() || "";

/** Registers the offline-shell service worker (production, browsers only). */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Registration is best-effort; ignore failures.
    });

    // Notify the SW of the current build id so it can wipe the navigation
    // cache when a new deploy replaces web/.next. Without this, a stale
    // cached "/" (referencing deleted _next chunk hashes) renders as a white
    // screen on slow/VPN networks that fall back to the cached HTML.
    function notifyBuildId() {
      if (!BUILD_COMMIT) return;
      navigator.serviceWorker.ready
        .then((reg) => {
          reg.active?.postMessage({ type: "BUILD_ID", id: BUILD_COMMIT });
        })
        .catch(() => {});
    }
    notifyBuildId();
    navigator.serviceWorker.addEventListener("controllerchange", notifyBuildId);

    return () => {
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        notifyBuildId,
      );
    };
  }, []);

  return null;
}