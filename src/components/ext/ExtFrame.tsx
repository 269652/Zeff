"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "../Toaster";

/** What a panel is told about where it's shown (a session panel: that session). */
export type ExtContext = { runId?: number; ticket?: string; todoId?: number };

const METHOD = /^[a-z][a-zA-Z.]{0,60}$/;

/**
 * A plugin's panel: its page in a sandboxed frame (no origin of its own, so it can't read Zeff's
 * page, cookies or storage, and can't call Zeff's API itself). The frame talks to this component by
 * messages — zeff.js (/ext/sdk/zeff.js) does that in the panel — and this component asks the API for
 * it, naming the plugin; the server checks what that plugin may do. A few methods are the page's own
 * (ui.toast, ui.navigate, ui.resize). Zeff's changes (work, todos …) are passed on as "change" events.
 * docs/plugins/panels.md.
 */
export function ExtFrame({ plugin, entry, title, context, fill = true }: { plugin: string; entry: string; title: string; context?: ExtContext; /** Fill the space it's given (a tab); else its height is the panel's (ui.resize). */ fill?: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const router = useRouter();
  const [height, setHeight] = useState(320);
  // The frame is rendered only once this page listens: its script talks to us at once, and a message sent
  // before the page is hydrated (the frame comes with the server's HTML) would be lost.
  const [listening, setListening] = useState(false);
  const ctx = useRef(context);
  useEffect(() => {
    ctx.current = context;
  }, [context]);

  useEffect(() => {
    const send = (msg: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ zeffExt: 1, ...msg }, "*");

    async function api(method: string, params: unknown): Promise<unknown> {
      const res = await fetch(`/api/ext/v1/${encodeURIComponent(method)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-zeff-ext-panel": plugin },
        body: JSON.stringify(params ?? {}),
      });
      const j = (await res.json().catch(() => null)) as { ok?: boolean; result?: unknown; error?: { code: string; message: string } } | null;
      if (!j?.ok) throw Object.assign(new Error(j?.error?.message ?? `HTTP ${res.status}`), { code: j?.error?.code ?? "failed" });
      return j.result;
    }

    async function handle(id: number, method: string, params: Record<string, unknown>) {
      switch (method) {
        case "hello":
          return { ...((await api("hello", {})) as object), context: ctx.current ?? {} };
        case "ui.toast":
          toast(String(params.message ?? "").slice(0, 300), { tone: params.tone === "error" ? "error" : undefined });
          return true;
        case "ui.navigate": {
          const href = String(params.href ?? "");
          // Zeff's own pages only (not another site, not the API, not another plugin's files).
          if (!href.startsWith("/") || href.startsWith("//") || href.startsWith("/api/") || href.startsWith("/ext/")) throw Object.assign(new Error("href: a path of Zeff's pages, like /work?run=3"), { code: "bad_request" });
          router.push(href);
          return true;
        }
        case "ui.resize": {
          const h = Number(params.height);
          if (!Number.isFinite(h)) throw Object.assign(new Error("height: a number"), { code: "bad_request" });
          setHeight(Math.max(80, Math.min(2000, Math.round(h))));
          return true;
        }
        default:
          if (!METHOD.test(method)) throw Object.assign(new Error("Unknown method."), { code: "not_found" });
          return api(method, params);
      }
    }

    function onMessage(e: MessageEvent) {
      const m = e.data as { zeffExt?: number; id?: unknown; method?: unknown; params?: unknown } | null;
      // Only this frame's own window — another frame, or a page, can't speak for the plugin.
      if (e.source !== frame.current?.contentWindow || m?.zeffExt !== 1 || typeof m.id !== "number" || typeof m.method !== "string") return;
      const id = m.id;
      const params = m.params && typeof m.params === "object" && !Array.isArray(m.params) ? (m.params as Record<string, unknown>) : {};
      handle(id, m.method, params).then(
        (result) => send({ id, ok: true, result }),
        (err: { message?: string; code?: string }) => send({ id, ok: false, error: { code: err.code ?? "failed", message: err.message ?? "failed" } }),
      );
    }
    window.addEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the listener is in place: the frame may load now
    setListening(true);

    const events = new EventSource("/api/events");
    events.addEventListener("change", (ev) => send({ event: "change", data: { topic: (ev as MessageEvent).data } }));
    return () => {
      window.removeEventListener("message", onMessage);
      events.close();
    };
  }, [plugin, router]);

  const src = `/ext/${encodeURIComponent(plugin)}/${entry.split("/").map(encodeURIComponent).join("/")}`;
  const box = `block w-full rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 ${fill ? "min-h-0 flex-1" : ""}`;
  if (!listening) return <div className={box} style={fill ? undefined : { height }} aria-busy />;
  return (
    <iframe
      ref={frame}
      src={src}
      title={title}
      // Scripts and forms, nothing more: no same-origin (it would hand over Zeff's page), no top navigation.
      sandbox="allow-scripts allow-forms allow-popups allow-modals"
      referrerPolicy="no-referrer"
      className={box}
      style={fill ? undefined : { height }}
    />
  );
}
