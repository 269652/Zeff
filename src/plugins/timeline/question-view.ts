/**
 * The timeline as a view of structured questions (the Questions plugin's point, questions/view-point.ts): its events by
 * entity, kind, source and date — so "Wann zuletzt mit Y gesprochen?" is `last` over Y's mails and messages, "wie oft im
 * September?" a count per day, week or month. An entity by its name as the timeline resolves it (a person, a ticket key, a
 * project, a page) and as the Entities plugin does (an organisation, a place, a project by an alias or a domain). Only the
 * events the asker may see (boundaries.ts). Server only.
 */
import type { Item, QueryView } from "@/plugins/questions/view-types";
import { SOURCES } from "./shared";

/** At most this many events are read for one question (newest first). */
const MAX_EVENTS = 20000;

export const TIMELINE_VIEW: QueryView = {
  name: "timeline",
  plugin: "timeline",
  description:
    "Die Zeitleiste: alles, was passiert ist, quer über die Quellen — Mails, Chat- und Teams-Nachrichten, Tickets (angelegt, Status, Kommentare), Merge Requests, Termine, gebuchte Zeit, Todos (angelegt, erledigt), Workspace-Zeilen, Zahlungen, Dokumente —, je Ereignis Zeitpunkt, Art, Quelle und wen/was es betrifft. Für „wann zuletzt mit X gesprochen/geschrieben/getroffen“ (entity, kind mail|message|meeting, last), „wie oft war etwas mit X pro Monat“ (count, groupBy month), „was ist mit Ticket/Projekt Y passiert“.",
  filters: {
    from: { type: "date", description: "ab diesem Tag (YYYY-MM-DD; YYYY-MM oder YYYY: ab dessen erstem Tag)" },
    to: { type: "date", description: "bis einschließlich diesem Tag (YYYY-MM oder YYYY: bis dessen letztem Tag)" },
    entity: { type: "text", description: "wen oder was es betrifft: eine Person (Name, Alias), ein Ticket-Key, ein Projekt, eine Organisation, ein Ort, eine Workspace-Seite — oder eine Ref (person:12, ticket:PROJ-7)" },
    kind: { type: "texts", description: "Arten (ein Anfang genügt): mail, message, meeting, ticket, comment, mr, time, todo, row, payment, document" },
    source: { type: "enum", values: SOURCES, description: "Quelle" },
    text: { type: "text", description: "in Titel oder Zusammenfassung" },
  },
  dims: ["kind", "source"],
  measures: {},
  async items(f, ctx) {
    const { eventsBetween, eventsFor } = await import("./store");
    const { eventFilter, visibleEvents } = await import("./boundaries");
    const { clearanceOf, has } = await import("@/plugins/questions/view-types");
    let refs: string[] | null = null;
    const entity = typeof f.entity === "string" ? f.entity.trim() : "";
    if (entity) {
      const { resolveQuery } = await import("./refs");
      const hit = resolveQuery(entity);
      refs = hit ? [hit.ref] : [];
      const { isInstalled } = await import("@/plugins/state");
      if (isInstalled("entities")) {
        try {
          const { resolveRefs } = await import("@/plugins/entities/resolve");
          refs = [...new Set([...refs, ...resolveRefs(entity)])];
        } catch {
          // the entities' tables not there yet
        }
      }
      if (!refs.length) {
        const { ValidationError } = await import("@/lib/errors");
        throw new ValidationError(`Nothing known by “${entity}” — give a person's name, a ticket key, a project, an organisation or a ref (person:12).`);
      }
    }
    const since = typeof f.from === "string" ? f.from : null;
    const until = typeof f.to === "string" ? `${f.to}T23:59:59.999Z` : null;
    const kinds = Array.isArray(f.kind) ? (f.kind as string[]) : undefined;
    const sources = typeof f.source === "string" ? [f.source] : undefined;
    const text = typeof f.text === "string" ? f.text : null;
    const keep = eventFilter(clearanceOf(ctx));
    const events = visibleEvents(
      (page) => (refs ? eventsFor(refs, { since: since ?? undefined, until: until ?? undefined, kinds, sources, ...page }) : eventsBetween(since, until, { kinds, sources, ...page })),
      MAX_EVENTS,
      { keep, rounds: MAX_EVENTS / 1000 },
    );
    return events
      .filter((e) => !text || has(`${e.title} ${e.summary}`, text))
      .map(
        (e): Item => ({
          at: e.at,
          title: `${e.kind} · ${e.title}`,
          ref: `tl:${e.id}`,
          href: e.url || null,
          values: {},
          dims: { kind: e.kind, source: e.source },
        }),
      );
  },
};
