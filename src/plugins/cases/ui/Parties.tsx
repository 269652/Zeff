"use client";

import Link from "next/link";
import { useT } from "@/components/I18nProvider";
import type { CaseBundle, CaseOperation } from "../blocks";
import { ContactField } from "./ContactField";

/**
 * Who a case is with: its creditor, who collects it, who is paid — each a contact (its page a click away), chosen from your
 * contacts or made new (a person or an organisation). And, for a debt of your own, its money to change.
 */

const ROLES = ["creditor", "collector", "payee"] as const;

export function PartiesCard({ d, run }: { d: CaseBundle; run: (op: CaseOperation) => Promise<void> }) {
  const t = useT();
  const labels: Record<(typeof ROLES)[number], { label: string; hint: string }> = {
    creditor: { label: t("Creditor"), hint: t("Who it is owed to") },
    collector: { label: t("Collected by"), hint: t("Bailiff, collection agency, lawyer") },
    payee: { label: t("Paid to"), hint: t("Whose account you pay to") },
  };
  return (
    <dl className="space-y-3">
      {ROLES.map((role) => {
        const p = d.parties[role];
        return (
          <div key={role} className="space-y-1">
            <dt className="flex items-baseline justify-between gap-2 text-xs text-zinc-500">
              <span title={labels[role].hint}>{labels[role].label}</span>
              {p && (
                <Link href={p.href} className="truncate text-zinc-600 hover:underline dark:text-zinc-300" title={p.source === "ai" ? t("As the AI read it from the case") : t("Chosen by you")}>
                  {p.name} →
                </Link>
              )}
            </dt>
            <dd>
              <ContactField contacts={d.people} value={p?.personId ?? null} label={labels[role].label} placeholder={labels[role].hint} onPick={(id) => void run({ op: "party", role, personId: id })} onNew={(name, kind) => void run({ op: "newParty", role, name, kind })} />
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
