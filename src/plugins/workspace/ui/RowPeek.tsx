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
export function DetailFromPage({ pageId, rowId }: { pageId: number; rowId: number }) {
  const [content, setContent] = useState<JSONContent | null>(null);
  useEffect(() => {
    let live = true;
    void pageContentAction(pageId).then((r) => live && r.ok && setContent(JSON.parse(r.content) as JSONContent));
    return () => {
      live = false;
    };
  }, [pageId]);
  if (!content) return <p className="text-sm text-zinc-400">…</p>;
  // Read-only as a layout (it's edited on its page); its blocks are the row's — their contents editable as ever.
  return (
    <div data-detail-page={pageId}>
      <Editor key={`${pageId}-${rowId}`} pageId={rowId} initial={content} rev={0} editable={false} smallText={false} />
    </div>
  );
}
