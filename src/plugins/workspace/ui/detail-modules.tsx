"use client";

import { useCallback, useEffect, useState } from "react";
import type { JSONContent } from "@tiptap/react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { ContextList } from "@/components/boards/TodoSources";
import { TicketChat } from "@/components/boards/TicketChat";
import { TicketQuestions } from "@/components/boards/TicketQuestions";
import type { TicketDetail } from "@/lib/items/tickets";
import { addSubtaskAction, detachSubtaskAction, linkedSourceAction, pageContentAction, rowContextAction, setSubtaskDoneAction, subtasksAction, ticketBlockAction, ticketDetailAction, unlinkRowAction, type DatabaseData } from "../actions";
import type { TicketExtras } from "@/lib/items/shared";
import { WS_CHANGED } from "./ChatPanel";
import type { DetailModule } from "../model";
import { ROW_MODULES } from "../doc";
import { CardTodos, extrasOf } from "./card-extras";
import { SuggestedActions } from "./suggested";
import { RowProperties } from "./DatabaseView";
import { Editor } from "./Editor";
import { TimelineList } from "@/plugins/timeline/ui/TimelineList";

/**
 * The modules of a row's detail view — the same everywhere: its properties and page, and by its ticket key what Zeff knows
 * (the briefing, the todos, the questions, the suggested actions, the flags, the context, the chat). The database chooses
 * which and in what order (DbSchema.detail).
 */

/** A module's name, as the detail view's editor lists it. */
export function useModuleLabels(): Record<DetailModule, string> {
  const t = useT();
  return { properties: t("Properties"), source: t("Linked ticket"), subtasks: t("Subtasks"), suggested: t("Suggested actions"), briefing: t("Briefing"), todos: t("Todos"), questions: t("Questions"), actions: t("Suggested actions"), flags: t("Flags"), context: t("Context"), chat: t("Chat"), page: t("Page"), timeline: t("Timeline") };
}

/** The modules that need the row's ticket key (none without one). */
const BY_KEY = new Set<DetailModule>(["briefing", "todos", "questions", "actions", "flags", "context", "chat"]);
/** The ones that need what's fetched when the panel opens. */
const HEAVY = new Set<DetailModule>(["questions", "actions", "flags", "context", "chat"]);

export function DetailModules({ modules, data, rowId, bare = false }: { modules: DetailModule[]; data: DatabaseData; rowId: number; /** One module as a block (no suggestions on top). */ bare?: boolean }) {
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

  const one = (m: DetailModule): React.ReactNode => {
    if (m === "properties") return <RowProperties initial={data} dbId={data.id} rowId={rowId} />;
    if (m === "source") return <LinkedSourceModule rowId={rowId} />;
    if (m === "subtasks") return <SubtasksModule rowId={rowId} locked={!!data.locked} />;
    if (m === "suggested") return <SuggestedActions rowId={rowId} value={data.rows.find((r) => r.id === rowId)?.cells.rowactions} />;
    if (m === "timeline") return <TimelineModule rowId={rowId} />;
    if (m === "page") return page ? <Editor key={rowId} pageId={rowId} initial={page.content} rev={page.rev} editable={!data.locked} smallText={false} /> : <p className="text-sm text-zinc-400">…</p>;
    return <ModuleBody m={m} k={x.key!} ticket={x.ticket} detail={detail} todosOn={!!data.extras?.todosOn} />;
  };
  const row = data.rows.find((r) => r.id === rowId);
  return (
    <>
      {/* What the pipeline suggests doing with it, first. */}
      {!bare && !modules.includes("suggested") && <SuggestedActions rowId={rowId} value={row?.cells.rowactions} />}
      {shown.map((m) => (
        <div key={m}>{one(m)}</div>
      ))}
    </>
  );
}

/** What happened with the row (the Timeline plugin): its own changes, and what concerns the person, case or ticket it stands for. */
function TimelineModule({ rowId }: { rowId: number }) {
  const t = useT();
  return (
    <section className="space-y-1.5" data-timeline-module>
      <h3 className="label">{t("Timeline")}</h3>
      <TimelineList row={rowId} limit={20} compact />
    </section>
  );
}

type Linked = NonNullable<Awaited<ReturnType<typeof linkedSourceAction>> extends infer R ? (R extends { ok: true; source: infer S } ? S : never) : never>;

/** The ticket a copy was sent from: its board, its key, its fields — and "unlink" (it becomes a copy). Nothing for a row that isn't one. */
function LinkedSourceModule({ rowId }: { rowId: number }) {
  const t = useT();
  const [s, setS] = useState<Linked | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const read = () => void linkedSourceAction(rowId).then((r) => live && setS(r.ok ? (r.source as Linked | null) : null));
    read();
    window.addEventListener(WS_CHANGED, read);
    return () => {
      live = false;
      window.removeEventListener(WS_CHANGED, read);
    };
  }, [rowId]);
  if (!s) return null;
  return (
    <section className="ws-module space-y-2 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 text-sm dark:border-indigo-900 dark:bg-indigo-950/20">
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden>🔗</span>
        <span className="font-medium">{t("Linked ticket")}</span>
        <a href={`/workspace/${s.sourceDbId}?row=${s.sourceId}`} className="min-w-0 truncate text-indigo-700 underline dark:text-indigo-300">
          {s.sourceTitle || t("Untitled")}
        </a>
        <span className="text-xs text-zinc-500">{t("in {board}", { board: s.sourceDb })}</span>
        {s.key && <span className="ws-chip" data-kind="ticket">{s.key}</span>}
        {s.url && (
          <a href={s.url} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 underline dark:text-indigo-400">
            {t("Open the ticket")} ↗
          </a>
        )}
        <button
          type="button"
          className="ml-auto text-xs text-zinc-500 hover:underline"
          onClick={async () => {
            const r = await unlinkRowAction(rowId);
            if (!r.ok) return void toast(r.error, { tone: "error" });
            toast(t("Unlinked — this is a copy now."), { tone: "ok" });
            window.dispatchEvent(new Event(WS_CHANGED));
          }}
        >
          ⛓ {t("Unlink — make it a copy")}
        </button>
      </div>
      {s.fields.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          {s.fields.map((f) => (
            <div key={f.name} className="contents">
              <dt className="text-zinc-500">{f.name}</dt>
              <dd className="min-w-0 break-words whitespace-pre-wrap">{f.text}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="text-xs text-zinc-500">{t("Changes there follow here. What Zeff knows of the ticket (Lage, todos, context) is below.")}</p>
    </section>
  );
}

type Sub = { id: number; title: string; done: boolean; status: string | null };

/** A row's subtasks (as on Kanban's cards): checked off, opened, made a row of their own again — and a new one added. */
function SubtasksModule({ rowId, locked }: { rowId: number; locked: boolean }) {
  const t = useT();
  const [list, setList] = useState<Sub[] | null>(null);
  const [title, setTitle] = useState("");
  const load = useCallback(() => void subtasksAction(rowId).then((r) => r.ok && setList(r.subtasks)), [rowId]);
  useEffect(load, [load]);
  const after = (r: { ok: boolean; error?: string }) => (r.ok ? load() : toast(r.error ?? t("Failed."), { tone: "error" }));
  if (!list) return null;
  const done = list.filter((x) => x.done).length;
  return (
    <section className="space-y-1.5" data-subtasks>
      <h3 className="label">
        {t("Subtasks")}
        {list.length > 0 && <span className="ml-1 font-normal text-zinc-500">{done}/{list.length}</span>}
      </h3>
      <ul className="space-y-0.5 text-sm">
        {list.map((x) => (
          <li key={x.id} className="group flex items-center gap-2">
            <input type="checkbox" checked={x.done} disabled={locked} aria-label={x.title} onChange={(e) => void setSubtaskDoneAction(x.id, e.target.checked).then(after)} />
            <a href={`?row=${x.id}`} className={`min-w-0 flex-1 truncate hover:underline ${x.done ? "text-zinc-400 line-through" : ""}`}>
              {x.title || t("Untitled")}
            </a>
            {x.status && <span className="text-xs text-zinc-400">{x.status}</span>}
            {!locked && (
              <button type="button" className="icon-btn invisible text-xs group-hover:visible" title={t("No longer a subtask")} aria-label={t("No longer a subtask")} onClick={() => void detachSubtaskAction(x.id).then(after)}>
                ⤴
              </button>
            )}
          </li>
        ))}
      </ul>
      {!locked && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            void addSubtaskAction(rowId, title).then((r) => (setTitle(""), after(r)));
          }}
        >
          <input className="input w-full text-sm" value={title} placeholder={`+ ${t("Subtask")} …`} aria-label={t("New subtask")} onChange={(e) => setTitle(e.target.value)} />
        </form>
      )}
    </section>
  );
}

/** A key module's body (the same in a row's panel and as a block of a page): what Zeff knows about ticket `k`. Null: nothing to show. */
export function ModuleBody({ m, k, ticket, detail, todosOn }: { m: DetailModule; k: string; ticket: TicketExtras | null; detail: TicketDetail | null; todosOn: boolean }) {
  const t = useT();
  const section = (title: string, body: React.ReactNode) => (
    <section className="space-y-1.5">
      <h3 className="label">{title}</h3>
      {body}
    </section>
  );
  switch (m) {
    case "briefing":
      return ticket && (ticket.lead || ticket.summary || ticket.happened.length) ? (
        <section className="space-y-1.5 rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-900">
          <h3 className="text-xs font-semibold text-zinc-500 uppercase">
            {t("Briefing")}
            {ticket.attentionLabel ? ` · ${ticket.attentionLabel}` : ""}
          </h3>
          {ticket.lead && <p className="font-medium">{ticket.lead}</p>}
          {ticket.summary && <p className="text-zinc-600 dark:text-zinc-400">{ticket.summary}</p>}
          {ticket.happened.length > 0 && (
            <ul className="space-y-0.5 text-xs text-zinc-500">
              {ticket.happened.map((h, i) => (
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
      return todosOn ? <CardTodos k={k} ticket={ticket} open /> : null;
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
      return detail ? <TicketChat key={k} ticket={k} initial={detail.chat} /> : null;
    default:
      return null;
  }
}

/**
 * A key module as a block of a page (/Lage, /Todos …): what Zeff knows about the ticket `ticketKey` — or, without one, about the
 * row whose page it's on. It reads its data itself, again on a change elsewhere.
 */
export function ModuleBlock({ module, ticketKey, pageId }: { module: DetailModule; ticketKey: string; pageId: number }) {
  if ((ROW_MODULES as readonly string[]).includes(module)) return <RowModuleBlock module={module} rowId={pageId} />;
  return <TicketModuleBlock module={module} ticketKey={ticketKey} pageId={pageId} />;
}

/**
 * A block about the row itself (its properties, subtasks, suggested actions, its own page) — in its detail view, or on its
 * page. On a page that isn't a row (a detail view being laid out): what it will show, as a placeholder.
 */
function RowModuleBlock({ module, rowId }: { module: DetailModule; rowId: number }) {
  const t = useT();
  const labels = useModuleLabels();
  const [data, setData] = useState<DatabaseData | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const read = () => void rowContextAction(rowId).then((r) => live && setData(r.ok ? r.data : null));
    read();
    window.addEventListener(WS_CHANGED, read);
    return () => {
      live = false;
      window.removeEventListener(WS_CHANGED, read);
    };
  }, [rowId]);
  if (data === undefined) return <p className="text-sm text-zinc-400">…</p>;
  if (!data)
    return (
      <div className="ws-module rounded-lg border border-dashed border-zinc-300 p-3 text-sm text-zinc-500 dark:border-zinc-700">
        ▤ {labels[module]} — {t("the row's, in its detail view")}
      </div>
    );
  return <DetailModules modules={[module]} data={data} rowId={rowId} bare />;
}

function TicketModuleBlock({ module, ticketKey, pageId }: { module: DetailModule; ticketKey: string; pageId: number }) {
  const t = useT();
  const labels = useModuleLabels();
  const [data, setData] = useState<{ key: string | null; ticket: TicketExtras | null; detail: TicketDetail | null; todosOn: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    const read = () => void ticketBlockAction(ticketKey, pageId).then((r) => live && r.ok && setData({ key: r.key, ticket: r.ticket, detail: r.detail, todosOn: r.todosOn }));
    read();
    window.addEventListener(WS_CHANGED, read);
    return () => {
      live = false;
      window.removeEventListener(WS_CHANGED, read);
    };
  }, [ticketKey, pageId]);
  const body = data?.key ? <ModuleBody m={module} k={data.key} ticket={data.ticket} detail={data.detail} todosOn={data.todosOn} /> : null;
  return (
    <div className="ws-module space-y-1 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <span className="font-semibold uppercase">{labels[module]}</span>
        {data?.key && <span className="font-mono">{data.key}</span>}
      </div>
      {!data ? <p className="text-sm text-zinc-400">…</p> : !data.key ? <p className="text-sm text-zinc-400">{t("No ticket here — give the block a key (e.g. PROJ-12).")}</p> : (body ?? <p className="text-sm text-zinc-400">{t("Nothing yet.")}</p>)}
    </div>
  );
}
