"use client";

import { loader } from "@monaco-editor/react";

/**
 * Monaco (the editor of VS Code) for Zeff's code editors — the Studio's IDE, the view templates' code: its files come from Zeff itself
 * (app/monaco), at an absolute address, since its workers (TypeScript, JSON) load from it inside a worker. Configured once.
 */
let done = false;
export function setupMonaco(): void {
  if (done) return;
  done = true;
  loader.config({ paths: { vs: typeof window === "undefined" ? "/monaco/vs" : `${window.location.origin}/monaco/vs` } });
}

/** Whether the page shows dark: the editor's theme follows. */
export const darkPage = (): boolean => typeof document !== "undefined" && document.documentElement.classList.contains("dark");
