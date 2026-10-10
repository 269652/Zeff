import { connection } from "next/server";

/**
 * What's worth a desktop notification right now (the launcher polls it and shows each id once):
 * sign-ins Zeff needs, agents asking you, and your todos due today or overdue — the account
 * you're in. Ids are stable (a due todo's per day), so a poller can remember what it showed.
 */
export async function GET() {
  await connection();
  const items: { id: string; title: string; body: string; href: string; at: string }[] = [];
  const { listAttention } = await import("@/lib/attention");
  for (const a of await listAttention()) items.push({ id: a.key, title: a.title, body: a.body.slice(0, 200), href: a.href ?? (a.kind === "login" ? "/logins" : "/heute"), at: a.at });
  const { isInstalled } = await import("@/plugins/state");
  if (isInstalled("todos")) {
    const { listTodos } = await import("@/lib/boards/store");
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    for (const t of listTodos({ status: "open" }))
      if (t.owner === "me" && t.due && t.due <= today)
        items.push({ id: `due:${t.id}:${today}`, title: t.due < today ? `${t.ref} ist überfällig` : `${t.ref} ist heute fällig`, body: t.text.slice(0, 200), href: `/t/${t.id}`, at: now.toISOString() });
  }
  return Response.json({ items });
}
