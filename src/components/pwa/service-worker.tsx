"use client";

import { useEffect } from "react";

/** Registers /sw.js. Browsers only allow this on HTTPS or localhost; elsewhere it silently does nothing. */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
  }, []);
  return null;
}
