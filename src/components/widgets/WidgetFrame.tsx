"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildSrcdoc, parseWidgetMessage, type WidgetMessage } from "@/lib/widgets/sandbox";
import type { CallName } from "@/lib/widgets/bridge";
import { useLang, useT } from "@/components/I18nProvider";

type Bundle = { js: string[]; css: string[] };
const bundles = new Map<string, Promise<Bundle>>();

/** The libraries' code and the exercise kit (once per set of libraries and page): the frame loads nothing itself. */
function bundleOf(libs: string[]): Promise<Bundle> {
  const key = [...new Set(libs)].sort().join(",");
  let p = bundles.get(key);
  if (!p) {
    p = fetch(`/api/widgets/bundle?libs=${encodeURIComponent(key)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Bundle>) : { js: [], css: [] }))
      .catch(() => {
        bundles.delete(key); // offline for a moment: asked again next time
        return { js: [], css: [] };
      });
    bundles.set(key, p);
  }
  return p;
}

const isDark = () => typeof document !== "undefined" && (document.documentElement.classList.contains("dark") || window.matchMedia?.("(prefers-color-scheme: dark)").matches);

/** What the page answers a widget's call with (lib/widgets/bridge.ts): a value, or a thrown error the widget's promise rejects with. */
export type WidgetCallHandler = (method: CallName, args: Record<string, unknown>) => Promise<unknown>;

/**
 * An interactive widget (a building block of Zeff — lib/widgets/sandbox.ts): its HTML in a sandboxed frame (scripts
 * only: no same origin, no network), as tall as its content. Results it reports come to `onResult`, checked; its calls
 * (zeff.db.rows …) to `onCall` — without one, each call is refused. `pulse` changing tells it "changed" (read again).
 */
export function WidgetFrame({
  html,
  libs = [],
  title,
  onResult,
  onError,
  onCall,
  context,
  errorNote,
  pulse,
  bus,
  className = "",
}: {
  /** Events from outside (the other widgets on the page): called once with a sender; what it returns ends it. */
  bus?: (send: (name: string, detail: unknown) => void) => () => void;
  html: string;
  libs?: string[];
  title: string;
  onResult?: (r: Extract<WidgetMessage, { type: "result" }>) => void;
  /** Something broke inside the widget (its own note shows there; this one is for whoever made it). */
  onError?: (message: string) => void;
  onCall?: WidgetCallHandler;
  /** What the widget reads as zeff.context (JSON). */
  context?: unknown;
  /** The note it shows when it breaks. */
  errorNote?: string;
  /** Changes when the data around it changed: the widget hears "changed". */
  pulse?: number;
  className?: string;
}) {
  const t = useT();
  const lang = useLang();
  const frame = useRef<HTMLIFrameElement>(null);
  const [doc, setDoc] = useState<string | null>(null);
  const [height, setHeight] = useState(320);
  const libsKey = useMemo(() => [...new Set(libs)].sort().join(","), [libs]);
  const contextKey = useMemo(() => (context === undefined ? "" : JSON.stringify(context)), [context]);
  const report = useRef(onResult);
  const fail = useRef(onError);
  const answer = useRef(onCall);
  useEffect(() => {
    report.current = onResult;
    fail.current = onError;
    answer.current = onCall;
  }, [onResult, onError, onCall]);

  useEffect(() => {
    let alive = true;
    void bundleOf(libsKey ? libsKey.split(",") : []).then(
      (b) => alive && setDoc(buildSrcdoc(html, { inline: b, dark: isDark(), lang, ...(contextKey ? { context: JSON.parse(contextKey) as unknown } : {}), ...(errorNote ? { errorNote } : {}) })),
    );
    return () => {
      alive = false;
    };
  }, [html, libsKey, lang, contextKey, errorNote]);

  useEffect(() => {
    const post = (m: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ zeffHost: 1, ...m }, "*");
    const onMessage = (e: MessageEvent) => {
      // Only this frame's messages (a sandboxed frame's origin is "null": it's told by its window).
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const m = parseWidgetMessage(e.data);
      if (!m) return;
      if (m.type === "resize") setHeight(Math.min(m.height + 4, Math.round(window.innerHeight * 1.5)));
      else if (m.type === "error") fail.current?.(m.message);
      else if (m.type === "call") {
        const handle = answer.current;
        if (!handle) return void post({ type: "reply", id: m.id, ok: false, error: "This widget can't reach Zeff here." });
        handle(m.method, m.args).then(
          (value) => post({ type: "reply", id: m.id, ok: true, value: value === undefined ? null : value }),
          (err: unknown) => post({ type: "reply", id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) }),
        );
      } else report.current?.(m);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!bus) return;
    return bus((name, detail) => frame.current?.contentWindow?.postMessage({ zeffHost: 1, type: "event", name, detail }, "*"));
  }, [bus]);

  // (Not on the first render: only a change is news.)
  const seen = useRef(pulse);
  useEffect(() => {
    if (pulse === seen.current) return;
    seen.current = pulse;
    frame.current?.contentWindow?.postMessage({ zeffHost: 1, type: "event", name: "changed" }, "*");
  }, [pulse]);

  return (
    <div className={`overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 ${className}`}>
      {doc ? (
        <iframe ref={frame} title={title} // Forms may be sent (their submit event runs) — but nowhere: the CSP has form-action 'none'.
        sandbox="allow-scripts allow-forms" srcDoc={doc} className="block w-full border-0" style={{ height }} referrerPolicy="no-referrer" />
      ) : (
        <p className="p-4 text-sm text-zinc-500">{t("Loading the widget …")}</p>
      )}
    </div>
  );
}

/**
 * A widget as it looked at one moment (its snapshot — the bridge takes one with each result): the body it had, its
 * drawing and what was typed in it, frozen — no scripts run (the frame has none), its libraries' styles only.
 */
export function SnapshotFrame({ html, libs = [], title }: { html: string; libs?: string[]; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [doc, setDoc] = useState<string | null>(null);
  const [height, setHeight] = useState(240);
  const libsKey = useMemo(() => [...new Set(libs)].sort().join(","), [libs]);
  useEffect(() => {
    let alive = true;
    void bundleOf(libsKey ? libsKey.split(",") : []).then((b) => alive && setDoc(buildSrcdoc(html, { inline: { js: [], css: b.css }, dark: isDark() })));
    return () => {
      alive = false;
    };
  }, [html, libsKey]);
  if (doc === null) return null;
  return (
    <iframe
      ref={frame}
      title={title}
      srcDoc={doc}
      // No scripts at all; the same origin only so its height can be read here (nothing in it can run).
      sandbox="allow-same-origin"
      className="w-full rounded-lg border border-zinc-200 bg-white dark:border-zinc-800"
      style={{ height }}
      onLoad={() => {
        const h = frame.current?.contentDocument?.documentElement.scrollHeight;
        if (h) setHeight(Math.min(h + 4, 1600));
      }}
    />
  );
}
