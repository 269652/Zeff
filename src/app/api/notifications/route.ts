import { isoDay } from "@/lib/text";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { localDay } from "@/lib/dates";

/**
 * What's worth a desktop notification right now (the launcher polls it and shows each id once):
 * sign-ins Zeff needs, agents asking you, and your todos due today or overdue — the account
 * you're in. Ids are stable (a due todo's per day), so a poller can remember what it showed.
 */
export async function GET() {
  await connection();
  const items: { id: string; title: string; body: string; href: string; at: string }[] = [];
  const { listAttention } = await import("@/lib/attention");
  for (const a of await listAttention()) items.push({ id: a.key, title: a.title, body: a.body.slice(0, 200), href: a.href ?? (a.kind === "login" ? "/settings/connections#sign-ins" : "/heute"), at: a.at });
  const { isInstalled } = await import("@/plugins/state");
  if (isInstalled("todos")) {
    const { listTodos } = await import("@/lib/boards/store");
    const now = new Date();
    const today = isoDay(now);
    for (const todo of listTodos({ status: "open" }))
      if (todo.owner === "me" && todo.due && todo.due <= today)
        items.push({
          id: `due:${todo.id}:${today}`,
          title: todo.due < today ? t("{ref} is overdue", { ref: todo.ref }) : t("{ref} is due today", { ref: todo.ref }),
          body: todo.text.slice(0, 200),
          href: `/t/${todo.id}`,
          at: now.toISOString(),
        });
  }
  // Your people's dates (Personen plugin): once when the reminder starts, once on the day.
  if (isInstalled("people")) {
    const { upcoming } = await import("@/plugins/people/store");
    const { personHref } = await import("@/plugins/workspace/people-database");
    const { inDaysText, upcomingTitle } = await import("@/plugins/people/shared");
    const now = new Date();
    for (const u of upcoming({ withinReminder: true }))
      items.push({
        id: `person-date:${u.date.id}:${u.on}:${u.inDays === 0 ? "today" : "soon"}`,
        title: u.inDays === 0 ? t("Today: {what}", { what: upcomingTitle(u, t) }) : `${upcomingTitle(u, t)} ${inDaysText(u.inDays, u.on, t)}`,
        body: u.date.kind === "birthday" ? t("Don't forget to congratulate.") : u.date.label || "",
        href: personHref(u.person.id),
        at: now.toISOString(),
      });
  }
  // What was promised (read from the messages) and falls due today or is overdue.
  if (isInstalled("people")) {
    const { openCommitments } = await import("@/plugins/people/graph");
    const { personHref } = await import("@/plugins/workspace/people-database");
    const now = new Date();
    const day = localDay(now);
    for (const c of openCommitments().filter((x) => x.due && x.due <= day).slice(0, 5))
      items.push({
        id: `commitment:${c.id}:${day}`,
        title: c.direction === "mine" ? t("You owe {name}: due {due}", { name: c.personName, due: c.due }) : t("{name} owes you: due {due}", { name: c.personName, due: c.due }),
        body: c.text.slice(0, 200),
        href: personHref(c.personId),
        at: now.toISOString(),
      });
  }
  return Response.json({ items });
}
