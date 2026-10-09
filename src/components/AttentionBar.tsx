"use client";

import Link from "next/link";
import { useEffect, useSyncExternalStore, useTransition } from "react";
import { dismissAttentionAction, openServiceLoginAction, retryServiceAction } from "@/app/actions";
import type { Attention } from "@/lib/attention";
import { toast } from "./Toaster";

const NOTIFIED_KEY = "zeff-notified";
const PERMISSION_EVENT = "zeff-notification-permission";

const permission = (): NotificationPermission | "unsupported" => (typeof Notification === "undefined" ? "unsupported" : Notification.permission);
const subscribePermission = (cb: () => void) => {
  window.addEventListener(PERMISSION_EVENT, cb);
  return () => window.removeEventListener(PERMISSION_EVENT, cb);
};

/** Each request pinged once (a new question, a sign-in asked again later: again). */
function notifyNew(items: Attention[]) {
  if (permission() !== "granted") return;
  let seen: string[] = [];
  try {
    seen = JSON.parse(localStorage.getItem(NOTIFIED_KEY) ?? "[]") as string[];
  } catch {
    seen = [];
  }
  const ids = items.map((a) => `${a.key}|${a.kind === "question" ? a.body : a.at}`);
  for (const [i, a] of items.entries()) {
    if (seen.includes(ids[i])) continue;
    const n = new Notification(`Zeff: ${a.title}`, { body: a.body, tag: a.key });
    n.onclick = () => {
      window.focus();
      if (a.href) window.location.href = a.href;
      n.close();
    };
  }
  try {
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify([...new Set([...seen, ...ids])].slice(-200)));
  } catch {
    // pinged again next time, then
  }
}

/**
 * What needs you, on every page: a service to sign in to (shown in the automation Chrome on a
 * click — you sign in, Zeff never does), a question an agent waits on. Each one also pinged as a
 * browser notification (once you allow them), so you needn't watch the page.
 */
export function AttentionBar({ items }: { items: Attention[] }) {
  const perm = useSyncExternalStore(subscribePermission, permission, () => "unsupported" as const);
  useEffect(() => notifyNew(items), [items, perm]);
  if (!items.length && perm !== "default") return null;
  return (
    <div className="mx-auto w-full max-w-6xl space-y-2 px-4 pt-3">
      {items.map((a) => (
        <AttentionRow key={a.key} a={a} />
      ))}
      {perm === "default" && (
        <button
          type="button"
          className="text-xs text-indigo-600 hover:underline dark:text-indigo-400"
          onClick={() => void Notification.requestPermission().then(() => window.dispatchEvent(new Event(PERMISSION_EVENT)))}
          title="Zeff meldet sich per Browser-Benachrichtigung, wenn es dich braucht (eine Anmeldung, die Frage eines Agenten) — solange ein Zeff-Tab offen ist"
        >
          🔔 Benachrichtigungen aktivieren — Zeff meldet sich, wenn es dich braucht
        </button>
      )}
    </div>
  );
}

function AttentionRow({ a }: { a: Attention }) {
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<{ ok: boolean; error?: string; message?: string } | null | undefined>) =>
    start(async () => {
      const r = await fn();
      if (!r?.ok) toast(r?.error ?? "Ging nicht.", { tone: "error" });
      else if (r.message) toast(r.message);
    });
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100" role="alert">
      <span className="min-w-0 flex-1">
        <strong>{a.kind === "question" ? "❗ " : "🔑 "}{a.title}</strong>
        <span className="ml-2 text-xs opacity-80">{a.body}</span>
      </span>
      {a.kind === "login" && a.service && (
        <span className="flex shrink-0 gap-1.5">
          <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={() => act(() => openServiceLoginAction(a.service!))} title="Die Seite im Automation-Chrome nach vorne holen (oder öffnen) — dort meldest du dich selbst an">
            Anmeldung öffnen
          </button>
          <button type="button" className="btn btn-sm" disabled={pending} onClick={() => act(() => retryServiceAction(a.service!))} title="Angemeldet? Dann jetzt noch einmal versuchen">
            {pending ? "…" : "Erneut prüfen"}
          </button>
          <button type="button" className="btn btn-sm" disabled={pending} onClick={() => act(() => dismissAttentionAction(a.key))} title="Ausblenden, bis der Dienst wieder fragt">
            Später
          </button>
        </span>
      )}
      {a.kind === "question" && a.href && (
        <Link href={a.href} className="btn btn-sm btn-primary shrink-0">
          Ansehen
        </Link>
      )}
    </div>
  );
}
