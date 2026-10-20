import { getPref, setPref } from "@/lib/prefs";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";

/**
 * The database "Cases" ("Vorgänge") of the Workspace: one row per case, its page the case's view (CaseView). Made once
 * (a gone one isn't made again), its rows read from the plugin's tables by the pipeline.
 */

const CASES = "workspace.casesDb";

/** The cases database — null: not made, or gone. */
export async function casesDatabase(): Promise<number | null> {
  const id = getPref<number | null>(CASES, null);
  if (!id) return null;
  const { getDatabase } = await import("@/plugins/workspace/store");
  const d = getDatabase(id);
  return d && !d.page.archivedAt ? id : null;
}

/** Your cases as a database of the Workspace — once, while Cases is installed. Its rows get the case's view. */
export async function ensureCasesDatabase(): Promise<void> {
  if (!isInstalled("workspace") || !isInstalled("cases")) return;
  if (await casesDatabase()) return void (await import("@/plugins/workspace/row-views")).ensureRowViews();
  if (getPref<number | null>(CASES, null) !== null) return;
  const { createExtSourceDatabase } = await import("@/plugins/workspace/derived");
  const id = await createExtSourceDatabase("cases", t("Cases"));
  setPref(CASES, id);
  const { runPipeline } = await import("@/plugins/workspace/pipeline");
  await runPipeline(id, { ai: false });
  (await import("@/plugins/workspace/row-views")).ensureRowViews();
}

/** Where a case's page is: its row in the cases database — the database without one, the Workspace without a database. */
export async function caseHref(caseId: number): Promise<string> {
  const db = await casesDatabase();
  if (!db) return "/workspace";
  const { rawRows } = await import("@/plugins/workspace/store");
  const row = rawRows(db).find((r) => r.cells.srcref === `case:${caseId}`);
  return row ? `/workspace/${row.id}` : `/workspace/${db}`;
}

/** The case a row of the cases database stands for (a row of a database made from it: the row it was made from). */
export async function caseOfRow(rowId: number, depth = 0): Promise<number | null> {
  const { getSqlite } = await import("@/db");
  const row = getSqlite().prepare("select props from ws_pages where id = ?").get(rowId) as { props: string } | undefined;
  if (!row || depth > 6) return null;
  try {
    const ref = String((JSON.parse(row.props) as Record<string, unknown>).srcref ?? "");
    const m = /^case:(\d+)$/.exec(ref);
    if (m) return Number(m[1]);
    const from = /^page:(\d+)$/.exec(ref);
    return from ? caseOfRow(Number(from[1]), depth + 1) : null;
  } catch {
    return null;
  }
}
