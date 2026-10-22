import type { WorkspaceSource } from "@/plugins/workspace/source-point";
import { CONTRACT } from "@/plugins/workspace/contract-fields";
import { DEBT } from "./fields";

/**
 * The cases' debts as a source of the Workspace's pipelines (the Finances plugin): a case with money open is a row of the debts
 * database, its figures what its letters say (locked there). Loaded lazily — registering it pulls nothing in.
 */
export const DEBTS_SOURCE: WorkspaceSource = {
  id: "debts",
  label: "Debts",
  icon: "💶",
  dataType: "debts",
  hint: "The cases with money open as debts — creditor, who collects it, total, open, instalment, due day. Rows of your own go beside them.",
  read: async () => (await import("./database")).debtRecords(),
  // What the letters say: not changed by hand on the rows the cases bring (your own rows are yours).
  lockedFields: Object.values(DEBT),
};

/**
 * The recurring payments of your statements as a source (the Finances plugin): a contract or subscription each — what it costs
 * a payment and a month, its rhythm, when last paid and next. Its figures are the bank's (locked); a contracts database follows it.
 */
export const RECURRING_SOURCE: WorkspaceSource = {
  id: "recurring",
  label: "Recurring payments",
  icon: "🔁",
  hint: "What goes out regularly to the same recipient — contracts and subscriptions read off your bank statements.",
  read: async () => (await import("./recurring-source")).recurringRecords(),
  lockedFields: Object.values(CONTRACT),
};
