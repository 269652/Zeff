"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/react";
import { Overlay } from "@/components/Overlay";
import { useT } from "@/components/I18nProvider";
import { pageContentAction, savePageAction, type DatabaseData } from "../actions";
import { detailModules } from "../model";
import { CardKey, extrasOf } from "./card-extras";
import { DetailModules } from "./detail-modules";
import { Editor } from "./Editor";
import { seedPerson } from "@/plugins/people/ui/PersonBlocks";
import type { PersonBundle } from "@/plugins/people/blocks";

/**
 * A row opened over its database (a card on the board, a note in the gallery) — the board stays
 * where it was, as Kanban's card panel did: its title, then the modules its database shows (its
 * properties, the briefing, the todos, … its page — see detail-modules); "Open as a page" for the full page.
 */
export function RowPeek({ data, rowId, onClose }: { data: DatabaseData; rowId: number; onClose: () => void }) {
  const t = useT();
  const row = data.rows.find((r) => r.id === rowId);
  const [title, setTitle] = useState(row?.title ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const x = extrasOf(data, rowId);

  const saveTitle = (v: string) => {
    setTitle(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void savePageAction(rowId, { title: v }), 500);
  };

  return (
    <Overlay open onClose={onClose} label={title || t("Untitled")} className="max-w-2xl">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-2 text-sm dark:border-zinc-800">
        <CardKey k={x.key} />
        <span className="flex-1" />
        <Link href={`/workspace/${rowId}`} className="text-zinc-500 hover:underline">
          {t("Open as a page")} ↗
        </Link>
        <button type="button" className="btn btn-sm" onClick={onClose}>
          {t("Close")}
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        <input value={title} readOnly={data.locked} onChange={(e) => saveTitle(e.target.value)} placeholder={t("Untitled")} aria-label={t("Title")} className="w-full bg-transparent text-2xl font-bold outline-none" />
        {row && (data.schema.detailPage ? <DetailFromPage pageId={data.schema.detailPage} rowId={rowId} /> : <DetailModules modules={detailModules(data.schema, data.extras?.source)} data={data} rowId={rowId} />)}
      </div>
    </Overlay>
  );
}

/** A row's detail view from its database's detail page: the page's blocks (and text), each about this row. */
export function DetailFromPage({ pageId, rowId, initial, person }: { pageId: number; rowId: number; /** The layout, when the server has it already (no fetch). */ initial?: { doc: JSONContent; rev: number }; /** What a person's blocks show, when the server has it already. */ person?: PersonBundle }) {
  const t = useT();
  // The blocks start from what the server read: instantly, no round trip per block.
  useState(() => (person ? seedPerson(rowId, person) : undefined));
  const [content, setContent] = useState<{ doc: JSONContent; rev: number } | null>(initial ?? null);
  const [layout, setLayout] = useState(false);
  useEffect(() => {
    // Not given (the panel), or the layout was just edited: read it.
    if (initial && !layout && content?.doc === initial.doc) return;
    let live = true;
    void pageContentAction(pageId).then((r) => live && r.ok && setContent({ doc: JSON.parse(r.content) as JSONContent, rev: r.rev }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the layout is read again when editing starts or ends
  }, [pageId, layout]);
  if (!content) return <p className="text-sm text-zinc-400">…</p>;
  // The page is the layout: shown as it is for this row (the blocks edit the row in place) — or, with "Edit layout", edited right here,
  // on this row's data: add, move and remove blocks, boxes and text, and see the result at once.
  return (
    <div data-detail-page={pageId} data-layout-editing={layout || undefined}>
      <div className="mb-2 flex items-center justify-end gap-2">
        {layout && <span className="text-xs text-zinc-500">{t("Drag the ⠿ grips, add with “＋”, type / for blocks — saved as you go; it is the layout of every entry.")}</span>}
        <button type="button" className={`btn btn-sm ${layout ? "btn-primary" : ""}`} aria-pressed={layout} onClick={() => setLayout(!layout)} data-edit-layout>
          {layout ? `✓ ${t("Done")}` : `▤ ${t("Edit layout")}`}
        </button>
      </div>
      {layout ? (
        <Editor key={`layout-${pageId}`} pageId={pageId} contextRowId={rowId} initial={content.doc} rev={content.rev} editable smallText={false} />
      ) : (
        <Editor key={`${pageId}-${rowId}-${content.rev}`} pageId={rowId} initial={content.doc} rev={0} editable={false} smallText={false} />
      )}
    </div>
  );
}
