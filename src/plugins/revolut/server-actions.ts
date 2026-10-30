"use server";

import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { localDay } from "@/lib/dates";

/** A statement (CSV) read: its bookings kept in the cases' bank, the payments matched, the late instalments warned of. */
export async function importStatementAction(csv: string, fileName: string): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  try {
    if (!isInstalled("revolut")) throw new Error(t("The Revolut plugin is not installed (Menu → Plugins)."));
    const { importStatement, accountOf } = await import("./statement");
    const text = String(csv ?? "");
    const r = importStatement(text, accountOf(String(fileName ?? ""), text));
    const bank = await import("@/plugins/cases/bank");
    const m = bank.matchPayments();
    const w = bank.overdueWarnings(localDay());
    // The knowledge reads the new months (and your income in them) — synced and compiled in the background.
    if (r.added && isInstalled("knowledge")) void import("@/plugins/knowledge/client").then((k) => k.knowledgeSync()).catch(() => {});
    return { ok: true, message: t("{added} new bookings of {total} — {matched} payments matched, {warned} warnings", { added: r.added, total: r.total, matched: m.matched, warned: w }) };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}
