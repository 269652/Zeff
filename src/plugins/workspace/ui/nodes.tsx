"use client";

import { mergeAttributes, Node, NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { mentionStateAction } from "../actions";
import { DatabaseBlock } from "./DatabaseView";
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
// Mentions: @person, @page, @todo, @ticket
// ---------------------------------------------------------------------------

type RefState = { label?: string; icon?: string; status?: string; done?: boolean; missing?: boolean };
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

function RefView({ node }: NodeViewProps) {
  const router = useRouter();
  const { kind, ref, label, href } = node.attrs as { kind: string; ref: string; label: string; href: string };
  const [state, setState] = useState<RefState>({});
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
  return (
    <NodeViewWrapper as="span" className="inline">
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
      {editor.isEditable && (
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
