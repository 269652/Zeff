import { recordFeedback, STEPS } from "@/lib/learning/ledger";
import { cellText } from "./model";
import { getDatabase, getPage, setCell } from "./store";

/**
 * A cell set by your hand (the table, the row's page): set as always — and when it is an AI property whose value the AI
 * had written, your change is a correction of that AI field (the feedback ledger: "edited", with what it said and what
 * you made of it). Filling an empty AI field isn't one.
 */
export function setCellByHand(rowId: number, propId: string, value: unknown): void {
  const row = getPage(rowId);
  const d = row?.dbId ? getDatabase(row.dbId) : null;
  const p = d?.schema.properties.find((x) => x.id === propId);
  const was = p?.type === "ai" ? cellText(p, row!.props[propId]) : "";
  setCell(rowId, propId, value);
  if (!p || p.type !== "ai" || !was.trim()) return;
  const now = cellText(p, getPage(rowId)?.props[propId]);
  if (now === was) return;
  recordFeedback({
    step: STEPS.wsAiField,
    itemRef: `page:${rowId}`,
    verdict: now.trim() ? "edited" : "rejected",
    sourceRef: `page:${row!.dbId}`,
    // The database and the field — the pattern of a field whose instruction needs work.
    sender: `db:${row!.dbId}`,
    kind: p.name,
    detail: { text: was.slice(0, 500), yours: now.slice(0, 500), database: d!.page.title },
  });
}
