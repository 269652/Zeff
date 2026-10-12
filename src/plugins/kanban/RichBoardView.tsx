"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CloseIcon } from "@/components/icons";
import { useT } from "@/components/I18nProvider";
import { formatAgo, formatDateTime } from "@/lib/format";
import { BoardLageButton } from "@/plugins/jira-lage/BoardLageButton";
import { BriefingRunButton } from "@/plugins/jira-lage/BriefingRunButton";
import { ContextList } from "@/components/boards/TodoSources";
import { TicketQuestions } from "@/components/boards/TicketQuestions";
import { TicketChat } from "@/components/boards/TicketChat";
import { BoardFrame, COLUMN } from "./BoardFrame";
import { initials, NOBODY, PersonChips, peopleOf } from "./PersonChips";
import type { RichBoard, RichCard } from "./shared";

/** The Lage's attention as a colour: the card's stripe and badge. */
const ATTENTION_TONE: Record<string, { stripe: string; badge: string }> = {
  feedback: { stripe: "border-l-red-500", badge: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200" },
  blocked: { stripe: "border-l-amber-500", badge: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200" },
  active: { stripe: "border-l-indigo-500", badge: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200" },
  check: { stripe: "border-l-sky-500", badge: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200" },
  spec: { stripe: "border-l-violet-500", badge: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200" },
  ready: { stripe: "border-l-emerald-500", badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" },
  stale: { stripe: "border-l-zinc-400", badge: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" },
};
const BADGE_TONE: Record<string, string> = {
  zinc: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  red: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  emerald: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  sky: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  violet: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
};


const ago = (iso: string | null) => {
  if (!iso) return "";
  // Jira's "+0200" as "+02:00" (what Date understands).
  const ms = Date.parse(iso.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  if (Number.isNaN(ms)) return "";
  return formatAgo(ms);
};

/** A ticket's card: the Lage's headline, the newest happening, its todos and flags at a glance. */
function Card({ c, onOpen }: { c: RichCard; onOpen: () => void }) {
  const t = useT();
  const tone = c.attention ? ATTENTION_TONE[c.attention] : undefined;
  const last = c.activity[c.activity.length - 1];
  const mine = c.todos.filter((x) => x.owner === "me").length;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`w-full rounded-lg border border-l-4 border-zinc-200 bg-white p-2.5 text-left text-sm shadow-xs transition hover:shadow-sm dark:border-zinc-700 dark:bg-zinc-900 ${tone?.stripe ?? "border-l-zinc-200 dark:border-l-zinc-700"} ${c.noLage ? "opacity-80" : ""}`}
    >
      <span className="flex items-center gap-1.5 text-[11px]">
        <span className="font-mono font-medium text-zinc-500">{c.ref}</span>
        {c.attentionLabel && <span className={`rounded px-1.5 py-0.5 font-medium ${tone?.badge ?? ""}`}>{c.attentionLabel}</span>}
        {c.badges.map((b) => (
          <span key={b.text} className={`rounded px-1.5 py-0.5 ${BADGE_TONE[b.tone ?? "zinc"]}`}>
            {b.text}
          </span>
        ))}
        {c.assignee && (
          <span className="ml-auto flex size-5 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-[9px] font-semibold text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200" title={c.assignee}>
            {initials(c.assignee)}
          </span>
        )}
      </span>
      <span className="mt-1 block font-medium break-words">{c.title}</span>
      {c.lead && <span className="mt-1 block text-xs text-zinc-700 dark:text-zinc-300">{c.lead}</span>}
      {last && (
        <span className="mt-1.5 block truncate text-[11px] text-zinc-500" title={`${last.when}${last.who ? ` · ${last.who}` : ""}: ${last.what}`}>
          ↳ {last.when}
          {last.who ? ` · ${last.who}` : ""}: {last.what}
        </span>
      )}
      {(c.todos.length > 0 || c.flags.length > 0 || c.actions.length > 0) && (
        <span className="mt-1.5 flex flex-wrap gap-1 text-[11px]">
          {c.todos.length > 0 && (
            <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" title={t("Open todos")}>
              ☐ {c.todos.length}
              {mine && mine < c.todos.length ? ` ${t("({n} mine)", { n: mine })}` : ""}
            </span>
          )}
          {c.actions.length > 0 && <span className="rounded bg-violet-50 px-1.5 py-0.5 text-violet-700 dark:bg-violet-950 dark:text-violet-300">⚡ {c.actions.length}</span>}
          {c.flags.slice(0, 2).map((f) => (
            <span key={f} className="max-w-full truncate rounded bg-amber-50 px-1.5 py-0.5 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
              ⚑ {f}
            </span>
          ))}
        </span>
      )}
    </button>
  );
}

/** A card opened: its whole Lage — summary, what happened, todos, flags, actions, who's on it. */
function Panel({ c, onClose }: { c: RichCard; onClose: () => void }) {
  const t = useT();
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  const tone = c.attention ? ATTENTION_TONE[c.attention] : undefined;
  return (
    <>
      <div className="fixed inset-0 z-40 bg-zinc-950/30" onClick={onClose} aria-hidden />
      <aside role="dialog" aria-label={c.ref} className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <span className="flex items-center gap-2 text-sm">
            {c.url ? (
              <a href={c.url} target="_blank" rel="noreferrer" className="font-mono font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                {c.ref} ↗
              </a>
            ) : (
              <span className="font-mono">{c.ref}</span>
            )}
            {c.attentionLabel && <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${tone?.badge ?? ""}`}>{c.attentionLabel}</span>}
          </span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t("Close")} title={t("Close (Esc)")}>
            <CloseIcon />
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
          <div>
            <h2 className="text-base font-semibold">{c.title}</h2>
            <p className="text-xs text-zinc-500">
              {[c.assignee && t("Assignee: {name}", { name: c.assignee }), c.updatedAt && t("changed {ago}", { ago: ago(c.updatedAt) }), ...c.badges.map((b) => b.text)].filter(Boolean).join(" · ")}
            </p>
          </div>
          {c.noLage && <p className="rounded-md bg-zinc-100 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">{t("Not in the briefing run — only what Jira says.")}</p>}
          {c.lead && <p className="font-medium">{c.lead}</p>}
          {c.summary && <p className="whitespace-pre-line text-zinc-700 dark:text-zinc-300">{c.summary}</p>}
          {c.activity.length > 0 && (
            <section>
              <h3 className="label">{t("What happened")}</h3>
              <ol className="space-y-1">
                {c.activity.map((a, i) => (
                  <li key={i} className="text-xs">
                    <span className="text-zinc-500">
                      {a.when}
                      {a.who ? ` · ${a.who}` : ""}:
                    </span>{" "}
                    {a.what}
                  </li>
                ))}
              </ol>
            </section>
          )}
          <TicketQuestions questions={c.questions ?? []} />
          {c.todos.length > 0 && (
            <section>
              <h3 className="label">{t("Open todos")}</h3>
              <ul className="space-y-1">
                {c.todos.map((todo) => (
                  <li key={todo.id} className="text-xs">
                    <Link href={`/t/${todo.id}`} className="font-mono text-indigo-600 hover:underline dark:text-indigo-400">
                      T-{todo.id}
                    </Link>{" "}
                    {todo.owner === "other" && <span className="text-zinc-500">{t("(waiting on others)")} </span>}
                    {todo.text}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <TicketChat key={c.id} ticket={c.ref} initial={c.chat ?? []} />
          {!!c.context?.length && (
            <section>
              <h3 className="label">{t("Context")}</h3>
              <ContextList items={c.context} />
            </section>
          )}
          {c.actions.length > 0 && (
            <section>
              <h3 className="label">{t("Suggested actions")}</h3>
              <ul className="space-y-1">
                {c.actions.map((a, i) => (
                  <li key={i} className="rounded border border-violet-200 bg-violet-50 px-2 py-1 text-xs dark:border-violet-900 dark:bg-violet-950/40">
                    ⚡ <span className="font-medium">{a.label}</span> <span className="text-zinc-600 dark:text-zinc-400">— {a.why}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[11px] text-zinc-500">{t("Run them in the Todos tab.")}</p>
            </section>
          )}
          {c.flags.length > 0 && (
            <section>
              <h3 className="label">{t("Flags")}</h3>
              <ul className="list-disc space-y-0.5 pl-4 text-xs">
                {c.flags.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </section>
          )}
          {c.people.length > 0 && (
            <section>
              <h3 className="label">{t("Involved")}</h3>
              <p className="text-xs text-zinc-600 dark:text-zinc-400">{c.people.join(", ")}</p>
            </section>
          )}
        </div>
      </aside>
    </>
  );
}

/**
 * A board another plugin brings (Jira Lage): its columns as there, each card with the Lage of its
 * ticket — filtered by words, by "only with a Lage", "only with todos"; empty columns folded.
 */
export function RichBoardView({ board }: { board: RichBoard }) {
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [onlyLage, setOnlyLage] = useState(false);
  const [onlyTodos, setOnlyTodos] = useState(false);
  // As in Jira: every column, empty ones too (hidden on request).
  const [hideEmpty, setHideEmpty] = useState(false);
  const [persons, setPersons] = useState<Set<string>>(new Set());
  const words = q.trim().toLowerCase();
  const shown = (c: RichCard) =>
    (!words || `${c.ref} ${c.title} ${c.lead ?? ""} ${c.summary ?? ""} ${c.assignee ?? ""}`.toLowerCase().includes(words)) && (!onlyLage || !c.noLage) && (!onlyTodos || c.todos.length > 0) && (!persons.size || persons.has(c.assignee || NOBODY));
  const columns = board.columns.map((col) => ({ ...col, cards: col.cards.filter(shown) }));
  const opened = open ? board.columns.flatMap((c) => c.cards).find((c) => c.id === open) : undefined;
  const total = columns.reduce((n, c) => n + c.cards.length, 0);
  return (
    <>
      <BoardFrame
        sidebar={
          <>
            <div>
              <h1 className="text-lg font-semibold">{board.name}</h1>
              {board.url && (
                <a href={board.url} target="_blank" rel="noreferrer" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
                  {t("in Jira ↗")}
                </a>
              )}
              <p className="mt-1 text-sm text-zinc-500">{board.description}</p>
              {board.lageAt && (
                <p className="text-xs text-zinc-500">
                  {t("Briefing of {when}", { when: formatDateTime(new Date(board.lageAt.replace(" ", "T") + (board.lageAt.includes("Z") || board.lageAt.includes("+") ? "" : "Z"))) })}
                </p>
              )}
              {board.error && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{board.error}</p>}
            </div>
            {board.briefing && <BriefingRunButton state={board.briefing} />}
            {board.boardLage && <BoardLageButton state={board.boardLage} />}
            <div className="space-y-2 text-sm">
              <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Filter cards …")} aria-label={t("Filter cards")} />
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={onlyLage} onChange={(e) => setOnlyLage(e.target.checked)} className="accent-indigo-600" /> {t("with a briefing")}
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={onlyTodos} onChange={(e) => setOnlyTodos(e.target.checked)} className="accent-indigo-600" /> {t("with todos")}
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} className="accent-indigo-600" /> {t("hide empty columns")}
              </label>
              <p className="text-xs text-zinc-500">{t("{n} cards", { n: total })}</p>
            </div>
            <div className="space-y-1.5">
              <h2 className="label">{t("People")}</h2>
              <PersonChips
                people={peopleOf(board.columns.flatMap((c) => c.cards.map((x) => x.assignee)))}
                selected={persons}
                onToggle={(n) =>
                  setPersons((s) => {
                    const next = new Set(s);
                    if (next.has(n)) next.delete(n);
                    else next.add(n);
                    return next;
                  })
                }
                onClear={() => setPersons(new Set())}
              />
            </div>
            {board.lede && (
              <details className="card p-3 text-sm">
                <summary className="cursor-pointer font-medium">{t("The briefing overall")}</summary>
                <p className="mt-2 whitespace-pre-line text-zinc-700 dark:text-zinc-300">{board.lede}</p>
              </details>
            )}
          </>
        }
      >
        {columns
          .filter((c) => !hideEmpty || c.cards.length > 0)
          .map((col) => (
            <section key={col.id} className={COLUMN} aria-label={col.name}>
              <div className="flex items-center gap-1.5 px-1">
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{col.name}</span>
                <span className="rounded-full bg-zinc-200/70 px-1.5 text-xs text-zinc-600 tabular-nums dark:bg-zinc-800 dark:text-zinc-300">{col.cards.length}</span>
              </div>
              <div className="flex min-h-0 flex-col gap-2 overflow-y-auto p-0.5">
                {col.cards.map((c) => (
                  <Card key={c.id} c={c} onOpen={() => setOpen(c.id)} />
                ))}
              </div>
            </section>
          ))}
      </BoardFrame>
      {opened && <Panel c={opened} onClose={() => setOpen(null)} />}
    </>
  );
}
