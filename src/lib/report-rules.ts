import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { parseRules, type ReportRule } from "./report-shared";

/**
 * The saved report rules as stored — [] while the legacy settings are in use, which carry
 * no tags. Read directly, so entries.ts needn't import report.ts (which imports it).
 */
export function getStoredReportRules(): ReportRule[] {
  const row = getDb()
    .select({ rules: schema.reportSettings.rules })
    .from(schema.reportSettings)
    .where(eq(schema.reportSettings.id, 1))
    .get();
  return parseRules(row?.rules);
}
