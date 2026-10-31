import { getSqlite } from "@/db";
import { localDay } from "@/lib/dates";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import type { BadgePart } from "@/plugins/workspace/badge-shared";
import type { RowBadgeSource } from "@/plugins/workspace/row-badge-point";
import { openCommitments } from "./graph";
import type { Person } from "./shared";
import { listPeople, namesOf, namesThem } from "./store";

/** Each person's unread messages: their chats (WhatsApp, Signal by name) and mail from their addresses — by person id (only those with some). */
export function unreadByPerson(people: Person[]): Map<number, number> {
  const out = new Map<number, number>();
  try {
    const rows = getSqlite()
      .prepare("select lower(coalesce(from_email, '')) e, coalesce(conv_id, '') c, count(*) n from emails where unread = 1 and resolved_at is null and folder not like '%Sent%' and folder not like '%Gesendet%' group by 1, 2")
      .all() as { e: string; c: string; n: number }[];
    const byMail = new Map<string, number>();
    const byConv = new Map<string, number>();
    for (const r of rows) {
      if (r.c.startsWith("wa:") || r.c.startsWith("sg:")) byConv.set(r.c, (byConv.get(r.c) ?? 0) + r.n);
      else if (r.e) byMail.set(r.e, (byMail.get(r.e) ?? 0) + r.n);
    }
    if (!byMail.size && !byConv.size) return out;
    for (const p of people) {
      let n = 0;
      for (const m of new Set(p.emails.map((x) => x.toLowerCase()))) n += byMail.get(m) ?? 0;
      for (const name of new Set(namesOf(p))) n += (byConv.get(`wa:${name}`) ?? 0) + (byConv.get(`sg:${name}`) ?? 0);
      if (n > 0) out.set(p.id, n);
    }
  } catch {
    // no mail kept yet
  }
  return out;
}

/**
 * A person's row in the People database, in the Workspace tree: what waits with them — the open todos about them (their name, an
 * alias, their first name when no one else has it, a mention), the overdue ones and the promises past their day as important, and
 * their unread messages (their chats, mail from their addresses). Everything at once for all the people (a word test only where the
 * name is in the text at all). Server only.
 */
export const PEOPLE_ROW_BADGES: RowBadgeSource = {
  prefix: "person:",
  badges: async () => {
    const out = new Map<string, BadgePart[]>();
    const people = listPeople();
    if (!people.length) return out;
    const today = localDay();
    const add = (id: number, part: BadgePart) => {
      if (part.count <= 0) return;
      const key = `person:${id}`;
      out.set(key, [...(out.get(key) ?? []), part]);
    };

    // Todos about them.
    if (isInstalled("todos")) {
      const { listTodos } = await import("@/lib/boards/store");
      const todos = listTodos({ status: "open" }).map((x) => ({ text: `${x.text} ${x.note ?? ""}`, low: `${x.text} ${x.note ?? ""}`.toLowerCase(), overdue: !!x.due && x.due < today }));
      const firsts = new Map<string, number>();
      for (const p of people) {
        const f = p.name.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
        firsts.set(f, (firsts.get(f) ?? 0) + 1);
      }
      for (const p of people) {
        const names = namesOf(p).filter((n) => n.length >= 3);
        const first = p.name.trim().split(/\s+/)[0] ?? "";
        const byFirst = first.length >= 3 && first !== p.name.trim() && firsts.get(first.toLowerCase()) === 1;
        const mention = `[[person:${p.id}|`;
        let open = 0;
        let overdue = 0;
        for (const x of todos) {
          const hit =
            x.text.includes(mention) ||
            (names.some((n) => x.low.includes(n.toLowerCase())) && namesThem(p, x.text)) ||
            (byFirst && x.low.includes(first.toLowerCase()) && namesThem({ ...p, name: first, aliases: [], whatsapp: "" }, x.text));
          if (!hit) continue;
          open++;
          if (x.overdue) overdue++;
        }
        // (The overdue ones are among the open ones: counted once, as important.)
        add(p.id, { tone: "unread", count: open - overdue, label: open === 1 ? t("1 open todo") : t("{n} open todos", { n: open }) });
        add(p.id, { tone: "important", count: overdue, label: overdue === 1 ? t("1 overdue todo") : t("{n} overdue todos", { n: overdue }) });
      }
    }

    // Promises past their day, both ways.
    try {
      const late = new Map<number, number>();
      for (const c of openCommitments()) if (c.direction && c.due && c.due < today) late.set(c.personId, (late.get(c.personId) ?? 0) + 1);
      for (const [id, n] of late) add(id, { tone: "important", count: n, label: n === 1 ? t("1 overdue promise") : t("{n} overdue promises", { n }) });
    } catch {
      // no claims yet
    }

    // Their unread messages: a pill of its own.
    for (const [id, n] of unreadByPerson(people)) add(id, { tone: "messages", count: n, label: n === 1 ? t("1 unread message") : t("{n} unread messages", { n }) });
    return out;
  },
};
