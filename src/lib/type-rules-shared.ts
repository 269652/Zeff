import type { EntryType } from "@/db/schema";
import { ENTRY_TYPE_OPTIONS } from "./report-shared";

/**
 * Type rules infer an entry's type from its job and description — e.g. job Abwesenheit
 * + description contains "Urlaub" → Absence. Tried top-down; the first rule whose set
 * conditions all match wins (a rule needs at least one condition). Server-free: the entry
 * form infers live, the server applies them to entries booked without a type.
 */
export type TypeRule = {
  id: string;
  /** Job number the entry must be on ("" = any job). */
  jobNumber: string;
  /** Case-insensitive text the description must contain ("" = any description). */
  description: string;
  type: EntryType;
};

const TYPES = new Set<string>(ENTRY_TYPE_OPTIONS.map((o) => o.value));

export function parseTypeRules(json: string | null | undefined): TypeRule[] {
  if (!json) return [];
  try {
    const raw = JSON.parse(json);
    if (!Array.isArray(raw)) return [];
    return raw
      .map((r, i) => ({
        id: String(r?.id ?? "") || `r${i}`,
        jobNumber: String(r?.jobNumber ?? "").trim(),
        description: String(r?.description ?? "").trim(),
        type: String(r?.type ?? "") as EntryType,
      }))
      .filter((r) => (r.jobNumber || r.description) && TYPES.has(r.type));
  } catch {
    return [];
  }
}

/** The type the first matching rule assigns, or undefined when none matches. */
export function inferType(rules: TypeRule[], e: { jobNumber: string; description: string }): EntryType | undefined {
  const desc = (e.description ?? "").toLowerCase();
  for (const r of rules) {
    if (!r.jobNumber && !r.description) continue;
    if (r.jobNumber && r.jobNumber !== e.jobNumber) continue;
    if (r.description && !desc.includes(r.description.toLowerCase())) continue;
    return r.type;
  }
  return undefined;
}
