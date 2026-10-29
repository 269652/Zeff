import { t } from "@/lib/i18n/server";
import type { WidgetItem, WidgetTile, WorkspaceWidget, WidgetSetting } from "@/plugins/workspace/widget-point";
import { visibleClaims } from "./graph";
import { dateKindLabels } from "./shared";
import { upcoming } from "./store";
import { nobody, personFor, personSetting } from "./widgets-person";

/**
 * Small widgets about one person, to make their page their own — each a piece of what Zeff knows: the facts, the fun facts,
 * what is new with them, the rhythm of you two, what is coming up. On their page they take that person by themselves (else the
 * name in their settings); they come without a header line (their name shows as a tab on hover). Server only.
 */

const limitSetting = (n: number): WidgetSetting => ({ key: "limit", label: t("How many"), kind: "number", default: n, min: 1, max: 30 });
/** "29.10." — a day as the rows show it. */
const dm = (iso: string) => (iso.length >= 10 ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.` : iso);
const bundleOf = async (id: number) => (await import("./blocks")).personBundle(id);

const KIND_ICON: Record<string, string> = { fact: "💡", role: "🧑‍💼", owns: "🔧", preference: "❤️" };

export const PERSON_DETAIL_WIDGETS: WorkspaceWidget[] = [
  {
    id: "people.facts",
    get label() {
      return t("Facts about a person");
    },
    icon: "💡",
    header: false,
    get description() {
      return t("What matters about a person: the key facts, their role, what they look after, what they like — from their summary and what was learned from your messages.");
    },
    get settings(): WidgetSetting[] {
      return [personSetting(), limitSetting(10)];
    },
    ttl: 120,
    data: async (config) => {
      const p = await personFor(config);
      if (!p) return nobody();
      const seen = new Set<string>();
      const items: WidgetItem[] = [];
      const add = (icon: string, text: string, detail?: string) => {
        const key = text.trim().toLowerCase();
        if (!key || seen.has(key)) return;
        seen.add(key);
        items.push({ id: String(items.length), icon, text, detail, wrap: true });
      };
      for (const f of p.compiled?.keyFacts ?? []) add("•", f);
      for (const c of visibleClaims(p.id).filter((c) => c.kind !== "commitment")) add(KIND_ICON[c.kind] ?? "💡", c.text, c.status === "confirmed" ? undefined : t("read from your messages"));
      const limit = Number(config.limit ?? 10);
      return { kind: "list", items: items.slice(0, limit), count: items.length > limit ? items.length : undefined, empty: t("No facts about {name} yet.", { name: p.name }) };
    },
  },
  {
    id: "people.funfacts",
    get label() {
      return t("Fun facts");
    },
    icon: "🎈",
    header: false,
    get description() {
      return t("The fun facts about a person — what makes them them.");
    },
    get settings(): WidgetSetting[] {
      return [personSetting()];
    },
    ttl: 300,
    data: async (config) => {
      const p = await personFor(config);
      if (!p) return nobody();
      const fun = p.compiled?.funFacts ?? [];
      return { kind: "list", items: fun.map((f, i) => ({ id: String(i), icon: "🎈", text: f, wrap: true })), empty: t("No fun facts about {name} yet — they come with their summary.", { name: p.name }) };
    },
  },
  {
    id: "people.news",
    get label() {
      return t("News from a person");
    },
    icon: "📰",
    header: false,
    get description() {
      return t("What is new with a person, the newest first: what was learned lately, their latest messages, the appointments with them.");
    },
    get settings(): WidgetSetting[] {
      return [personSetting(), limitSetting(8), { key: "days", label: t("Of the last … days"), kind: "number", default: 30, min: 1, max: 365 }];
    },
    ttl: 60,
    data: async (config) => {
      const p = await personFor(config);
      if (!p) return nobody();
      const b = await bundleOf(p.id);
      const since = new Date(Date.now() - Number(config.days ?? 30) * 864e5).toISOString();
      const now = new Date().toISOString();
      const rows: (WidgetItem & { at: string })[] = [];
      for (const c of visibleClaims(p.id).filter((c) => c.kind !== "commitment" && c.createdAt >= since)) rows.push({ id: `c${c.id}`, at: c.createdAt, icon: KIND_ICON[c.kind] ?? "💡", text: c.text, detail: t("learned"), meta: dm(c.createdAt), wrap: true });
      for (const m of b.contacts.filter((m) => m.at >= since)) rows.push({ id: `m${m.key}`, at: m.at, icon: "💬", text: m.text.slice(0, 200), detail: `${m.who} · ${m.folder}`, meta: dm(m.at), wrap: true });
      for (const e of [...(b.events?.recent ?? []), ...(b.events?.upcoming ?? [])].filter((e) => e.start >= since.slice(0, 16))) rows.push({ id: `e${e.id}:${e.start}`, at: e.start, icon: e.start > now.slice(0, 16) ? "📆" : "🗓️", text: e.title, detail: e.location || undefined, meta: dm(e.start), href: e.href });
      const limit = Number(config.limit ?? 8);
      const items = rows.sort((a, c) => c.at.localeCompare(a.at)).slice(0, limit);
      return { kind: "list", items, count: rows.length > limit ? rows.length : undefined, empty: t("Nothing new from {name} lately.", { name: p.name }) };
    },
  },
  {
    id: "people.rhythm",
    get label() {
      return t("Your rhythm with a person");
    },
    icon: "📈",
    header: false,
    size: "full",
    get description() {
      return t("How you two are in touch: days in touch this year, how often usually, the last time, who starts, how fast each answers.");
    },
    get settings(): WidgetSetting[] {
      return [personSetting()];
    },
    ttl: 300,
    data: async (config) => {
      const p = await personFor(config);
      if (!p) return nobody();
      const r = (await bundleOf(p.id)).pulse;
      if (!r?.contactDays) return { kind: "list", items: [], empty: t("Not in touch with {name} in the last 12 months — as far as Zeff reads.", { name: p.name }) };
      const mins = (m: number | null) => (m === null ? "–" : m < 60 ? `${Math.round(m)} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`);
      const tiles: WidgetTile[] = [
        { label: t("Days in touch"), value: String(r.contactDays), detail: t("in 12 months") },
        { label: t("Usually every"), value: r.typicalGap ? t("{n} days", { n: r.typicalGap }) : "–" },
        { label: t("Last contact"), value: r.daysSince === null ? "–" : r.daysSince === 0 ? t("today") : t("{n} days ago", { n: r.daysSince }), tone: r.drifting ? "warn" : "good", detail: r.drifting ? t("longer quiet than usual") : undefined },
        { label: t("You start"), value: r.initiative.share === null ? "–" : `${Math.round(r.initiative.share * 100)} %`, detail: t("{mine} of {all} conversations", { mine: r.initiative.mine, all: r.initiative.mine + r.initiative.theirs }) },
        { label: t("Answers"), value: `${mins(r.reply.mine)} / ${mins(r.reply.theirs)}`, detail: t("you / them") },
      ];
      return { kind: "stats", tiles };
    },
  },
  {
    id: "people.coming",
    get label() {
      return t("Coming up with a person");
    },
    icon: "📆",
    header: false,
    get description() {
      return t("What is coming up with a person: the next appointments with them, their birthday and the other dates you keep.");
    },
    get settings(): WidgetSetting[] {
      return [personSetting(), limitSetting(6)];
    },
    ttl: 120,
    data: async (config) => {
      const p = await personFor(config);
      if (!p) return nobody();
      const b = await bundleOf(p.id);
      const rows: (WidgetItem & { at: string })[] = [];
      for (const e of b.events?.upcoming ?? []) rows.push({ id: `e${e.id}:${e.start}`, at: e.start, icon: "📆", text: e.title, detail: [e.allDay ? "" : e.start.slice(11, 16), e.location].filter(Boolean).join(" · ") || undefined, meta: dm(e.start), href: e.href });
      const labels = dateKindLabels(t);
      for (const u of upcoming({ days: 366 }).filter((x) => x.person.id === p.id)) rows.push({ id: `d${u.date.id}:${u.on}`, at: u.on, icon: u.date.kind === "birthday" ? "🎂" : "📅", text: u.date.kind === "other" ? u.date.label || labels.other : labels[u.date.kind], meta: dm(u.on) });
      const limit = Number(config.limit ?? 6);
      const items = rows.sort((a, c) => a.at.localeCompare(c.at)).slice(0, limit);
      return { kind: "list", items, empty: t("Nothing coming up with {name}.", { name: p.name }) };
    },
  },
];
