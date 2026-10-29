import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import type { WidgetConfig, WidgetItem, WorkspaceWidget, WidgetSetting } from "@/plugins/workspace/widget-point";
import { linksOf, openCommitments, reviewClaim, visibleClaims } from "./graph";
import { circleLabels, dateKindLabels, type Person } from "./shared";
import { datesOf, getPerson, listPeople, namesThem, relationsOf, upcoming } from "./store";

/**
 * Widgets about one person, for a page — on a person's own page (a row of the People database) they take that person by
 * themselves, elsewhere the one named in their settings: their open todos, everything Zeff knows about them in one place,
 * and the promises open between you, both ways. Server only.
 */

/** The person a widget is about: the one named in its settings (a name, an alias, a first name), else the page's it stands on. */
export async function personFor(config: WidgetConfig): Promise<Person | null> {
  const name = String(config.person ?? "").trim();
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

const personSetting = (): WidgetSetting => ({ key: "person", label: t("Person (a name; empty: the person whose page this is)"), kind: "text", default: "" });
const nobody = () => ({ kind: "list" as const, items: [], empty: t("Name a person in its settings — or put it on a person's page.") });

/**
 * A todo names them: their name or an alias, their first name when no one else has it ("Chris anrufen"), or a mention of
 * them ([[person:12|…]]).
 */
function aboutThem(p: Person, text: string): boolean {
  if (namesThem(p, text) || text.includes(`[[person:${p.id}|`)) return true;
  const first = p.name.trim().split(/\s+/)[0] ?? "";
  if (first.length < 3 || first === p.name.trim()) return false;
  const shared = listPeople().filter((x) => x.id !== p.id && x.name.trim().split(/\s+/)[0]?.toLowerCase() === first.toLowerCase()).length;
  return !shared && namesThem({ ...p, name: first, aliases: [] }, text);
}

export const PERSON_WIDGETS: WorkspaceWidget[] = [
  {
    id: "people.todos",
    get label() {
      return t("Todos with a person");
    },
    icon: "☑️",
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
      const { listTodos } = await import("@/lib/boards/store");
      const today = new Date().toISOString().slice(0, 10);
      const all = listTodos({ status: "open" }).filter((x) => aboutThem(p, `${x.text} ${x.note ?? ""}`));
      const items: WidgetItem[] = all.slice(0, Number(config.limit ?? 8)).map((x) => ({
        id: String(x.id),
        icon: x.owner === "other" ? "⏳" : "☑️",
        text: x.text,
        detail: [x.ref, x.owner === "other" ? t("waiting on them") : ""].filter(Boolean).join(" · "),
        meta: x.due || undefined,
        tone: x.due && x.due < today ? ("bad" as const) : undefined,
        href: `/t/${x.id}`,
        done: false,
        actions: [{ id: "toggle", label: t("Done"), icon: "✓" }],
      }));
      return { kind: "list", title: p.name, items, count: all.length || undefined, empty: t("No open todos with {name}.", { name: p.name }) };
    },
    act: async (action, payload) => {
      if (action !== "toggle") throw new Error("unknown action");
      (await import("@/lib/boards/store")).setTodoStatus(Number(payload.id), "done");
    },
  },
  {
    id: "people.overview",
    get label() {
      return t("All about a person");
    },
    icon: "🧑",
    size: "full",
    get description() {
      return t("Everything Zeff knows about a person in one place: who they are to you, key facts, what was learned, relations, dates, last contact, open promises and todos, money, tickets, pages, how to reach them.");
    },
    get settings(): WidgetSetting[] {
      return [personSetting()];
    },
    ttl: 60,
    data: async (config) => {
      const p = await personFor(config);
      if (!p) return nobody();
      const { personHref } = await import("@/plugins/workspace/people-database");
      const href = personHref(p.id);
      const items: WidgetItem[] = [];
      const add = (icon: string, text: string, detail?: string, extra: Partial<WidgetItem> = {}) => text && items.push({ id: `${items.length}`, icon, text, detail, wrap: true, ...extra });
      const now = Date.now();
      const circle = p.circle ? circleLabels(t)[p.circle] : "";
      // Who they are to you.
      add("🧑", p.compiled?.connection || p.note || p.name, [circle, p.aliases.length ? t("also: {names}", { names: p.aliases.join(", ") }) : ""].filter(Boolean).join(" · "), { href });
      for (const f of (p.compiled?.keyFacts ?? []).slice(0, 6)) add("•", f);
      for (const c of visibleClaims(p.id).slice(0, 8)) add("💡", c.text);
      const rel = relationsOf(p.id);
      if (rel.out.length || rel.in.length) add("🔗", [...rel.out.map((r) => `${r.rel}${r.otherName ? ` ${r.otherName}` : ""}`), ...rel.in.map((r) => `${r.personName}: ${r.rel}`)].slice(0, 6).join(" · "), t("Relations"));
      // When: last contact, the next date, the dates you know.
      try {
        const last = (await (await import("./pulse")).lastContactsAll([p])).get(p.id);
        if (last) add("💬", t("Last contact: {ago}", { ago: (await import("./view-data")).agoText(t, last.at, now) }), last.at.slice(0, 10));
      } catch {
        // the pulse is a bonus
      }
      const next = upcoming({ days: 366 }).filter((u) => u.person.id === p.id).sort((a, b) => a.on.localeCompare(b.on))[0];
      if (next) add("🎂", t("Next: {what} on {day}", { what: next.date.kind === "other" ? next.date.label || dateKindLabels(t).other : dateKindLabels(t)[next.date.kind], day: next.on }));
      const dates = datesOf(p.id).filter((d) => d.confirmed);
      if (dates.length) add("📅", dates.map((d) => `${d.label || dateKindLabels(t)[d.kind]}: ${d.day}.${d.month}.${d.year ?? ""}`).join(" · "), t("Dates"));
      // What is open between you.
      const promises = openCommitments().filter((c) => c.personId === p.id);
      const mine = promises.filter((c) => c.direction === "mine");
      const theirs = promises.filter((c) => c.direction === "theirs");
      if (mine.length) add("🤝", mine.map((c) => c.text).slice(0, 3).join(" · "), t("You promised ({n})", { n: mine.length }));
      if (theirs.length) add("🤝", theirs.map((c) => c.text).slice(0, 3).join(" · "), t("They promised ({n})", { n: theirs.length }));
      if (isInstalled("todos")) {
        const { listTodos } = await import("@/lib/boards/store");
        const todos = listTodos({ status: "open" }).filter((x) => aboutThem(p, `${x.text} ${x.note ?? ""}`));
        if (todos.length) add("☑️", todos.slice(0, 3).map((x) => x.text).join(" · "), t("Open todos ({n})", { n: todos.length }));
      }
      // Money: what you owe them, what they owe you (Finances).
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
      const tickets = [...new Set(linksOf(p.id).filter((l) => l.targetType === "ticket").map((l) => l.targetRef))];
      if (tickets.length) add("🎫", tickets.slice(0, 8).join(", "), t("Tickets"));
      const { pagesMentioning } = await import("@/plugins/workspace/store");
      const pages = pagesMentioning("person", p.id, 8);
      if (pages.length) add("📄", pages.map((x) => x.title || t("Untitled")).join(" · "), t("Pages that mention them"));
      const reach = [...p.emails, p.whatsapp ? `WhatsApp: ${p.whatsapp}` : "", ...p.accounts.map((a) => a.value)].filter(Boolean);
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
      const today = new Date().toISOString().slice(0, 10);
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
      return { kind: "list", title: p?.name, items, count: all.length || undefined, empty: p ? t("Nothing open with {name}.", { name: p.name }) : t("Nothing open.") };
    },
    act: (action, payload) => {
      if (action !== "done") throw new Error("unknown action");
      reviewClaim(Number(payload.id), "done");
    },
  },
];
