"use client";

import { TodoMark } from "../todo-mark";
import { useEffect, useState } from "react";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { receivingDatabasesAction, runJobAction, sendRowAction, unlinkRowAction } from "../../actions";
import { hideRows, TITLE, type Row } from "../../model";
import type { CellCtx } from "../cells";
import { Dropdown, MenuItem, Modal } from "../kit";
import type { Api } from "./use-database";

export function RowMenu({ row, api }: { row: Row; api: Api }) {
  const t = useT();
  const [send, setSend] = useState<{ id: number; title: string; icon: string; column: string }[] | null>(null);
  const locked = !!api.data?.locked; // a sync keeps its rows — they can still be sent elsewhere
  const linked = api.data?.extras.links?.[row.id];
  return (
    <>
      <Dropdown label="⋮" title={t("Row actions")} className="icon-btn" align="left">
        {(close) => (
          <>
            {!locked && api.data?.schema.jobs && (
              <MenuItem
                onClick={async () => {
                  close();
                  const r = await runJobAction(row.id);
                  await api.reload();
                  toast(r.ok ? t("Given to a worker — the result comes back into the row.") : r.error, { tone: r.ok ? "ok" : "error" });
                }}
              >
                ▶ {t("Start the agent")}
              </MenuItem>
            )}
            <MenuItem
              onClick={async () => {
                close();
                const r = await receivingDatabasesAction();
                if (!r.ok) return void toast(r.error, { tone: "error" });
                const mine = api.data?.id;
                setSend(r.databases.filter((d) => d.id !== mine));
              }}
            >
              ➜ {t("Send to board …")}
            </MenuItem>
            {linked && !locked && (
              <MenuItem
                onClick={async () => {
                  close();
                  const r = await unlinkRowAction(row.id);
                  await api.reload();
                  toast(r.ok ? t("Unlinked — this is a copy now.") : r.error, { tone: r.ok ? "ok" : "error" });
                }}
              >
                ⛓ {t("Unlink — make it a copy")}
              </MenuItem>
            )}
            {/* Hidden from the views (the row itself untouched — a synced one too). */}
            <MenuItem onClick={() => (close(), api.changeSchema((s) => hideRows(s, [row.id], !s.hiddenRows?.includes(row.id))))}>
              {api.data?.schema.hiddenRows?.includes(row.id) ? `👁 ${t("Show again")}` : `🙈 ${t("Hide row")}`}
            </MenuItem>
            {!locked && <MenuItem onClick={() => (close(), void api.duplicateRow(row.id))}>⧉ {t("Duplicate")}</MenuItem>}
            {!locked && (
              <MenuItem danger onClick={() => (close(), void api.removeRow(row.id))}>
                🗑 {t("Delete")}
              </MenuItem>
            )}
          </>
        )}
      </Dropdown>
      {send && (
        <Modal title={t("Send to board")} onClose={() => setSend(null)}>
          {send.length ? (
            <ul className="space-y-0.5">
              {send.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    onClick={async () => {
                      setSend(null);
                      const r = await sendRowAction(row.id, d.id);
                      if (!r.ok) return void toast(r.error, { tone: "error" });
                      toast(r.existing ? t("Already there: {board}.", { board: r.database }) : t("Sent to {board} ({column}), linked.", { board: r.database, column: d.column }), { tone: "ok" });
                    }}
                  >
                    <span>{d.icon || "🗂️"}</span>
                    <span className="min-w-0 flex-1 truncate">{d.title}</span>
                    <span className="text-xs text-zinc-400">→ {d.column}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-500">{t("No board receives rows yet — open one with “Receive tickets …” in its menu.")}</p>
          )}
        </Modal>
      )}
    </>
  );
}

export function TitleCell({ row, ctx, openRow, autoEdit = false, onEdited }: { row: Row; ctx: CellCtx; openRow: (id: number) => void; autoEdit?: boolean; onEdited?: () => void }) {
  const t = useT();
  const [editing, setEditing] = useState(autoEdit);
  const [text, setText] = useState(row.title);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the field follows the row when it is changed elsewhere
  useEffect(() => setText(row.title), [row.title]);
  if (editing)
    return (
      <input
        autoFocus
        className="ws-cell-input"
        value={text}
        aria-label={t("Title")}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setEditing(false);
          onEdited?.();
          if (text !== row.title) ctx.set(row.id, TITLE, text);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setText(row.title);
            setEditing(false);
          }
        }}
      />
    );
  return (
    <div className="group/title flex min-h-8 items-center gap-1 px-2 py-1">
      <span>{row.icon || "📄"}</span>
      <button type="button" className="min-w-0 flex-1 truncate text-left font-medium hover:underline" onClick={() => openRow(row.id)} title={t("Open")}>
        {row.title || <span className="text-zinc-400">{t("Untitled")}</span>}
      </button>
      <TodoMark mark={ctx.data.extras?.todoMarks?.[row.id]} />
      {ctx.data.extras?.links?.[row.id] && (
        <span className="ws-chip shrink-0" data-kind="link" title={t("Linked to “{title}” in {board} — it follows changes there.", { title: ctx.data.extras.links[row.id].sourceTitle, board: ctx.data.extras.links[row.id].sourceDb })}>
          🔗
        </span>
      )}
      <button type="button" className="icon-btn opacity-0 group-hover/title:opacity-100" onClick={() => setEditing(true)} aria-label={t("Rename")} title={t("Rename")}>
        ✎
      </button>
    </div>
  );
}
