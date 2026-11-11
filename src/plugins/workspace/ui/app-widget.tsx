"use client";

import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { AiProgressBar, AiWorkingLabel } from "@/components/AiWorking";
import { WidgetFrame, type WidgetCallHandler } from "@/components/widgets/WidgetFrame";
import { MAX_STATE, missing, wantsOf, widgetKey, type WidgetGrant, type WidgetWants } from "@/lib/widgets/bridge";
import { WIDGET_LIBS } from "@/lib/widgets/sandbox";
import { postJson } from "@/lib/post-json";
import { allowWidgetAction, saveBlockAction, publishWidgetValueAction, revokeWidgetAction, saveWidgetVersionAction, setWidgetPageStateAction, widgetCallAction, widgetContextAction, widgetGrantAction, widgetPageStateAction, widgetVersionAction, widgetVersionsAction } from "../actions";
import type { MadeWidget } from "../widget-make";
import { GripBar } from "./app-nodes";
import { WS_CHANGED } from "./ChatPanel";

type Context = { page?: { id: number; title: string }; databases: { id: number; title: string; onPage?: boolean }[] };

/** The page's bus: what one widget shares or says (zeff.page.set, zeff.emit) reaches the other widgets on the same page. */
const BUS = "zeff-widget-bus";
type BusEvent = { page: number; from: string; name: string; detail: unknown };
const say = (e: BusEvent) => window.dispatchEvent(new CustomEvent<BusEvent>(BUS, { detail: e }));
/** Shared values where there is no page (the assistant's answer): kept while the page is open. */
const loose = new Map<string, unknown>();

/**
 * A widget an AI wrote (lib/widgets — a form, a table, a calculator, a small app), shown with Zeff's data bridge: its calls
 * go to the Workspace (widget-bridge.ts checks them), what it may write is asked of you once — a bar under it names the
 * databases and whether it asks the AI, and Allow grants it to this widget's code. Its state is kept by whoever shows it
 * (`state`, `onState`: a page's block keeps it in the block); a write tells the pages and the other widgets.
 */
export function AppWidget({
  html,
  libs = [],
  title,
  wants,
  pageId,
  state,
  onState,
  showGrants = false,
  onError,
  wid,
  params,
  className = "",
}: {
  /** What a widget block was given (blocks.ts): zeff.context.params. */
  params?: unknown;
  /** The block it is (its published values are the block's). */
  wid?: string;
  /** Something broke inside it (the block offers to have it fixed). */
  onError?: (message: string) => void;
  html: string;
  libs?: string[];
  title: string;
  wants: WidgetWants;
  /** The page it stands on (zeff.context names its databases first). */
  pageId?: number | null;
  /** What it kept (JSON) — none: kept only while it is shown. */
  state?: string;
  onState?: (json: string) => void;
  /** The databases it may write to shown under it, each to take back (a page's block, while it is edited). */
  showGrants?: boolean;
  className?: string;
}) {
  const t = useT();
  const router = useRouter();
  const me = useId();
  const key = useMemo(() => widgetKey(html), [html]);
  const [grant, setGrant] = useState<WidgetGrant | null>(null);
  const [context, setContext] = useState<Context | null>(null);
  const [pulse, setPulse] = useState(0);
  const kept = useRef<string>(state ?? "null");
  useEffect(() => {
    kept.current = state ?? kept.current;
  }, [state]);

  useEffect(() => {
    let live = true;
    void widgetGrantAction(key, pageId ?? null).then((r) => {
      if (!live || !r.ok) return;
      setGrant(r.grant);
      setContext(r.context as Context);
    });
    return () => {
      live = false;
    };
  }, [key, pageId]);

  // Something changed in the workspace (the assistant, another widget, a page): the widget hears "changed".
  useEffect(() => {
    const bump = () => setPulse((n) => n + 1);
    window.addEventListener(WS_CHANGED, bump);
    return () => window.removeEventListener(WS_CHANGED, bump);
  }, []);

  const save = useRef(onState);
  useEffect(() => {
    save.current = onState;
  }, [onState]);

  const onCall = useCallback<WidgetCallHandler>(
    async (method, args) => {
      if (method === "state.get") return JSON.parse(kept.current || "null") as unknown;
      if (method === "state.set") {
        const json = JSON.stringify(args.value ?? null);
        if (json.length > MAX_STATE) throw new Error(t("Too much to keep ({n} characters at most).", { n: MAX_STATE }));
        kept.current = json;
        save.current?.(json);
        return true;
      }
      if (method === "page.get") {
        const k = args.key === undefined || args.key === null ? undefined : String(args.key);
        if (!pageId) return k === undefined ? Object.fromEntries(loose) : (loose.get(k) ?? null);
        const r = await widgetPageStateAction(pageId, k);
        if (!r.ok) throw new Error(r.error);
        return r.value;
      }
      if (method === "page.set") {
        const k = String(args.key ?? "").trim();
        if (!k) throw new Error("page.set: a key");
        if (pageId) {
          const r = await setWidgetPageStateAction(pageId, k, args.value ?? null);
          if (!r.ok) throw new Error(r.error);
        } else if (args.value === null || args.value === undefined) loose.delete(k);
        else loose.set(k, args.value);
        say({ page: pageId ?? 0, from: me, name: "page", detail: { key: k, value: args.value ?? null } });
        return true;
      }
      if (method === "publish") {
        const r = await publishWidgetValueAction(key, wid ?? null, pageId ?? null, title, { name: String(args.name ?? ""), value: args.value ?? null, unit: args.unit as string | undefined, label: args.label as string | undefined });
        if (!r.ok) throw new Error(r.error);
        // (Every widget in this window hears it — any page —, and the views read their outputs again.)
        say({ page: -1, from: me, name: "value", detail: { name: r.name, value: args.value ?? null } });
        window.dispatchEvent(new Event(WS_CHANGED));
        return true;
      }
      if (method === "emit") {
        const name = String(args.name ?? "").trim().slice(0, 80);
        if (!name || name === "changed" || name === "page") throw new Error(`emit: "${name}" is not a name to send`);
        say({ page: pageId ?? 0, from: me, name, detail: args.detail ?? null });
        return true;
      }
      if (method === "toast") {
        toast(String(args.text ?? "").slice(0, 300));
        return true;
      }
      if (method === "open") {
        const id = Math.floor(Number(args.row));
        if (!(id > 0)) throw new Error("open: a row's id");
        router.push(`/workspace/${id}`);
        return true;
      }
      const r = await widgetCallAction(key, method, args);
      if (!r.ok) throw new Error(r.error);
      if (method === "db.add" || method === "db.update") {
        // The tables on the page and the other widgets read again (this one too: it hears "changed").
        window.dispatchEvent(new Event(WS_CHANGED));
        router.refresh();
      }
      return r.value;
    },
    [key, router, t, pageId, me, wid, title],
  );

  // What the other widgets on this page share and say: to this one.
  const bus = useCallback(
    (send: (name: string, detail: unknown) => void) => {
      const on = (e: Event) => {
        const d = (e as CustomEvent<BusEvent>).detail;
        if (d && (d.page === -1 || d.page === (pageId ?? 0)) && d.from !== me) send(d.name, d.detail);
      };
      window.addEventListener(BUS, on);
      return () => window.removeEventListener(BUS, on);
    },
    [pageId, me],
  );

  const paramsJson = params === undefined ? "" : JSON.stringify(params);
  const frameContext = useMemo(() => (context || paramsJson ? { ...(context ?? {}), ...(paramsJson ? { params: JSON.parse(paramsJson) as unknown } : {}) } : undefined), [context, paramsJson]);
  const lack = missing(wants, grant);
  const dbName = (id: number) => context?.databases.find((d) => d.id === id)?.title ?? `#${id}`;
  const allow = async () => {
    const r = await allowWidgetAction(key, { dbs: lack.writes, ...(lack.ai ? { ai: true } : {}), ...(lack.flows ? { flows: lack.flows } : {}) }, title);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    setGrant(r.grant);
  };
  const revoke = async (what: { db?: number; ai?: boolean; flow?: string }) => {
    const r = await revokeWidgetAction(key, what);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    setGrant(r.grant);
  };
  const asks = [...lack.writes.map((id) => t("write to „{db}“", { db: dbName(id) })), ...(lack.ai ? [t("ask the AI")] : []), ...(lack.flows ?? []).map((f) => t("run the flow „{flow}“", { flow: f }))];

  return (
    <div className={`space-y-1.5 ${className}`}>
      <WidgetFrame html={html} libs={libs} title={title} onCall={onCall} context={frameContext} pulse={pulse} bus={bus} onError={onError} />
      {grant !== null || context ? (
        asks.length > 0 && (
          <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <span className="flex-1">🔒 {t("This widget wants to {what}.", { what: asks.join(t(" and ")) })}</span>
            <button type="button" className="btn btn-sm" onClick={() => void allow()}>
              {t("Allow")}
            </button>
          </div>
        )
      ) : null}
      {showGrants && grant && (grant.dbs.length > 0 || grant.ai || !!grant.flows?.length) && (
        <div className="flex flex-wrap items-center gap-1 text-xs text-zinc-500">
          <span>{t("Allowed:")}</span>
          {grant.dbs.map((id) => (
            <button key={id} type="button" className="rounded-full border border-zinc-200 px-2 py-0.5 hover:border-red-300 hover:text-red-600 dark:border-zinc-700" title={t("Take it back")} onClick={() => void revoke({ db: id })}>
              ✎ {dbName(id)} ✕
            </button>
          ))}
          {grant.ai && (
            <button type="button" className="rounded-full border border-zinc-200 px-2 py-0.5 hover:border-red-300 hover:text-red-600 dark:border-zinc-700" title={t("Take it back")} onClick={() => void revoke({ ai: true })}>
              ✨ {t("AI")} ✕
            </button>
          )}
          {(grant.flows ?? []).map((f) => (
            <button key={f} type="button" className="rounded-full border border-zinc-200 px-2 py-0.5 hover:border-red-300 hover:text-red-600 dark:border-zinc-700" title={t("Take it back")} onClick={() => void revoke({ flow: f })}>
              ⚡ {f} ✕
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const csv = (v: unknown) => String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** A new id for a block's versions (widget-versions.ts keeps them by it). */
const newWid = () => (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)).slice(0, 18);

type VersionRow = { n: number; at: string; source: string; prompt: string; title: string; note: string; size: number };
const SOURCE_ICON: Record<string, string> = { ai: "✨", fix: "🩹", code: "</>", restore: "↶", first: "•" };

/**
 * The block: a widget the AI builds from what you describe, improved step by step — by a sentence (✨), by its code (</>), by the
 * AI fixing what broke (🩹) — every step a version (🕘) to look at again or bring back.
 */
function AppView({ node, updateAttributes, editor, getPos, deleteNode, extension }: NodeViewProps) {
  const t = useT();
  const pageId = Number((extension.options as { pageId: number }).pageId) || null;
  const html = String(node.attrs.html ?? "");
  const title = String(node.attrs.title ?? "");
  const wid = String(node.attrs.wid ?? "");
  const libs = csv(node.attrs.libs).filter((l) => Object.prototype.hasOwnProperty.call(WIDGET_LIBS, l));
  const wants = wantsOf(node.attrs.writes, node.attrs.ai, node.attrs.flows);
  const [ask, setAsk] = useState(String(node.attrs.prompt ?? ""));
  const [mode, setMode] = useState<"show" | "change" | "code" | "versions">(html ? "show" : "change");
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState(html);
  const [ideas, setIdeas] = useState<{ id: number; title: string }[]>([]);
  // (What broke belongs to the code it broke in: a new widget starts without it.)
  const [brokeIn, setBrokeIn] = useState<{ html: string; message: string } | null>(null);
  const broke = brokeIn && brokeIn.html === html ? brokeIn.message : null;
  const setBroke = useCallback((message: string | null) => setBrokeIn(message === null ? null : { html, message }), [html]);
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [preview, setPreview] = useState<{ n: number; html: string; libs: string[]; title: string } | null>(null);
  const elapsed = useElapsed(busy);
  const editable = editor.isEditable;

  // (Every block gets its own id the first time it is edited: its versions are kept by it.)
  useEffect(() => {
    if (editable && !wid) updateAttributes({ wid: newWid() });
  }, [editable, wid, updateAttributes]);

  useEffect(() => {
    if (html || !editable) return;
    let live = true;
    void widgetContextAction(pageId).then((r) => live && r.ok && setIdeas((r.context as Context).databases.filter((d) => d.onPage).slice(0, 3)));
    return () => {
      live = false;
    };
  }, [html, editable, pageId]);

  const loadVersions = useCallback(async () => {
    if (!wid) return setVersions([]);
    const r = await widgetVersionsAction(wid);
    setVersions(r.ok ? (r.versions as VersionRow[]) : []);
  }, [wid]);

  const build = async (request: string, fix = false) => {
    const said = request.trim();
    if (!said || busy) return;
    setBusy(true);
    // (A route, not the action: the page's saves don't wait for the minute it may take.)
    const r = await postJson<{ ok: true; widget: MadeWidget; version?: number } | { ok: false; error: string }>("/api/workspace/widget-make", {
      request: said,
      pageId,
      wid: wid || undefined,
      fix,
      current: html ? { title, html, libs, writes: wants.writes, ai: wants.ai, flows: wants.flows ?? [] } : undefined,
    }).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
    setBusy(false);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    const w = r.widget;
    updateAttributes({ title: w.title, prompt: fix ? String(node.attrs.prompt ?? "") : said, html: w.html, libs: w.libs.join(","), writes: w.wants.writes.join(","), ai: !!w.wants.ai, flows: (w.wants.flows ?? []).join(",") });
    setCode(w.html);
    setPreview(null);
    setMode("show");
    if (r.version) toast(t("Version {n}", { n: r.version }) + (w.note ? ` — ${w.note}` : ""));
    else if (w.note) toast(w.note);
  };

  const keep = async (source: "code" | "restore", v: { html: string; title?: string; libs?: string[]; writes?: number[]; ai?: boolean; flows?: string[]; prompt?: string }) => {
    if (!wid) return;
    // (The one before versions existed is kept first, so it can be brought back too.)
    if (versions === null || !versions.length) {
      const had = await widgetVersionsAction(wid);
      if (had.ok && !had.versions.length && html) await saveWidgetVersionAction(wid, pageId, { source: "first", title, html, libs, writes: wants.writes, ai: wants.ai, flows: wants.flows });
    }
    const r = await saveWidgetVersionAction(wid, pageId, { source, ...v });
    if (!r.ok) return void toast(r.error, { tone: "error" });
    toast(t("Version {n}", { n: r.version }));
    if (mode === "versions") void loadVersions();
  };

  const restore = async (n: number) => {
    const r = await widgetVersionAction(wid, n);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    const v = r.version;
    updateAttributes({ title: v.title, html: v.html, libs: v.libs.join(","), writes: v.writes.join(","), ai: v.ai, flows: v.flows.join(","), ...(v.prompt ? { prompt: v.prompt } : {}) });
    setCode(v.html);
    setPreview(null);
    await keep("restore", { html: v.html, title: v.title, libs: v.libs, writes: v.writes, ai: v.ai, flows: v.flows, prompt: t("Version {n} brought back", { n }) });
    setMode("show");
  };

  const look = async (n: number) => {
    if (preview?.n === n) return setPreview(null);
    const r = await widgetVersionAction(wid, n);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    setPreview({ n, html: r.version.html, libs: r.version.libs, title: r.version.title });
  };

  const examples = [
    ...ideas.map((d) => t("A form that adds entries to „{db}“", { db: d.title })),
    ...ideas.slice(0, 1).map((d) => t("A chart of „{db}“", { db: d.title })),
    t("A calculator for …"),
    t("A 3D model of …"),
    t("A Wolfram|Alpha-like calculator"),
  ];
  const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <NodeViewWrapper className="ws-app-widget ws-module-block my-2" contentEditable={false}>
      <GripBar editor={editor} node={node} getPos={getPos} deleteNode={deleteNode} label={title || t("Widget")}>
        {html && mode === "show" && (
          <>
            <button type="button" title={t("Change it — say what should be different")} onClick={() => (setAsk(""), setMode("change"))}>
              ✨
            </button>
            <button type="button" title={t("Its code")} onClick={() => (setCode(html), setMode("code"))}>
              {"</>"}
            </button>
            <button
              type="button"
              title={t("Save as a block — use it in any view with <use block=…>")}
              onClick={() => {
                const asked = window.prompt(t("A name for the block (lowercase letters, digits, - and _):"), (title || "widget").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30));
                if (!asked) return;
                void saveBlockAction({ name: asked, title: title || undefined, description: title || asked, params: [], widget: { html, libs, writes: wants.writes, ai: wants.ai, flows: wants.flows } }).then((r) =>
                  r.ok ? toast(t("Saved as the block “{name}” — <use block=\"{name}\"/> in a view.", { name: r.block.name })) : toast(r.error, { tone: "error" }),
                );
              }}
            >
              🧩
            </button>
            {wid && (
              <button type="button" title={t("Versions")} onClick={() => (setMode("versions"), void loadVersions())}>
                🕘
              </button>
            )}
          </>
        )}
      </GripBar>
      {broke && editable && mode === "show" && !busy && (
        <div role="status" className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <span className="min-w-0 flex-1 truncate" title={broke}>
            ⚠ {t("Something broke in the widget:")} <code>{broke}</code>
          </span>
          <button type="button" className="btn btn-sm" onClick={() => (setMode("change"), void build(t("Fix this error in the widget (keep everything else as it is): {error}", { error: broke }), true))}>
            🩹 {t("Fix it with the AI")}
          </button>
          <button type="button" className="rounded px-1 hover:bg-amber-100 dark:hover:bg-amber-900" aria-label={t("Close")} onClick={() => setBroke(null)}>
            ✕
          </button>
        </div>
      )}
      {mode === "change" && editable && (
        <div className="mb-2 space-y-2 rounded-lg border border-violet-200 bg-violet-50/40 p-3 dark:border-violet-900 dark:bg-violet-950/20">
          <label className="block text-xs font-medium text-violet-700 dark:text-violet-300" htmlFor={`app-${getPos?.() ?? 0}`}>
            ✨ {html ? t("What should be different?") : t("What should this widget do?")}
          </label>
          <textarea
            id={`app-${getPos?.() ?? 0}`}
            value={ask}
            rows={2}
            autoFocus
            disabled={busy}
            onChange={(e) => setAsk(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void build(ask);
              }
              e.stopPropagation();
            }}
            placeholder={t("e.g. a form for new contacts that writes into the table below")}
            className="w-full resize-y rounded-md border border-violet-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-violet-400 dark:border-violet-900 dark:bg-zinc-900"
          />
          {!html && !busy && (
            <div className="flex flex-wrap gap-1">
              {examples.map((e) => (
                <button key={e} type="button" className="rounded-full border border-violet-200 px-2 py-0.5 text-xs text-violet-700 hover:bg-violet-50 dark:border-violet-900 dark:text-violet-300 dark:hover:bg-violet-950" onClick={() => setAsk(e)}>
                  {e}
                </button>
              ))}
            </div>
          )}
          {busy ? (
            <div className="space-y-1.5">
              <AiProgressBar />
              <AiWorkingLabel label={html ? t("The AI is changing the widget …") : t("The AI is building the widget …")} detail={elapsed} />
            </div>
          ) : (
            <div className="flex gap-2">
              <button type="button" className="btn btn-sm btn-primary" disabled={!ask.trim()} onClick={() => void build(ask)}>
                {html ? t("Change") : t("Build")}
              </button>
              {html && (
                <button type="button" className="btn btn-sm" onClick={() => setMode("show")}>
                  {t("Cancel")}
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {mode === "code" && editable && (
        <div className="mb-2 space-y-2">
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            rows={14}
            spellCheck={false}
            aria-label={t("The widget's code")}
            className="w-full rounded-md border border-zinc-200 bg-zinc-50 p-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-950"
          />
          <p className="text-xs text-zinc-500">{t("Changed code is a new widget: what it may write is asked again.")}</p>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => {
                const changed = code !== html;
                updateAttributes({ html: code });
                setMode("show");
                if (changed) void keep("code", { html: code, title, libs, writes: wants.writes, ai: wants.ai, flows: wants.flows, prompt: t("Code edited") });
              }}
            >
              {t("Save")}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setMode("show")}>
              {t("Cancel")}
            </button>
          </div>
        </div>
      )}
      {mode === "versions" && (
        <div className="mb-2 space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">🕘 {t("Versions")}</span>
            <button type="button" className="btn btn-sm" onClick={() => (setPreview(null), setMode("show"))}>
              {t("Close")}
            </button>
          </div>
          {versions === null ? (
            <p className="text-xs text-zinc-500">{t("Loading …")}</p>
          ) : !versions.length ? (
            <p className="text-xs text-zinc-500">{t("No versions yet — each change from now on is kept.")}</p>
          ) : (
            <ol className="max-h-72 divide-y divide-zinc-100 overflow-y-auto text-sm dark:divide-zinc-800">
              {versions.map((v, i) => (
                <li key={v.n} className={`flex items-start gap-2 py-1.5 ${preview?.n === v.n ? "bg-indigo-50/60 dark:bg-indigo-950/30" : ""}`}>
                  <span className="w-10 shrink-0 font-mono text-xs text-zinc-500 tabular-nums">v{v.n}</span>
                  <span className="w-5 shrink-0 text-center text-xs" title={v.source} aria-hidden>
                    {SOURCE_ICON[v.source] ?? "•"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{v.prompt || v.title || t("Widget")}</div>
                    <div className="text-xs text-zinc-500">
                      {when(v.at)}
                      {i === 0 ? ` · ${t("current")}` : ""}
                      {v.note ? ` · ${v.note}` : ""}
                    </div>
                  </div>
                  <button type="button" className="rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800" onClick={() => void look(v.n)}>
                    {preview?.n === v.n ? t("Hide") : t("Show")}
                  </button>
                  {editable && i > 0 && (
                    <button type="button" className="btn btn-sm" onClick={() => void restore(v.n)}>
                      ↶ {t("Bring back")}
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}
          {preview && (
            <div className="space-y-1">
              <p className="text-xs text-zinc-500">{t("Version {n} as it was (its data is today's):", { n: preview.n })}</p>
              <WidgetFrame html={preview.html} libs={preview.libs} title={preview.title || t("Widget")} />
            </div>
          )}
        </div>
      )}
      {html ? (
        <AppWidget html={html} libs={libs} title={title || t("Widget")} wants={wants} pageId={pageId} state={String(node.attrs.state ?? "")} onState={(json) => updateAttributes({ state: json })} showGrants={editable && mode !== "show"} onError={setBroke} wid={wid || undefined} />
      ) : (
        !editable && <p className="text-sm text-zinc-500">{t("An empty widget.")}</p>
      )}
    </NodeViewWrapper>
  );
}

/**
 * A widget the AI built, as a block of a page (`pageId`: the page — or the row — it stands on): its code, what it asked to
 * be allowed (writes: database ids, ai), its state. In Markdown `:::app {…}` … `:::` (doc.ts).
 */
export const ZeffApp = Node.create<{ pageId: number }>({
  name: "zeffApp",
  addOptions() {
    return { pageId: 0 };
  },
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { title: { default: "" }, prompt: { default: "" }, html: { default: "" }, libs: { default: "" }, writes: { default: "" }, ai: { default: false }, flows: { default: "" }, wid: { default: "" }, state: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "div[data-zeff-app]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ "data-zeff-app": "", "data-title": HTMLAttributes.title ?? "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(AppView);
  },
});

/** How long it has been at it ("12 s", "1:05") while `on` — so a slow build shows it's still going. */
function useElapsed(on: boolean): string {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t0 = Date.now();
    setSecs(0);
    const id = setInterval(() => setSecs(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [on]);
  if (!on) return "";
  return secs < 60 ? `${secs} s` : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}
