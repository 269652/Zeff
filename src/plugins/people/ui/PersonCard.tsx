"use client";

import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { initials } from "@/plugins/workspace/widget-shared";
import { CIRCLES, circleLabels, type Circle } from "../shared";
import type { PeopleTool, PersonCardInfo } from "../tools";

/**
 * A person on the people overview: who they are (initials, name, star, circle, role), when you were last in touch, what is
 * open between you (one click shows it, one more ticks it), the next date and the todos — and on hover what to do: write,
 * add a todo, pay, set the circle; on their birthday a greeting to draft.
 */

export type CardPerson = { id: number; personId: number | null; name: string; starred: boolean; next: string | null; nextKind: string; context: string; todos: number; tickets: number };

const TONES = ["bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300", "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300", "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300", "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300", "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300", "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300"];
/** A name's colour: always the same one for the same name. */
export const toneOf = (name: string) => TONES[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % TONES.length];

const CIRCLE_TONE: Record<Circle, string> = {
  family: "text-rose-700 dark:text-rose-300",
  friends: "text-emerald-700 dark:text-emerald-300",
  work: "text-indigo-700 dark:text-indigo-300",
  authorities: "text-amber-800 dark:text-amber-300",
  services: "text-zinc-600 dark:text-zinc-300",
};

const chip = "rounded px-1.5 py-0.5";
const grey = `${chip} bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300`;

/** "today", "yesterday", "5 days ago", "3 weeks ago", "4 months ago". */
export function agoText(t: ReturnType<typeof useT>, iso: string, now: number): string {
  const days = Math.max(0, Math.floor((now - Date.parse(iso)) / 864e5));
  if (days === 0) return t("today");
  if (days === 1) return t("yesterday");
  if (days < 14) return t("{n} days ago", { n: days });
  if (days < 61) return t("{n} weeks ago", { n: Math.floor(days / 7) });
  return t("{n} months ago", { n: Math.floor(days / 30) });
}

export function PersonCard({ p, info, now, soonUntil, weeks, open, run }: { p: CardPerson; info: PersonCardInfo | undefined; now: number; soonUntil: string; weeks: number; open: () => void; run: (tool: PeopleTool, key: string) => Promise<{ ok: boolean; draft?: string }> }) {
  const t = useT();
  const [panel, setPanel] = useState<null | "owed" | "todo" | "greeting">(null);
  const [todo, setTodo] = useState("");
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const today = new Date(now).toISOString().slice(0, 10);
  const soon = !!p.next && p.next >= today && p.next <= soonUntil;
  const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const circles = circleLabels(t);
  const mine = info?.owed.filter((o) => o.direction === "mine") ?? [];
  const theirs = info?.owed.filter((o) => o.direction === "theirs") ?? [];
  const cared = p.starred || info?.circle === "family" || info?.circle === "friends";
  const quiet = !!info?.lastContact && cared && now - Date.parse(info.lastContact.at) >= weeks * 7 * 864e5;
  const pid = p.personId;
  const channel = (c: string) => (c === "Appointment" ? t("Appointment") : c);
  const act = async (tool: PeopleTool, key: string) => {
    setBusy(true);
    const r = await run(tool, key);
    setBusy(false);
    return r;
  };
  const toggle = (x: typeof panel) => setPanel(panel === x ? null : x);
  const iconBtn = "flex size-7 items-center justify-center rounded-md text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-100";

  return (
    <div className="card group relative flex h-full flex-col gap-2 p-3 transition hover:border-zinc-300 hover:shadow-sm dark:hover:border-zinc-600">
      <div className="flex items-start gap-3">
        <button type="button" className={`flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${toneOf(p.name)}`} onClick={open} aria-label={t("Open {name}", { name: p.name })}>
          {initials(p.name) || "?"}
        </button>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-baseline gap-1 pr-24">
            <button type="button" className="truncate text-left font-medium hover:underline" onClick={open}>
              {p.name}
            </button>
            {p.starred && (
              <span className="text-amber-500" title={t("Starred")}>
                ★
              </span>
            )}
          </div>
          {(info?.circle || info?.role || p.context) && (
            <p className="line-clamp-2 text-xs text-zinc-500">
              {info?.circle && <span className={`font-medium ${CIRCLE_TONE[info.circle]}`}>{circles[info.circle]}</span>}
              {info?.circle && (info.role || p.context) ? " · " : ""}
              {info?.role || p.context}
            </p>
          )}
          <div className="flex flex-wrap gap-1 pt-0.5 text-xs">
            {info?.lastContact ? (
              <span className={`${chip} ${quiet ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`} title={t("Last contact: {when}", { when: new Date(info.lastContact.at).toLocaleString() })}>
                {channel(info.lastContact.channel)} · {agoText(t, info.lastContact.at, now)}
              </span>
            ) : null}
            {info?.birthdayIn != null && <span className={`${chip} bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300`}>🎂 {info.birthdayIn === 0 ? t("today") : t("tomorrow")}</span>}
            {p.next && info?.birthdayIn == null && <span className={soon ? `${chip} bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300` : grey}>{p.nextKind ? `${p.nextKind} · ${day(p.next)}` : day(p.next)}</span>}
            {info?.away && <span className={grey}>{t("Away until {date}", { date: day(info.away) })}</span>}
            {mine.length > 0 && (
              <button type="button" aria-expanded={panel === "owed"} className={`${chip} bg-rose-50 text-rose-700 hover:bg-rose-100 dark:bg-rose-950 dark:text-rose-300`} onClick={() => toggle("owed")}>
                {t("you owe {n}", { n: mine.length })}
              </button>
            )}
            {theirs.length > 0 && (
              <button type="button" aria-expanded={panel === "owed"} className={`${chip} bg-sky-50 text-sky-700 hover:bg-sky-100 dark:bg-sky-950 dark:text-sky-300`} onClick={() => toggle("owed")}>
                {t("owes you {n}", { n: theirs.length })}
              </button>
            )}
            {info?.debt && (
              <span className={`${chip} bg-rose-100 font-medium text-rose-800 dark:bg-rose-950 dark:text-rose-300`} title={info.debt.count === 1 ? t("1 running debt to them") : t("{n} running debts to them", { n: info.debt.count })}>
                {t("Debt {amount}", { amount: info.debt.amount.toLocaleString(undefined, { style: "currency", currency: "EUR", maximumFractionDigits: 0 }) })}
              </span>
            )}
            {p.todos > 0 && <span className={`${chip} bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300`}>{p.todos === 1 ? t("1 todo") : t("{n} todos", { n: p.todos })}</span>}
            {p.tickets > 0 && <span className={grey}>{p.tickets === 1 ? t("1 ticket") : t("{n} tickets", { n: p.tickets })}</span>}
          </div>
        </div>
      </div>

      {/* What to do: on hover (and always on touch). */}
      {pid && (
        <div className="absolute top-2 right-2 flex gap-0.5 rounded-md bg-white/90 opacity-100 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100 dark:bg-zinc-900/90">
          {info?.email && (
            <a className={iconBtn} href={`mailto:${info.email}`} title={t("Write a mail")} aria-label={t("Write a mail")}>
              ✉
            </a>
          )}
          {info?.chat && (
            <a className={iconBtn} href={`/mail?q=${encodeURIComponent(info.chat)}`} title={t("Open the chat")} aria-label={t("Open the chat")}>
              💬
            </a>
          )}
          <button type="button" className={iconBtn} title={t("Add a todo")} aria-label={t("Add a todo")} onClick={() => toggle("todo")}>
            ＋
          </button>
          {info?.pay && (
            <a className={iconBtn} href={`/pay?${new URLSearchParams({ name: p.name, iban: info.pay.iban, bic: info.pay.bic })}`} title={t("Transfer money")} aria-label={t("Transfer money")}>
              💶
            </a>
          )}
          <label className={`${iconBtn} relative cursor-pointer`} title={t("Circle")}>
            ◐
            <select
              className="absolute inset-0 cursor-pointer opacity-0"
              aria-label={t("Circle")}
              value={info?.circle ?? ""}
              onChange={(e) => void act({ tool: "circle", id: pid, circle: e.target.value as Circle | "" }, `circle${pid}`)}
            >
              <option value="">{t("No circle")}</option>
              {CIRCLES.map((c) => (
                <option key={c} value={c}>
                  {circles[c]}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {pid && info?.birthdayIn != null && panel !== "greeting" && (
        <button
          type="button"
          className="btn btn-sm self-start"
          disabled={busy}
          onClick={async () => {
            setPanel("greeting");
            if (draft === null) {
              const r = await act({ tool: "greeting", id: pid }, `greet${pid}`);
              setDraft(r.ok ? (r.draft ?? "") : null);
              if (!r.ok) setPanel(null);
            }
          }}
        >
          🎂 {t("Draft a greeting")}
        </button>
      )}

      {panel === "greeting" && (
        <div className="space-y-1.5 border-t border-zinc-100 pt-2 dark:border-zinc-800">
          {draft === null ? (
            <p className="text-xs text-zinc-400">{t("Drafting …")}</p>
          ) : (
            <>
              <textarea className="input min-h-20 text-sm" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={t("Greeting")} />
              <div className="flex gap-1">
                <button type="button" className="btn btn-primary btn-sm" onClick={() => void navigator.clipboard.writeText(draft).then(() => toast(t("Copied.")))}>
                  {t("Copy")}
                </button>
                {info?.email && (
                  <a className="btn btn-sm" href={`mailto:${info.email}?${new URLSearchParams({ subject: t("Happy birthday!"), body: draft }).toString().replace(/\+/g, "%20")}`}>
                    ✉ {t("As a mail")}
                  </a>
                )}
                <button type="button" className="btn btn-sm" onClick={() => setPanel(null)}>
                  {t("Close")}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {panel === "owed" && pid && (
        <ul className="space-y-1.5 border-t border-zinc-100 pt-2 text-sm dark:border-zinc-800">
          {[...mine, ...theirs].map((o) => (
            <li key={o.id} className="flex items-start gap-2">
              <span className={`mt-0.5 shrink-0 text-xs ${o.direction === "mine" ? "text-rose-700 dark:text-rose-300" : "text-sky-700 dark:text-sky-300"}`}>{o.direction === "mine" ? t("you") : t("they")}</span>
              <span className="min-w-0 flex-1">
                {o.text}
                {o.due && <span className="text-xs text-zinc-400"> · {o.due}</span>}
              </span>
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void act({ tool: "claim", id: o.id, action: "done" }, `c${o.id}`)}>
                {t("Done")}
              </button>
            </li>
          ))}
        </ul>
      )}

      {panel === "todo" && pid && (
        <form
          className="flex gap-1 border-t border-zinc-100 pt-2 dark:border-zinc-800"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!todo.trim()) return;
            const r = await act({ tool: "todo", id: pid, text: todo }, `todo${pid}`);
            if (r.ok) {
              setTodo("");
              setPanel(null);
            }
          }}
        >
          <input className="input text-sm" autoFocus value={todo} onChange={(e) => setTodo(e.target.value)} placeholder={t("What to do with {name}…", { name: p.name.split(" ")[0] })} aria-label={t("New todo")} />
          <button className="btn btn-primary btn-sm" disabled={busy || !todo.trim()}>
            {t("Add")}
          </button>
        </form>
      )}
    </div>
  );
}
