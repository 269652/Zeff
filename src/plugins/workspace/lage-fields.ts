import { ATTENTIONS, isAttention } from "@/lib/boards/shared";
import { rowsByKeys } from "./collections";
import type { Property } from "./model";
import { getDatabase, getPage, setCell, updateSchema } from "./store";

/**
 * The Lage as AI fields of a board (the Board-Lage, done by the Workspace's AI review): attention — one of the Lage's —,
 * a lead, a summary, filled for the cards that changed (not those the Ticket-Lage read: they have theirs). The cards'
 * stripe and lead come from them. Hidden in the views: the card shows them its way (stripe, lead), the panel its briefing.
 */

export const LAGE_FIELDS = { attention: "lageattention", lead: "lagelead", summary: "lagesummary" } as const;

const FIELDS = (): Property[] => [
  {
    id: LAGE_FIELDS.attention,
    name: "Attention",
    type: "ai",
    aiChoices: [...ATTENTIONS],
    aiPrompt:
      "Wie das Ticket steht: feedback (eine Rückfrage ist offen / wartet auf Antwort), active (es wird daran gearbeitet), check (im Test, Review, Abnahme), spec (Anforderung/Spezifikation unklar, in Klärung), blocked (wartet auf andere / extern), ready (bereit zum Weitermachen, nichts blockiert), stale (liegt seit Wochen ohne Bewegung).",
  },
  { id: LAGE_FIELDS.lead, name: "Lead", type: "ai", aiPrompt: "EIN Satz — wie es steht, was als Nächstes passieren muss (und wer dran ist). Deutsch, nüchtern, konkret: Daten, Namen — nichts erfinden." },
  { id: LAGE_FIELDS.summary, name: "Summary", type: "ai", aiPrompt: "2–4 Sätze — der Stand mit den wichtigen Fakten (letzte Entscheidungen, offene Fragen, Merge Requests, Termine)." },
];

/**
 * What a Ticket-Lage run says about its tickets, into the Lage fields of every row with the key (the Jira boards, Meine
 * Lage, a moved Kanban card) — the fields made where missing. The cards read only the fields. The number of rows.
 */
export function applyTicketLage(tickets: { key: string; attention?: string | null; lead?: string | null; summary?: string | null }[]): number {
  let n = 0;
  const ready = new Set<number>();
  for (const t of tickets) {
    for (const row of rowsByKeys([t.key.trim().toUpperCase()])) {
      const db = getPage(row)?.dbId;
      if (!db) continue;
      if (!ready.has(db)) {
        ensureLageFields(db);
        ready.add(db);
      }
      if (t.attention && isAttention(t.attention)) setCell(row, LAGE_FIELDS.attention, t.attention);
      if (typeof t.lead === "string") setCell(row, LAGE_FIELDS.lead, t.lead);
      if (typeof t.summary === "string") setCell(row, LAGE_FIELDS.summary, t.summary);
      n++;
    }
  }
  return n;
}

/** Every board of the Workspace (the Jira boards the sync keeps, your own) gets its Lage fields and review. */
export async function ensureBoardReviews(): Promise<void> {
  const { listCollections } = await import("@/lib/items");
  for (const c of listCollections({ plugin: "workspace" })) if (c.kind === "board") ensureLageFields(Number(c.id.slice("workspace:".length)));
}

/** A board gets the Lage fields and the AI review (skipping what the Ticket-Lage read) — once; the fields out of its views. */
export function ensureLageFields(dbId: number): void {
  const d = getDatabase(dbId);
  if (!d) return;
  const ids: string[] = Object.values(LAGE_FIELDS);
  const missing = FIELDS().filter((f) => !d.schema.properties.some((p) => p.id === f.id));
  const hide = (hidden: string[]) => [...new Set([...hidden, ...ids])];
  // As the Board-Lage read them: open cards moved lately (or in progress), not those the Ticket-Lage read.
  const next = { ...d.schema, properties: [...d.schema.properties, ...missing], views: d.schema.views.map((v) => ({ ...v, hidden: hide(v.hidden) })), review: { on: true, skipBriefed: true, openOnly: true, recentDays: 30 } };
  if (JSON.stringify(next) !== JSON.stringify(d.schema)) updateSchema(dbId, next);
}
