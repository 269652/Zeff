"use client";

import { confirmAction } from "@/components/confirm";
import Link from "next/link";
import { useId, useState } from "react";
import { useAction } from "@/components/useAction";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import type { T } from "@/lib/i18n/shared";
import { createGoogleNoteAction, trashGoogleNoteAction, updateGoogleNoteAction } from "@/plugins/keep-write/server-actions";
import { createNoteAction, deleteNoteAction, updateNoteAction } from "./actions";
import { KEEP_SWATCH, keepNoteClass } from "./colors";

export type BoardNote = { id: number | string; title: string; text: string; labels: string[]; color: string | null; pinned: boolean; archived: boolean; updatedAt: string | null; url?: string };
type Result = { ok: boolean; error?: string; message?: string; id?: number | string };
type Patch = { title?: string; text?: string; color?: string | null; labels?: string[]; pinned?: boolean; archived?: boolean };

/**
 * Whose notes: one of your boards (Zeff's own), or Google Keep's — written in Keep itself (Google
 * Keep schreiben, beta: each change takes a while, and is shown once Keep confirmed it).
 */
export type NoteSource = { kind: "own"; boardId: number } | { kind: "google"; labelHref: string };

type Api = {
  create: (v: Patch) => Promise<Result>;
  update: (id: BoardNote["id"], p: Patch) => Promise<Result>;
  remove: (id: BoardNote["id"]) => Promise<Result>;
  removeQuestion: string;
  google: boolean;
};

const apiFor = (s: NoteSource, t: T): Api =>
  s.kind === "own"
    ? {
        create: (v) => createNoteAction(s.boardId, v),
        update: (id, p) => updateNoteAction(Number(id), p),
        remove: (id) => deleteNoteAction(Number(id)),
        removeQuestion: t("Delete the note?"),
        google: false,
      }
    : {
        create: (v) => createGoogleNoteAction(v),
        update: (id, p) => updateGoogleNoteAction(String(id), p),
        remove: (id) => trashGoogleNoteAction(String(id)),
        removeQuestion: t("Move the note to Google Keep's bin?"),
        google: true,
      };

type Run = (fn: () => Promise<Result>) => Promise<boolean>;

/** A checklist line: "- [ ] …" / "- [x] …" (Keep's lists, written as text). */
const CHECK = /^(\s*)[-*]\s\[( |x|X)\]\s?(.*)$/;

const labelList = (s: string) => [...new Set(s.split(",").map((l) => l.trim()).filter(Boolean))];

/** A note's text: its checklist lines as boxes you tick (the text changes), the rest as written. */
function NoteText({ text, onToggle }: { text: string; onToggle?: (line: number) => void }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-0.5 text-sm break-words">
      {lines.map((l, i) => {
        const m = CHECK.exec(l);
        if (!m) return l.trim() ? <p key={i} className="whitespace-pre-wrap">{l}</p> : <div key={i} className="h-2" />;
        const done = m[2].toLowerCase() === "x";
        return (
          <label key={i} className="flex items-start gap-2" style={{ paddingLeft: `${m[1].length * 0.5}rem` }}>
            <input type="checkbox" className="mt-0.5 size-4 accent-zinc-600" checked={done} disabled={!onToggle} onChange={() => onToggle?.(i)} onClick={(e) => e.stopPropagation()} />
            <span className={done ? "text-zinc-400 line-through" : ""}>{m[3]}</span>
          </label>
        );
      })}
    </div>
  );
}

/** The labels field: comma-separated, with the labels already in use offered (datalist for the typed one, chips to add). */
function LabelsInput({ value, onChange, disabled, known }: { value: string; onChange: (v: string) => void; disabled?: boolean; known: string[] }) {
  const t = useT();
  const id = useId();
  const used = new Set(labelList(value));
  const free = known.filter((l) => !used.has(l)).slice(0, 12);
  return (
    <div className="space-y-1">
      <input disabled={disabled} list={id} aria-label={t("Labels, comma-separated")} className="input text-xs" placeholder={t("Labels, comma-separated")} value={value} onChange={(e) => onChange(e.target.value)} />
      <datalist id={id}>
        {known.map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>
      {free.length > 0 && (
        <div className="flex flex-wrap gap-1 text-xs" role="group" aria-label={t("Add a label")}>
          {free.map((l) => (
            <button key={l} type="button" disabled={disabled} className="min-h-6 rounded-full bg-zinc-200/70 px-2 hover:bg-zinc-300 dark:bg-zinc-700/70 dark:hover:bg-zinc-600" onClick={() => onChange(`${value.trim().replace(/,$/, "")}${value.trim() ? ", " : ""}${l}`)}>
              + {l}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ColorPicker({ value, onPick, disabled }: { value: string | null; onPick: (c: string | null) => void; disabled?: boolean }) {
  const t = useT();
  return (
    <span className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label={t("Colour")}>
            <button type="button" role="radio" aria-checked={!value} aria-label={t("No colour")} disabled={disabled} onClick={() => onPick(null)} className={`grid size-6 place-items-center rounded-full border border-zinc-400 bg-white text-[11px] leading-none text-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 ${!value ? "ring-2 ring-zinc-500" : ""}`}>
        {!value ? "✓" : ""}
      </button>
      {Object.entries(KEEP_SWATCH).map(([c, cls]) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={c} disabled={disabled} onClick={() => onPick(c)} className={`grid size-6 place-items-center rounded-full text-[11px] leading-none font-bold text-zinc-900 ${cls} ${value === c ? "ring-2 ring-zinc-600" : "opacity-70 hover:opacity-100"}`}>
          {value === c ? "✓" : ""}
        </button>
      ))}
    </span>
  );
}

/** "Write a note …": opens into title, text, labels and colour; saved with Enter in the title or the button. */
function Composer({ api, run, known }: { api: Api; run: Run; known: string[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [labels, setLabels] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const reset = () => (setTitle(""), setText(""), setLabels(""), setColor(null), setOpen(false));
  const save = async () => {
    if (busy) return;
    if (!title.trim() && !text.trim()) return reset();
    setBusy(true);
    const ok = await run(() => api.create({ title, text, color, labels: labelList(labels) }));
    setBusy(false);
    if (ok) reset();
  };
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="card mx-auto block w-full max-w-xl px-4 py-3 text-left text-sm text-zinc-500 hover:shadow">
        {api.google ? t("Write a note in Google Keep …") : t("Write a note …")}
      </button>
    );
  return (
    <div className={`card mx-auto max-w-xl space-y-2 p-3 ${keepNoteClass(color)} ${busy ? "opacity-70" : ""}`} aria-busy={busy}>
      <input
        autoFocus
        disabled={busy}
        className="w-full bg-transparent font-medium outline-none"
        placeholder={t("Title")}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), void save())}
      />
      <textarea disabled={busy} className="min-h-24 w-full resize-y bg-transparent text-sm outline-none" placeholder={t("Note … (a list: lines with “- [ ] ”)")} value={text} onChange={(e) => setText(e.target.value)} />
      <LabelsInput disabled={busy} value={labels} onChange={setLabels} known={known} />
      <div className="flex flex-wrap items-center gap-2">
        <ColorPicker value={color} onPick={setColor} disabled={busy} />
        <button type="button" disabled={busy} className="btn btn-sm ml-auto" onClick={() => setText((s) => `${s}${s && !s.endsWith("\n") ? "\n" : ""}- [ ] `)}>
          ☐ {t("List")}
        </button>
        <button type="button" disabled={busy} className="btn btn-sm" onClick={reset}>
          {t("Discard")}
        </button>
        <button type="button" disabled={busy} className="btn btn-primary btn-sm" onClick={() => void save()}>
          {busy ? (api.google ? t("Saving in Keep …") : "…") : t("Save")}
        </button>
      </div>
    </div>
  );
}

/** One note: as Keep shows it; a click opens it for editing (title, text, labels), ticks, colour, pin, archive, delete. */
function NoteCard({ n, api, run, labelHref, known }: { n: BoardNote; api: Api; run: Run; labelHref?: string; known: string[] }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(n.title);
  const [text, setText] = useState(n.text);
  const [labels, setLabels] = useState(n.labels.join(", "));
  // The text as ticked here: a tick shows at once and the next one builds on it (a Keep write takes a while).
  const [shown, setShown] = useState(n.text);
  const go = async (p: Patch) => {
    setBusy(true);
    const ok = await run(() => api.update(n.id, p));
    setBusy(false);
    return ok;
  };
  const toggle = (line: number) => {
    const lines = shown.split("\n");
    lines[line] = lines[line].replace(/\[( |x|X)\]/, (m) => (m === "[ ]" ? "[x]" : "[ ]"));
    const next = lines.join("\n");
    setShown(next);
    void go({ text: next }).then((ok) => ok || setShown(n.text));
  };
  const save = async () => {
    const ls = labelList(labels);
    const p: Patch = {};
    if (title !== n.title) p.title = title;
    if (text !== n.text) p.text = text;
    if (ls.join(",") !== n.labels.join(",")) p.labels = ls;
    if (!Object.keys(p).length) return setEditing(false);
    if (await go(p)) setEditing(false);
  };
  return (
    <article id={`note-${n.id}`} aria-busy={busy} className={`card group mb-3 break-inside-avoid space-y-2 p-3 ${keepNoteClass(n.color)} ${busy ? "opacity-70" : ""}`}>
      {editing ? (
        <>
          <input autoFocus disabled={busy} className="w-full bg-transparent font-medium outline-none" placeholder={t("Title")} value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea disabled={busy} className="min-h-32 w-full resize-y bg-transparent text-sm outline-none" value={text} onChange={(e) => setText(e.target.value)} />
          <LabelsInput disabled={busy} value={labels} onChange={setLabels} known={known} />
          <div className="flex justify-end gap-2">
            <button type="button" disabled={busy} className="btn btn-sm" onClick={() => (setTitle(n.title), setText(n.text), setLabels(n.labels.join(", ")), setEditing(false))}>
              {t("Cancel")}
            </button>
            <button type="button" disabled={busy} className="btn btn-primary btn-sm" onClick={() => void save()}>
              {busy ? (api.google ? t("Saving in Keep …") : "…") : t("Save")}
            </button>
          </div>
        </>
      ) : (
        <div role="button" tabIndex={0} className="cursor-text space-y-1.5" onClick={() => !busy && setEditing(true)} onKeyDown={(e) => {
            // Only the note itself (not a checkbox in it) opens on Enter or Space.
            if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
            e.preventDefault();
            if (!busy) setEditing(true);
          }}>
          {(n.title || n.pinned) && (
            <h2 className="flex items-baseline gap-2 font-medium">
              <span className="min-w-0 flex-1 break-words">{n.title}</span>
              {n.pinned && <span title={t("Pinned")}>📌</span>}
            </h2>
          )}
          {shown && <NoteText text={shown} onToggle={toggle} />}
        </div>
      )}
      {n.labels.length > 0 && !editing && (
        <div className="flex flex-wrap gap-1 text-xs">
          {n.labels.map((l) =>
            labelHref ? (
              <Link key={l} href={`${labelHref}${encodeURIComponent(l)}`} className="rounded-full bg-zinc-200/70 px-2 py-0.5 hover:bg-zinc-300 dark:bg-zinc-700/70 dark:hover:bg-zinc-600">
                {l}
              </Link>
            ) : (
              <span key={l} className="rounded-full bg-zinc-200/70 px-2 py-0.5 dark:bg-zinc-700/70">
                {l}
              </span>
            ),
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-500 opacity-60 group-hover:opacity-100 focus-within:opacity-100">
        <ColorPicker value={n.color} disabled={busy} onPick={(c) => void go({ color: c })} />
        <span className="ml-auto flex items-center gap-1">
          {busy && <span className="text-zinc-500">{api.google ? t("saving in Keep …") : "…"}</span>}
          {n.url && (
            <a href={n.url} target="_blank" rel="noreferrer" className="px-1 text-indigo-600 hover:underline dark:text-indigo-400">
              Keep ↗
            </a>
          )}
          <button type="button" disabled={busy} className="icon-btn" title={n.pinned ? t("Unpin") : t("Pin")} aria-label={n.pinned ? t("Unpin") : t("Pin")} onClick={() => void go({ pinned: !n.pinned })}>
            📌
          </button>
          <button
            type="button"
            disabled={busy}
            className="icon-btn"
            title={n.archived ? t("Restore") : t("Archive")}
            aria-label={n.archived ? t("Restore") : t("Archive")}
            onClick={() =>
              void go({ archived: !n.archived }).then((ok) => {
                if (!ok) return;
                const was = n.archived;
                toast(was ? t("Note restored.") : t("Note archived."), { action: { label: t("Undo"), run: () => void run(() => api.update(n.id, { archived: was })) } });
              })
            }
          >
            {n.archived ? "↩" : "🗄"}
          </button>
          <button
            type="button"
            disabled={busy}
            className="icon-btn"
            title={t("Delete")}
            aria-label={t("Delete")}
            onClick={() => {
              if (!confirmAction(api.removeQuestion)) return;
              setBusy(true);
              void run(() => api.remove(n.id)).then((ok) => {
                setBusy(false);
                if (!ok || api.google) return;
                // Own notes: put it back from a snapshot (same text, colour, labels; pinned and archived follow).
                const snap = { title: n.title, text: n.text, color: n.color, labels: n.labels };
                toast(t("Note deleted."), {
                  action: {
                    label: t("Undo"),
                    run: async () => {
                      let made: Result | undefined;
                      const ok2 = await run(async () => (made = await api.create(snap)));
                      if (ok2 && made?.id !== undefined && (n.pinned || n.archived)) await run(() => api.update(made!.id!, { pinned: n.pinned, archived: n.archived }));
                    },
                  },
                });
              });
            }}
          >
            🗑
          </button>
        </span>
      </div>
    </article>
  );
}

/** Notes like Keep's — one of your boards or Google Keep: write a note, see them (pinned first), edit, tick, colour, pin, archive. */
export function KeepBoardView({ source, notes, archived, empty }: { source: NoteSource; notes: BoardNote[]; archived: boolean; empty: string }) {
  const t = useT();
  const { run: act } = useAction<Result>({ quiet: [t("Archived."), t("Restored."), t("Note deleted.")] });
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState<string[]>([]);
  const api = apiFor(source, t);
  const labelHref = source.kind === "google" ? source.labelHref : undefined;
  const run: Run = (fn) => {
    if (api.google) toast(t("Writing to Google Keep … (about half a minute)"), { tone: "ok" });
    return act(fn);
  };
  const known = [...new Set(notes.flatMap((n) => n.labels))].sort((a, b) => a.localeCompare(b));
  const q = query.trim().toLowerCase();
  const shownNotes = notes.filter((n) => (!q || `${n.title}
${n.text}
${n.labels.join(" ")}`.toLowerCase().includes(q)) && sel.every((l) => n.labels.includes(l)));
  const filtering = !!q || sel.length > 0;
  const pinned = shownNotes.filter((n) => n.pinned);
  const others = shownNotes.filter((n) => !n.pinned);
  const card = (n: BoardNote) => <NoteCard key={`${n.id}:${n.updatedAt}:${n.color}:${n.pinned}:${n.archived}:${n.text}`} n={n} api={api} run={run} labelHref={labelHref} known={known} />;
  return (
    <section className="space-y-4">
      {!archived && <Composer api={api} run={run} known={known} />}
      {notes.length > 0 && (
        <div className="mx-auto max-w-xl space-y-2">
          <input type="search" aria-label={t("Search notes")} className="input w-full" placeholder={t("Search notes (title, text, labels)")} value={query} onChange={(e) => setQuery(e.target.value)} />
          {known.length > 0 && (
            <div className="flex flex-wrap gap-1 text-xs" role="group" aria-label={t("Filter by label")}>
              {known.map((l) => (
                <button key={l} type="button" aria-pressed={sel.includes(l)} className={`min-h-6 rounded-full px-2 ${sel.includes(l) ? "bg-indigo-600 text-white" : "bg-zinc-200/70 hover:bg-zinc-300 dark:bg-zinc-700/70 dark:hover:bg-zinc-600"}`} onClick={() => setSel((s) => (s.includes(l) ? s.filter((x) => x !== l) : [...s, l]))}>
                  {sel.includes(l) ? "✓ " : ""}
                  {l}
                </button>
              ))}
            </div>
          )}
          <p role="status" aria-live="polite" className="text-xs text-zinc-500">
            {filtering ? t("{n} of {total} notes", { n: shownNotes.length, total: notes.length }) : ""}
          </p>
        </div>
      )}
      {shownNotes.length === 0 && <p className="py-6 text-center text-sm text-zinc-500">{filtering ? t("No note matches.") : empty}</p>}
      {pinned.length > 0 && others.length > 0 && <h2 className="text-xs font-semibold text-zinc-500 uppercase">{t("Pinned")}</h2>}
      {pinned.length > 0 && <div className="columns-1 gap-3 sm:columns-2 xl:columns-3">{pinned.map(card)}</div>}
      {pinned.length > 0 && others.length > 0 && <h2 className="text-xs font-semibold text-zinc-500 uppercase">{t("Others")}</h2>}
      {others.length > 0 && <div className="columns-1 gap-3 sm:columns-2 xl:columns-3">{others.map(card)}</div>}
    </section>
  );
}
