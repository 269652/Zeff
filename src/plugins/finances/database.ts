import { getPref, setPref } from "@/lib/prefs";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import type { SourceRecord } from "@/plugins/workspace/pipeline";
import type { DbSchema, Property } from "@/plugins/workspace/model";
import { caseStanding } from "@/plugins/cases/bank";
import { partiesOf } from "@/plugins/cases/parties";
import { caseTitle } from "@/plugins/cases/shared";
import { listCases, setCaseStatus } from "@/plugins/cases/store";

/**
 * Your debts — and what others owe you — as a database of the Workspace, apart from the cases: a row each, its direction (you
 * owe it, or it is owed to you), the other side (the creditor, or who owes you) and who collects
 * it (contacts), the whole claim, what is open, the instalment, the due day and the plan's day of the month (the Finances
 * plugin). Rows of your own
 * (a loan from Chris, a credit card) you write and change yourself; the debts the cases hold (a case with money open — what its
 * letters say) come as rows by the cases' source, their figures the letters' (locked). Made once. Server only.
 */

const PREF = "workspace.debtsDb";

export { DEBT } from "./fields";
import { DEBT } from "./fields";

const euro = { type: "number" as const, format: "euro" as const };

/** The debts database's fields — a new database has them from the start (for rows of your own). */
function properties(): Property[] {
  return [
    { id: DEBT.dir, name: t("Direction"), type: "select", options: [{ id: "owe", name: t("I owe"), color: "red" }, { id: "owed", name: t("Owed to me"), color: "green" }] },
    { id: DEBT.creditor, name: t("Other side"), type: "person" },
    { id: DEBT.collector, name: t("Collected by"), type: "person" },
    { id: DEBT.total, name: t("Total"), ...euro },
    { id: DEBT.open, name: t("Open"), ...euro },
    { id: DEBT.rate, name: t("Instalment"), ...euro },
    { id: DEBT.due, name: t("Next due"), type: "date" },
    { id: DEBT.day, name: t("Plan's day"), type: "number", format: "number" },
    { id: DEBT.case, name: t("Case number"), type: "text" },
    { id: DEBT.next, name: t("Next"), type: "text" },
    { id: DEBT.claim, name: t("From promise"), type: "number", format: "number" },
  ];
}

/** The cases with money open as debts — what their letters say (the bank's payments counted). */
export function debtRecords(): SourceRecord[] {
  return listCases()
    .filter((c) => c.status === "open" && c.compiled && !c.compiled.manual && !c.compiled.done)
    .flatMap((c) => {
      const s = c.compiled!;
      const open = caseStanding(c.id).open ?? s.open;
      if (open == null || open <= 0) return [];
      const p = partiesOf(c.id);
      return [
        {
          ref: `case:${c.id}`,
          title: caseTitle(c),
          fields: {},
          updatedAt: c.updatedAt,
          dataType: "debts" as const,
          typed: [
            { id: DEBT.dir, name: "Direction", type: "select" as const, value: t("I owe") },
            { id: DEBT.creditor, name: "Other side", type: "person" as const, value: p.creditor ? [p.creditor.personId] : c.personId ? [c.personId] : [] },
            { id: DEBT.collector, name: "Collected by", type: "person" as const, value: p.collector ? [p.collector.personId] : [] },
            { id: DEBT.total, name: "Total", type: "number" as const, format: "euro" as const, value: s.total },
            { id: DEBT.open, name: "Open", type: "number" as const, format: "euro" as const, value: open },
            { id: DEBT.rate, name: "Instalment", type: "number" as const, format: "euro" as const, value: s.installment },
            { id: DEBT.due, name: "Next due", type: "date" as const, value: s.nextDue },
            { id: DEBT.day, name: "Plan's day", type: "number" as const, value: s.installmentDay ?? null },
            { id: DEBT.case, name: "Case number", type: "text" as const, value: c.label },
            { id: DEBT.next, name: "Next", type: "text" as const, value: s.nextWhat },
          ],
        },
      ];
    });
}


/** The debts database — null: not made, or gone. */
export async function debtsDatabase(): Promise<number | null> {
  const id = getPref<number | null>(PREF, null);
  if (!id) return null;
  const { getDatabase } = await import("@/plugins/workspace/store");
  const d = getDatabase(id);
  return d && !d.page.archivedAt ? id : null;
}

/**
 * The debts database — made once (a gone one isn't made again), with your own debts written down in the cases before ("MAN-…")
 * moved into it as rows (the cases set aside, not deleted). Its id (null: no Workspace).
 */
export async function ensureDebtsDatabase(): Promise<number | null> {
  if (!isInstalled("workspace") || !isInstalled("finances")) return null;
  let id = await debtsDatabase();
  const made = !id;
  if (!id) {
    if (getPref<number | null>(PREF, null) !== null) return null;
    const { createPage, updatePage } = await import("@/plugins/workspace/store");
    const { newView } = await import("@/plugins/workspace/model");
    const schema: DbSchema = {
      titleName: t("What for"),
      properties: properties(),
      views: [{ ...newView(t("Overview"), "table"), type: "app", app: "debts" }, { ...newView(t("Table"), "table"), hidden: [DEBT.claim] }],
      dataType: "debts",
      personProp: DEBT.creditor,
      pipeline: { steps: [{ id: "sdebts", kind: "source", from: "ext", ext: "debts" }], everyMinutes: 60 },
    };
    id = createPage({ kind: "database", title: t("Debts and claims"), icon: "💶", schema });
    updatePage(id, { fullWidth: true });
    setPref(PREF, id);
  }
  const moved = await moveOwnDebts(id);
  // Read the cases' debts in when it is new (else its pipeline runs on its own, every hour and after a change).
  if (made || moved) await (await import("@/plugins/workspace/pipeline")).runPipeline(id, { ai: false });
  return id;
}

/** Your own debts kept as cases before (no case number, "MAN-…"): rows of the debts database now — the cases set aside. */
async function moveOwnDebts(dbId: number): Promise<number> {
  const own = listCases().filter((c) => c.compiled?.manual);
  if (!own.length) return 0;
  const { addRow } = await import("@/plugins/workspace/store");
  for (const c of own) {
    const s = c.compiled!;
    const p = partiesOf(c.id);
    const creditor = p.creditor?.personId ?? c.personId;
    addRow(dbId, {
      title: s.title,
      cells: {
        [DEBT.dir]: "owe",
        ...(creditor ? { [DEBT.creditor]: [creditor] } : {}),
        [DEBT.total]: s.total,
        [DEBT.open]: s.open,
        [DEBT.rate]: s.installment,
        [DEBT.due]: s.nextDue,
        ...(s.installmentDay ? { [DEBT.day]: s.installmentDay } : {}),
        ...(s.fromClaim ? { [DEBT.claim]: s.fromClaim } : {}),
      },
    });
    // Set aside, not deleted: it can come back if anything went wrong.
    setCaseStatus(c.id, "ignored");
  }
  return own.length;
}
