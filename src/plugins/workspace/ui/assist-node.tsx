"use client";

import { Fragment, type Node as PmNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { mergeAttributes, Node, NodeViewWrapper, ReactNodeViewRenderer, type Editor, type NodeViewProps } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { useLang, useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { applyAssistAction, assistAction, undoAssistAction } from "../actions";
import { newAssistState, readAssistState, type AssistAction, type AssistEvent, type AssistQuestion, type AssistState } from "../assist-shared";

/**
 * "✨ Think along" (Mitdenken): a card right after the block it is about (or at the top, for the whole page) — the AI's one line
 * of understanding, its questions as chips, then its proposal with a checkbox each; "Apply" puts the blocks after the card in one
 * step (Ctrl+Z takes them back). Nothing happens without the button. Its state is kept in the page (doc.ts: assistCard).
 */

// The cards just made by the button or the shortcut: those (and only those) ask the AI as they appear — never one loaded with the page.
const startNow = new Set<string>();

/** A card put in at `at` that starts thinking at once: about the block before it, or the whole page. */
export function startAssist(editor: Editor, at: number, scope: AssistState["scope"]): void {
  const id = Math.random().toString(36).slice(2, 12);
  startNow.add(id);
  editor.chain().insertContentAt(at, { type: "assistCard", attrs: { id, state: JSON.stringify(newAssistState(scope)) } }).run();
}

function findCard(editor: Editor, id: string): { pos: number; node: PmNode } | null {
  let found: { pos: number; node: PmNode } | null = null;
  editor.state.doc.descendants((n, pos) => {
    if (found) return false;
    if (n.type.name === "assistCard" && n.attrs.id === id) found = { pos, node: n };
    return !found;
  });
  return found;
}

/** The card's new state written into the page (not a step of its own for Ctrl+Z: the AI's answers aren't edits). */
function writeState(editor: Editor, id: string, s: AssistState): void {
  const c = findCard(editor, id);
  if (!c || editor.isDestroyed) return;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(c.pos, undefined, { ...c.node.attrs, state: JSON.stringify(s) }).setMeta("addToHistory", false));
}

const answerOf = (q: AssistQuestion, picked: string | string[] | undefined, other: string): string | string[] => {
  const free = other.trim();
  if (q.kind === "multi") return [...(Array.isArray(picked) ? picked : []), ...(free ? [free] : [])];
  return free || (typeof picked === "string" ? picked : "");
};

function Question({ q, name, value, other, onPick, onOther }: { q: AssistQuestion; name: string; value: string | string[] | undefined; other: string; onPick: (v: string | string[]) => void; onOther: (v: string) => void }) {
  const t = useT();
  if (q.kind === "choice" || q.kind === "multi") {
    const list = Array.isArray(value) ? value : [];
    return (
      <fieldset className="ws-assist-q">
        <legend className="mb-1 text-sm font-medium">{q.text}</legend>
        <div className="flex flex-wrap items-center gap-1.5">
          {q.options.map((o) => (
            <label key={o} className="ws-assist-chip">
              <input
                type={q.kind === "multi" ? "checkbox" : "radio"}
                name={name}
                value={o}
                className="sr-only"
                checked={q.kind === "multi" ? list.includes(o) : value === o}
                onChange={(e) => onPick(q.kind === "multi" ? (e.target.checked ? [...list, o] : list.filter((x) => x !== o)) : o)}
              />
              {o}
            </label>
          ))}
          <input value={other} onChange={(e) => onOther(e.target.value)} placeholder={t("Other …")} aria-label={t("Other answer: {question}", { question: q.text })} className="ws-assist-other" />
        </div>
      </fieldset>
    );
  }
  const id = `${name}-in`;
  return (
    <div className="ws-assist-q">
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {q.text}
      </label>
      <input id={id} type={q.kind === "number" ? "number" : q.kind === "date" ? "date" : "text"} value={typeof value === "string" ? value : ""} onChange={(e) => onPick(e.target.value)} className="input input-sm w-full max-w-sm" />
    </div>
  );
}

function EventLine({ e, lang }: { e: AssistEvent; lang: string }) {
  const t = useT();
  const day = (s: string) => new Date(s.length === 10 ? `${s}T00:00` : s).toLocaleDateString(lang, { weekday: "short", day: "numeric", month: "short" });
  const time = (s: string) => (s.length > 10 ? s.slice(11, 16) : "");
  const lastDay = e.allDay ? new Date(new Date(`${e.end}T00:00`).getTime() - 86400000) : null;
  const span = e.allDay ? (lastDay && lastDay.getTime() > new Date(`${e.start}T00:00`).getTime() ? `${day(e.start)} – ${lastDay.toLocaleDateString(lang, { weekday: "short", day: "numeric", month: "short" })}` : day(e.start)) : `${day(e.start)} ${time(e.start)}–${time(e.end)}`;
  return (
    <li>
      <span className="tabular-nums">{span}</span> · {e.title}
      {e.conflicts?.length ? (
        <span className="ml-1 text-amber-700 dark:text-amber-400">
          ⚠ {t("overlaps {what}", { what: e.conflicts.join(", ") })}
        </span>
      ) : null}
    </li>
  );
}

function Preview({ a, lang }: { a: AssistAction; lang: string }) {
  const t = useT();
  if (a.kind === "shadowCalendar")
    return (
      <div className="text-xs text-zinc-600 dark:text-zinc-400">
        📅 {t("Plan calendar “{name}” (suggestions — it blocks nothing)", { name: a.name })}
        <ul className="mt-0.5 ml-4 list-disc">
          {a.events.map((e, i) => (
            <EventLine key={i} e={e} lang={lang} />
          ))}
        </ul>
      </div>
    );
  if (a.kind === "todo") return <div className="text-xs text-zinc-600 dark:text-zinc-400">☑️ {a.text}{a.due ? ` · ${t("due {day}", { day: new Date(`${a.due}T00:00`).toLocaleDateString(lang) })}` : ""}</div>;
  if (a.kind === "widget") return <div className="text-xs text-zinc-600 dark:text-zinc-400">🧩 {a.config.person ? t("Widget for {name}", { name: String(a.config.person) }) : t("Widget")}</div>;
  return <pre className="mt-0.5 max-h-32 overflow-hidden text-xs whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">{a.markdown.split("\n").slice(0, 8).join("\n")}</pre>;
}

function AssistCardView({ node, editor, getPos, extension, deleteNode, updateAttributes }: NodeViewProps) {
  const t = useT();
  const lang = useLang();
  const id = String(node.attrs.id ?? "");
  const s = readAssistState(node.attrs.state);
  const pageId = Number((extension.options as { pageId: number }).pageId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [live, setLive] = useState("");
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const [off, setOff] = useState<Set<string>>(new Set());
  const box = useRef<HTMLDivElement>(null);
  const focusNext = useRef(false);
  const editable = editor.isEditable;

  // A card without an id (pasted, an old copy): one of its own.
  useEffect(() => {
    if (!id) updateAttributes({ id: Math.random().toString(36).slice(2, 12) });
  }, [id, updateAttributes]);

  const step = async (from: AssistState) => {
    const at = typeof getPos === "function" ? getPos() : undefined;
    const before = at !== undefined && from.scope === "block" ? editor.state.doc.resolve(at).nodeBefore : null;
    setBusy(true);
    setError("");
    setLive(t("Thinking along …"));
    focusNext.current = true;
    const r = await assistAction(pageId, before ? JSON.stringify(before.toJSON()) : null, JSON.stringify(from));
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      setLive(r.error);
      return;
    }
    setAnswers({});
    setOther({});
    setOff(new Set());
    writeState(editor, id, r.state);
    setLive(r.state.status === "asking" ? t("{n} questions — answer them, then Continue.", { n: r.state.questions.length }) : t("A proposal: {n} things — choose, then Apply.", { n: r.state.actions.length }));
  };

  // Made by the button just now: it starts (focus in the card, so its answer is announced and reached by keyboard).
  useEffect(() => {
    if (id && startNow.delete(id)) {
      box.current?.focus();
      // (Next tick: the call's "thinking" state is set outside the effect.)
      queueMicrotask(() => void step(s));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the card appears
  }, [id]);

  // Its questions or its proposal came: focus on the first of them.
  useEffect(() => {
    if (!focusNext.current || busy) return;
    focusNext.current = false;
    requestAnimationFrame(() => box.current?.querySelector<HTMLElement>("input, [data-first]")?.focus());
  }, [s.status, busy]);

  const dismiss = () => {
    const at = typeof getPos === "function" ? getPos() : undefined;
    deleteNode();
    if (at !== undefined) editor.commands.focus(Math.max(0, at - 1));
  };

  const apply = async () => {
    const ids = s.actions.filter((a) => !off.has(a.id)).map((a) => a.id);
    setBusy(true);
    setError("");
    setLive(t("Setting up …"));
    const r = await applyAssistAction(pageId, JSON.stringify(s), ids);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      setLive(r.error);
      return;
    }
    const c = findCard(editor, id);
    if (!c) return;
    const { state, view } = editor;
    let nodes: PmNode[] = [];
    try {
      nodes = r.nodes.map((n) => state.schema.nodeFromJSON(n));
    } catch {
      toast(t("Some of it couldn't be put into the page."), { tone: "error" });
    }
    const next: AssistState = { ...s, status: "applied", summary: r.summary, created: r.created };
    // One step: the blocks after the card and the card's summary — Ctrl+Z takes both back.
    const tr = state.tr.setNodeMarkup(c.pos, undefined, { ...c.node.attrs, state: JSON.stringify(next) }).insert(c.pos + c.node.nodeSize, Fragment.from(nodes));
    // The caret after what went in — nothing left selected (a selection over the new blocks brought up the text toolbar).
    const end = c.pos + c.node.nodeSize + Fragment.from(nodes).size;
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(end, tr.doc.content.size)), 1));
    view.dispatch(tr);
    setLive(t("Set up: {summary}. Ctrl+Z takes back what went into the page.", { summary: r.summary }));
  };

  // What it made outside the page taken back, and its blocks in the page with it.
  const undoCreated = async () => {
    const r = await undoAssistAction(s.created);
    if (!r.ok) return toast(r.error, { tone: "error" });
    const cals = new Set(s.created.filter((c) => c.kind === "calendar").map((c) => c.id));
    const todos = new Set(s.created.filter((c) => c.kind === "todo").map((c) => String(c.id)));
    const ranges: [number, number][] = [];
    editor.state.doc.descendants((n, pos) => {
      const ref = n.type.name === "paragraph" && n.childCount === 1 ? n.firstChild : null;
      if ((n.type.name === "calendarEmbed" && cals.has(Number(n.attrs.calendarId))) || (ref?.type.name === "zeffRef" && ref.attrs.kind === "todo" && todos.has(String(ref.attrs.ref))) || (n.type.name === "assistCard" && n.attrs.id === id)) {
        ranges.push([pos, pos + n.nodeSize]);
        return false;
      }
      return true;
    });
    const tr = editor.state.tr;
    for (const [from, to] of ranges.reverse()) tr.delete(from, to);
    editor.view.dispatch(tr);
    toast(t("Taken back: {n} things.", { n: r.undone }), { tone: "ok" });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && (s.status === "asking" || s.status === "proposing" || s.status === "thinking") && editable) {
      e.preventDefault();
      dismiss();
    }
  };

  const head = s.summary || s.intent || (s.scope === "page" ? t("Thinking along about this page") : t("Thinking along about this block"));

  if (s.status === "applied")
    return (
      <NodeViewWrapper className="ws-assist ws-assist-done" contentEditable={false} data-assist-ui="">
        {/* Its summary on a line of its own, what it made under it (each a link, cut to one line), the buttons beside. */}
        <div className="flex items-start gap-2 text-sm">
          <span aria-hidden className="pt-0.5">
            ✨
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium">{head}</p>
            {s.created.some((c) => c.href) && (
              <ul className="mt-1 space-y-0.5 text-xs">
                {s.created.map((c) =>
                  c.href ? (
                    <li key={`${c.kind}${c.id}`} className="truncate">
                      <a href={c.href} className="underline" title={c.label}>
                        {c.label}
                      </a>
                    </li>
                  ) : null,
                )}
              </ul>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {editable && s.created.length > 0 && (
              <button type="button" className="btn btn-sm" title={t("Deletes the plan calendars and dismisses the todos it made (Ctrl+Z only takes back what went into the page)")} onClick={() => void undoCreated()}>
                {t("Undo")}
              </button>
            )}
            {editable && (
              <button type="button" className="btn btn-sm" aria-label={t("Remove this note")} title={t("Remove this note")} onClick={() => deleteNode()}>
                ×
              </button>
            )}
          </div>
          <span role="status" aria-live="polite" className="sr-only">
            {live}
          </span>
        </div>
      </NodeViewWrapper>
    );

  return (
    <NodeViewWrapper className="ws-assist" contentEditable={false} data-assist-ui="">
      <div ref={box} tabIndex={-1} role="group" aria-label={t("Think along")} aria-busy={busy} onKeyDown={onKeyDown} className="space-y-3 outline-none">
        <div className="flex items-start gap-2">
          <span aria-hidden className="text-base leading-5">✨</span>
          <p className={`min-w-0 flex-1 text-sm font-medium ${busy && !s.summary ? "ws-assist-shimmer" : ""}`}>{busy && !s.summary ? t("Thinking along …") : head}</p>
          {editable && (
            <button type="button" className="btn btn-xs" aria-label={t("Dismiss")} title={`${t("Dismiss")} (Esc)`} onClick={dismiss}>
              ×
            </button>
          )}
        </div>
        <span role="status" aria-live="polite" className="sr-only">
          {live}
        </span>
        {busy && s.summary && <p className="ws-assist-shimmer text-xs">{t("Thinking along …")}</p>}
        {error && (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-red-700 dark:text-red-400">
            <span className="flex-1">{error}</span>
            {s.status === "thinking" && editable && (
              <button type="button" className="btn btn-xs" onClick={() => void step(s)}>
                {t("Try again")}
              </button>
            )}
          </div>
        )}
        {/* A card left thinking (the page was reloaded meanwhile): started again only by hand. */}
        {s.status === "thinking" && !busy && !error && editable && (
          <button type="button" className="btn btn-sm" data-first="" onClick={() => void step(s)}>
            ✨ {t("Start")}
          </button>
        )}
        {s.status === "asking" && editable && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (busy) return;
              const all = Object.fromEntries(s.questions.map((q) => [q.id, answerOf(q, answers[q.id], other[q.id] ?? "")]));
              void step({ ...s, answers: all });
            }}
          >
            {s.questions.map((q) => (
              <Question key={q.id} q={q} name={`${id}-${q.id}`} value={answers[q.id]} other={other[q.id] ?? ""} onPick={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} onOther={(v) => setOther((o) => ({ ...o, [q.id]: v }))} />
            ))}
            <div className="flex items-center gap-2">
              <button type="submit" className="btn btn-sm btn-primary" disabled={busy}>
                {t("Continue")}
              </button>
              <span className="text-xs text-zinc-500">{t("Unanswered is fine — it then assumes something sensible.")}</span>
            </div>
          </form>
        )}
        {s.status === "proposing" && (
          <div className="space-y-2">
            <ul className="space-y-2" aria-label={t("Proposal")}>
              {s.actions.map((a, i) => (
                <li key={a.id} className="flex items-start gap-2">
                  <input id={`${id}-${a.id}`} type="checkbox" className="mt-0.5 size-4" disabled={!editable || busy} checked={!off.has(a.id)} data-first={i === 0 ? "" : undefined} onChange={(e) => setOff((o) => { const n = new Set(o); if (e.target.checked) n.delete(a.id); else n.add(a.id); return n; })} />
                  <label htmlFor={`${id}-${a.id}`} className="min-w-0 flex-1 text-sm">
                    <span className="font-medium">{a.label}</span>
                    <Preview a={a} lang={lang} />
                  </label>
                </li>
              ))}
            </ul>
            {editable && (
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="btn btn-sm btn-primary" disabled={busy || off.size >= s.actions.length} title={t("Puts the chosen ones into the page (Ctrl+Z takes them back); calendars and todos are made at once")} onClick={() => void apply()}>
                  {t("Apply")}
                </button>
                <button type="button" className="btn btn-sm" disabled={busy} onClick={dismiss}>
                  {t("Dismiss")}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

/** The card (doc.ts: assistCard), and Ctrl+Shift+Space: think along about the block the cursor is in. */
export const AssistCardNode = Node.create<{ pageId: number }>({
  name: "assistCard",
  group: "block",
  atom: true,
  selectable: true,
  addOptions() {
    return { pageId: 0 };
  },
  addAttributes() {
    return { id: { default: "" }, state: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "div[data-assist-card]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-assist-card": "" })];
  },
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-Space": () => {
        const { $from } = this.editor.state.selection;
        if (!this.editor.isEditable) return false;
        startAssist(this.editor, $from.depth > 0 ? $from.after(1) : $from.pos, $from.depth > 0 ? "block" : "page");
        return true;
      },
    };
  },
  addNodeView() {
    // Its chips, fields and buttons are its own (the editor doesn't take their keys or clicks).
    return ReactNodeViewRenderer(AssistCardView, { stopEvent: ({ event }) => !!(event.target instanceof Element && event.target.closest("[data-assist-ui]")) });
  },
});
