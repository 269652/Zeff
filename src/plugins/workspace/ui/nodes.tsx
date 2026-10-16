"use client";

import { mergeAttributes, Node, NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { aiBlockAction, mentionStateAction } from "../actions";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { DatabaseBlock } from "./DatabaseView";
import { embedPage } from "./page-embed";
import { ModuleBlock } from "./detail-modules";
import type { DetailModule } from "../model";

/** The editor's own blocks: a callout, a mention chip (people, pages, todos, tickets), a database view. */

// ---------------------------------------------------------------------------
// Callout
// ---------------------------------------------------------------------------

const CALLOUT_ICONS: { icon: string; tone: string }[] = [
  { icon: "💡", tone: "gray" },
  { icon: "ℹ️", tone: "blue" },
  { icon: "⚠️", tone: "yellow" },
  { icon: "❗", tone: "red" },
  { icon: "✅", tone: "green" },
  { icon: "📌", tone: "gray" },
];

function CalloutView({ node, updateAttributes, editor }: NodeViewProps) {
  const icon = String(node.attrs.icon ?? "💡");
  return (
    <NodeViewWrapper className="ws-callout" data-tone={String(node.attrs.tone ?? "gray")}>
      <button
        type="button"
        contentEditable={false}
        title="Change the icon"
        disabled={!editor.isEditable}
        onClick={() => {
          const i = CALLOUT_ICONS.findIndex((c) => c.icon === icon);
          const next = CALLOUT_ICONS[(i + 1) % CALLOUT_ICONS.length];
          updateAttributes({ icon: next.icon, tone: next.tone });
        }}
      >
        {icon}
      </button>
      <NodeViewContent />
    </NodeViewWrapper>
  );
}

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return { icon: { default: "💡" }, tone: { default: "gray" } };
  },
  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-callout": "" }), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },
});

// ---------------------------------------------------------------------------
// Flex: a row or a column of blocks — nest them to lay a page out
// ---------------------------------------------------------------------------

function FlexView({ node, updateAttributes, editor }: NodeViewProps) {
  const dir = node.attrs.dir === "col" ? "col" : "row";
  const gap = String(node.attrs.gap ?? "md");
  const wrap = !!node.attrs.wrap;
  const next = { sm: "md", md: "lg", lg: "sm" } as Record<string, string>;
  return (
    <NodeViewWrapper className="ws-flex" data-dir={dir} data-gap={gap} data-wrap={wrap ? "true" : undefined}>
      {editor.isEditable && (
        <div className="ws-flex-bar" contentEditable={false}>
          <button type="button" title="Row or column" onClick={() => updateAttributes({ dir: dir === "row" ? "col" : "row" })}>
            {dir === "row" ? "↔ row" : "↕ column"}
          </button>
          <button type="button" title="Wrap onto the next line" aria-pressed={wrap} onClick={() => updateAttributes({ wrap: !wrap })}>
            ⤶ wrap
          </button>
          <button type="button" title="Space between the blocks" onClick={() => updateAttributes({ gap: next[gap] ?? "md" })}>
            ⇔ {gap}
          </button>
        </div>
      )}
      <NodeViewContent className="ws-flex-body" />
    </NodeViewWrapper>
  );
}

/** A row or a column of blocks (any blocks — more flex boxes too): the layout of a page, a row's detail view. */
export const FlexBox = Node.create({
  name: "flexBox",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return { dir: { default: "row" }, gap: { default: "md" }, wrap: { default: false } };
  },
  parseHTML() {
    return [{ tag: "div[data-flex-box]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-flex-box": "" }), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(FlexView);
  },
});

// ---------------------------------------------------------------------------
// Mentions: @person, @page, @todo, @ticket
// ---------------------------------------------------------------------------

type RefState = { label?: string; icon?: string; status?: string; done?: boolean; missing?: boolean; href?: string };
const stateCache = new Map<string, { at: number; state: RefState }>();
let pending: { kind: string; ref: string; resolve: (s: RefState) => void }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

/** What a chip shows live (a todo's status, a page's title): asked for in batches, remembered for a minute. */
function refState(kind: string, ref: string): Promise<RefState> {
  const key = `${kind}:${ref}`;
  const hit = stateCache.get(key);
  if (hit && Date.now() - hit.at < 60000) return Promise.resolve(hit.state);
  return new Promise((resolve) => {
    pending.push({ kind, ref, resolve });
    if (!timer)
      timer = setTimeout(async () => {
        const batch = pending;
        pending = [];
        timer = null;
        const res = await mentionStateAction(batch.map((b) => ({ kind: b.kind as "person" | "page" | "todo" | "ticket", ref: b.ref }))).catch(() => ({}) as Record<string, RefState>);
        for (const b of batch) {
          const state = res[`${b.kind}:${b.ref}`] ?? {};
          stateCache.set(`${b.kind}:${b.ref}`, { at: Date.now(), state });
          b.resolve(state);
        }
      }, 30);
  });
}

function RefView({ node, editor, getPos }: NodeViewProps) {
  const router = useRouter();
  const t = useT();
  const { kind, ref, label, href: written } = node.attrs as { kind: string; ref: string; label: string; href: string };
  const [state, setState] = useState<RefState>({});
  // A person: their row in the people database (the link written with the mention may be the old profile page).
  const href = state.href ?? written ?? (kind === "person" ? `/personen/${ref}` : "");
  useEffect(() => {
    let alive = true;
    void refState(kind, ref).then((s) => alive && setState(s));
    return () => {
      alive = false;
    };
  }, [kind, ref]);
  const icon = state.icon ?? (kind === "person" ? "👤" : kind === "todo" ? (state.done ? "✅" : "☑️") : kind === "ticket" ? "🎫" : "📄");
  const text = kind === "todo" || kind === "ticket" ? label : (state.label ?? label);
  const external = /^https?:\/\//.test(href ?? "");
  // A page's chip: shown inline instead (its content in place) — a click on ⤢.
  const pageId = kind === "page" ? Number(/^\/workspace\/(\d+)/.exec(href ?? "")?.[1] ?? ref) : 0;
  const inline = editor.isEditable && pageId > 0 && !state.missing;
  return (
    <NodeViewWrapper as="span" className="group/ref inline">
      <a
        className="ws-chip"
        data-kind={kind}
        data-done={state.done ? "true" : undefined}
        data-missing={state.missing ? "true" : undefined}
        href={href || undefined}
        target={external ? "_blank" : undefined}
        rel={external ? "noreferrer" : undefined}
        title={[state.label && state.label !== text ? state.label : "", state.status ?? ""].filter(Boolean).join(" · ") || undefined}
        onClick={(e) => {
          if (!href) return e.preventDefault();
          if (!external && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            router.push(href);
          }
        }}
        contentEditable={false}
      >
        <span aria-hidden>{icon}</span>
        {text}
        {state.status && kind === "todo" && !state.done ? <span className="opacity-60">· {state.status}</span> : null}
      </a>
      {inline && (
        <button
          type="button"
          contentEditable={false}
          className="invisible ml-0.5 rounded px-1 text-xs text-zinc-400 group-hover/ref:visible hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
          title={t("Show inline")}
          aria-label={t("Show inline")}
          onClick={() => {
            const pos = typeof getPos === "function" ? getPos() : null;
            if (pos !== null && pos !== undefined) embedPage(editor, pos, { id: pageId, title: text });
          }}
        >
          ⤢
        </button>
      )}
    </NodeViewWrapper>
  );
}

export const ZeffRef = Node.create({
  name: "zeffRef",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { kind: { default: "page" }, ref: { default: "" }, label: { default: "" }, href: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "a[data-zeff-ref]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["a", mergeAttributes(HTMLAttributes, { "data-zeff-ref": "", "data-kind": node.attrs.kind, href: node.attrs.href || undefined }), String(node.attrs.label)];
  },
  renderText({ node }) {
    return String(node.attrs.label);
  },
  addNodeView() {
    return ReactNodeViewRenderer(RefView);
  },
});

// ---------------------------------------------------------------------------
// A database in a page
// ---------------------------------------------------------------------------

function DatabaseBlockView({ node, updateAttributes }: NodeViewProps) {
  const dbId = Number(node.attrs.dbId);
  return (
    <NodeViewWrapper className="ws-dbblock" contentEditable={false}>
      <DatabaseBlock dbId={dbId} viewId={String(node.attrs.viewId ?? "")} onView={(viewId) => updateAttributes({ viewId })} />
    </NodeViewWrapper>
  );
}

export const DatabaseViewNode = Node.create({
  name: "databaseView",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { dbId: { default: 0 }, viewId: { default: "" }, title: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "div[data-database-view]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-database-view": "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(DatabaseBlockView);
  },
});

/** A detail module as a block (/Lage, /Todos …): its key in a small field (empty: its page's row's), the module below. */
function ModuleBlockView({ node, updateAttributes, editor, extension }: NodeViewProps) {
  const [key, setKey] = useState(String(node.attrs.key ?? ""));
  return (
    <NodeViewWrapper className="ws-module-block my-2" contentEditable={false}>
      {editor.isEditable && !String(node.attrs.module).startsWith("person-") && (
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onBlur={() => updateAttributes({ key: key.trim().toUpperCase() })}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), e.currentTarget.blur())}
          placeholder="KEY-1"
          aria-label="Ticket"
          className="float-right w-24 bg-transparent text-right font-mono text-xs text-zinc-400 outline-none focus:text-zinc-700"
        />
      )}
      <ModuleBlock module={node.attrs.module as DetailModule} ticketKey={String(node.attrs.key ?? "")} pageId={Number((extension.options as { pageId: number }).pageId)} />
    </NodeViewWrapper>
  );
}

/** What Zeff knows about a ticket, as a block of a page — the modules of a row's detail view (doc.ts: zeffModule). */
export const ZeffModuleNode = Node.create<{ pageId: number }>({
  name: "zeffModule",
  group: "block",
  atom: true,
  draggable: true,
  addOptions() {
    return { pageId: 0 };
  },
  addAttributes() {
    return { module: { default: "briefing" }, key: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "div[data-zeff-module]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-zeff-module": "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ModuleBlockView);
  },
});

/** An AI block: its instruction, what the AI wrote by it from the page (and the databases in it), written again by hand — or with the briefing ("auto"). */
function AiBlockView({ node, updateAttributes, editor, extension }: NodeViewProps) {
  const t = useT();
  const [prompt, setPrompt] = useState(String(node.attrs.prompt ?? ""));
  const [busy, setBusy] = useState(false);
  const text = String(node.attrs.text ?? "");
  const at = String(node.attrs.at ?? "");
  const write = async () => {
    setBusy(true);
    const r = await aiBlockAction(Number((extension.options as { pageId: number }).pageId), prompt);
    setBusy(false);
    if (r.ok) updateAttributes({ prompt, text: r.text, at: r.at });
    else toast(r.error, { tone: "error" });
  };
  return (
    <NodeViewWrapper className="ws-ai-block my-2 space-y-2 rounded-lg border border-violet-200 bg-violet-50/40 p-3 dark:border-violet-900 dark:bg-violet-950/20" contentEditable={false}>
      <div className="flex items-center gap-2 text-xs text-violet-700 dark:text-violet-300">
        <span aria-hidden>✨</span>
        {editor.isEditable ? (
          <input value={prompt} onChange={(e) => setPrompt(e.target.value)} onBlur={() => updateAttributes({ prompt })} placeholder={t("What should the AI write here?")} aria-label={t("Instruction")} className="min-w-0 flex-1 bg-transparent outline-none" />
        ) : (
          <span className="flex-1">{prompt}</span>
        )}
        {editor.isEditable && (
          <label className="flex items-center gap-1" title={t("Written again with every briefing")}>
            <input type="checkbox" checked={!!node.attrs.auto} onChange={(e) => updateAttributes({ auto: e.target.checked })} />
            {t("with the briefing")}
          </label>
        )}
        <button type="button" className="btn btn-sm" disabled={busy || !prompt.trim()} onClick={() => void write()}>
          {busy ? "…" : text ? t("Write again") : t("Write")}
        </button>
      </div>
      {text ? <div className="text-sm whitespace-pre-wrap">{text}</div> : <p className="text-sm text-zinc-400">{t("Nothing written yet.")}</p>}
      {at && <p className="text-xs text-zinc-400">{new Date(at).toLocaleString()}</p>}
    </NodeViewWrapper>
  );
}

/** AI in any page (doc.ts: aiBlock). */
export const AiBlockNode = Node.create<{ pageId: number }>({
  name: "aiBlock",
  group: "block",
  atom: true,
  draggable: true,
  addOptions() {
    return { pageId: 0 };
  },
  addAttributes() {
    return { prompt: { default: "" }, text: { default: "" }, at: { default: "" }, auto: { default: false } };
  },
  parseHTML() {
    return [{ tag: "div[data-ai-block]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-ai-block": "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(AiBlockView);
  },
});
