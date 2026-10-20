import type { WorkspaceSource } from "@/plugins/workspace/source-point";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { detectCases } from "./detect";
import { caseTitle } from "./shared";
import { listCases, sourcesOf } from "./store";

/**
 * Cases as a source of the Workspace's pipelines — one record per case, with the money and the next step as fields of fixed
 * id and type (what the Finances overview sums up and sorts by). The cases stay in the plugin's own tables; reading finds new
 * ones first.
 */

/** Fixed field ids: what a cases database's views, sums and the overviews rely on. */
export const CASE_FIELDS = { key: "casekey", party: "caseparty", person: "caseperson", total: "casetotal", open: "caseopen", installment: "caseinstallment", nextDue: "casenext", nextWhat: "casenextwhat", iban: "caseiban", sources: "casesources", last: "caselast" } as const;
const F = CASE_FIELDS;

export async function caseRecords() {
  detectCases();
  const names = new Map<number, string>();
  if (isInstalled("people")) for (const p of (await import("@/plugins/people/store")).listPeople()) names.set(p.id, p.name);
  return listCases().map((c) => {
    const s = c.compiled;
    // The row's page text: your note only — the summary is shown by the case's view at the top of the page (twice would repeat it).
    const text = c.note;
    return {
      ref: `case:${c.id}`,
      title: caseTitle(c),
      key: c.label,
      status: c.status === "closed" || s?.done ? { name: t("Closed"), group: "done" as const } : { name: t("Open"), group: "todo" as const },
      fields: {} as Record<string, string>,
      text,
      updatedAt: c.updatedAt,
      dataType: "cases" as const,
      typed: [
        { id: F.key, name: "Case number", type: "text" as const, value: c.label },
        { id: F.party, name: "Party", type: "text" as const, value: s?.party ?? "" },
        { id: F.person, name: "Person", type: "text" as const, value: c.personId ? (names.get(c.personId) ?? "") : "" },
        { id: F.total, name: "Total", type: "number" as const, value: s?.total ?? null },
        { id: F.open, name: "Open", type: "number" as const, value: s?.open ?? null },
        { id: F.installment, name: "Instalment", type: "number" as const, value: s?.installment ?? null },
        { id: F.nextDue, name: "Next due", type: "date" as const, value: s?.nextDue ?? null },
        { id: F.nextWhat, name: "Next", type: "text" as const, value: s?.nextWhat ?? "" },
        { id: F.iban, name: "IBAN", type: "text" as const, value: s?.iban ?? "" },
        { id: F.sources, name: "Sources", type: "number" as const, value: sourcesOf(c.id).length },
        { id: F.last, name: "Last activity", type: "date" as const, value: c.lastAt.slice(0, 10) },
      ],
    };
  });
}

export const CASES_SOURCE: WorkspaceSource = {
  id: "cases",
  label: "Cases",
  icon: "📁",
  dataType: "cases",
  hint: "Your cases — a row per case number (Aktenzeichen) with the party, the person, the money (total, open, instalment), the next payment or deadline and the account to pay to.",
  read: caseRecords,
  count: () => listCases().length,
  noNewRows: true,
};
