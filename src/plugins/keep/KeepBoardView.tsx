"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import type { T } from "@/lib/i18n/shared";
import { createGoogleNoteAction, trashGoogleNoteAction, updateGoogleNoteAction } from "@/plugins/keep-write/server-actions";
import { createNoteAction, deleteNoteAction, updateNoteAction } from "./actions";
import { KEEP_SWATCH, keepNoteClass } from "./colors";

export type BoardNote = { id: number | string; title: string; text: string; labels: string[]; color: string | null; pinned: boolean; archived: boolean; updatedAt: string | null; url?: string };
type Result = { ok: boolean; error?: string; message?: string };
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

function ColorPicker({ value, onPick, disabled }: { value: string | null; onPick: (c: string | null) => void; disabled?: boolean }) {
  const t = useT();
  return (
    <span className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label={t("Colour")}>
      <button type="button" role="radio" aria-checked={!value} aria-label={t("No colour")} disabled={disabled} onClick={() => onPick(null)} className={`size-4 rounded-full border border-zinc-300 bg-white dark:bg-zinc-900 ${!value ? "ring-2 ring-zinc-500" : ""}`} />
      {Object.entries(KEEP_SWATCH).map(([c, cls]) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={c} disabled={disabled} onClick={() => onPick(c)} className={`size-4 rounded-full ${cls} ${value === c ? "ring-2 ring-zinc-500" : "opacity-70 hover:opacity-100"}`} />
      ))}
    </span>
  );
}

/** "Write a note …": opens into title, text, labels and colour; saved with Enter in the title or the button. */
function Composer({ api, run }: { api: Api; run: Run }) {
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
      <input disabled={busy} className="input text-xs" placeholder={t("Labels, comma-separated")} value={labels} onChange={(e) => setLabels(e.target.value)} />
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
function NoteCard({ n, api, run, labelHref }: { n: BoardNote; api: Api; run: Run; labelHref?: string }) {
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
          <input disabled={busy} className="input text-xs" placeholder={t("Labels, comma-separated")} value={labels} onChange={(e) => setLabels(e.target.value)} />
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
        <div role="button" tabIndex={0} className="cursor-text space-y-1.5" onClick={() => !busy && setEditing(true)} onKeyDown={(e) => e.key === "Enter" && !busy && setEditing(true)}>
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
            onClick={() => void go({ archived: !n.archived })}
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
              if (!confirm(api.removeQuestion)) return;
              setBusy(true);
              void run(() => api.remove(n.id)).then(() => setBusy(false));
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
  const router = useRouter();
  const [, start] = useTransition();
  const api = apiFor(source, t);
  const labelHref = source.kind === "google" ? source.labelHref : undefined;
  const run: Run = (fn) =>
    new Promise<boolean>((resolve) => {
      if (api.google) toast(t("Writing to Google Keep … (about half a minute)"), { tone: "ok" });
      start(async () => {
        const r: Result = await fn().catch((e: unknown) => ({ ok: false, error: String((e as Error)?.message ?? e) }));
        if (!r.ok) toast(r.error ?? t("That didn't work."), { tone: "error" });
        else if (r.message) toast(r.message, { tone: "ok" });
        router.refresh();
        resolve(r.ok);
      });
    });
  const pinned = notes.filter((n) => n.pinned);
  const others = notes.filter((n) => !n.pinned);
  const card = (n: BoardNote) => <NoteCard key={`${n.id}:${n.updatedAt}:${n.color}:${n.pinned}:${n.archived}:${n.text}`} n={n} api={api} run={run} labelHref={labelHref} />;
  return (
    <section className="space-y-4">
      {!archived && <Composer api={api} run={run} />}
      {notes.length === 0 && <p className="py-6 text-center text-sm text-zinc-500">{empty}</p>}
      {pinned.length > 0 && others.length > 0 && <h2 className="text-xs font-semibold text-zinc-500 uppercase">{t("Pinned")}</h2>}
      {pinned.length > 0 && <div className="columns-1 gap-3 sm:columns-2 xl:columns-3">{pinned.map(card)}</div>}
      {pinned.length > 0 && others.length > 0 && <h2 className="text-xs font-semibold text-zinc-500 uppercase">{t("Others")}</h2>}
      {others.length > 0 && <div className="columns-1 gap-3 sm:columns-2 xl:columns-3">{others.map(card)}</div>}
    </section>
  );
}
