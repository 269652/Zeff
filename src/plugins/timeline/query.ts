/**
 * The timeline as callers ask for it (the Timeline plugin) — the API methods, the MCP tools and the pages share these: an entity's
 * events by its ref or by a name ("Julia", "PROJ-12"), and what changed since a time, grouped by entity, with labels and links —
 * each without what the reader may not see (boundaries.ts: secret sources and databases for nobody, personal ones only with
 * clearance). Server only.
 */
import { changesSince, eventsBetween, eventsFor, lastSeen, type ChangeGroup, type TimelineEvent } from "./store";
import { eventFilter, visibleEvents } from "./boundaries";
import { hrefOf, labelOf, refsOfRow, resolveQuery } from "./refs";

/** "7d", "24h", "2w", a day (YYYY-MM-DD, its start in local time) or an ISO time → ISO; null when it is none of these. */
export function parseSince(s: string | null | undefined, now = new Date()): string | null {
  const v = String(s ?? "").trim();
  if (!v) return null;
  const rel = /^(\d+)\s*([hdwm])$/i.exec(v);
  if (rel) {
    const n = Number(rel[1]);
    const ms = { h: 3600e3, d: 864e5, w: 7 * 864e5, m: 30 * 864e5 }[rel[2].toLowerCase() as "h" | "d" | "w" | "m"];
    return new Date(now.getTime() - n * ms).toISOString();
  }
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00`) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export type LabeledRef = { ref: string; label: string; href: string };
export type ShownEvent = TimelineEvent & { entities: LabeledRef[] };

/** The entities of events, labelled (each ref read once) — the event's own identity (its mail, message, entry) left out. */
export function withEntities(events: TimelineEvent[], skip: string[] = []): ShownEvent[] {
  const cache = new Map<string, LabeledRef>();
  const label = (ref: string) => {
    if (!cache.has(ref)) cache.set(ref, { ref, label: labelOf(ref), href: hrefOf(ref) });
    return cache.get(ref)!;
  };
  const own = /^(mail|msg|entry|event|doc):/;
  // A todo's own events: the todo is the event itself (its title), not one of the entities around it.
  const itself = (e: TimelineEvent, r: string) => own.test(r) || (e.source === "todos" && r.startsWith("todo:")) || (e.source === "workspace" && r === e.url.replace("/workspace/", "page:"));
  return events.map((e) => ({ ...e, entities: e.refs.filter((r) => !itself(e, r) && !skip.includes(r)).slice(0, 8).map(label) }));
}

export type ForQuery = { ref?: string; q?: string; row?: number; since?: string; until?: string; kinds?: string[]; sources?: string[]; limit?: number; before?: { at: string; id: number } };
export type ForResult = { ok: true; refs: string[]; label: string; events: ShownEvent[]; lastSeen: string | null } | { ok: false; error: string };

/** An entity's events: by its ref, by a name or key (resolved), or by a Workspace row (the row, the person or case it is). */
export function timelineFor(q: ForQuery): ForResult {
  let refs: string[] = [];
  let label = "";
  if (q.row) {
    refs = refsOfRow(q.row);
    label = labelOf(`page:${q.row}`);
  } else {
    const hit = resolveQuery(q.ref || q.q || "");
    if (!hit) return { ok: false, error: `Nothing known by “${q.ref || q.q || ""}” — give a ref (person:12, ticket:PROJ-7, page:31) or a person's name, a ticket key, a project.` };
    refs = [hit.ref];
    label = hit.label;
  }
  const since = q.since ? (parseSince(q.since) ?? undefined) : undefined;
  const until = q.until ? (parseSince(q.until) ?? undefined) : undefined;
  // What the reader may not see (a secret source or database; personal data without clearance) is left out.
  const events = visibleEvents((page) => eventsFor(refs, { since, until, kinds: q.kinds, sources: q.sources, ...page }), q.limit ?? 50, { before: q.before });
  return { ok: true, refs, label, events: withEntities(events, refs), lastSeen: lastSeen(refs[0]) };
}

export type SinceGroup = Omit<ChangeGroup, "events"> & LabeledRef & { events: ShownEvent[] };

/** What changed since a time, by entity, labelled. */
export function timelineSince(q: { since: string; until?: string; kinds?: string[]; sources?: string[]; refKinds?: string[]; limit?: number; perGroup?: number }): { ok: true; since: string; groups: SinceGroup[] } | { ok: false; error: string } {
  const since = parseSince(q.since);
  if (!since) return { ok: false, error: `“${q.since}” is no time — give a day (2026-10-01), an ISO time or a span back (24h, 7d, 2w).` };
  const until = q.until ? (parseSince(q.until) ?? undefined) : undefined;
  const groups = changesSince(since, { until, kinds: q.kinds, sources: q.sources, refKinds: q.refKinds, limit: q.limit ?? 30, perGroup: q.perGroup ?? 5, keep: eventFilter() });
  return { ok: true, since, groups: groups.map((g) => ({ ...g, label: labelOf(g.ref), href: hrefOf(g.ref), events: withEntities(g.events, [g.ref]) })) };
}

/** The whole timeline (the Timeline page): newest first, filtered — paged by the last event shown. */
export function timelineAll(q: { since?: string; until?: string; kinds?: string[]; sources?: string[]; limit?: number; before?: { at: string; id: number } }): ShownEvent[] {
  const from = q.since ? parseSince(q.since) : null;
  const to = q.until ? parseSince(q.until) : null;
  return withEntities(visibleEvents((page) => eventsBetween(from, to, { kinds: q.kinds, sources: q.sources, ...page }), q.limit ?? 100, { before: q.before }));
}

/** Events as lines for an agent: day and time, kind, source, title, a short summary, the entities, the link. */
export function eventLines(events: ShownEvent[]): string[] {
  return events.map((e) => {
    const when = e.at.slice(0, 16).replace("T", " ");
    const who = e.entities.map((x) => `${x.label} [${x.ref}]`).join(", ");
    return `${when} | ${e.kind} (${e.source}) | ${e.title}${e.summary && e.summary !== e.title ? ` — ${e.summary.slice(0, 200)}` : ""}${who ? ` | ${who}` : ""}${e.url && /^https?:/.test(e.url) ? ` | ${e.url}` : ""}`;
  });
}
