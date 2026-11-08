"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "./I18nProvider";

/** The phone app's offer (app.getzeff.com shows Zeff in a frame; its page holds the browser's install offer). */
type ShellInstall = { available(): boolean; prompt(): Promise<void>; subscribe(fn: () => void): () => void };
type InstallPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };

/**
 * "+" in the header while Zeff can be put on the home screen: in the phone app (app.getzeff.com) it asks the app's page,
 * which has the browser's offer (or, on an iPhone, says where Safari's "Add to Home Screen" is); opened directly, it
 * takes the browser's offer itself. Not there when there's nothing to offer — installed already, or a browser that can't.
 */
export function InstallAppButton() {
  const t = useT();
  const [can, setCan] = useState(false);
  const shell = useRef<ShellInstall | null>(null);
  const own = useRef<InstallPrompt | null>(null);
  useEffect(() => {
    try {
      shell.current = window.parent !== window ? ((window.parent as unknown as { zeffInstall?: ShellInstall }).zeffInstall ?? null) : null;
    } catch {
      shell.current = null; // another site's frame
    }
    const s = shell.current;
    if (s) {
      const update = () => setCan(s.available());
      update();
      return s.subscribe(update);
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      own.current = e as InstallPrompt;
      setCan(true);
    };
    const onInstalled = () => setCan(false);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  if (!can) return null;
  const install = async () => {
    if (shell.current) return shell.current.prompt();
    const p = own.current;
    if (!p) return;
    await p.prompt();
    await p.userChoice.catch(() => null);
    own.current = null;
    setCan(false);
  };
  return (
    <button
      type="button"
      onClick={() => void install()}
      className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-zinc-600 transition hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:text-zinc-300 dark:hover:bg-zinc-800"
      aria-label={t("Install as an app")}
      title={t("Install Zeff as an app on this device")}
    >
      <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
        <path d="M10 4.5v11M4.5 10h11" />
      </svg>
    </button>
  );
}
