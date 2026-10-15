"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/react";
import { Overlay } from "@/components/Overlay";
import { useT } from "@/components/I18nProvider";
import { pageContentAction, savePageAction, type DatabaseData } from "../actions";
import { CardKey, CardTodos, extrasOf } from "./card-extras";
import { RowProperties } from "./DatabaseView";
import { Editor } from "./Editor";

/**
 * A row opened over its database (a card on the board, a note in the gallery) — the board stays
 * where it was, as Kanban's card panel did: its title, its properties, its page to write in, what
 * the Lage says about it and its todos; "Open as a page" for the full page.
 */
export function RowPeek({ data, rowId, onClose }: { data: DatabaseData; rowId: number; onClose: () => void }) {
  const t = useT();
  const row = data.rows.find((r) => r.id === rowId);
  const [title, setTitle] = useState(row?.title ?? "");
  const [page, setPage] = useState<{ content: JSONContent; rev: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const x = extrasOf(data, rowId);

  useEffect(() => {
    let live = true;
    void pageContentAction(rowId).then((r) => live && r.ok && setPage({ content: JSON.parse(r.content) as JSONContent, rev: r.rev }));
    return () => {
      live = false;
    };
  }, [rowId]);

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
        <input value={title} onChange={(e) => saveTitle(e.target.value)} placeholder={t("Untitled")} aria-label={t("Title")} className="w-full bg-transparent text-2xl font-bold outline-none" />
        {row && <RowProperties initial={data} dbId={data.id} rowId={rowId} />}
        {x.ticket && (x.ticket.lead || x.ticket.summary || x.ticket.happened.length > 0) && (
          <section className="space-y-1.5 rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-900">
            <h3 className="text-xs font-semibold text-zinc-500 uppercase">
              {t("Briefing")}
              {x.ticket.attentionLabel ? ` · ${x.ticket.attentionLabel}` : ""}
            </h3>
            {x.ticket.lead && <p className="font-medium">{x.ticket.lead}</p>}
            {x.ticket.summary && <p className="text-zinc-600 dark:text-zinc-400">{x.ticket.summary}</p>}
            {x.ticket.happened.length > 0 && (
              <ul className="space-y-0.5 text-xs text-zinc-500">
                {x.ticket.happened.map((h, i) => (
                  <li key={i}>
                    {h.when}
                    {h.who ? ` · ${h.who}` : ""}: {h.what}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {x.key && data.extras?.todosOn && <CardTodos k={x.key} ticket={x.ticket} open />}
        {page ? <Editor key={rowId} pageId={rowId} initial={page.content} rev={page.rev} editable smallText={false} /> : <p className="text-sm text-zinc-400">…</p>}
      </div>
    </Overlay>
  );
}
