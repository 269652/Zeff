"use client";

import Link from "next/link";
import { useEffect, useRef, useSyncExternalStore, useTransition } from "react";
import { dismissAttentionAction, openServiceLoginAction, retryServiceAction } from "@/app/actions";
import type { Attention } from "@/lib/attention";
import { toast } from "./Toaster";
import { useT } from "@/components/I18nProvider";

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
 * click — you sign in, Zeff never does). A question an agent waits on gets no banner — it's a
 * yellow dot on the Work tab and its session. Each one is also pinged as a browser notification
 * (once you allow them), so you needn't watch the page.
 */
export function AttentionBar({ items }: { items: Attention[] }) {
  const t = useT();
  const perm = useSyncExternalStore(subscribePermission, permission, () => "unsupported" as const);
  useEffect(() => notifyNew(items), [items, perm]);
  // A sync that asks for a sign-in: a toast right where you are (once per request), with the button that brings the page up.
  const toasted = useRef<Set<string> | null>(null);
  useEffect(() => {
    const logins = items.filter((a) => a.kind === "login" && a.service);
    const seen = (toasted.current ??= new Set());
    for (const a of logins) {
      const id = `${a.key}|${a.at}`;
      if (seen.has(id)) continue;
      seen.add(id);
      toast(a.title, {
        tone: "error",
        ms: 20000,
        action: { label: t("Open sign-in"), run: () => void openServiceLoginAction(a.service!).then((r) => toast(r?.ok ? (r.message ?? t("Done.")) : (r?.error ?? t("Didn't work.")), { tone: r?.ok ? "ok" : "error" })) },
      });
    }
  }, [items, t]);
  const logins = items.filter((a) => a.kind === "login");
  if (!logins.length) return null;
  return (
    <div className="mx-auto w-full max-w-6xl space-y-2 px-4 pt-3">
      {logins.map((a) => (
        <AttentionRow key={a.key} a={a} />
      ))}
      {perm === "default" && (
        <button
          type="button"
          className="text-xs text-indigo-600 hover:underline dark:text-indigo-400"
          onClick={() => void Notification.requestPermission().then(() => window.dispatchEvent(new Event(PERMISSION_EVENT)))}
          title={t("Zeff sends a browser notification when it needs you (a sign-in, an agent's question) — as long as a Zeff tab is open")}
        >
          🔔 {t("Turn on notifications — Zeff lets you know when it needs you")}
        </button>
      )}
    </div>
  );
}

function AttentionRow({ a }: { a: Attention }) {
  const t = useT();
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<{ ok: boolean; error?: string; message?: string } | null | undefined>) =>
    start(async () => {
      const r = await fn();
      if (!r?.ok) toast(r?.error ?? t("Didn't work."), { tone: "error" });
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
          <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={() => act(() => openServiceLoginAction(a.service!))} title={t("Bring the page to the front in the automation Chrome (or open it) — you sign in there yourself")}>
            {t("Open sign-in")}
          </button>
          <button type="button" className="btn btn-sm" disabled={pending} onClick={() => act(() => retryServiceAction(a.service!))} title={t("Signed in? Then try again now")}>
            {pending ? "…" : t("Check again")}
          </button>
          <button type="button" className="btn btn-sm" disabled={pending} onClick={() => act(() => dismissAttentionAction(a.key))} title={t("Hide until the service asks again")}>
            {t("Later")}
          </button>
        </span>
      )}
      {a.kind === "question" && a.href && (
        <Link href={a.href} className="btn btn-sm btn-primary shrink-0">
          {t("View")}
        </Link>
      )}
    </div>
  );
}
