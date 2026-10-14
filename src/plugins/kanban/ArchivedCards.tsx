"use client";

import { confirmAction } from "@/components/confirm";
import { useT } from "@/components/I18nProvider";
import { useAction } from "@/components/useAction";
import { formatDate } from "@/lib/format";
import { deleteCardAction, restoreCardAction } from "./actions";
import type { CardView } from "./shared";

/** The archived cards of a board, the latest first: each can be restored (end of its column) or deleted for good. */
export function ArchivedCards({ cards }: { cards: (CardView & { column: string })[] }) {
  const t = useT();
  const { run, pending } = useAction();
  return (
    <ul className="space-y-2">
      {cards.map((c) => (
        <li key={c.id} className="card flex flex-wrap items-center gap-3 p-3">
          <span className="text-xs text-zinc-500 tabular-nums">{c.ref}</span>
          <span className="min-w-0 flex-1 truncate font-medium" title={c.title}>
            {c.title}
          </span>
          <span className="text-xs text-zinc-500">
            {c.column} · {formatDate(c.updatedAt, { weekday: false })}
          </span>
          <button type="button" className="btn btn-sm" disabled={pending} onClick={() => run(() => restoreCardAction(c.id))}>
            {t("Restore")}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-danger"
            disabled={pending}
            onClick={() => confirmAction(t("Delete the card “{title}” for good?", { title: c.title })) && run(() => deleteCardAction(c.id))}
          >
            {t("Delete")}
          </button>
        </li>
      ))}
    </ul>
  );
}
