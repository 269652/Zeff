import type { T } from "@/lib/i18n/shared";
import type { Row } from "@/plugins/workspace/model";
import { CIRCLES, circleLabels, type Circle } from "./shared";
import type { PeopleOverview } from "./tools";
import { localDay } from "@/lib/dates";

/**
 * What the people view's template reads as app.* (view-template.ts): the people filtered and sorted as the view's state says
 * (state.circle, state.only, state.sort), the circles with their counts, the appointments, nudges, dates coming up and the things to
 * check — each a list of plain items, their texts worked out. Client-safe; the parts read the overview itself (app.overview).
 */

/** The people source's fixed field ids (workspace-source.ts). */
const F = { starred: "peoplestar", next: "peoplenext", nextKind: "peoplenextkind", context: "peoplecontext", todos: "peopletodos", tickets: "peopletickets" };

/** A row as a person's card needs it. */
export type CardPerson = { id: number; personId: number | null; name: string; starred: boolean; next: string | null; nextKind: string; context: string; todos: number; tickets: number };

export function personOf(r: Row): CardPerson {
  const text = (id: string) => String(r.cells[id] ?? "").trim();
  const count = (id: string) => (text(id) ? text(id).split(" · ").length : 0);
  const ref = /^person:(\d+)$/.exec(String(r.cells.srcref ?? ""));
  return { id: r.id, personId: ref ? Number(ref[1]) : null, name: r.title || "—", starred: r.cells[F.starred] === true, next: text(F.next) || null, nextKind: text(F.nextKind), context: text(F.context), todos: count(F.todos), tickets: text(F.tickets) ? text(F.tickets).split(/,\s*/).length : 0 };
}

/** "today", "yesterday", "5 days ago", "3 weeks ago", "4 months ago". */
export function agoText(t: T, iso: string, now: number): string {
  const days = Math.max(0, Math.floor((now - Date.parse(iso)) / 864e5));
  if (days === 0) return t("today");
  if (days === 1) return t("yesterday");
  if (days < 14) return t("{n} days ago", { n: days });
  if (days < 61) return t("{n} weeks ago", { n: Math.floor(days / 7) });
  return t("{n} months ago", { n: Math.floor(days / 30) });
}

type Sort = "name" | "quiet" | "recent" | "next" | "todos";

/** The day `days` from `now` (ISO). */
const dayFrom = (now: number, days = 0) => localDay(new Date(now + days * 864e5));

export function peopleAppData(o: PeopleOverview, rows: Row[], v: { t: T; state: Record<string, string>; now: number; locale?: string }): Record<string, unknown> {
  const { t, state, now, locale } = v;
  // "Soon": today to 30 days ahead.
  const today = dayFrom(now);
  const in30 = dayFrom(now, 30);
  const weeks = o.settings.weeks;
  const all = rows.map(personOf);
  const info = (p: CardPerson) => (p.personId ? o.cards[p.personId] : undefined);
  const last = (p: CardPerson) => info(p)?.lastContact?.at ?? "";
  const cared = (p: CardPerson) => p.starred || info(p)?.circle === "family" || info(p)?.circle === "friends";
  const circle = state.circle ?? "all";
  const only = state.only ?? "";
  const shown = all
    .filter((p) => (circle === "all" || !circle ? true : circle === "none" ? !info(p)?.circle : info(p)?.circle === circle))
    .filter((p) => {
      if (only === "starred") return p.starred;
      if (only === "todos") return p.todos > 0;
      if (only === "owed") return (info(p)?.owed.length ?? 0) > 0;
      if (only === "soon") return !!p.next && p.next >= today && p.next <= in30;
      if (only === "quiet") return cared(p) && !!last(p) && now - Date.parse(last(p)) >= weeks * 7 * 864e5;
      return true;
    });
  const byName = (a: CardPerson, b: CardPerson) => a.name.localeCompare(b.name, "de");
  const cmp: Record<Sort, (a: CardPerson, b: CardPerson) => number> = {
    name: (a, b) => Number(b.starred) - Number(a.starred) || byName(a, b),
    // The longest without contact first; never in touch at the end.
    quiet: (a, b) => (last(a) || "9999").localeCompare(last(b) || "9999") || byName(a, b),
    recent: (a, b) => last(b).localeCompare(last(a)) || byName(a, b),
    next: (a, b) => (a.next ?? "9999").localeCompare(b.next ?? "9999") || byName(a, b),
    todos: (a, b) => b.todos - a.todos || byName(a, b),
  };
  shown.sort(cmp[(state.sort as Sort) in cmp ? (state.sort as Sort) : "name"]);

  // The circles with someone in them (and those in none, unless that is everyone).
  const labels = circleLabels(t);
  const inCircle = (c: Circle | "none") => all.filter((p) => (p.personId ? (c === "none" ? !o.cards[p.personId]?.circle : o.cards[p.personId]?.circle === c) : false)).length;
  const none = inCircle("none");
  const circles = [
    ["all", t("All"), all.length],
    ...CIRCLES.map((c) => [c, labels[c], inCircle(c)] as const).filter((c) => c[2] > 0),
    ...(none && none < all.length ? [["none", t("No circle"), none] as const] : []),
  ];

  const rowOf = new Map(rows.flatMap((r) => (/^person:(\d+)$/.test(String(r.cells.srcref ?? "")) ? [[Number(String(r.cells.srcref).slice(7)), r.id] as const] : [])));
  const rowId = (personId: number) => rowOf.get(personId) ?? null;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const channel = (c: string) => (c === "Appointment" ? t("Appointment") : c);
  const time = (s: string) => (s.length === 10 ? t("all day") : new Date(s).toLocaleString(locale, { weekday: "short", hour: "2-digit", minute: "2-digit" }));

  const groups = [
    { key: "identities", title: t("Same person?"), items: o.identities.map((s) => ({ id: s.id, on: "identity", rowId: null, person: "", text: s.text, detail: `${s.evidence} · ${pct(s.confidence)}` })) },
    { key: "owed", title: t("Open commitments"), items: o.owed.map((c) => ({ id: c.id, on: "commitment", rowId: rowId(c.personId), person: c.person, text: c.text, detail: `${c.direction === "mine" ? t("you owe") : t("they owe")}${c.due ? ` · ${c.due}` : ""}` })) },
    {
      key: "read",
      title: t("What the AI read"),
      items: [
        ...o.claims.map((c) => ({ id: c.id, on: "claim", rowId: rowId(c.personId), person: c.person, text: c.text, detail: `${c.evidence ? `“${c.evidence}” · ` : ""}${pct(c.confidence)}` })),
        ...o.links.map((l) => ({ id: l.id, on: "link", rowId: rowId(l.personId), person: l.person, text: l.text, detail: l.evidence })),
      ],
    },
    { key: "stale", title: t("Still true?"), items: o.stale.map((c) => ({ id: c.id, on: "stale", rowId: rowId(c.personId), person: c.person, text: c.text, detail: "" })) },
    { key: "dates", title: t("Dates found"), items: o.dates.map((d) => ({ id: d.id, on: "date", rowId: rowId(d.personId), person: d.person, text: d.text, detail: d.source })) },
  ]
    .filter((g) => g.items.length > 0)
    .map((g) => ({ ...g, n: g.items.length }));
  const dates = o.progress.dates;
  const compile = o.progress.compile;

  return {
    loading: false,
    count: o.count,
    rowCount: rows.length,
    weeks,
    circleOptions: circles.map(([id, label, n]) => `${id}:${String(label).replace(/[,:]/g, " ")} ${n}`).join(", "),
    people: all,
    shown,
    filtered: shown.length !== rows.length,
    now,
    soonUntil: in30,
    meetings: o.meetings.map((m) => ({
      key: `${m.eventId}-${m.personId}`,
      rowId: rowId(m.personId),
      name: m.name,
      title: m.title,
      when: time(m.start),
      lastMet: m.lastMet ? t("Last met {when}", { when: agoText(t, m.lastMet, now) }) : t("No appointment with them in the last year."),
      sinceTitle: m.lastMet ? t("Since then") : t("Lately"),
      since: m.since.map((s) => ({ ago: agoText(t, s.at, now), text: s.text })),
      owed: m.owed.map((x) => ({ mine: x.direction === "mine", text: x.text, due: x.due })),
      cases: m.cases.map((c) => ({ title: c.title, label: c.label, hasOpen: c.open != null, open: c.open ?? 0 })),
      nothing: !m.since.length && !m.owed.length && !m.cases.length,
    })),
    nudges: o.nudges.map((n) => {
      const c = o.cards[n.personId];
      return {
        personId: n.personId,
        rowId: rowId(n.personId),
        name: n.name,
        note: t("{n} weeks without contact · last: {channel}", { n: Math.floor(n.days / 7), channel: channel(n.channel) }),
        // Write in the chat if there is one, else a mail.
        write: c?.chat ? `/mail?q=${encodeURIComponent(c.chat)}` : c?.email ? `mailto:${c.email}` : "",
        icon: c?.chat ? "💬" : "✉",
      };
    }),
    upcoming: o.upcoming.map((u) => ({ key: u.key, rowId: rowId(u.personId), title: u.title, when: u.when, soon: u.soon })),
    toCheck: o.identities.length + o.claims.length + o.links.length + o.stale.length + o.owed.length + o.dates.length,
    // Just one kind to check: it is open.
    oneKind: groups.length === 1,
    groups,
    confident: o.confident,
    suggestions: {
      persons: o.suggestions.persons.map((k) => ({ id: k.id, name: k.name, pages: k.pages })),
      chats: o.suggestions.chats.map((c) => ({ name: c.name, messages: c.messages })),
      error: o.suggestions.error ?? "",
      n: o.suggestions.persons.length + o.suggestions.chats.length,
      any: o.suggestions.persons.length > 0 || o.suggestions.chats.length > 0 || !!o.suggestions.error,
    },
    datesProgress: dates ? t("Searching dates… {done} of {total} · {found} found", dates) : "",
    compileProgress: compile ? `${t("Compiling … {done} of {total}", { done: compile.done, total: compile.total })}${compile.current ? ` · ${compile.current}` : ""}` : "",
    running: !!dates || !!compile,
    overview: o,
  };
}

/** What app.* holds — the AI and the language's help read it. */
export const PEOPLE_APP_DATA =
  "app.loading, app.error, app.count (people in all), app.rowCount, app.weeks (nudged after so many weeks), app.circleOptions (the circles with their counts, as <tabs> options), app.people and app.shown (the people — app.shown filtered by state.circle, state.only, sorted by state.sort; each: id (the row), personId, name, starred, next, nextKind, context, todos, tickets), app.filtered (not everyone shown), app.now, app.soonUntil, app.meetings (appointments in the next 24 hours, each: key, rowId, name, title, when, lastMet, sinceTitle, since (ago, text), owed (mine, text, due), cases (title, label, hasOpen, open), nothing), app.nudges (personId, rowId, name, note, write (an address), icon), app.upcoming (key, rowId, title, when, soon), app.toCheck, app.oneKind, app.groups (to check, each: key, title, n, items (id, on: identity|commitment|claim|link|stale|date, rowId, person, text, detail)), app.confident, app.suggestions (persons (id, name, pages), chats (name, messages), error, n, any), app.datesProgress, app.compileProgress, app.running. State: state.circle (all|family|friends|work|authorities|services|none), state.only (\"\"|starred|quiet|owed|todos|soon), state.sort (name|quiet|recent|next|todos), state.adding (\"true\": the form for a new person), state.days (0|14|30: how far back reading messages goes), state.busy (the tool running).";
