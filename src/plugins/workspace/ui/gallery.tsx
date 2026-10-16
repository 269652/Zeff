"use client";

import { useRef, useState } from "react";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { savePageAction, toggleTaskAction } from "../actions";
import { markdownToDoc } from "../doc";
import { splitPinned, type Property, type Row } from "../model";
import { RowCard } from "./cards";
import type { CellCtx } from "./cells";
import { WS_CHANGED } from "./ChatPanel";

/**
 * The gallery as Keep shows notes: "Write a note …" on top, the pinned ones apart, cards in columns of their own height
 * (masonry), each in its note's colour with its text and checklist (ticked in place), a pin to flip — and label chips to
 * filter by. Any database's gallery gets what fits it: the pin with a `pinned` property, the colour with a `color` one.
 */

const PINNED = "pinned";
const COLOR = "color";

type Props = { rows: Row[]; visible: Property[]; ctx: CellCtx; openRow: (id: number) => void; add: (cells: Record<string, unknown>, title: string) => Promise<number | null>; locked: boolean };

export function GalleryView({ rows, visible, ctx, openRow, add, locked }: Props) {
  const t = useT();
  const schema = ctx.data.schema;
  const pinnable = schema.properties.some((p) => p.id === PINNED);
  const tags = schema.properties.find((p) => p.type === "multi_select");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const shownRows = picked.size && tags ? rows.filter((r) => [...picked].every((id) => ((r.cells[tags.id] as string[] | undefined) ?? []).includes(id))) : rows;
  const { pinned, others } = pinnable ? splitPinned(shownRows) : { pinned: [], others: shownRows };
  // The card shows what the gallery is for: not the pin and the colour as values (they're the card itself).
  const cardProps = visible.filter((p) => p.id !== PINNED && p.id !== COLOR);
  const used = tags ? (tags.options ?? []).filter((o) => rows.some((r) => ((r.cells[tags.id] as string[] | undefined) ?? []).includes(o.id))) : [];
  const grid = (list: Row[]) => (
    <div className="ws-masonry">
      {list.map((r) => (
        <NoteCard key={r.id} row={r} visible={cardProps} ctx={ctx} openRow={openRow} pinnable={pinnable && !locked} />
      ))}
    </div>
  );
  return (
    <div className="space-y-3">
      {/* Not on a database whose rows come from a source (people, mails …): a note there would be a new person or mail. */}
      {!locked && !schema.dataType && <NoteComposer add={add} />}
      {used.length > 0 && (
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t("Filter by label")}>
          {used.map((o) => {
            const on = picked.has(o.id);
            return (
              <button key={o.id} type="button" aria-pressed={on} className={`ws-tag ${on ? "ring-2 ring-indigo-400" : "opacity-80 hover:opacity-100"}`} data-color={o.color} onClick={() => setPicked((cur) => (cur.has(o.id) ? new Set([...cur].filter((x) => x !== o.id)) : new Set([...cur, o.id])))}>
                {o.name}
              </button>
            );
          })}
        </div>
      )}
      {pinned.length > 0 && (
        <section className="space-y-1.5">
          <h3 className="label">{t("Pinned")}</h3>
          {grid(pinned)}
        </section>
      )}
      {others.length > 0 && (
        <section className="space-y-1.5">
          {pinned.length > 0 && <h3 className="label">{t("Others")}</h3>}
          {grid(others)}
        </section>
      )}
      {!shownRows.length && <p className="text-sm text-zinc-500">{rows.length ? t("No note matches.") : t("Nothing here yet.")}</p>}
    </div>
  );
}

/** A note's card: its colour, its pin, its fields, its text and checklist (ticked in place). */
function NoteCard({ row, visible, ctx, openRow, pinnable }: { row: Row; visible: Property[]; ctx: CellCtx; openRow: (id: number) => void; pinnable: boolean }) {
  const t = useT();
  const colorProp = ctx.data.schema.properties.find((p) => p.id === COLOR);
  const color = colorProp?.options?.find((o) => o.id === row.cells[COLOR])?.color;
  const pinned = row.cells[PINNED] === true;
  // A note without a title of its own got its first line as one: not twice on the card.
  const lines = (ctx.data.extras?.previews?.[row.id] ?? []).filter((l, i) => !(i === 0 && l.kind === "text" && l.text === row.title));
  const [ticks, setTicks] = useState<Record<number, boolean>>({});
  const tick = (index: number, checked: boolean) => {
    setTicks((cur) => ({ ...cur, [index]: checked }));
    void toggleTaskAction(row.id, index, checked).then((r) => {
      if (!r.ok) {
        toast(r.error, { tone: "error" });
        setTicks((cur) => ({ ...cur, [index]: !checked }));
      } else window.dispatchEvent(new Event(WS_CHANGED));
    });
  };
  return (
    <div className="ws-card ws-note group/card relative cursor-pointer" data-color={color} role="button" tabIndex={0} onClick={() => openRow(row.id)} onKeyDown={(e) => e.key === "Enter" && openRow(row.id)}>
      {pinnable && (
        <button
          type="button"
          className={`absolute top-1.5 right-1.5 rounded px-1 text-sm ${pinned ? "" : "opacity-0 group-hover/card:opacity-60 focus:opacity-100"}`}
          aria-pressed={pinned}
          title={pinned ? t("Unpin") : t("Pin")}
          onClick={(e) => {
            e.stopPropagation();
            ctx.set(row.id, PINNED, !pinned);
          }}
        >
          📌
        </button>
      )}
      <RowCard row={row} visible={visible} ctx={ctx} mode="gallery" />
      {lines.length > 0 && (
        <ul className="space-y-0.5 text-sm" onClick={(e) => e.stopPropagation()}>
          {lines.map((l, i) =>
            l.kind === "task" ? (
              <li key={i} className="flex items-start gap-1.5">
                <input type="checkbox" className="mt-1 size-3.5 shrink-0" checked={ticks[l.index] ?? l.checked} disabled={!ctx.editable} onChange={(e) => tick(l.index, e.target.checked)} aria-label={l.text} />
                <span className={(ticks[l.index] ?? l.checked) ? "text-zinc-400 line-through" : ""}>{l.text}</span>
              </li>
            ) : (
              <li key={i} className="break-words whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
                {l.text}
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

/** "Write a note …": opens to a title and a text (a list: lines with "- [ ] "); Save makes the note on top. */
function NoteComposer({ add }: { add: (cells: Record<string, unknown>, title: string) => Promise<number | null> }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const body = useRef<HTMLTextAreaElement>(null);
  const reset = () => (setTitle(""), setText(""), setOpen(false));
  const save = async () => {
    if (!title.trim() && !text.trim()) return reset();
    setBusy(true);
    const id = await add({}, title.trim() || text.trim().split("\n")[0].replace(/^- \[[ x]\] /, "").slice(0, 120));
    if (id && text.trim()) await savePageAction(id, { content: markdownToDoc(text) });
    setBusy(false);
    window.dispatchEvent(new Event(WS_CHANGED));
    reset();
  };
  if (!open)
    return (
      <button type="button" className="ws-card w-full max-w-xl text-left text-sm text-zinc-500" onClick={() => setOpen(true)}>
        {t("Write a note …")}
      </button>
    );
  return (
    <div className="ws-card w-full max-w-xl space-y-2">
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), void save())} placeholder={t("Title")} aria-label={t("Title")} className="w-full bg-transparent font-medium outline-none" />
      <textarea ref={body} value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder={t("Note … (a list: lines with “- [ ] ”)")} aria-label={t("Note … (a list: lines with “- [ ] ”)")} className="w-full resize-y bg-transparent text-sm outline-none" />
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            setText((v) => `${v}${v && !v.endsWith("\n") ? "\n" : ""}- [ ] `);
            // Typing goes on in the text, after the new item.
            requestAnimationFrame(() => {
              const el = body.current;
              if (el) (el.focus(), el.setSelectionRange(el.value.length, el.value.length));
            });
          }}
        >
          ☐ {t("List")}
        </button>
        <span className="flex-1" />
        <button type="button" className="btn btn-sm" onClick={reset}>
          {t("Discard")}
        </button>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void save()}>
          {t("Save")}
        </button>
      </div>
    </div>
  );
}
