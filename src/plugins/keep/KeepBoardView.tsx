"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/Toaster";
import { createNoteAction, deleteNoteAction, updateNoteAction } from "./actions";
import { KEEP_SWATCH, keepNoteClass } from "./colors";

export type BoardNote = { id: number; title: string; text: string; labels: string[]; color: string | null; pinned: boolean; archived: boolean; updatedAt: string | null };
type Result = { ok: boolean; error?: string; message?: string };

/** A checklist line: "- [ ] …" / "- [x] …" (Keep's lists, written as text). */
const CHECK = /^(\s*)[-*]\s\[( |x|X)\]\s?(.*)$/;

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

function ColorPicker({ value, onPick }: { value: string | null; onPick: (c: string | null) => void }) {
  return (
    <span className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label="Farbe">
      <button type="button" role="radio" aria-checked={!value} aria-label="Keine Farbe" onClick={() => onPick(null)} className={`size-4 rounded-full border border-zinc-300 bg-white dark:bg-zinc-900 ${!value ? "ring-2 ring-zinc-500" : ""}`} />
      {Object.entries(KEEP_SWATCH).map(([c, cls]) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={c} onClick={() => onPick(c)} className={`size-4 rounded-full ${cls} ${value === c ? "ring-2 ring-zinc-500" : "opacity-70 hover:opacity-100"}`} />
      ))}
    </span>
  );
}

/** "Notiz schreiben …": opens into title, text and colour; saved with Enter in the title, the button, or leaving it. */
function Composer({ boardId, run }: { boardId: number; run: (fn: () => Promise<Result>) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const reset = () => (setTitle(""), setText(""), setColor(null), setOpen(false));
  const save = async () => {
    if (!title.trim() && !text.trim()) return reset();
    if (await run(() => createNoteAction(boardId, { title, text, color }))) reset();
  };
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="card mx-auto block w-full max-w-xl px-4 py-3 text-left text-sm text-zinc-500 hover:shadow">
        Notiz schreiben …
      </button>
    );
  return (
    <div className={`card mx-auto max-w-xl space-y-2 p-3 ${keepNoteClass(color)}`}>
      <input autoFocus className="w-full bg-transparent font-medium outline-none" placeholder="Titel" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), void save())} />
      <textarea className="min-h-24 w-full resize-y bg-transparent text-sm outline-none" placeholder="Notiz … (eine Liste: Zeilen mit „- [ ] “)" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex flex-wrap items-center gap-2">
        <ColorPicker value={color} onPick={setColor} />
        <button type="button" className="btn btn-sm ml-auto" onClick={() => setText((t) => `${t}${t && !t.endsWith("\n") ? "\n" : ""}- [ ] `)}>
          ☐ Liste
        </button>
        <button type="button" className="btn btn-sm" onClick={reset}>
          Verwerfen
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void save()}>
          Speichern
        </button>
      </div>
    </div>
  );
}

/** One note: as Keep shows it; a click opens it for editing (title, text, labels, colour), pin, archive, delete. */
function NoteCard({ n, run }: { n: BoardNote; run: (fn: () => Promise<Result>) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(n.title);
  const [text, setText] = useState(n.text);
  const [labels, setLabels] = useState(n.labels.join(", "));
  const toggle = (line: number) => {
    const lines = n.text.split("\n");
    lines[line] = lines[line].replace(/\[( |x|X)\]/, (m) => (m === "[ ]" ? "[x]" : "[ ]"));
    void run(() => updateNoteAction(n.id, { text: lines.join("\n") }));
  };
  const save = async () => {
    const ls = labels.split(",").map((l) => l.trim()).filter(Boolean);
    if (title === n.title && text === n.text && ls.join(",") === n.labels.join(",")) return setEditing(false);
    if (await run(() => updateNoteAction(n.id, { title, text, labels: ls }))) setEditing(false);
  };
  return (
    <article id={`note-${n.id}`} className={`card group mb-3 break-inside-avoid space-y-2 p-3 ${keepNoteClass(n.color)}`}>
      {editing ? (
        <>
          <input autoFocus className="w-full bg-transparent font-medium outline-none" placeholder="Titel" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className="min-h-32 w-full resize-y bg-transparent text-sm outline-none" value={text} onChange={(e) => setText(e.target.value)} />
          <input className="input text-xs" placeholder="Labels, durch Komma" value={labels} onChange={(e) => setLabels(e.target.value)} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-sm" onClick={() => (setTitle(n.title), setText(n.text), setLabels(n.labels.join(", ")), setEditing(false))}>
              Abbrechen
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void save()}>
              Speichern
            </button>
          </div>
        </>
      ) : (
        <div role="button" tabIndex={0} className="cursor-text space-y-1.5" onClick={() => setEditing(true)} onKeyDown={(e) => e.key === "Enter" && setEditing(true)}>
          {(n.title || n.pinned) && (
            <h2 className="flex items-baseline gap-2 font-medium">
              <span className="min-w-0 flex-1 break-words">{n.title}</span>
              {n.pinned && <span title="Angeheftet">📌</span>}
            </h2>
          )}
          {n.text && <NoteText text={n.text} onToggle={toggle} />}
        </div>
      )}
      {n.labels.length > 0 && !editing && (
        <div className="flex flex-wrap gap-1 text-xs">
          {n.labels.map((l) => (
            <span key={l} className="rounded-full bg-zinc-200/70 px-2 py-0.5 dark:bg-zinc-700/70">
              {l}
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-500 opacity-60 group-hover:opacity-100 focus-within:opacity-100">
        <ColorPicker value={n.color} onPick={(c) => void run(() => updateNoteAction(n.id, { color: c }))} />
        <span className="ml-auto flex gap-1">
          <button type="button" className="icon-btn" title={n.pinned ? "Lösen" : "Anheften"} aria-label={n.pinned ? "Lösen" : "Anheften"} onClick={() => void run(() => updateNoteAction(n.id, { pinned: !n.pinned }))}>
            📌
          </button>
          <button type="button" className="icon-btn" title={n.archived ? "Zurückholen" : "Archivieren"} aria-label={n.archived ? "Zurückholen" : "Archivieren"} onClick={() => void run(() => updateNoteAction(n.id, { archived: !n.archived }))}>
            {n.archived ? "↩" : "🗄"}
          </button>
          <button type="button" className="icon-btn" title="Löschen" aria-label="Löschen" onClick={() => confirm("Notiz löschen?") && void run(() => deleteNoteAction(n.id))}>
            🗑
          </button>
        </span>
      </div>
    </article>
  );
}

/** One of your Keep boards: write a note, see them (pinned first), edit, tick, colour, pin, archive. */
export function KeepBoardView({ boardId, notes, archived, empty }: { boardId: number; notes: BoardNote[]; archived: boolean; empty: string }) {
  const router = useRouter();
  const [, start] = useTransition();
  const run = (fn: () => Promise<Result>) =>
    new Promise<boolean>((resolve) =>
      start(async () => {
        const r = await fn();
        if (!r.ok) toast(r.error ?? "Ging nicht.", { tone: "error" });
        else if (r.message) toast(r.message, { tone: "ok" });
        router.refresh();
        resolve(r.ok);
      }),
    );
  const pinned = notes.filter((n) => n.pinned);
  const others = notes.filter((n) => !n.pinned);
  return (
    <section className="space-y-4">
      {!archived && <Composer boardId={boardId} run={run} />}
      {notes.length === 0 && <p className="py-6 text-center text-sm text-zinc-500">{empty}</p>}
      {pinned.length > 0 && others.length > 0 && <h2 className="text-xs font-semibold text-zinc-500 uppercase">Angeheftet</h2>}
      {pinned.length > 0 && (
        <div className="columns-1 gap-3 sm:columns-2 xl:columns-3">
          {pinned.map((n) => (
            <NoteCard key={`${n.id}:${n.updatedAt}:${n.color}:${n.pinned}`} n={n} run={run} />
          ))}
        </div>
      )}
      {pinned.length > 0 && others.length > 0 && <h2 className="text-xs font-semibold text-zinc-500 uppercase">Weitere</h2>}
      {others.length > 0 && (
        <div className="columns-1 gap-3 sm:columns-2 xl:columns-3">
          {others.map((n) => (
            <NoteCard key={`${n.id}:${n.updatedAt}:${n.color}:${n.pinned}`} n={n} run={run} />
          ))}
        </div>
      )}
    </section>
  );
}
