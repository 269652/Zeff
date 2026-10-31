import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { listBadge, type WidgetConfig, type WidgetItem, type WorkspaceWidget, type WidgetSetting } from "@/plugins/workspace/widget-point";
import { openCommitments, reviewClaim } from "./graph";
import { circleLabels, dateKindLabels, type Person } from "./shared";
import { namesPerson } from "./resolve";
import { getPerson, listPeople, upcoming } from "./store";
import type { DocNode } from "@/plugins/workspace/doc";
import { localDay } from "@/lib/dates";

/**
 * Widgets about one person, for a page — on a person's own page (a row of the People database) they take that person by
 * themselves, elsewhere the one named in their settings: their open todos, everything Zeff knows about them in one place,
 * and the promises open between you, both ways. Server only.
 */

/** The person a widget is about: the one named in its settings (a name, an alias, a first name), else the page's it stands on. */
export async function personFor(config: WidgetConfig): Promise<Person | null> {
  const name = String(config.person ?? "").trim();
  // Picked from the suggestions: that one, whatever their name is now.
  const picked = Number(config.personId);
  if (name && picked > 0) {
    const p = getPerson(picked);
    if (p) return p;
  }
  if (name) {
    const { peopleOf } = await import("./formulas");
    return peopleOf(name)?.people[0] ?? null;
  }
  const page = Number(config.__page);
  if (!page) return null;
  const { getPage } = await import("@/plugins/workspace/store");
  const m = /^person:(\d+)$/.exec(String(getPage(page)?.props?.srcref ?? ""));
  return m ? getPerson(Number(m[1])) : null;
}

/**
 * The detail widgets about this person on the page a widget stands on (one in a column too) — "All about a person" leaves out
 * what they show already: one form per thing.
 */
async function detailWidgetsOn(config: WidgetConfig, p: Person | null): Promise<Set<string>> {
  const page = Number(config.__page);
  const out = new Set<string>();
  if (!page || !p) return out;
  const { getPage } = await import("@/plugins/workspace/store");
  const nodes: DocNode[] = [];
  const walk = (n: DocNode) => {
    if (n.type === "zeffWidget" && n.attrs?.widget !== "people.overview") nodes.push(n);
    (n.content ?? []).forEach(walk);
  };
  (getPage(page)?.content.content ?? []).forEach(walk);
  for (const n of nodes) {
    let own: WidgetConfig = {};
    try {
      own = JSON.parse(String(n.attrs?.config ?? "{}"));
    } catch {
      // no settings: the page's person
    }
    if ((await personFor({ ...own, __page: page }))?.id === p.id) out.add(String(n.attrs?.widget));
  }
  return out;
}

export const personSetting = (): WidgetSetting => ({ key: "person", label: t("Person (a name; empty: the person whose page this is)"), kind: "person", default: "" });
export const nobody = () => ({ kind: "list" as const, items: [], empty: t("Name a person in its settings — or put it on a person's page.") });

/**
 * A todo names them: their name or an alias, a part of their name no one else has ("Chris anrufen"), or a mention of them
 * ([[person:12|…]]) — the one index of everyone (people/resolve.ts), each todo's text read once.
 */
const aboutThem = (p: Person, text: string): boolean => namesPerson(p.id, text);

export const PERSON_WIDGETS: WorkspaceWidget[] = [
  {
    id: "people.todos",
    get label() {
      return t("Todos with a person");
    },
    icon: "☑️",
    // (on a person's page its name says nothing new: no header, the controls float top right)
    header: false,
    get description() {
      return t("The open todos about a person — on their page by itself; tick one off right here.");
    },
    get settings(): WidgetSetting[] {
      return [personSetting(), { key: "limit", label: t("How many"), kind: "number", default: 8, min: 1, max: 30 }];
    },
    ttl: 30,
    data: async (config) => {
      const p = await personFor(config);
      if (!p) return nobody();
      if (!isInstalled("todos")) return { kind: "list", items: [], empty: t("Needs the Todos plugin.") };
      const { listTodos } = await import("@/lib/todos/store");
      const today = localDay();
      // (A checklist of the same page that feeds the engine goes into this list there: the editor folds it — merged-lists.ts.)
      const all = listTodos({ status: "open" }).filter((x) => aboutThem(p, `${x.text} ${x.note ?? ""}`));
      const items: WidgetItem[] = all.slice(0, Number(config.limit ?? 8)).map((x) => ({
        id: String(x.id),
        icon: x.owner === "other" ? "⏳" : "☐",
        text: x.text,
        detail: [x.ref, x.owner === "other" ? t("waiting on them") : ""].filter(Boolean).join(" · "),
        meta: x.due || undefined,
        tone: x.due && x.due < today ? ("bad" as const) : undefined,
        href: `/t/${x.id}`,
        done: false,
        actions: [
          { id: "toggle", label: t("Done"), icon: "✓" },
          { id: "dismiss", label: t("Dismiss"), icon: "✕" },
        ],
      }));
      const overdue = all.filter((x) => x.due && x.due < today).length;
      return { kind: "list", title: p.name, items, count: all.length || undefined, urgent: overdue, empty: t("No open todos with {name}.", { name: p.name }) };
    },
    // The page's badge: the open todos about them, the overdue ones as important.
    badge: listBadge({ unread: (n) => (n === 1 ? t("1 open todo") : t("{n} open todos", { n })), important: (n) => (n === 1 ? t("1 overdue todo") : t("{n} overdue todos", { n })) }),
    act: async (action, payload) => {
      // Ticked: done; ✕: dismissed (not to be done) — either way off the list.
      if (action !== "toggle" && action !== "dismiss") throw new Error("unknown action");
      (await import("@/lib/todos/store")).setTodoStatus(Number(payload.id), action === "toggle" ? "done" : "dismissed");
    },
  },
  {
    id: "people.overview",
    get label() {
      return t("All about a person");
    },
    icon: "🧑",
    size: "full",
    header: false,
    get description() {
      return t("Everything Zeff knows about a person in one place: who they are to you, key facts, what was learned, relations, dates, last contact, open promises and todos, money, tickets, pages, how to reach them.");
    },
    get settings(): WidgetSetting[] {
      return [personSetting()];
    },
    ttl: 60,
    cacheKey: async (config) => [...(await detailWidgetsOn(config, await personFor(config)))].sort().join(","),
    data: async (config) => {
      const p = await personFor(config);
      if (!p) return nobody();
      // What their own page shows (blocks.ts personBundle) — all of it, as rows.
      const b = await (await import("./blocks")).personBundle(p.id);
      const { personHref } = await import("@/plugins/workspace/people-database");
      const { detailLabels } = await import("./row-data");
      const href = personHref(p.id);
      // What the detail widgets on the same page show already stays there.
      const on = await detailWidgetsOn(config, p);
      const shows = (id: string) => on.has(id);
      const items: WidgetItem[] = [];
      const add = (icon: string, text: string, detail?: string, extra: Partial<WidgetItem> = {}) => text && items.push({ id: `${items.length}`, icon, text, detail, wrap: true, ...extra });
      const now = Date.now();
      const day = (iso: string) => iso.slice(0, 10);
      const circle = p.circle ? circleLabels(t)[p.circle] : "";
      // Who they are to you.
      add("🧑", b.compiled?.connection || p.name, [circle, b.aliases.length ? t("also: {names}", { names: b.aliases.join(", ") }) : ""].filter(Boolean).join(" · "), { href });
      if (b.note) add("📝", b.note, t("Note"));
      if (!shows("people.facts")) for (const f of (b.compiled?.keyFacts ?? []).slice(0, 8)) add("•", f, t("Key fact"));
      if (!shows("people.funfacts")) for (const f of (b.compiled?.funFacts ?? []).slice(0, 4)) add("🎈", f, t("Fun fact"));
      if (!shows("people.facts")) for (const c of b.claims.filter((c) => c.status !== "rejected" && !c.done && c.kind !== "commitment").slice(0, 10)) add("💡", c.text, c.status === "confirmed" ? t("Known") : t("Read from your messages — to check"));
      const rel = b.relations;
      if (rel.out.length || rel.in.length) add("🔗", [...rel.out.map((r) => `${r.rel}${r.otherName ? ` ${r.otherName}` : ""}`), ...rel.in.map((r) => `${r.personName}: ${r.rel}`)].slice(0, 8).join(" · "), t("Relations"));
      // The rhythm: how often, who starts, how fast.
      const pulse = shows("people.rhythm") ? undefined : b.pulse;
      if (pulse?.contactDays) {
        const parts = [t("{n} days in touch in 12 months", { n: pulse.contactDays }), pulse.typicalGap ? t("usually every {n} days", { n: pulse.typicalGap }) : "", pulse.initiative.share !== null ? t("you start {n} %", { n: Math.round(pulse.initiative.share * 100) }) : ""].filter(Boolean);
        add("📈", parts.join(" · "), pulse.drifting ? t("Drifting apart — longer quiet than usual") : t("Rhythm"), pulse.drifting ? { tone: "warn" } : {});
      }
      try {
        const last = shows("people.rhythm") ? undefined : (await (await import("./pulse")).lastContactsAll([p])).get(p.id);
        if (last) add("🕑", t("Last contact: {ago}", { ago: (await import("./view-data")).agoText(t, last.at, now) }), day(last.at));
      } catch {
        // the pulse is a bonus
      }
      // Their latest messages.
      if (!shows("people.news")) for (const m of b.contacts.slice(0, 4)) add("💬", m.text.slice(0, 220), `${m.who} · ${m.folder} · ${day(m.at)}`);
      // Appointments and dates.
      const coming = !shows("people.coming");
      if (coming) for (const e of (b.events?.upcoming ?? []).slice(0, 3)) add("📆", e.title, `${e.start.slice(0, 16).replace("T", " ")}${e.location ? ` · ${e.location}` : ""}`, { href: e.href });
      const next = coming && upcoming({ days: 366 }).filter((u) => u.person.id === p.id).sort((a, b2) => a.on.localeCompare(b2.on))[0];
      if (next) add("🎂", t("Next: {what} on {day}", { what: next.date.kind === "other" ? next.date.label || dateKindLabels(t).other : dateKindLabels(t)[next.date.kind], day: next.on }));
      const dates = coming ? b.dates.filter((d) => d.confirmed) : [];
      if (dates.length) add("📅", dates.map((d) => `${d.label || dateKindLabels(t)[d.kind]}: ${d.text}`).join(" · "), t("Dates"));
      // What is open between you.
      const promises = shows("people.promises") ? [] : openCommitments().filter((c) => c.personId === p.id);
      const mine = promises.filter((c) => c.direction === "mine");
      const theirs = promises.filter((c) => c.direction === "theirs");
      if (mine.length) add("🤝", mine.map((c) => c.text).slice(0, 3).join(" · "), t("You promised ({n})", { n: mine.length }));
      if (theirs.length) add("🤝", theirs.map((c) => c.text).slice(0, 3).join(" · "), t("They promised ({n})", { n: theirs.length }));
      if (isInstalled("todos") && !shows("people.todos")) {
        const { listTodos } = await import("@/lib/todos/store");
        const todos = listTodos({ status: "open" }).filter((x) => aboutThem(p, `${x.text} ${x.note ?? ""}`));
        if (todos.length) add("☐", todos.slice(0, 4).map((x) => x.text).join(" · "), t("Open todos ({n})", { n: todos.length }));
      }
      // Money: what you owe them, what they owe you (Finances) — and their cases.
      if (isInstalled("finances")) {
        try {
          const { FINANCES_FORMULAS } = await import("@/plugins/finances/formulas");
          const { EntityRef } = await import("@/plugins/workspace/formula");
          const arg = [new EntityRef("person", String(p.id), p.name)];
          const owe = Number(FINANCES_FORMULAS.find((f) => f.name === "Schulden")!.call(arg)) || 0;
          const owed = Number(FINANCES_FORMULAS.find((f) => f.name === "Forderungen")!.call(arg)) || 0;
          const euro = (n: number) => `${n.toLocaleString("de-DE", { maximumFractionDigits: 2 })} €`;
          if (owe || owed) add("💶", [owe ? t("You owe {amount}", { amount: euro(owe) }) : "", owed ? t("They owe you {amount}", { amount: euro(owed) }) : ""].filter(Boolean).join(" · "), t("Money"), { tone: owe ? "warn" : "good" });
        } catch {
          // money is a bonus
        }
      }
      for (const c of b.cases.filter((c) => !c.done).slice(0, 3)) add("📁", `${c.label ? `${c.label} · ` : ""}${c.title}`, [c.open !== null ? t("open {amount}", { amount: `${c.open.toLocaleString("de-DE")} €` }) : "", c.nextDue ? t("next {day}", { day: c.nextDue }) : ""].filter(Boolean).join(" · ") || t("Case"), { href: c.href });
      // Details: IBAN, RevTag, address, phone …
      const labels = detailLabels(t);
      if (b.details.length) add("🪪", b.details.map((d) => `${labels[d.key] ?? d.key}: ${d.value}`).join(" · "), t("Details"));
      for (const d of b.documents.slice(0, 3)) add("📄", d.name, d.summary.slice(0, 160) || day(d.at));
      if (b.tickets.length) add("🎫", b.tickets.slice(0, 8).join(", "), t("Tickets"));
      if (b.pages.length) add("📄", b.pages.slice(0, 8).map((x) => x.title || t("Untitled")).join(" · "), t("Pages that mention them"));
      const reach = [...b.emails, b.whatsapp ? `WhatsApp: ${b.whatsapp}` : "", ...b.jira.map((j) => `Jira: ${j}`)].filter(Boolean);
      if (reach.length) add("✉️", reach.join(" · "), t("How to reach them"));
      return { kind: "list", title: p.name, items, empty: t("Nothing known about {name} yet.", { name: p.name }) };
    },
  },
  {
    id: "people.promises",
    get label() {
      return t("Open promises (both ways)");
    },
    icon: "🤝",
    header: false,
    get description() {
      return t("What you promised a person and what they promised you, open — past its day first; on their page by itself, empty: everyone. Tick one off when it is kept.");
    },
    get settings(): WidgetSetting[] {
      return [
        { key: "person", label: t("Person (a name; empty: the page's person, else everyone)"), kind: "text", default: "" },
        {
          key: "who",
          label: t("Whose"),
          kind: "select",
          default: "all",
          options: [
            { value: "all", label: t("Both") },
            { value: "mine", label: t("What I promised") },
            { value: "theirs", label: t("What they promised") },
          ],
        },
        { key: "limit", label: t("How many"), kind: "number", default: 10, min: 1, max: 40 },
      ];
    },
    ttl: 60,
    data: async (config) => {
      const p = await personFor(config);
      if (String(config.person ?? "").trim() && !p) return { kind: "list", items: [], empty: t("No person “{name}”.", { name: String(config.person) }) };
      const { personHref } = await import("@/plugins/workspace/people-database");
      const who = String(config.who ?? "all");
      const today = localDay();
      const names = new Map(listPeople().map((x) => [x.id, x.name]));
      const all = openCommitments()
        .filter((c) => (!p || c.personId === p.id) && (who === "all" || c.direction === who) && c.direction)
        .sort((a, b) => Number(!!b.due && b.due < today) - Number(!!a.due && a.due < today) || (a.due || "9999").localeCompare(b.due || "9999"));
      const items: WidgetItem[] = all.slice(0, Number(config.limit ?? 10)).map((c) => ({
        id: String(c.id),
        icon: c.direction === "mine" ? "➡️" : "⬅️",
        text: c.text,
        detail: `${p ? "" : `${names.get(c.personId) ?? ""} · `}${c.direction === "mine" ? t("you promised") : t("they promised")}`,
        meta: c.due || undefined,
        tone: c.due && c.due < today ? ("bad" as const) : undefined,
        wrap: true,
        href: personHref(c.personId),
        actions: [{ id: "done", label: t("Kept"), icon: "✓" }],
      }));
      const overdue = all.filter((c) => c.due && c.due < today).length;
      return { kind: "list", title: p?.name, items, count: all.length || undefined, urgent: overdue, empty: p ? t("No open promises with {name}.", { name: p.name }) : t("No open promises.") };
    },
    // The page's badge: a promise past its day.
    badge: listBadge({ important: (n) => (n === 1 ? t("1 overdue promise") : t("{n} overdue promises", { n })) }),
    act: (action, payload) => {
      if (action !== "done") throw new Error("unknown action");
      reviewClaim(Number(payload.id), "done");
    },
  },
];
