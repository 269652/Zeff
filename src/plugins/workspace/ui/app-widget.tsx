"use client";

import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { AiProgressBar, AiWorkingLabel } from "@/components/AiWorking";
import { WidgetFrame, type WidgetCallHandler } from "@/components/widgets/WidgetFrame";
import { MAX_STATE, missing, wantsOf, widgetKey, type WidgetGrant, type WidgetWants } from "@/lib/widgets/bridge";
import { WIDGET_LIBS } from "@/lib/widgets/sandbox";
import { postJson } from "@/lib/post-json";
import { allowWidgetAction, revokeWidgetAction, widgetCallAction, widgetContextAction, widgetGrantAction } from "../actions";
import type { MadeWidget } from "../widget-make";
import { GripBar } from "./app-nodes";
import { WS_CHANGED } from "./ChatPanel";

type Context = { page?: { id: number; title: string }; databases: { id: number; title: string; onPage?: boolean }[] };

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
  className = "",
}: {
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
    [key, router, t],
  );

  const lack = missing(wants, grant);
  const dbName = (id: number) => context?.databases.find((d) => d.id === id)?.title ?? `#${id}`;
  const allow = async () => {
    const r = await allowWidgetAction(key, { dbs: lack.writes, ...(lack.ai ? { ai: true } : {}) }, title);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    setGrant(r.grant);
  };
  const revoke = async (what: { db?: number; ai?: boolean }) => {
    const r = await revokeWidgetAction(key, what);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    setGrant(r.grant);
  };
  const asks = [...lack.writes.map((id) => t("write to „{db}“", { db: dbName(id) })), ...(lack.ai ? [t("ask the AI")] : [])];

  return (
    <div className={`space-y-1.5 ${className}`}>
      <WidgetFrame html={html} libs={libs} title={title} onCall={onCall} context={context ?? undefined} pulse={pulse} />
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
      {showGrants && grant && (grant.dbs.length > 0 || grant.ai) && (
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
        </div>
      )}
    </div>
  );
}

const csv = (v: unknown) => String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** The block: a widget the AI builds from what you describe, changed by a sentence or in its code. */
function AppView({ node, updateAttributes, editor, getPos, deleteNode, extension }: NodeViewProps) {
  const t = useT();
  const pageId = Number((extension.options as { pageId: number }).pageId) || null;
  const html = String(node.attrs.html ?? "");
  const title = String(node.attrs.title ?? "");
  const libs = csv(node.attrs.libs).filter((l) => Object.prototype.hasOwnProperty.call(WIDGET_LIBS, l));
  const wants = wantsOf(node.attrs.writes, node.attrs.ai);
  const [ask, setAsk] = useState(String(node.attrs.prompt ?? ""));
  const [mode, setMode] = useState<"show" | "change" | "code">(html ? "show" : "change");
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState(html);
  const [ideas, setIdeas] = useState<{ id: number; title: string }[]>([]);
  const elapsed = useElapsed(busy);
  const editable = editor.isEditable;

  useEffect(() => {
    if (html || !editable) return;
    let live = true;
    void widgetContextAction(pageId).then((r) => live && r.ok && setIdeas((r.context as Context).databases.filter((d) => d.onPage).slice(0, 3)));
    return () => {
      live = false;
    };
  }, [html, editable, pageId]);

  const build = async () => {
    const said = ask.trim();
    if (!said || busy) return;
    setBusy(true);
    // (A route, not the action: the page's saves don't wait for the minute it may take.)
    const r = await postJson<{ ok: true; widget: MadeWidget } | { ok: false; error: string }>("/api/workspace/widget-make", {
      request: said,
      pageId,
      current: html ? { title, html, libs, writes: wants.writes, ai: wants.ai } : undefined,
    }).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
    setBusy(false);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    const w = r.widget;
    updateAttributes({ title: w.title, prompt: said, html: w.html, libs: w.libs.join(","), writes: w.wants.writes.join(","), ai: !!w.wants.ai });
    setCode(w.html);
    setMode("show");
    if (w.note) toast(w.note);
  };

  const examples = [
    ...ideas.map((d) => t("A form that adds entries to „{db}“", { db: d.title })),
    ...ideas.slice(0, 1).map((d) => t("A chart of „{db}“", { db: d.title })),
    t("A calculator for …"),
    t("A countdown to …"),
  ];

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
          </>
        )}
      </GripBar>
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
                void build();
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
              <button type="button" className="btn btn-sm btn-primary" disabled={!ask.trim()} onClick={() => void build()}>
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
                updateAttributes({ html: code });
                setMode("show");
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
      {html ? (
        <AppWidget html={html} libs={libs} title={title || t("Widget")} wants={wants} pageId={pageId} state={String(node.attrs.state ?? "")} onState={(json) => updateAttributes({ state: json })} showGrants={editable && mode !== "show"} />
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
    return { title: { default: "" }, prompt: { default: "" }, html: { default: "" }, libs: { default: "" }, writes: { default: "" }, ai: { default: false }, state: { default: "" } };
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
