import type { WorkspaceSource } from "@/plugins/workspace/source-point";
import type { Row } from "@/plugins/workspace/model";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { createPerson, datesOf, getPerson, listPeople, namesThem, relationsOf, updatePerson, upcoming } from "./store";
import { linksOf, visibleClaims } from "./graph";
import { dateKindLabels } from "./shared";

/**
 * People as a source of the Workspace's pipelines — one record per profile, with the fields a profile has. The profiles stay in
 * People's own tables (mentions, reminders, Jira accounts, the normalizer and the knowledge graph read them there); the rows
 * are a two-way view: an edit in the database goes to the profile, a profile that changed since the row was read wins.
 */

const REF = /^person:(\d+)$/;
/** Fixed field ids: what a people database's views and joins rely on. */
const F = { aliases: "peoplealiases", emails: "peopleemails", chat: "peoplechat", jira: "peoplejira", note: "peoplenote", starred: "peoplestar", next: "peoplenext", nextKind: "peoplenextkind", pages: "peoplepages", context: "peoplecontext", knowledge: "peopleknowledge", todos: "peopletodos", tickets: "peopletickets" };
const list = (v: unknown) => [...new Set(String(v ?? "").split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean))];

export async function peopleRecords() {
  const label = dateKindLabels(t);
  const soonest = new Map<number, { on: string; kind: string }>();
  for (const u of upcoming({ days: 366 }).sort((a, b) => a.on.localeCompare(b.on))) if (!soonest.has(u.person.id)) soonest.set(u.person.id, { on: u.on, kind: u.date.kind === "other" ? u.date.label || label.other : label[u.date.kind] });
  const { pagesMentioning } = await import("@/plugins/workspace/store");
  const todos = isInstalled("todos") ? (await import("@/lib/boards/store")).listTodos({ status: "open" }) : [];
  const clip = (items: string[], n = 8) => items.slice(0, n).join(" · ");
  return listPeople().map((p) => {
    const claims = visibleClaims(p.id);
    const tickets = [...new Set(linksOf(p.id).filter((l) => l.targetType === "ticket").map((l) => l.targetRef))];
    const mine = todos.filter((todo) => namesThem(p, `${todo.text} ${todo.note ?? ""}`)).map((todo) => `${todo.ref} ${todo.text}`);
    const pages = pagesMentioning("person", p.id, 12).map((x) => x.title || "Untitled");
    const rel = relationsOf(p.id).out;
    const dates = datesOf(p.id).filter((d) => d.confirmed);
    const section = (title: string, items: string[]) => (items.length ? "## " + title + String.fromCharCode(10) + items.map((x) => "- " + x).join(String.fromCharCode(10)) : "");
    const text = [
      p.compiled?.connection ?? "",
      section(t("Key facts"), p.compiled?.keyFacts ?? []),
      section(t("Knowledge"), claims.map((c) => c.text)),
      section(t("Relations"), rel.map((r) => r.rel + (r.otherName ? " " + r.otherName : ""))),
      section(t("Dates"), dates.map((d) => (d.label || dateKindLabels(t)[d.kind]) + ": " + d.day + "." + d.month + "." + (d.year ?? ""))),
    ]
      .filter(Boolean)
      .join(String.fromCharCode(10, 10));
    return {
    ref: `person:${p.id}`,
    title: p.name,
    fields: {} as Record<string, string>,
    text,
    updatedAt: p.updatedAt,
    dataType: "people" as const,
    typed: [
      { id: F.aliases, name: "Aliases", type: "text" as const, value: p.aliases.join(", ") },
      { id: F.emails, name: "Emails", type: "text" as const, value: p.emails.join(", ") },
      { id: F.chat, name: "Chat", type: "text" as const, value: p.whatsapp },
      { id: F.jira, name: "Jira", type: "text" as const, value: p.accounts.map((a) => a.value).join(", ") },
      { id: F.note, name: "Note", type: "text" as const, value: p.note },
      { id: F.starred, name: "Starred", type: "checkbox" as const, value: p.starred || null },
      { id: F.next, name: "Next date", type: "date" as const, value: soonest.get(p.id)?.on ?? null },
      { id: F.nextKind, name: "Next", type: "text" as const, value: soonest.get(p.id)?.kind ?? "" },
      { id: F.pages, name: "Pages", type: "text" as const, value: clip(pages, 12) },
      { id: F.context, name: "Context", type: "text" as const, value: p.compiled?.connection ?? "" },
      { id: F.knowledge, name: "Knowledge", type: "text" as const, value: clip(claims.map((c) => c.text)) },
      { id: F.todos, name: "Todos", type: "text" as const, value: clip(mine) },
      { id: F.tickets, name: "Tickets", type: "text" as const, value: tickets.join(", ") },
    ],
    };
  });
}

/** What was edited in the database goes to the profiles; a row without a profile makes one. */
export async function pullPeople(_dbId: number, rows: Row[]): Promise<void> {
  const { setCell } = await import("@/plugins/workspace/store");
  const SRC = "srcref";
  const EDITED = "srcedited";
  for (const row of rows) {
    const ref = String(row.cells[SRC] ?? "");
    const m = REF.exec(ref);
    if (!m) {
      // A row of its own in the database: a new profile (the next read makes the row theirs).
      if (ref || !row.title.trim()) continue;
      const id = createPerson({ name: row.title, aliases: list(row.cells[F.aliases]), emails: list(row.cells[F.emails]), whatsapp: String(row.cells[F.chat] ?? ""), note: String(row.cells[F.note] ?? "") });
      setCell(row.id, SRC, `person:${id}`);
      continue;
    }
    const p = getPerson(Number(m[1]));
    // The profile changed since the row was read: it wins (the row follows).
    if (!p || String(row.cells[EDITED] ?? "") !== p.updatedAt) continue;
    const patch: Parameters<typeof updatePerson>[1] = {};
    if (row.title.trim() && row.title !== p.name) patch.name = row.title;
    const aliases = list(row.cells[F.aliases]);
    if (aliases.join("|") !== p.aliases.join("|")) patch.aliases = aliases;
    const emails = list(row.cells[F.emails]);
    if (emails.join("|") !== p.emails.join("|")) patch.emails = emails;
    const chat = String(row.cells[F.chat] ?? "");
    if (chat !== p.whatsapp) patch.whatsapp = chat;
    const note = String(row.cells[F.note] ?? "");
    if (note !== p.note) patch.note = note;
    const star = row.cells[F.starred] === true;
    if (star !== p.starred) patch.starred = star;
    if (Object.keys(patch).length) updatePerson(p.id, patch);
  }
}

export const PEOPLE_SOURCE: WorkspaceSource = {
  id: "people",
  label: "People",
  icon: "👤",
  dataType: "people",
  hint: "Your profiles — a row per person with aliases, addresses, chat, Jira account, note, next date, the pages that mention them, context, knowledge, todos and shared tickets. Edits go to the profile.",
  read: peopleRecords,
  count: () => listPeople().length,
  pull: pullPeople,
};
