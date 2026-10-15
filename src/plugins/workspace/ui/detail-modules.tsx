"use client";

import { useEffect, useState } from "react";
import type { JSONContent } from "@tiptap/react";
import { useT } from "@/components/I18nProvider";
import { ContextList } from "@/components/boards/TodoSources";
import { TicketChat } from "@/components/boards/TicketChat";
import { TicketQuestions } from "@/components/boards/TicketQuestions";
import type { TicketDetail } from "@/lib/items/tickets";
import { pageContentAction, ticketDetailAction, type DatabaseData } from "../actions";
import { DETAIL_MODULES, moveDetail, toggleDetail, type DetailModule } from "../model";
import { CardTodos, extrasOf } from "./card-extras";
import { RowProperties } from "./DatabaseView";
import { Editor } from "./Editor";
import { Modal } from "./kit";

/**
 * The modules of a row's detail view — the same everywhere: its properties and page, and by its ticket key what Zeff knows
 * (the briefing, the todos, the questions, the suggested actions, the flags, the context, the chat). The database chooses
 * which and in what order (DbSchema.detail).
 */

/** A module's name, as the detail view's editor lists it. */
export function useModuleLabels(): Record<DetailModule, string> {
  const t = useT();
  return { properties: t("Properties"), briefing: t("Briefing"), todos: t("Todos"), questions: t("Questions"), actions: t("Suggested actions"), flags: t("Flags"), context: t("Context"), chat: t("Chat"), page: t("Page") };
}

/** The modules that need the row's ticket key (none without one). */
const BY_KEY = new Set<DetailModule>(["briefing", "todos", "questions", "actions", "flags", "context", "chat"]);
/** The ones that need what's fetched when the panel opens. */
const HEAVY = new Set<DetailModule>(["questions", "actions", "flags", "context", "chat"]);

export function DetailModules({ modules, data, rowId }: { modules: DetailModule[]; data: DatabaseData; rowId: number }) {
  const t = useT();
  const x = extrasOf(data, rowId);
  const shown = modules.filter((m) => !BY_KEY.has(m) || x.key);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [page, setPage] = useState<{ content: JSONContent; rev: number } | null>(null);
  const wantsDetail = !!x.key && shown.some((m) => HEAVY.has(m));
  const wantsPage = shown.includes("page");
  useEffect(() => {
    let live = true;
    if (wantsDetail && x.key) void ticketDetailAction(x.key).then((r) => live && r.ok && setDetail(r.detail));
    if (wantsPage) void pageContentAction(rowId).then((r) => live && r.ok && setPage({ content: JSON.parse(r.content) as JSONContent, rev: r.rev }));
    return () => {
      live = false;
    };
  }, [rowId, x.key, wantsDetail, wantsPage]);

  const section = (title: string, body: React.ReactNode) => (
    <section className="space-y-1.5">
      <h3 className="label">{title}</h3>
      {body}
    </section>
  );
  const one = (m: DetailModule): React.ReactNode => {
    switch (m) {
      case "properties":
        return <RowProperties initial={data} dbId={data.id} rowId={rowId} />;
      case "briefing":
        return x.ticket && (x.ticket.lead || x.ticket.summary || x.ticket.happened.length) ? (
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
        ) : null;
      case "todos":
        return data.extras?.todosOn ? <CardTodos k={x.key!} ticket={x.ticket} open /> : null;
      case "questions":
        return detail?.questions.length ? <TicketQuestions questions={detail.questions} /> : null;
      case "actions":
        return detail?.actions.length
          ? section(
              t("Suggested actions"),
              <>
                <ul className="space-y-1 text-sm">
                  {detail.actions.map((a, i) => (
                    <li key={i}>
                      <span className="font-medium">{a.label}</span>
                      {"why" in a && a.why ? <span className="text-zinc-500"> — {String(a.why)}</span> : null}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-zinc-500">{t("Run them in the Todos tab.")}</p>
              </>,
            )
          : null;
      case "flags":
        return detail?.flags.length
          ? section(
              t("Flags"),
              <div className="flex flex-wrap gap-1">
                {detail.flags.map((f) => (
                  <span key={f} className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                    ⚑ {f}
                  </span>
                ))}
              </div>,
            )
          : null;
      case "context":
        return detail?.context.length ? section(t("Context"), <ContextList items={detail.context} />) : null;
      case "chat":
        return detail ? <TicketChat key={x.key} ticket={x.key!} initial={detail.chat} /> : null;
      case "page":
        return page ? <Editor key={rowId} pageId={rowId} initial={page.content} rev={page.rev} editable={!data.locked} smallText={false} /> : <p className="text-sm text-zinc-400">…</p>;
    }
  };
  return (
    <>
      {shown.map((m) => (
        <div key={m}>{one(m)}</div>
      ))}
    </>
  );
}

/** The detail view's editor: which modules a row's panel shows, in which order — or back to what fits the database. */
export function DetailEditor({ modules, custom, onChange, onClose }: { modules: DetailModule[]; custom: boolean; onChange: (next: DetailModule[] | null) => void; onClose: () => void }) {
  const t = useT();
  const labels = useModuleLabels();
  const rest = DETAIL_MODULES.filter((m) => !modules.includes(m));
  return (
    <Modal title={t("Detail view …")} onClose={onClose}>
      <p className="text-sm text-zinc-500">{t("Shown in a row's detail view, in this order")}</p>
      <ul className="space-y-1">
        {modules.map((m, i) => (
          <li key={m} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked onChange={() => onChange(toggleDetail(modules, m))} aria-label={labels[m]} />
            <span className="flex-1">{labels[m]}</span>
            <button type="button" className="icon-btn" disabled={i === 0} onClick={() => onChange(moveDetail(modules, m, -1))} aria-label={t("Up")}>
              ↑
            </button>
            <button type="button" className="icon-btn" disabled={i === modules.length - 1} onClick={() => onChange(moveDetail(modules, m, 1))} aria-label={t("Down")}>
              ↓
            </button>
          </li>
        ))}
        {rest.map((m) => (
          <li key={m} className="flex items-center gap-2 text-sm text-zinc-500">
            <input type="checkbox" checked={false} onChange={() => onChange(toggleDetail(modules, m))} aria-label={labels[m]} />
            <span className="flex-1">{labels[m]}</span>
          </li>
        ))}
      </ul>
      {custom && (
        <button type="button" className="text-sm text-zinc-500 hover:underline" onClick={() => onChange(null)}>
          {t("Back to the default")}
        </button>
      )}
    </Modal>
  );
}
