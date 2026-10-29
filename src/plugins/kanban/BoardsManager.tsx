"use client";

import { EmptyState } from "@/components/EmptyState";
import { confirmAction } from "@/components/confirm";
import Link from "next/link";
import { useState } from "react";
import { useAction } from "@/components/useAction";
import { useT } from "@/components/I18nProvider";
import { deleteBoardAction, moveBoardAction, updateBoardAction } from "./actions";
import { boardDot } from "./colors";
import { BOARD_COLORS } from "./shared";

type Row = { id: number; name: string; description: string; color: string; archived: boolean; inLage: boolean; cards: number; open: number; archivedCards: number };
type Result = { ok: boolean; error?: string; message?: string };

/** One board's row: name and description (saved when you leave the field), colour, Lage, order, archive, delete. */
function BoardRow({ b, first, last, run }: { b: Row; first: boolean; last: boolean; run: (fn: () => Promise<Result>) => void }) {
  const t = useT();
  const [name, setName] = useState(b.name);
  const [description, setDescription] = useState(b.description);
  return (
    <li className={`card space-y-3 p-4 ${b.archived ? "border-dashed" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex flex-col">
          <button type="button" className="icon-btn h-4 text-xs" disabled={first} onClick={() => run(() => moveBoardAction(b.id, -1))} aria-label={t("Move up")} title={t("Move up")}>
            ▲
          </button>
          <button type="button" className="icon-btn h-4 text-xs" disabled={last} onClick={() => run(() => moveBoardAction(b.id, 1))} aria-label={t("Move down")} title={t("Move down")}>
            ▼
          </button>
        </span>
        <input
          className="input max-w-xs font-medium"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== b.name && run(() => updateBoardAction(b.id, { name }))}
          aria-label={t("Name")}
        />
        <span className="flex items-center gap-1" role="radiogroup" aria-label={t("Colour")}>
          {BOARD_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={b.color === c}
              aria-label={c}
              onClick={() => c !== b.color && run(() => updateBoardAction(b.id, { color: c }))}
              className={`grid size-6 place-items-center rounded-full text-[11px] leading-none font-bold text-white ${boardDot(c)} ring-offset-2 dark:ring-offset-zinc-900 ${b.color === c ? "ring-2 ring-zinc-600 dark:ring-zinc-300" : "opacity-60 hover:opacity-100"}`}
            >
              {b.color === c ? "✓" : ""}
            </button>
          ))}
        </span>
        <span className="text-xs text-zinc-500">
          {t("{open} open · {cards} cards", { open: b.open, cards: b.cards })}
          {b.archived ? ` · ${t("archived")}` : ""}
        </span>
        <span className="ml-auto flex gap-2">
          {b.archivedCards > 0 && (
            <Link href={`/kanban/${b.id}/archive`} className="btn btn-sm">
              {t("Archived cards ({n})", { n: b.archivedCards })}
            </Link>
          )}
          {!b.archived && (
            <Link href={`/kanban/${b.id}`} className="btn btn-sm">
              {t("Open")}
            </Link>
          )}
          <button type="button" className="btn btn-sm" onClick={() => run(() => updateBoardAction(b.id, { archived: !b.archived }))}>
            {b.archived ? t("Restore") : t("Archive")}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-danger"
            onClick={() => confirmAction(t("Delete the board “{name}” with all its {n} cards?", { name: b.name, n: b.cards })) && run(() => deleteBoardAction(b.id))}
          >
            {t("Delete")}
          </button>
        </span>
      </div>
      <input
        className="input text-sm"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={() => description !== b.description && run(() => updateBoardAction(b.id, { description }))}
        placeholder={t("Description (optional)")}
        aria-label={t("Description")}
      />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={b.inLage} onChange={(e) => run(() => updateBoardAction(b.id, { inLage: e.target.checked }))} className="mt-0.5 size-4 accent-indigo-600" />
        <span>
          {t("In the briefing")}
          <span className="block text-xs text-zinc-500">{t("The open cards go into every briefing run as KB-…: todos for them, a briefing per card, a place in the reports — like Jira tickets.")}</span>
        </span>
      </label>
    </li>
  );
}

/** All your boards — the archived ones too — to rename, colour, order, put in the Lage, archive or delete. */
export function BoardsManager({ boards }: { boards: Row[] }) {
  const t = useT();
  const { run } = useAction<Result>({ quiet: [t("Saved.")] });
  if (!boards.length) return <EmptyState>{t("No boards yet.")}</EmptyState>;
  return (
    <ul className="space-y-3">
      {boards.map((b, i) => (
        <BoardRow key={`${b.id}:${b.name}:${b.description}`} b={b} first={i === 0} last={i === boards.length - 1} run={run} />
      ))}
    </ul>
  );
}
