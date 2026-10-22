import { formatDate, formatDayTime } from "@/lib/format";
import { accountFor } from "@/lib/girocode";
import type { T } from "@/lib/i18n/shared";
import type { Appointment } from "./appointments";
import type { KnowledgeOfPerson } from "./block-actions";
import type { PersonBundle } from "./blocks";

/**
 * What a person's own page reads as app.* (view-template.ts): the bundle of what is known about them and what the knowledge knows —
 * each list a list of plain items, their texts and addresses worked out. Client-safe; the parts read the bundle itself (app.person).
 */

/** What the page's hook has: the bundle (null: not read yet, or no person), what went wrong, what the knowledge knows (null: no knowledge plugin; undefined: being read). */
export type PersonPageInput = { person: PersonBundle | null; error: string | null; loading: boolean; wiki: KnowledgeOfPerson | null | undefined };

/** The kinds of details, as the page names them. */
export const detailLabels = (t: T): Record<string, string> => ({ iban: "IBAN", bic: "BIC", bank: t("Bank"), revtag: "RevTag", address: t("Address"), phone: t("Phone"), hours: t("Office hours") });

const kindLabels = (t: T): Record<string, string> => ({ fact: t("Fact"), role: t("Role"), owns: t("Responsible for"), preference: t("Preference"), commitment: t("Commitment") });
const relLabels = (t: T): Record<string, string> => ({
  "reports-to": t("reports to"),
  manages: t("manages"),
  "works-with": t("works with"),
  decides: t("decides on"),
  owns: t("is responsible for"),
  "on-ticket": t("is on"),
  "commented-on": t("commented on"),
  authored: t("wrote in"),
  "active-in": t("is active in"),
  "knows-about": t("knows about"),
});

/** The kinds as the Facts tab groups them, in this order. */
const KIND_ORDER = ["role", "owns", "fact", "preference", "commitment"];
const kindGroups = (t: T): Record<string, string> => ({ role: t("Role"), owns: t("Responsible for"), fact: t("Facts"), preference: t("Preferences"), commitment: t("Commitments") });

/** A name as an option of a <select> (its commas and colons would split it). */
const option = (s: string) => s.replace(/[,:]/g, " ").replace(/\s+/g, " ").trim();

export function personPageData(x: PersonPageInput, v: { t: T; locale?: string }): Record<string, unknown> {
  const { t, locale } = v;
  const d = x.person;
  if (x.loading && !d) return { loading: true, ready: false };
  if (!d) return { loading: false, ready: false, error: x.error ?? t("This row is not a person.") };

  const kinds = kindLabels(t);
  const rels = relLabels(t);
  const labels = detailLabels(t);
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const due = (c: PersonBundle["claims"][number]) => (c.kind === "commitment" ? c.due : "");

  // What was read from messages: still to check, confirmed (by kind), done.
  const toCheck = d.claims.filter((c) => c.status !== "confirmed" && !c.done);
  const facts = d.claims.filter((c) => c.status === "confirmed" && !c.done);
  const done = d.claims.filter((c) => c.done);
  const count = (label: string, n: number) => `${label}${n > 0 ? `:${n}` : ""}`;
  const groups = kindGroups(t);
  const names = new Map(d.others.map((o) => [String(o.id), o.name]));

  // Their bank account, paid to the recipient what was said about them names ("Empfänger …").
  const account = accountFor(d.name, d.details, d.claims.filter((c) => c.status !== "rejected").map((c) => c.text));

  const w = x.wiki;
  const wikiEmpty = !!w && !w.error && !w.summary && !w.related.length && !w.pages.length;

  const when = (e: Appointment) => (e.allDay ? formatDate(e.start) : formatDayTime(e.start));
  const event = (e: Appointment) => ({ key: `${e.id}:${e.start}`, color: e.color, calendar: e.calendar, when: when(e), title: e.title, href: e.href, location: e.location });
  const events = d.events;

  return {
    loading: false,
    ready: true,
    person: d,
    id: d.id,
    name: d.name,
    starred: d.starred,
    starLabel: d.starred ? "★" : "☆",
    starTip: d.starred ? t("Remove star") : t("Add star"),
    profile: { name: d.name, aliases: d.aliases.join(", "), emails: d.emails.join(", "), whatsapp: d.whatsapp, jira: d.jira.join(", ") },
    note: d.note,

    details: d.details.map((x) => ({
      id: x.id,
      key: x.key,
      label: labels[x.key] ?? x.key,
      value: x.value,
      mono: x.key === "iban" || x.key === "bic",
      phone: x.key === "phone",
      dial: x.key === "phone" ? x.value.replace(/[^\d+]/g, "") : "",
      map: x.key === "address" ? `https://www.openstreetmap.org/search?query=${encodeURIComponent(x.value)}` : "",
      confirmed: x.confirmed,
    })),
    hasDetails: d.details.length > 0,
    account,
    canPay: !!account,

    compiled: !!d.compiled,
    compileLabel: d.compiled ? t("Compile again") : t("Compile"),
    summary: d.compiled ? { connection: d.compiled.connection, keyFacts: d.compiled.keyFacts, funFacts: d.compiled.funFacts, sources: d.compiled.sources } : null,

    dates: d.dates.map((x) => ({ id: x.id, label: x.label, text: x.text, when: x.when ? `${x.when}${x.turns ? ` · ${t("turns {age}", { age: x.turns })}` : ""}` : "", confirmed: x.confirmed, remindDays: x.remindDays, sourceText: x.sourceText })),
    hasDates: d.dates.length > 0,

    known: {
      any: d.claims.length > 0,
      nothing: d.claims.length === 0 && d.links.length === 0,
      // To check first when there is something to check.
      first: toCheck.length ? "check" : "facts",
      tabs: [`check:${count(option(t("To check")), toCheck.length)}`, `facts:${count(option(t("Facts")), facts.length)}`, `done:${count(option(t("Done")), done.length)}`].join(", "),
      check: toCheck.map((c) => ({ id: c.id, kind: kinds[c.kind] ?? c.kind, text: c.text, due: due(c), evidence: c.evidence, quote: `${c.evidence ? `“${c.evidence}” · ` : ""}${pct(c.confidence)}` })),
      facts: KIND_ORDER.map((k) => ({ kind: k, title: groups[k], items: facts.filter((c) => c.kind === k).map((c) => ({ id: c.id, text: c.text, due: due(c), tip: c.evidence ? `“${c.evidence}”` : "", commitment: c.kind === "commitment" })) })).filter((g) => g.items.length > 0),
      hasFacts: facts.length > 0,
      done: done.map((c) => ({ id: c.id, kind: kinds[c.kind] ?? c.kind, text: c.text, due: due(c) })),
      hasDone: done.length > 0,
      hasCheck: toCheck.length > 0,
    },
    links: d.links.map((l) => ({ id: l.id, rel: rels[l.rel] ?? l.rel, target: l.targetType === "person" ? (names.get(l.targetRef) ?? "?") : l.targetRef })),

    relations: {
      out: d.relations.out.map((r) => ({ id: r.id, rel: r.rel, toYou: !r.otherId, other: r.otherName ?? "", evidence: r.evidence })),
      in: d.relations.in.map((r) => ({ id: r.id, rel: r.rel, person: r.personName, evidence: r.evidence })),
      none: !d.relations.out.length && !d.relations.in.length,
    },
    others: d.others,
    hasOthers: d.others.length > 0,
    mergeOptions: [`:${option(t("Pick a profile …"))}`, ...d.others.map((o) => `${o.id}:${option(o.name)}`)].join(", "),

    wiki: w ? { summary: w.summary, related: w.related, pages: w.pages, graph: w.graph ?? "", error: w.error ?? "", merge: w.merge ?? null } : null,
    // No knowledge plugin (null): the section is left out.
    showWiki: w !== null,
    wikiLoading: w === undefined,
    wikiError: !!w?.error,
    wikiEmpty,
    wikiFull: !!w && !w.error && !wikiEmpty,
    wikiMerge: w?.merge ? { id: w.merge.id, text: t("The knowledge keeps them as {n} entries: {names}.", { n: w.merge.names.length, names: w.merge.names.join(", ") }), label: t("Merge the {n} knowledge entries", { n: w.merge.names.length }) } : null,
    hasWikiMerge: !!w?.merge && !w.error,
    wikiPagesTitle: w ? t("{n} pages", { n: w.pages.length }) : "",

    contacts: d.contacts.map((c) => ({ key: c.key, folder: c.folder, who: c.who, at: new Date(c.at).toLocaleString(locale), text: c.text })),
    todos: d.todos.map((x) => ({ id: x.id, ref: x.ref, text: x.text, due: x.due ?? "", href: `/t/${x.id}` })),
    hasEvents: !!events,
    anyEvents: !!events && (events.upcoming.length > 0 || events.recent.length > 0),
    events: events ? { upcoming: events.upcoming.map(event), recent: events.recent.map(event) } : { upcoming: [], recent: [] },
    cases: d.cases.map((c) => ({ id: c.id, label: c.label, title: c.title, href: c.href, done: c.done, showOpen: c.open != null && !c.done, open: c.open ?? 0, nextDue: c.nextDue && !c.done ? new Date(c.nextDue).toLocaleDateString(locale) : "" })),
    hasCases: d.cases.length > 0,
    documents: d.documents.map((x) => ({ id: x.id, name: x.name, href: `/api/documents/${x.id}/file`, at: new Date(x.at).toLocaleDateString(locale), summary: x.summary })),
    hasDocuments: d.documents.length > 0,
    pages: d.pages.map((p) => ({ id: p.id, label: `${p.icon} ${p.title}`.trim(), href: `/workspace/${p.id}` })),
    tickets: d.tickets,
  };
}

/** What app.* holds — the AI and the language's help read it. */
export const PERSON_PAGE_APP_DATA =
  "app.loading, app.ready (the person read), app.error, app.person (the whole bundle), app.id, app.name, app.starred, app.starLabel (★/☆), app.starTip, app.profile (name, aliases, emails, whatsapp, jira — as the inputs show them), app.note, app.details (id, key: iban|bic|bank|revtag|address|phone|hours, label, value, mono, phone, dial (the number to call), map (an address on the map), confirmed), app.hasDetails, app.account (their bank account, for the transfer), app.canPay, app.compiled, app.compileLabel, app.summary (connection, keyFacts, funFacts, sources), app.dates (id, label, text, when, confirmed, remindDays, sourceText), app.hasDates, app.known (read from messages: any, nothing, first (the tab to start on), tabs (the <tabs> options with their counts), check (id, kind, text, due, evidence, quote), facts (by kind: kind, title, items (id, text, due, tip, commitment)), done (id, kind, text, due), hasCheck, hasFacts, hasDone), app.links (id, rel, target), app.relations (out (id, rel, toYou, other, evidence), in (id, rel, person, evidence), none), app.others (id, name), app.hasOthers, app.mergeOptions (<select> options), app.wiki (summary, related (name, rels), pages (id, title, space, href), graph, error, merge), app.showWiki, app.wikiLoading, app.wikiError, app.wikiEmpty, app.wikiFull, app.wikiMerge (id, text, label), app.hasWikiMerge, app.wikiPagesTitle, app.contacts (key, folder, who, at, text), app.todos (id, ref, text, due, href), app.hasEvents (the Calendar plugin), app.anyEvents, app.events (upcoming, recent — each: key, color, calendar, when, title, href, location), app.cases (id, label, title, href, done, showOpen, open, nextDue), app.hasCases, app.documents (id, name, href, at, summary), app.hasDocuments, app.pages (id, label, href), app.tickets. State: state.known (check|facts|done: the tab), state.keep (the profile to merge into), state.busy (compile|findDates: running), state.saved (profile|note: “Saved ✓” for a moment).";
