"use client";

import { useEffect } from "react";
import { reloadIfStale } from "@/lib/stale-page";

/** On every page: a button whose Server Action the server no longer knows (it was rebuilt) reloads the page. */
export function StalePageGuard() {
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => {
      if (reloadIfStale(e.reason)) e.preventDefault();
    };
    const onError = (e: ErrorEvent) => {
      if (reloadIfStale(e.error ?? e.message)) e.preventDefault();
    };
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
  }, []);
  return null;
}
