import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { parseTypeRules, type TypeRule } from "./type-rules-shared";

/** The saved type rules (read directly, so entries.ts needn't import report.ts, which imports it). */
export function getTypeRules(): TypeRule[] {
  const row = getDb()
    .select({ typeRules: schema.reportSettings.typeRules })
    .from(schema.reportSettings)
    .where(eq(schema.reportSettings.id, 1))
    .get();
  return parseTypeRules(row?.typeRules);
}
