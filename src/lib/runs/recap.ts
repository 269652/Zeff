import { isoDay } from "@/lib/text";
import { fillPrompt } from "@/lib/prompts";
import { mailLink } from "@/lib/mail/shared";
import { gitText } from "@/lib/git";
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { inThisAccount } from "@/db/accounts";
import { aiChoice, runAi } from "@/lib/ai";
import { AI_PROVIDER_INFO } from "@/lib/ai/shared";
import { listEntries } from "@/lib/entries";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { gitlabTicket } from "@/lib/gitlab/shared";
import { resultToPayload, runStdioSession } from "@/lib/jira/mcp-client";
import { getJiraTicket, myJiraName } from "@/lib/jira/store";
import { getJiraSyncConfig } from "@/lib/jira/sync";
import { keepComments } from "@/lib/jira/comments";
import { listRepos } from "@/lib/repos";
import { workRef } from "@/lib/work/shared";
import { CHANGE_LABELS, dateOf, FIELDS, plain, who, type Issue } from "./collect";
import { RECAP_SCHEMA, type RecapFact, type RecapFacts, type RecapResult, type RecapView } from "./recap-shared";
import { todoContextUrls } from "@/lib/work/booking";
import { resolveLinks } from "@/lib/context-links";
import type { Entity } from "@/lib/entities-shared";
import { jiraCommentUrl, todoRef } from "../todos/shared";
import { listTodos } from "../todos/store";
import { pushTo } from "@/lib/collections";
import { accountFlag, setAccountFlag } from "@/lib/sync/account-flags";

const { dayRecaps, workRuns, gitlabItems, jiraTickets } = schema;

// ---------------------------------------------------------------------------
// Stored recaps
// ---------------------------------------------------------------------------

function toView(r: typeof dayRecaps.$inferSelect): RecapView {
  const parse = <T,>(s: string | null, fallback: T): T => {
    try {
      return s ? (JSON.parse(s) as T) : fallback;
    } catch {
      return fallback;
    }
  };
  return {
    id: r.id,
    day: r.day,
    status: r.status === "ok" || r.status === "error" ? r.status : "running",
    model: r.model,
    facts: parse<RecapFacts>(r.facts, { tickets: [], other: [] }),
    result: parse<RecapResult | null>(r.result, null),
    error: r.error,
    costUsd: r.costUsd,
    durationMs: r.durationMs,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
  };
}

/** A day's newest recap (whatever its state), and its newest that worked. */
export function recapsOf(day: string): { latest: RecapView | null; good: RecapView | null } {
  const rows = getDb().select().from(dayRecaps).where(eq(dayRecaps.day, day)).orderBy(desc(dayRecaps.id)).limit(10).all();
  const good = rows.find((r) => r.status === "ok");
  return { latest: rows[0] ? toView(rows[0]) : null, good: good ? toView(good) : null };
}

// ---------------------------------------------------------------------------
// What happened on the day
// ---------------------------------------------------------------------------

const git = (cwd: string, args: string[]) => gitText(cwd, args);

const KEY = /\b([A-Z][A-Z0-9]+-\d+)\b/;

/** The day's bounds (local midnight to midnight). */
function bounds(day: string): { from: Date; to: Date; next: string } {
  const [y, m, d] = day.split("-").map(Number);
  const from = new Date(y, m - 1, d);
  const to = new Date(y, m - 1, d + 1);
  const next = isoDay(to);
  return { from, to, next };
}

/**
 * Everything Zeff can find you did on a day, by ticket: your bookings, the todos done, the
 * workers' runs, your Jira comments and changes (read from Jira), your commits in the repos,
 * your GitLab comments and merge requests. What fails to be read is just left out (noted).
 */
export async function gather(day: string): Promise<{ facts: RecapFacts; notes: string[] }> {
  const { from, to, next } = bounds(day);
  const inDay = (at: string | Date | null | undefined) => {
    const d = at instanceof Date ? at : at ? new Date(/^\d{4}-\d{2}-\d{2} \d/.test(at) ? `${at.replace(" ", "T")}Z` : at) : null;
    return !!d && !Number.isNaN(d.getTime()) && d >= from && d < to;
  };
  const me = myJiraName();
  const notes: string[] = [];
  const byTicket = new Map<string, RecapFact[]>();
  const other: RecapFact[] = [];
  const info = new Map<string, { summary: string; status: string | null; url: string | null }>();
  const links = new Map<string, string[]>();
  const link = (ticket: string | null | undefined, ...urls: (string | null | undefined)[]) => {
    const k = ticket?.trim().toUpperCase();
    if (k && /^[A-Z][A-Z0-9]+-\d+$/.test(k)) links.set(k, [...(links.get(k) ?? []), ...urls.filter((u): u is string => !!u)]);
  };
  const todoIds = new Map<string, number[]>();
  const add = (ticket: string | null | undefined, f: RecapFact) => {
    const k = ticket?.trim().toUpperCase();
    if (k && /^[A-Z][A-Z0-9]+-\d+$/.test(k)) pushTo(byTicket, k, f);
    else other.push(f);
  };

  // Zeff: bookings, todos done, workers' runs.
  for (const e of listEntries({ from: day, to: day })) add(e.ticket, { kind: "entry", at: null, hours: e.hours, text: `${e.job.name}: ${e.description}` });
  for (const t of listTodos({ status: "done" }).filter((t) => inDay(t.doneAt))) {
    add(t.ticket, { kind: "todo", at: t.doneAt, text: `${todoRef(t.id)} erledigt: ${t.text}${t.note ? ` — ${t.note}` : ""}` });
    pushTo(todoIds, t.ticket.toUpperCase(), t.id);
  }
  for (const r of getDb()
    .select()
    .from(workRuns)
    .where(and(gte(workRuns.finishedAt, from.toISOString()), lt(workRuns.finishedAt, to.toISOString())))
    .all()
    .filter((r) => r.status === "done")) {
    add(r.ticket, { kind: "work", at: r.finishedAt, text: `${workRef(r.id)} (${r.mode}): ${plain(r.summary ?? r.entryLine ?? "", 600)}` });
    pushTo(todoIds, r.ticket.toUpperCase(), r.todoId);
  }

  // Jira: your comments and changes on the tickets updated since then.
  const cfg = getJiraSyncConfig();
  if (cfg.configured && cfg.command && me) {
    try {
      const issues = await runStdioSession(
        { command: cfg.command, args: cfg.args, env: cfg.env, label: "Jira" },
        async (call) => {
          const p = resultToPayload(await call("jira_search", { jql: `updated >= "${day}" ORDER BY updated DESC`, limit: 100, fields: FIELDS, expand: "changelog" })) as { issues?: Issue[] };
          return (p.issues ?? []).filter((i) => i?.key);
        },
        120000,
      );
      keepComments(
        issues.flatMap((i) => (i.comments ?? []).flatMap((c) => (c.id ? [{ id: c.id, ticket: i.key, author: who(c.author), at: dateOf(c.created)?.toISOString() ?? "", body: plain(c.body, 4000) }] : []))),
      );
      for (const i of issues) {
        info.set(i.key, { summary: i.summary ?? "", status: i.status?.name ?? null, url: i.browse_url ?? null });
        for (const c of i.comments ?? [])
          if (who(c.author) === me && inDay(dateOf(c.created))) {
            add(i.key, { kind: "jira-comment", at: dateOf(c.created)?.toISOString() ?? null, text: `Kommentar: ${plain(c.body, 800)}` });
            const url = i.browse_url ?? getJiraTicket(i.key)?.url;
            if (c.id && url) link(i.key, jiraCommentUrl(url, c.id));
          }
        for (const c of i.changelogs ?? []) {
          if (who(c.author) !== me || !inDay(dateOf(c.created))) continue;
          const parts = (c.items ?? [])
            .filter((x) => x.field && CHANGE_LABELS[x.field])
            .map((x) => (x.field === "description" || x.field === "summary" ? `${CHANGE_LABELS[x.field!]} geändert` : `${CHANGE_LABELS[x.field!]}: ${x.from_string || "—"} → ${x.to_string || "—"}`));
          if (parts.length) add(i.key, { kind: "jira-change", at: dateOf(c.created)?.toISOString() ?? null, text: parts.join("; ") });
        }
      }
    } catch (e) {
      notes.push(t("Couldn't read Jira: {error}", { error: errorMessage(e) }));
    }
  }

  // Git: your commits that day, in every repo (by your git email there).
  for (const repo of listRepos().filter((r) => r.ok)) {
    const email = await git(repo.path, ["config", "user.email"]);
    if (!email) continue;
    const log = await git(repo.path, ["log", "--all", "--source", `--author=${email}`, `--since=${day} 00:00`, `--until=${next} 00:00`, "--date=iso-strict", "--format=%h%x09%ad%x09%S%x09%s"]);
    const seen = new Set<string>();
    for (const line of log.split("\n").filter(Boolean)) {
      const [hash, at, ref, subject] = line.split("\t");
      if (seen.has(hash)) continue;
      seen.add(hash);
      const ticket = KEY.exec(subject ?? "")?.[1] ?? KEY.exec(ref ?? "")?.[1] ?? null;
      add(ticket, { kind: "commit", at, text: `${repo.name} ${hash} ${subject}${ref ? ` (${ref.replace(/^refs\/(heads|remotes)\//, "")})` : ""}` });
    }
  }

  // GitLab: your comments and merge requests that day.
  if (me) {
    const prefixes = new Set(
      getDb()
        .select({ key: jiraTickets.key })
        .from(jiraTickets)
        .all()
        .map((r) => r.key.split("-")[0].toUpperCase()),
    );
    for (const g of getDb().select().from(gitlabItems).where(eq(gitlabItems.author, me)).all()) {
      if (g.kind === "branch" || !inDay(g.createdAt)) continue;
      const text = g.kind === "comment" ? `Kommentar in ${g.ref} (${g.title}): ${plain(g.body, 400)}` : `Merge Request ${g.ref} geöffnet: ${g.title}${g.state ? ` (${g.state})` : ""}`;
      add(gitlabTicket(g, prefixes), { kind: "gitlab", at: g.createdAt, text });
      link(gitlabTicket(g, prefixes), g.url);
    }
  }

  const tickets = [...byTicket.entries()]
    .map(([key, facts]) => {
      const i = info.get(key) ?? (() => {
        const t = getJiraTicket(key);
        return t ? { summary: t.summary, status: t.status, url: t.url } : { summary: "", status: null, url: null };
      })();
      // What it was about, as links: its todos' context (merge requests, the messages and comments
      // they came from, the todos), then your comments that day.
      const refs = [...new Set([...dayRefs(day, key, [...new Set(todoIds.get(key) ?? [])]), ...(links.get(key) ?? [])])];
      return { key, ...i, facts: facts.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? "")), refs };
    })
    // Most booked first, then the busiest.
    .sort((a, b) => hoursOf(b.facts) - hoursOf(a.facts) || b.facts.length - a.facts.length);
  return { facts: { tickets, other }, notes };
}

const hoursOf = (facts: RecapFact[]) => facts.reduce((s, f) => s + (f.hours ?? 0), 0);

const KIND_LABEL: Record<RecapFact["kind"], string> = {
  entry: "Buchung",
  todo: "Todo",
  work: "Worker",
  "jira-comment": "Jira",
  "jira-change": "Jira-Änderung",
  commit: "Commit",
  gitlab: "GitLab",
};

const factLine = (f: RecapFact) =>
  `- ${f.at ? `${new Date(f.at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} ` : ""}[${KIND_LABEL[f.kind]}${f.hours ? ` ${f.hours} h` : ""}] ${f.text}`;

/** The recap's instructions ({{me}}: " (your name)" or nothing; {{date}}: the day) — a page of System → Prompts. */
export const RECAP_INSTRUCTIONS = [
  "Schreib auf, was ich{{me}} am {{date}} gemacht habe — für mein Standup und meinen Überblick. Auf Deutsch, in der Ich-Form, nüchtern und konkret: was ich gemacht habe, was fertig wurde, was offen blieb. Nur was in den Daten steht — nichts erfinden, nichts ausschmücken.",
  "",
  "Die Daten: meine Buchungen in Zeff (mit Stunden), erledigte Todos, Läufe von Workern (W-…, KI-Agenten, die in meinem Auftrag gearbeitet haben — das zählt als meine Arbeit), meine Jira-Kommentare und -Änderungen, meine Commits und GitLab-Kommentare/Merge Requests.",
  "",
  "Gib zurück:",
  "- summary: der Tag insgesamt in 3–5 Sätzen.",
  "- tickets: für jedes Ticket unten (Schlüssel wie angegeben) lead — ein Satz, was ich daran gemacht habe und wo es steht — und done — kurze Stichpunkte, Verb zuerst (Commits, Kommentare und Todos zum selben Thema fasst du zusammen).",
  "- other: Arbeit ohne Ticket (Meetings, Internes) als kurze Stichpunkte.",
].join("\n");

function promptOf(day: string, facts: RecapFacts, me: string | null): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return [
    fillPrompt("recap", RECAP_INSTRUCTIONS, { me: me ? ` (${me})` : "", date }),
    "",
    `# Tickets (${facts.tickets.length})`,
    "",
    facts.tickets.map((t) => [`## ${t.key} · ${t.summary}${t.status ? ` (${t.status})` : ""}`, ...t.facts.map(factLine)].join("\n")).join("\n\n") || "(keine)",
    "",
    "# Ohne Ticket",
    "",
    facts.other.map(factLine).join("\n") || "(nichts)",
  ].join("\n");
}

/** The answer, held to the tickets it was given (each once). */
function clean(r: RecapResult, facts: RecapFacts): RecapResult {
  const known = new Set(facts.tickets.map((t) => t.key));
  const seen = new Set<string>();
  const lines = (a: unknown) => (Array.isArray(a) ? a.map((s) => String(s ?? "").trim()).filter(Boolean).slice(0, 10) : []);
  return {
    summary: String(r.summary ?? "").trim(),
    tickets: (r.tickets ?? [])
      .map((t) => ({ key: String(t.key ?? "").trim().toUpperCase(), lead: String(t.lead ?? "").trim(), done: lines(t.done) }))
      .filter((t) => known.has(t.key) && !seen.has(t.key) && seen.add(t.key)),
    other: lines(r.other),
  };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

type RecapNow = { id: number; day: string; phase: "gather" | "ai" | "saving"; since: number; provider: string };

/** The recap being made in this server right now, and its step. */
export const recapState = () => accountFlag<RecapNow>("__zeffRecap") ?? null;

function finish(id: number, patch: Partial<typeof dayRecaps.$inferInsert>) {
  getDb()
    .update(dayRecaps)
    .set({ ...patch, finishedAt: new Date().toISOString().replace("T", " ").slice(0, 19) })
    .where(eq(dayRecaps.id, id))
    .run();
}

/** Make a day's recap in the background: gather, have the AI write it up, keep it. Answers at once. */
export function startRecap(day: string): { ok: boolean; message: string } {
  // Kept in the account it was started in — whichever is switched to while it runs.
  return inThisAccount(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, message: t("Which day?") };
    if (accountFlag<RecapNow>("__zeffRecap")) return { ok: false, message: t("A day is being recapped already.") };
    const ai = aiChoice();
    const provider = AI_PROVIDER_INFO[ai.provider].label;
    const id = getDb()
      .insert(dayRecaps)
      .values({ day, status: "running", model: `${provider}${ai.model ? ` · ${ai.model}` : ""}` })
      .returning()
      .get().id;
    const t0 = Date.now();
    setAccountFlag("__zeffRecap", { id, day, phase: "gather", since: t0, provider });
    void (async () => {
      try {
        const { facts, notes } = await gather(day);
        if (!facts.tickets.length && !facts.other.length) {
          finish(id, { status: "ok", facts: JSON.stringify(facts), result: JSON.stringify({ summary: `${t("Zeff found nothing of yours for this day.")}${notes.length ? ` (${notes.join(" ")})` : ""}`, tickets: [], other: [] }), durationMs: Date.now() - t0 });
          return;
        }
        setAccountFlag("__zeffRecap", { id, day, phase: "ai", since: t0, provider });
        const answer = await runAi<RecapResult>(promptOf(day, facts, myJiraName()), RECAP_SCHEMA, { task: "recap", maxBudgetUsd: 2, timeoutMs: 10 * 60000 });
        setAccountFlag("__zeffRecap", { id, day, phase: "saving", since: t0, provider });
        const result = clean(answer.output, facts);
        if (notes.length) result.summary = `${result.summary}\n\n(${notes.join(" ")})`;
        finish(id, { status: "ok", facts: JSON.stringify(facts), result: JSON.stringify(result), model: answer.model ?? undefined, costUsd: answer.costUsd ?? null, durationMs: Date.now() - t0 });
      } catch (e) {
        finish(id, { status: "error", error: errorMessage(e).slice(0, 2000), durationMs: Date.now() - t0 });
      } finally {
        setAccountFlag("__zeffRecap", null);
      }
    })();
    return { ok: true, message: t("Recapping.") };
  });
}

/**
 * Everything a ticket's day was about, as links (each once): the context of its todos (merge
 * requests, the messages and comments they came from — with their conversations — the todos),
 * the Jira comments on it that day (anyone's: the conversation), the Teams messages that day
 * naming it, and the GitLab comments and merge requests on it that day.
 */
export function dayRefs(day: string, key: string, todoIds: number[]): string[] {
  const { from, to } = bounds(day);
  const inDay = (at: string | null | undefined) => {
    const d = at ? new Date(at) : null;
    return !!d && !Number.isNaN(d.getTime()) && d >= from && d < to;
  };
  const named = new RegExp(`(^|[^A-Za-z0-9])${key}(?![0-9])`, "i");
  const ticketUrl = getJiraTicket(key)?.url ?? null;
  const jira = ticketUrl
    ? getDb()
        .select({ id: schema.jiraComments.id, at: schema.jiraComments.at })
        .from(schema.jiraComments)
        .where(eq(schema.jiraComments.ticket, key))
        .all()
        .filter((c) => inDay(c.at))
        .sort((a, b) => a.at.localeCompare(b.at))
        .map((c) => jiraCommentUrl(ticketUrl, c.id))
    : [];
  const teams = getDb()
    .select({ link: schema.teamsMessages.link, sentAt: schema.teamsMessages.sentAt, text: schema.teamsMessages.text })
    .from(schema.teamsMessages)
    .where(and(gte(schema.teamsMessages.sentAt, from.toISOString()), lt(schema.teamsMessages.sentAt, to.toISOString())))
    .all()
    .filter((m) => named.test(m.text))
    .map((m) => m.link);
  const mails = getDb()
    .select({ key: schema.emails.key, subject: schema.emails.subject, preview: schema.emails.preview })
    .from(schema.emails)
    .where(and(gte(schema.emails.receivedAt, from.toISOString()), lt(schema.emails.receivedAt, to.toISOString())))
    .all()
    .filter((m) => named.test(`${m.subject} ${m.preview}`))
    .map((m) => mailLink(m.key));
  const prefixes = new Set([key.split("-")[0].toUpperCase()]);
  const gitlab = getDb()
    .select()
    .from(gitlabItems)
    .all()
    .filter((g) => g.kind !== "branch" && inDay(g.createdAt) && gitlabTicket(g, prefixes) === key)
    .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""))
    .map((g) => g.url);
  return [...new Set([...todoContextUrls(key, todoIds), ...jira, ...teams, ...mails, ...gitlab])];
}

/** The todos a recap's facts name: those done (T-…) and those its workers' runs (W-…) were on. */
function todosOfFacts(facts: RecapFact[]): number[] {
  const ids = new Set<number>();
  const runs: number[] = [];
  for (const f of facts) {
    if (f.kind === "todo") for (const m of f.text.matchAll(/\bT-(\d+)\b/g)) ids.add(Number(m[1]));
    if (f.kind === "work") for (const m of f.text.matchAll(/\bW-(\d+)\b/g)) runs.push(Number(m[1]));
  }
  if (runs.length) for (const r of getDb().select({ todoId: workRuns.todoId }).from(workRuns).where(inArray(workRuns.id, runs)).all()) ids.add(r.todoId);
  return [...ids];
}

/**
 * A recap's evidence as badges, per ticket: everything its day was about (dayRefs — as Zeff
 * knows it now, so older recaps get it too) and the links kept with it, resolved to the todos,
 * messages, comments and merge requests.
 */
export function recapEntities(recap: RecapView): Record<string, Entity[]> {
  const refsOf = (t: RecapView["facts"]["tickets"][number]) => [...new Set([...dayRefs(recap.day, t.key, todosOfFacts(t.facts)), ...(t.refs ?? [])])];
  const byTicket = recap.facts.tickets.map((t) => [t.key, refsOf(t)] as const);
  const linked = resolveLinks(byTicket.flatMap(([, refs]) => refs));
  return Object.fromEntries(byTicket.map(([key, refs]) => [key, refs.flatMap((u) => (linked[u] ? [linked[u]] : []))]));
}
