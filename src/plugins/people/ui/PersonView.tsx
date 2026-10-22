"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { confirmAction } from "@/components/confirm";
import { GiroCode } from "@/components/GiroCode";
import { Overlay } from "@/components/Overlay";
import { accountFor, amountIn } from "@/lib/girocode";
import { personBundleAction, personKnowledgeMergeAction, personOpAction, personWikiAction, type KnowledgeOfPerson } from "../block-actions";
import type { Appointment } from "../appointments";
import type { PersonBundle, PersonOperation } from "../blocks";
import { formatDate, formatDayTime } from "@/lib/format";

/**
 * The sections of a person's page — all read one bundle per row, so a change in one shows in the others.
 */

type Entry = { data: PersonBundle | null; error: string | null; loading: boolean };
const entries = new Map<number, Entry>();
const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());
const EMPTY: Entry = { data: null, error: null, loading: true };

const seeded = new Map<number, number>();

/** What the server read with the page: shown at once (and not read again for a moment). */
export function seedPerson(rowId: number, data: PersonBundle) {
  entries.set(rowId, { data, error: null, loading: false });
  seeded.set(rowId, Date.now());
}

const inflight = new Map<number, Promise<void>>();

/** The bundle of a row read — once at a time however many blocks ask (and an error is kept for a moment: a page that is no person is not asked again and again). */
function load(rowId: number): Promise<void> {
  const running = inflight.get(rowId);
  if (running) return running;
  const p = personBundleAction(rowId)
    .then((r) => {
      entries.set(rowId, r.ok ? { data: r.person, error: null, loading: false } : { data: null, error: r.error, loading: false });
      if (!r.ok) seeded.set(rowId, Date.now());
      emit();
    })
    .finally(() => inflight.delete(rowId));
  inflight.set(rowId, p);
  return p;
}

function usePerson(rowId: number) {
  const entry = useSyncExternalStore(
    (cb) => (subs.add(cb), () => void subs.delete(cb)),
    () => entries.get(rowId) ?? EMPTY,
    () => EMPTY,
  );
  useEffect(() => {
    // Read when shown (what was cached shows meanwhile) — unless the server just gave it with the page.
    if (Date.now() - (seeded.get(rowId) ?? 0) > 5000) void load(rowId);
  }, [rowId]);
  const router = useRouter();
  const t = useT();
  /** An operation; the bundle is read again. Gone (merged, deleted): the page goes to where `href` says. */
  const run = useCallback(
    async (op: PersonOperation, done?: string): Promise<boolean> => {
      const r = await personOpAction(rowId, op);
      if (!r.ok) {
        toast(r.error, { tone: "error" });
        return false;
      }
      if (r.message) toast(r.message);
      else if (done) toast(done);
      if (r.gone) {
        entries.delete(rowId);
        router.push(r.href ?? "/workspace");
        router.refresh();
        return true;
      }
      await load(rowId);
      return true;
    },
    [rowId, router],
  );
  void t;
  return { ...entry, run };
}

function Card({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <section className="ws-module space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-800" data-person-block>
      <div role="heading" aria-level={3} className="flex items-baseline justify-between gap-2 text-xs font-semibold text-zinc-500 uppercase">
        <span>{title}</span>
        {extra}
      </div>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="text-sm text-zinc-400">{children}</p>;
const LinkBtn = ({ children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button type="button" className="text-xs font-normal tracking-normal text-indigo-600 normal-case hover:underline dark:text-indigo-400" {...p}>
    {children}
  </button>
);

/**
 * A person's page — the custom view of the people database's rows, ONE block of the row's own page (the rest of the page is free
 * text and blocks): who they are, your notes, their dates on the left; the summary, what was read from messages and the relations on the right;
 * below, over the full width, one row each: what the knowledge knows, the latest messages, the todos — then pages and tickets.
 */
export default function PersonView({ rowId }: { rowId: number }) {
  const t = useT();
  const p = usePerson(rowId);
  if (p.loading) return <Empty>…</Empty>;
  if (!p.data) return <Empty>{p.error ?? t("This row is not a person.")}</Empty>;
  const d = p.data;
  return (
    <div className="@container space-y-5" data-person-view>
      {/* Who they are on the left, what Zeff made of them on the right … */}
      <div className="ws-person grid gap-x-8 gap-y-5 @2xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <aside className="space-y-5">
          <Profile d={d} run={p.run} />
          <Details d={d} run={p.run} />
          <Note d={d} run={p.run} />
          <Dates d={d} run={p.run} />
          <Manage d={d} run={p.run} />
        </aside>
        <div className="space-y-5">
          <Summary d={d} run={p.run} />
          <Known d={d} run={p.run} />
          <Relations d={d} run={p.run} />
        </div>
      </div>
      {/* … then, each over the full width: what the knowledge knows, the latest messages, the todos they appear in. */}
      <Wiki rowId={rowId} />
      <Messages d={d} />
      <TodosOf d={d} />
      {d.events && <Appointments events={d.events} />}
      <div className="grid gap-x-8 gap-y-5 @2xl:grid-cols-2">
        <CasesOf d={d} />
        <Letters d={d} />
      </div>
      <div className="grid gap-x-8 gap-y-5 @2xl:grid-cols-2">
        <Pages d={d} />
        <Tickets d={d} />
      </div>
    </div>
  );
}

function Messages({ d }: { d: PersonBundle }) {
  const t = useT();
  return (
    <Card title={t("Latest messages")}>
      {d.contacts.length ? (
        <ul className="space-y-1.5 text-sm">
          {d.contacts.map((c) => (
            <li key={c.key}>
              <div className="flex items-baseline gap-2 text-xs text-zinc-500">
                <span>{c.folder}</span>
                <span>{c.who}</span>
                <span className="ml-auto">{new Date(c.at).toLocaleString()}</span>
              </div>
              <p className="line-clamp-2">{c.text}</p>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>{t("No messages — enter the WhatsApp chat or the mail addresses in the profile.")}</Empty>
      )}
    </Card>
  );
}

/** Appointments with them (the Calendar plugin): the next 30 days, then the last 30 — each opens its day in the calendar. */
function Appointments({ events }: { events: NonNullable<PersonBundle["events"]> }) {
  const t = useT();
  const when = (e: Appointment) => (e.allDay ? formatDate(e.start) : formatDayTime(e.start));
  const list = (items: Appointment[]) => (
    <ul className="space-y-1 text-sm">
      {items.map((e) => (
        <li key={`${e.id}:${e.start}`} className="flex items-baseline gap-2">
          <span className="size-2 shrink-0 self-center rounded-full" style={{ background: e.color }} title={e.calendar} aria-hidden />
          <span className="w-36 shrink-0 text-xs text-zinc-500">{when(e)}</span>
          <Link href={e.href} className="min-w-0 flex-1 truncate hover:underline">
            {e.title}
          </Link>
          {e.location && <span className="max-w-[40%] shrink truncate text-xs text-zinc-400">{e.location}</span>}
        </li>
      ))}
    </ul>
  );
  return (
    <Card title={t("Appointments")}>
      {events.upcoming.length || events.recent.length ? (
        <div className="grid gap-x-8 gap-y-3 @2xl:grid-cols-2">
          <div className="space-y-1">
            <h4 className="label">{t("Coming up")}</h4>
            {events.upcoming.length ? list(events.upcoming) : <Empty>{t("Nothing in the next 30 days.")}</Empty>}
          </div>
          <div className="space-y-1">
            <h4 className="label">{t("Recently")}</h4>
            {events.recent.length ? list(events.recent) : <Empty>{t("Nothing in the last 30 days.")}</Empty>}
          </div>
        </div>
      ) : (
        <Empty>{t("No appointment with them in the last or next 30 days — Zeff looks for their mail address among the attendees and their name in the title.")}</Empty>
      )}
    </Card>
  );
}

function TodosOf({ d }: { d: PersonBundle }) {
  const t = useT();
  return (
    <Card title={t("Todos they appear in")}>
      {d.todos.length ? (
        <ul className="space-y-1.5 text-sm">
          {d.todos.map((todo) => (
            <li key={todo.id} className="flex items-baseline gap-2">
              <Link href={`/t/${todo.id}`} className="font-mono text-xs text-zinc-400 hover:underline">
                {todo.ref}
              </Link>
              <span className="min-w-0 flex-1">{todo.text}</span>
              {todo.due && <span className="shrink-0 text-xs text-zinc-500">{todo.due}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <Empty>{t("No open todo names them.")}</Empty>
      )}
    </Card>
  );
}

/** Their cases (the Cases plugin): what is open and what is next, each leading to the case's page. */
function CasesOf({ d }: { d: PersonBundle }) {
  const t = useT();
  if (!d.cases.length) return null;
  return (
    <Card title={t("Cases")}>
      <ul className="space-y-1.5 text-sm">
        {d.cases.map((c) => (
          <li key={c.id} className={`flex items-baseline gap-2 ${c.done ? "text-zinc-400" : ""}`}>
            <span className="shrink-0 font-mono text-xs text-zinc-500">{c.label}</span>
            <Link href={c.href} className="min-w-0 flex-1 truncate hover:underline">
              {c.title}
            </Link>
            {c.open != null && !c.done && <span className="shrink-0 tabular-nums">{c.open.toLocaleString(undefined, { style: "currency", currency: "EUR" })}</span>}
            {c.nextDue && !c.done && <span className="shrink-0 text-xs text-zinc-500">{new Date(c.nextDue).toLocaleDateString()}</span>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Their letters: the documents with their address or their name in them. */
function Letters({ d }: { d: PersonBundle }) {
  const t = useT();
  if (!d.documents.length) return null;
  return (
    <Card title={t("Letters and documents")}>
      <ul className="space-y-1.5 text-sm">
        {d.documents.map((doc) => (
          <li key={doc.id}>
            <div className="flex items-baseline gap-2">
              <a href={`/api/documents/${doc.id}/file`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">
                📄 {doc.name}
              </a>
              <span className="shrink-0 text-xs text-zinc-500">{new Date(doc.at).toLocaleDateString()}</span>
            </div>
            {doc.summary && <p className="line-clamp-2 text-xs text-zinc-500">{doc.summary}</p>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Pages({ d }: { d: PersonBundle }) {
  const t = useT();
  return (
    <Card title={t("Mentioned in your workspace")}>
      {d.pages.length ? (
        <ul className="flex flex-wrap gap-1.5 text-sm">
          {d.pages.map((pg) => (
            <li key={pg.id}>
              <Link href={`/workspace/${pg.id}`} className="rounded-md border border-zinc-200 px-2 py-0.5 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
                {pg.icon} {pg.title}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>{t("No page mentions them yet — type @ in a page.")}</Empty>
      )}
    </Card>
  );
}

function Tickets({ d }: { d: PersonBundle }) {
  const t = useT();
  return (
    <Card title={t("Shared tickets")}>
      {d.tickets.length ? (
        <ul className="flex flex-wrap gap-1.5 text-sm">
          {d.tickets.map((k) => (
            <li key={k} className="rounded-md border border-zinc-200 px-2 py-0.5 font-mono text-xs dark:border-zinc-700">
              🎫 {k}
            </li>
          ))}
        </ul>
      ) : (
        <Empty>{t("No ticket known yet — Zeff derives them from comments and assignments.")}</Empty>
      )}
    </Card>
  );
}

type RunFn = (op: PersonOperation, done?: string) => Promise<boolean>;

/** A line that saves itself: on leaving it (or Enter) when it changed — "✓" for a moment, no Save button. */
function useSaved() {
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!saved) return;
    const id = setTimeout(() => setSaved(false), 1500);
    return () => clearTimeout(id);
  }, [saved]);
  return [saved, () => setSaved(true)] as const;
}

function Profile({ d, run }: { d: PersonBundle; run: RunFn }) {
  const t = useT();
  const [f, setF] = useState({ name: d.name, aliases: d.aliases.join(", "), emails: d.emails.join(", "), whatsapp: d.whatsapp, jira: d.jira.join(", ") });
  const [saved, flash] = useSaved();
  const current = { name: d.name, aliases: d.aliases.join(", "), emails: d.emails.join(", "), whatsapp: d.whatsapp, jira: d.jira.join(", ") };
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the fields follow the profile as saved
  useEffect(() => setF({ name: d.name, aliases: d.aliases.join(", "), emails: d.emails.join(", "), whatsapp: d.whatsapp, jira: d.jira.join(", ") }), [d.name, d.aliases, d.emails, d.whatsapp, d.jira]);
  const commit = async (key: keyof typeof f) => {
    if (f[key] === current[key]) return;
    if (key === "name" && !f.name.trim()) return setF({ ...f, name: d.name });
    if (await run({ op: "profile", [key]: f[key] })) flash();
  };
  const field = (label: string, key: keyof typeof f, placeholder = "") => (
    <label className="block text-sm">
      <span className="label">{label}</span>
      <input
        className="input"
        value={f[key]}
        placeholder={placeholder}
        onChange={(e) => setF({ ...f, [key]: e.target.value })}
        onBlur={() => void commit(key)}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
    </label>
  );
  return (
    <Card
      title={t("Profile")}
      extra={
        <span className="flex items-center gap-2">
          {saved && <span className="text-xs font-normal normal-case text-emerald-600 dark:text-emerald-400">{t("Saved ✓")}</span>}
          <button type="button" className={`text-xl leading-none ${d.starred ? "text-amber-500" : "text-zinc-300 hover:text-amber-400 dark:text-zinc-600"}`} aria-label={d.starred ? t("Remove star") : t("Add star")} onClick={() => void run({ op: "star", on: !d.starred })}>
            ★
          </button>
        </span>
      }
    >
      {field(t("Name"), "name")}
      {field(t("Also called (comma-separated)"), "aliases")}
      {field(t("Mail addresses (comma-separated)"), "emails")}
      {field(t("WhatsApp chat (its name)"), "whatsapp")}
      {field(t("Jira usernames (comma-separated) — for @-mentions in Jira comments"), "jira", "chrlorenz1")}
    </Card>
  );
}

function Note({ d, run }: { d: PersonBundle; run: RunFn }) {
  const t = useT();
  const [note, setNote] = useState(d.note);
  const [saved, flash] = useSaved();
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the note as saved elsewhere follows
  useEffect(() => setNote(d.note), [d.note]);
  // Saved while you write (a moment after the last key) and on leaving it — no Save button.
  useEffect(() => {
    if (note === d.note) return;
    const id = setTimeout(() => void run({ op: "note", note }).then((ok) => ok && flash()), 900);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run and flash are stable enough; the text is what restarts the wait
  }, [note]);
  return (
    <Card title={t("Notes")} extra={saved ? <span className="text-xs font-normal normal-case text-emerald-600 dark:text-emerald-400">{t("Saved ✓")}</span> : undefined}>
      <textarea
        className="input resize-y text-sm"
        rows={Math.min(14, Math.max(4, note.split("\n").length + 1))}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => note !== d.note && void run({ op: "note", note }).then((ok) => ok && flash())}
        placeholder={t("What you want to remember about them — preferences, gift ideas, what you last talked about…")}
      />
    </Card>
  );
}

function Summary({ d, run }: { d: PersonBundle; run: RunFn }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const s = d.compiled;
  return (
    <Card
      title={t("Summary")}
      extra={
        <LinkBtn
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await run({ op: "compile" });
            setBusy(false);
          }}
        >
          {busy ? "…" : s ? t("Compile again") : t("Compile")}
        </LinkBtn>
      }
    >
      {s ? (
        <div className="space-y-2 text-sm">
          {s.connection && (
            <section>
              <h4 className="label">{t("What connects you")}</h4>
              <p className="whitespace-pre-line">{s.connection}</p>
            </section>
          )}
          {s.keyFacts.length > 0 && (
            <section>
              <h4 className="label">{t("Key facts")}</h4>
              <ul className="list-disc space-y-0.5 pl-4">
                {s.keyFacts.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </section>
          )}
          {s.funFacts.length > 0 && (
            <section>
              <h4 className="label">{t("Fun facts")}</h4>
              <ul className="space-y-0.5">
                {s.funFacts.map((f, i) => (
                  <li key={i}>🎈 {f}</li>
                ))}
              </ul>
            </section>
          )}
          <p className="text-xs text-zinc-400">{t("Compiled from {n} things", { n: s.sources })}</p>
        </div>
      ) : (
        <Empty>{t("Not compiled yet — “Compile” writes what connects you, the key facts and the fun ones (needs the LLM plugin).")}</Empty>
      )}
    </Card>
  );
}

const KINDS = ["birthday", "anniversary", "other"] as const;

function Dates({ d, run }: { d: PersonBundle; run: RunFn }) {
  const t = useT();
  const [kind, setKind] = useState<(typeof KINDS)[number]>("birthday");
  const [date, setDate] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const names = { birthday: t("Birthday"), anniversary: t("Anniversary"), other: t("Date") };
  return (
    <Card
      title={t("Dates")}
      extra={
        <LinkBtn
          disabled={busy}
          title={t("In the facts and (with the LLM plugin) by AI in the knowledge and the messages")}
          onClick={async () => {
            setBusy(true);
            await run({ op: "findDates" });
            setBusy(false);
          }}
        >
          {busy ? "…" : t("Find dates")}
        </LinkBtn>
      }
    >
      {d.dates.length ? (
        <ul className="space-y-2">
          {d.dates.map((x) => (
            <li key={x.id} className={`space-y-1 text-sm ${x.confirmed ? "" : "rounded-md bg-amber-50 p-2 dark:bg-amber-950/40"}`}>
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{x.label}</span>
                <span className="tabular-nums">{x.text}</span>
                {x.when && (
                  <span className="text-xs text-zinc-500">
                    {x.when}
                    {x.turns ? ` · ${t("turns {age}", { age: x.turns })}` : ""}
                  </span>
                )}
                {!x.confirmed && <span className="text-xs text-amber-700 dark:text-amber-400">{t("found — is it right?")}</span>}
              </div>
              {x.sourceText && <p className="text-xs text-zinc-500">{x.sourceText}</p>}
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {!x.confirmed && (
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => void run({ op: "dateConfirm", id: x.id })}>
                    {t("Right")}
                  </button>
                )}
                {x.confirmed && (
                  <>
                    <span className="text-zinc-500">{t("remind")}</span>
                    <input type="number" min={0} max={60} defaultValue={x.remindDays} className="input w-16 py-0.5 text-xs" aria-label={t("Days before to remind")} onBlur={(e) => Number(e.target.value) !== x.remindDays && void run({ op: "dateRemind", id: x.id, days: Number(e.target.value) })} />
                    <span className="text-zinc-500">{t("days before")}</span>
                  </>
                )}
                <button type="button" className="btn btn-sm" onClick={() => void run({ op: "dateDelete", id: x.id })}>
                  {x.confirmed ? t("Delete") : t("Wrong")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>{t("No date yet — enter one or let Zeff search (“Find dates”).")}</Empty>
      )}
      <form
        className="flex flex-wrap items-end gap-2 border-t border-zinc-200 pt-3 text-sm dark:border-zinc-800"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run({ op: "addDate", kind, date, label })) (setDate(""), setLabel(""));
        }}
      >
        <select className="input w-auto" value={kind} onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])} aria-label={t("Kind")}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {names[k]}
            </option>
          ))}
        </select>
        <input className="input w-36" required value={date} onChange={(e) => setDate(e.target.value)} placeholder={t("16.10. or 16.10.1996")} aria-label={t("Date")} />
        <input className="input min-w-28 flex-1" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("what for (other dates)")} aria-label={t("Label")} />
        <button className="btn btn-sm">{t("Add")}</button>
      </form>
    </Card>
  );
}

const KIND_LABEL: Record<string, string> = { fact: "Fact", role: "Role", owns: "Responsible for", preference: "Preference", commitment: "Commitment" };
const REL_LABEL: Record<string, string> = { "reports-to": "reports to", manages: "manages", "works-with": "works with", decides: "decides on", owns: "is responsible for", "on-ticket": "is on", "commented-on": "commented on", authored: "wrote in", "active-in": "is active in", "knows-about": "knows about" };

type Tr = ReturnType<typeof useT>;
const detailLabels = (t: Tr): Record<string, string> => ({ iban: "IBAN", bic: "BIC", bank: t("Bank"), revtag: "RevTag", address: t("Address"), phone: t("Phone"), hours: t("Office hours") });

/** Their bank account, addresses, phone, office hours — properties of the profile, to copy; read off what was said, or yours. */
function Details({ d, run }: { d: PersonBundle; run: RunFn }) {
  const t = useT();
  const [key, setKey] = useState("iban");
  const [value, setValue] = useState("");
  const labels = detailLabels(t);
  const copy = (v: string) => void navigator.clipboard.writeText(v).then(() => toast(t("Copied.")));
  const shown = (x: PersonBundle["details"][number]) =>
    x.key === "phone" ? (
      <a href={`tel:${x.value.replace(/[^\d+]/g, "")}`} className="hover:underline">
        {x.value}
      </a>
    ) : x.key === "address" ? (
      <a href={`https://www.openstreetmap.org/search?query=${encodeURIComponent(x.value)}`} target="_blank" rel="noreferrer" className="hover:underline">
        {x.value}
      </a>
    ) : (
      x.value
    );
  // Their bank account, paid to the recipient what was said about them names ("Empfänger …").
  const account = accountFor(d.name, d.details, d.claims.filter((c) => c.status !== "rejected").map((c) => c.text));
  return (
    <Card title={t("Details")} extra={account && <Transfer account={account} />}>
      {d.details.length ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1.5 text-sm">
          {d.details.map((x) => (
            <Fragment key={x.id}>
              <dt className="text-xs text-zinc-500">{labels[x.key] ?? x.key}</dt>
              <dd className={`min-w-0 break-words ${x.key === "iban" || x.key === "bic" ? "font-mono text-[13px]" : ""}`}>
                {shown(x)}
                {!x.confirmed && (
                  <span className="ml-1.5 text-xs text-amber-600 dark:text-amber-400" title={t("Read from a message — confirm it under To check.")}>
                    {t("unchecked")}
                  </span>
                )}
              </dd>
              <span className="flex gap-1">
                <button type="button" className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" aria-label={t("Copy")} title={t("Copy")} onClick={() => copy(x.value)}>
                  ⧉
                </button>
                <button type="button" className="text-xs text-zinc-400 hover:text-red-600" aria-label={t("Remove")} title={t("Remove")} onClick={() => void run({ op: "detail", action: "remove", key: x.key, value: x.value })}>
                  ×
                </button>
              </span>
            </Fragment>
          ))}
        </dl>
      ) : (
        <Empty>{t("No bank account, address or phone known yet — Zeff takes them from what it reads, or add one.")}</Empty>
      )}
      <form
        className="flex flex-wrap gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) void run({ op: "detail", action: "add", key, value }).then((ok) => ok && setValue(""));
        }}
      >
        <select className="input w-auto" value={key} onChange={(e) => setKey(e.target.value)} aria-label={t("Kind")}>
          {Object.entries(labels).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <input className="input min-w-28 flex-1" value={value} onChange={(e) => setValue(e.target.value)} aria-label={t("Value")} />
        <button className="btn btn-sm">{t("Add")}</button>
      </form>
    </Card>
  );
}

/** "Transfer money": a dialog with the amount and purpose to fill in, and the GiroCode of the transfer to their account. */
function Transfer({ account }: { account: NonNullable<ReturnType<typeof accountFor>> }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  const euros = amount.trim() ? amountIn(`${amount.trim()} €`) : null;
  return (
    <>
      <button type="button" className="text-xs font-medium normal-case text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setOpen(true)}>
        {t("Transfer money")}
      </button>
      <Overlay open={open} onClose={() => setOpen(false)} label={t("Transfer money")} side="center" className="max-w-sm">
        <div className="space-y-3 overflow-y-auto p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">{t("Transfer to {name}", { name: account.name })}</h2>
            <button type="button" className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" aria-label={t("Close")} onClick={() => setOpen(false)}>
              ×
            </button>
          </div>
          <div className="flex gap-1.5">
            <input className="input w-28" inputMode="decimal" placeholder="0,00 €" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label={t("Amount")} />
            <input className="input min-w-0 flex-1" maxLength={140} placeholder={t("Purpose")} value={purpose} onChange={(e) => setPurpose(e.target.value)} aria-label={t("Purpose")} />
          </div>
          {amount.trim() && euros == null && <p className="text-xs text-amber-600 dark:text-amber-400">{t("Not an amount — e.g. 11,52")}</p>}
          <GiroCode {...account} amount={euros} purpose={purpose} />
        </div>
      </Overlay>
    </>
  );
}

/** The kinds as the Facts tab groups them. */
const KIND_ORDER = ["role", "owns", "fact", "preference", "commitment"];
const kindGroups = (t: Tr): Record<string, string> => ({ role: t("Role"), owns: t("Responsible for"), fact: t("Facts"), preference: t("Preferences"), commitment: t("Commitments") });

/**
 * What was read from your messages, in tabs: what is still to check (with the quote, Right / Wrong), the facts you
 * confirmed (by kind), and what is done (commitments kept) — not all in one list.
 */
function Known({ d, run }: { d: PersonBundle; run: RunFn }) {
  const t = useT();
  const names = new Map(d.others.map((o) => [String(o.id), o.name]));
  const toCheck = d.claims.filter((c) => c.status !== "confirmed" && !c.done);
  const facts = d.claims.filter((c) => c.status === "confirmed" && !c.done);
  const done = d.claims.filter((c) => c.done);
  const [tab, setTab] = useState<"check" | "facts" | "done">(toCheck.length ? "check" : "facts");
  const tabs = [
    { id: "check" as const, label: t("To check"), n: toCheck.length },
    { id: "facts" as const, label: t("Facts"), n: facts.length },
    { id: "done" as const, label: t("Done"), n: done.length },
  ];
  const text = (c: PersonBundle["claims"][number]) => (
    <>
      {c.text}
      {c.kind === "commitment" && c.due ? <span className="text-zinc-500"> · {c.due}</span> : null}
    </>
  );
  const doneButton = (c: PersonBundle["claims"][number]) =>
    c.kind === "commitment" && (
      <button type="button" className="btn btn-sm shrink-0" onClick={() => void run({ op: "review", what: "claim", id: c.id, action: "done" })}>
        {t("Done")}
      </button>
    );
  return (
    <Card title={t("Read from your messages")}>
      {d.claims.length === 0 && d.links.length === 0 && <Empty>{t("Nothing read from your messages yet — Zeff reads new ones after each briefing.")}</Empty>}
      {d.claims.length > 0 && (
        <div role="tablist" className="flex gap-1 border-b border-zinc-200 text-sm dark:border-zinc-800">
          {tabs.map((x) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={tab === x.id}
              className={`-mb-px border-b-2 px-2 py-1 ${tab === x.id ? "border-indigo-500 font-medium text-zinc-900 dark:text-zinc-100" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}
              onClick={() => setTab(x.id)}
            >
              {x.label}
              {x.n > 0 && <span className="ml-1 rounded-full bg-zinc-100 px-1.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{x.n}</span>}
            </button>
          ))}
        </div>
      )}
      {d.claims.length > 0 && tab === "check" && (
        <ul className="space-y-2.5">
          {toCheck.length === 0 && <Empty>{t("Nothing to check.")}</Empty>}
          {toCheck.map((c) => (
            <li key={c.id} className="space-y-0.5 text-sm">
              <div className="flex items-baseline gap-2">
                <span className="shrink-0 text-xs text-zinc-400">{t(KIND_LABEL[c.kind] ?? c.kind)}</span>
                <span className="min-w-0 flex-1">{text(c)}</span>
                <span className="flex shrink-0 gap-1">
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => void run({ op: "review", what: "claim", id: c.id, action: "confirm" })}>
                    {t("Right")}
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => void run({ op: "review", what: "claim", id: c.id, action: "reject" })}>
                    {t("Wrong")}
                  </button>
                </span>
              </div>
              <p className="truncate text-xs text-zinc-500" title={c.evidence}>
                {c.evidence && <>“{c.evidence}” · </>}
                {Math.round(c.confidence * 100)}%
              </p>
            </li>
          ))}
        </ul>
      )}
      {d.claims.length > 0 && tab === "facts" && (
        <div className="space-y-3">
          {facts.length === 0 && <Empty>{t("No confirmed facts yet — check what was read under To check.")}</Empty>}
          {KIND_ORDER.map((k) => {
            const of = facts.filter((c) => c.kind === k);
            return (
              of.length > 0 && (
                <div key={k} className="space-y-1">
                  <h4 className="text-xs text-zinc-500">{kindGroups(t)[k]}</h4>
                  <ul className="space-y-1 text-sm">
                    {of.map((c) => (
                      <li key={c.id} className="flex items-baseline gap-2" title={c.evidence ? `“${c.evidence}”` : undefined}>
                        <span className="min-w-0 flex-1">{text(c)}</span>
                        {doneButton(c)}
                      </li>
                    ))}
                  </ul>
                </div>
              )
            );
          })}
        </div>
      )}
      {d.claims.length > 0 && tab === "done" && (
        <ul className="space-y-1 text-sm text-zinc-500">
          {done.length === 0 && <Empty>{t("Nothing done yet.")}</Empty>}
          {done.map((c) => (
            <li key={c.id} className="flex items-baseline gap-2">
              <span className="shrink-0 text-xs text-zinc-400">{t(KIND_LABEL[c.kind] ?? c.kind)}</span>
              <span className="min-w-0 line-through">{text(c)}</span>
            </li>
          ))}
        </ul>
      )}
      {d.links.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 text-xs">
          {d.links.map((l) => (
            <li key={l.id} className="rounded-full border border-zinc-200 px-2 py-0.5 dark:border-zinc-700">
              {t(REL_LABEL[l.rel] ?? l.rel)} <span className="font-medium">{l.targetType === "person" ? (names.get(l.targetRef) ?? "?") : l.targetRef}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Wiki({ rowId }: { rowId: number }) {
  const t = useT();
  const [wiki, setWiki] = useState<KnowledgeOfPerson | null | undefined>(undefined);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    void personWikiAction(rowId).then((r) => live && setWiki(r.ok ? r.wiki : null));
    return () => {
      live = false;
    };
  }, [rowId, reload]);
  if (wiki === null) return null;
  return (
    <Card title={t("What the knowledge knows")} extra={wiki?.graph ? <a href={wiki.graph} target="_blank" rel="noreferrer" className="text-xs font-normal tracking-normal text-indigo-600 normal-case hover:underline dark:text-indigo-400">{t("In the graph ↗")}</a> : undefined}>
      {wiki === undefined ? (
        <Empty>…</Empty>
      ) : wiki.error ? (
        <p className="text-xs text-amber-700 dark:text-amber-400">{wiki.error}</p>
      ) : !wiki.summary && !wiki.related.length && !wiki.pages.length ? (
        <Empty>{t("The knowledge knows nobody of this name. An alias — what the person is called in your pages — helps.")}</Empty>
      ) : (
        <>
          {wiki.merge && <KnowledgeMerge rowId={rowId} merge={wiki.merge} done={() => setReload((n) => n + 1)} />}
          {wiki.summary && <p className="text-sm">{wiki.summary}</p>}
          {wiki.related.length > 0 && (
            <ul className="space-y-1 text-sm">
              {wiki.related.map((g, i) => (
                <li key={i}>
                  <span className="font-medium">{g.name}</span>
                  {g.rels.map((r, k) => (
                    <span key={k} className="block text-xs text-zinc-500">
                      {r}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          )}
          {wiki.pages.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs text-zinc-500">{t("{n} pages", { n: wiki.pages.length })}</summary>
              <ul className="mt-1 space-y-1 text-sm">
                {wiki.pages.map((pg) => (
                  <li key={pg.id}>
                    <a href={pg.href} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline dark:text-indigo-400">
                      {pg.title}
                    </a>{" "}
                    <span className="text-xs text-zinc-400">{pg.space}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </Card>
  );
}

/** The knowledge keeps them as several entries: merged there once you say so (Wiki card). */
function KnowledgeMerge({ rowId, merge, done }: { rowId: number; merge: NonNullable<KnowledgeOfPerson["merge"]>; done: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const act = async (op: "merge" | "dismiss") => {
    setBusy(true);
    const r = await personKnowledgeMergeAction(rowId, merge.id, op);
    setBusy(false);
    if (!r.ok) return toast(r.error, { tone: "error" });
    if (op === "merge") toast(t("Merged in the knowledge."));
    done();
  };
  return (
    <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs dark:border-amber-900 dark:bg-amber-950/40">
      <p>{t("The knowledge keeps them as {n} entries: {names}.", { n: merge.names.length, names: merge.names.join(", ") })}</p>
      <div className="mt-1 flex gap-2">
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void act("merge")}>
          {t("Merge the {n} knowledge entries", { n: merge.names.length })}
        </button>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void act("dismiss")}>
          {t("Not the same")}
        </button>
      </div>
    </div>
  );
}

function Relations({ d, run }: { d: PersonBundle; run: RunFn }) {
  const t = useT();
  const [rel, setRel] = useState("");
  const [other, setOther] = useState("0");
  return (
    <Card title={t("Relations")}>
      <ul className="space-y-1 text-sm">
        {d.relations.out.map((r) => (
          <li key={r.id} className="flex items-baseline gap-2" title={r.evidence || undefined}>
            <span className="min-w-0 flex-1">
              <span className="font-medium">{r.rel}</span> {r.otherId ? <>{t("of")} {r.otherName}</> : <span className="text-zinc-400">{t("(to you)")}</span>}
              {r.evidence && <span className="block text-xs text-zinc-400">{r.evidence}</span>}
            </span>
            <button type="button" className="text-xs text-zinc-400 hover:text-red-600" aria-label={t("Remove")} title={t("Wrong? Remove it.")} onClick={() => void run({ op: "deleteRelation", id: r.id })}>
              ✕
            </button>
          </li>
        ))}
        {d.relations.in.map((r) => (
          <li key={r.id} className="flex items-baseline gap-2" title={r.evidence || undefined}>
            <span className="min-w-0 flex-1">
              {r.personName}: <span className="font-medium">{r.rel}</span>
              {r.evidence && <span className="block text-xs text-zinc-400">{r.evidence}</span>}
            </span>
            <button type="button" className="text-xs text-zinc-400 hover:text-red-600" aria-label={t("Remove")} onClick={() => void run({ op: "deleteRelation", id: r.id })}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      {!d.relations.out.length && !d.relations.in.length && <Empty>{t("None known yet — the AI derives them from your todos and messages (“Match names”), or add one below.")}</Empty>}
      <form
        className="flex flex-wrap gap-2 text-sm"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run({ op: "addRelation", rel, other: Number(other) })) setRel("");
        }}
      >
        <input className="input min-w-0 flex-1" required value={rel} onChange={(e) => setRel(e.target.value)} placeholder={t("e.g. mother, landlord")} aria-label={t("Relation")} />
        <select className="input w-40" value={other} onChange={(e) => setOther(e.target.value)} aria-label={t("To whom")}>
          <option value="0">{t("to you")}</option>
          {d.others.map((o) => (
            <option key={o.id} value={o.id}>
              {t("of {name}", { name: o.name })}
            </option>
          ))}
        </select>
        <button className="btn btn-sm">{t("Add")}</button>
      </form>
    </Card>
  );
}

function Manage({ d, run }: { d: PersonBundle; run: RunFn }) {
  const t = useT();
  const [keep, setKeep] = useState("");
  return (
    <Card title={t("Same person, or gone")}>
      {d.others.length > 0 && (
        <div className="space-y-1">
          <span className="label">{t("Same person as …")}</span>
          <div className="flex gap-2">
            <select className="input min-w-0 flex-1" value={keep} onChange={(e) => setKeep(e.target.value)} aria-label={t("Same person as …")}>
              <option value="">{t("Pick a profile …")}</option>
              {d.others.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-sm" disabled={!keep} onClick={() => void run({ op: "merge", keep: Number(keep) })}>
              {t("Merge into it")}
            </button>
          </div>
          <p className="text-xs text-zinc-400">{t("“{name}” becomes an alias of the chosen profile; its chat, addresses, notes and dates come along; this profile is removed.", { name: d.name })}</p>
        </div>
      )}
      <button type="button" className="btn btn-sm text-red-700 dark:text-red-400" onClick={() => confirmAction(t("Delete the profile of “{name}”?", { name: d.name })) && void run({ op: "delete" })}>
        {t("Delete profile")}
      </button>
    </Card>
  );
}
