import { docRefs } from "./doc";
import { isComputed } from "./model";
import { backlinks, getDatabase, getPage, rawRows, search, tree } from "./store";

/**
 * Everything that belongs to a page or a row, gathered from what Zeff already knows - nothing is asked of an AI: the pages it
 * links to and the ones that link to it, the rows it is related to (both ways), the todos and tickets it names or holds in its fields,
 * and pages about much the same words. The detail view's block "Everything that belongs". Server only.
 */

export type BelongItem = { id: number; title: string; icon: string; hint: string; href: string };
export type BelongTodo = { id: number; ref: string; text: string; done: boolean; ticket: string };
export type BelongTicket = { key: string; summary: string; status: string; href: string | null };
export type Belongs = { groups: { key: string; title: string; items: BelongItem[] }[]; todos: BelongTodo[]; tickets: BelongTicket[] };

const idsOf = (v: unknown): number[] => (Array.isArray(v) ? v : v === undefined || v === null || v === "" ? [] : [v]).map(Number).filter((n) => Number.isInteger(n) && n > 0);

export async function belongsTo(pageId: number): Promise<Belongs> {
  const page = getPage(pageId);
  if (!page) return { groups: [], todos: [], tickets: [] };
  const seen = new Set<number>([pageId]);
  const item = (id: number, hint = ""): BelongItem | null => {
    const p = getPage(id);
    if (!p || p.archivedAt || seen.has(id)) return null;
    seen.add(id);
    return { id, title: p.title, icon: p.icon, hint, href: `/workspace/${id}` };
  };
  const take = (list: (BelongItem | null)[]) => list.filter((x): x is BelongItem => !!x);

  const refs = docRefs(page.content);
  const linked = take(refs.filter((r) => r.kind === "page").map((r) => item(Number(r.ref), "")));
  const linking = take(backlinks(pageId).map((b) => item(b.id, getDatabase(b.dbId ?? 0)?.page.title ?? "")));

  // Rows it is related to: by its own relation fields, and the rows of other databases that point to it.
  const related: BelongItem[] = [];
  const dbId = page.dbId;
  const d = dbId ? getDatabase(dbId) : null;
  if (d) {
    for (const prop of d.schema.properties.filter((p) => p.type === "relation" && !isComputed(p))) {
      related.push(...take(idsOf(page.props[prop.id]).map((id) => item(id, prop.name))));
    }
    for (const x of tree().filter((x) => x.kind === "database" && x.id !== dbId)) {
      const other = getDatabase(x.id);
      const rels = (other?.schema.properties ?? []).filter((p) => p.type === "relation" && p.relationDb === dbId && !p.backOf);
      if (!rels.length) continue;
      for (const r of rawRows(x.id)) if (rels.some((p) => idsOf(r.cells[p.id]).includes(pageId))) related.push(...take([item(r.id, x.title || "")]));
    }
  }

  // Todos and tickets: named in its text, or held in its fields.
  const todoIds = new Set(refs.filter((r) => r.kind === "todo").map((r) => Number(r.ref)));
  const ticketKeys = new Set(refs.filter((r) => r.kind === "ticket").map((r) => r.ref.toUpperCase()));
  if (d) {
    for (const prop of d.schema.properties) {
      if (prop.type === "todo") idsOf(page.props[prop.id]).forEach((n) => todoIds.add(n));
      if (prop.type === "ticket") for (const k of String(page.props[prop.id] ?? "").split(/[,\s]+/)) if (/^[A-Z][A-Z0-9]+-\d+$/i.test(k)) ticketKeys.add(k.toUpperCase());
    }
  }
  const todos: BelongTodo[] = [];
  try {
    const { getTodo } = await import("@/lib/boards/store");
    for (const id of [...todoIds].slice(0, 20)) {
      const x = getTodo(id);
      if (x) todos.push({ id: x.id, ref: x.ref, text: x.text, done: x.status !== "open", ticket: x.ticket });
    }
  } catch {
    // no todos here
  }
  const tickets: BelongTicket[] = [];
  try {
    const { getJiraTicket } = await import("@/lib/jira/store");
    for (const key of [...ticketKeys].slice(0, 20)) {
      const x = getJiraTicket(key);
      tickets.push({ key, summary: x?.summary ?? "", status: x?.status ?? "", href: x?.url ?? null });
    }
  } catch {
    // no tickets here
  }

  // Pages about much the same: the words of its title in the search.
  const words = (page.title.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []).slice(0, 6);
  const similar = words.length ? take(search(words.join(" "), 9).map((h) => item(h.id, h.path.split(" / ").slice(0, -1).join(" / ")))).slice(0, 5) : [];

  const groups = [
    { key: "related", title: "Related", items: related },
    { key: "linking", title: "Linked from", items: linking },
    { key: "linked", title: "Linked here", items: linked },
    { key: "similar", title: "About the same", items: similar },
  ].filter((g) => g.items.length);
  return { groups, todos, tickets };
}
