"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { dismissAttentionAction, openServiceLoginAction, retryServiceAction, runSyncAction } from "@/app/actions";
import type { Attention } from "@/lib/attention";
import { toast } from "./Toaster";
import { sourceToasts } from "@/lib/sync/source-toasts";
import { useT } from "@/components/I18nProvider";

const NOTIFIED_KEY = "zeff-notified";
const TOASTED_SOURCES_KEY = "zeff-toasted-sources";
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
  // Not yet for the desktop (a source not well only a short while): not pinged, nor counted as pinged — it may be later.
  const due = items.filter((a) => a.notify !== false);
  const ids = due.map((a) => `${a.key}|${a.kind === "question" ? a.body : a.at}`);
  for (const [i, a] of due.entries()) {
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
 * yellow dot on the Code tab and its session. Each one is also pinged as a browser notification
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
        action: { label: t("Open sign-in"), run: () => void runSaid(t, t("Opening the sign-in on the computer (automation Chrome) …"), () => openServiceLoginAction(a.service!)) },
      });
    }
  }, [items, t]);
  // A source that isn't well (silent, not running, failing, its app changed): a toast once per incident — in any tab, across reloads.
  useEffect(() => {
    const sources = items.filter((a) => a.kind === "source" && a.step);
    if (!sources.length) return;
    let seen: string[] = [];
    try {
      seen = JSON.parse(localStorage.getItem(TOASTED_SOURCES_KEY) ?? "[]") as string[];
    } catch {
      seen = [];
    }
    const fresh = sources.filter((a) => !seen.includes(a.key));
    seen.push(...fresh.map((a) => a.key));
    // Several at once: one notice naming them (not a stack of red toasts over half the screen).
    for (const n of sourceToasts(fresh.map((a) => ({ key: a.key, title: a.title, body: a.body, step: a.step! })), t)) {
      const { action } = n;
      toast(n.text, {
        tone: "error",
        ms: 20000,
        action:
          action.kind === "sync"
            ? { label: t("Sync now"), run: () => void runSaid(t, t("Syncing — this can take a minute …"), () => runSyncAction(action.step)) }
            : { label: t("Details"), run: () => void (window.location.href = "/diagnostics#sources") },
      });
    }
    try {
      localStorage.setItem(TOASTED_SOURCES_KEY, JSON.stringify(seen.slice(-100)));
    } catch {
      // toasted again next time, then
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

type Result = { ok: boolean; error?: string; message?: string } | null | undefined;

/**
 * A button's action, said at once ("Opening … on the computer") — it runs on the PC (Chrome brought up, a sync) and takes
 * a while; on a phone nothing else would show till it's done — then its answer.
 */
export function runSaid(t: (s: string, v?: Record<string, string | number>) => string, note: string, fn: () => Promise<Result>): Promise<void> {
  if (note) toast(note, { ms: 6000 });
  return fn().then(
    (r) => (!r?.ok ? toast(r?.error ?? t("Didn't work."), { tone: "error" }) : toast(r.message ?? t("Done."))),
    () => toast(t("Didn't work."), { tone: "error" }),
  );
}

function AttentionRow({ a }: { a: Attention }) {
  const t = useT();
  const [pending, start] = useTransition();
  const [which, setWhich] = useState("");
  const act = (id: string, note: string, fn: () => Promise<Result>) => {
    setWhich(id);
    start(() => runSaid(t, note, fn));
  };
  const label = (id: string, text: string) => (pending && which === id ? `${text} …` : text);
  return (
    // The text on top, its actions in a row of their own below (not squeezed beside it).
    <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100" role="alert">
      <div className="min-w-0">
        <strong>{a.kind === "question" ? "❗ " : "🔑 "}{a.title}</strong>
        {a.body && <div className="text-xs">{a.body}</div>}
      </div>
      {a.kind === "login" && a.service && (
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={() => act("open", t("Opening the sign-in on the computer (automation Chrome) …"), () => openServiceLoginAction(a.service!))} title={t("Bring the page to the front in the automation Chrome (or open it) — you sign in there yourself")}>
            {label("open", t("Open sign-in"))}
          </button>
          <button type="button" className="btn btn-sm" disabled={pending} onClick={() => act("retry", t("Checking again — this can take a minute …"), () => retryServiceAction(a.service!))} title={t("Signed in? Then try again now")}>
            {label("retry", t("Check again"))}
          </button>
          <button type="button" className="btn btn-sm" disabled={pending} onClick={() => act("later", "", () => dismissAttentionAction(a.key).then((r) => (r?.ok ? { ok: true, message: t("Hidden until it asks again.") } : r)))} title={t("Hide until the service asks again")}>
            {label("later", t("Later"))}
          </button>
        </div>
      )}
      {a.kind === "question" && a.href && (
        <div className="flex">
          <Link href={a.href} className="btn btn-sm btn-primary">
            {t("View")}
          </Link>
        </div>
      )}
    </div>
  );
}
