"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useT } from "@/components/I18nProvider";
import { formatDateTime } from "@/lib/format";
import type { ReplicaConflict } from "@/lib/replica/shared";
import { clearPhoneConflictsAction } from "./actions";

const show = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "string" ? (v.length > 200 ? `${v.slice(0, 200)} …` : v) : typeof v === "boolean" ? (v ? "✓" : "✗") : "…");

/**
 * Zeff on the go, seen from the PC: what was changed both here and on the phone while it was away — the later change
 * stayed; the one that didn't is listed, to put back by hand if it mattered.
 */
export function PhoneConflicts({ conflicts }: { conflicts: ReplicaConflict[] }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <section className="card space-y-3 p-4" aria-label={t("Conflicts with the phone")}>
      <h2 className="text-base font-semibold">{t("Conflicts with the phone")}</h2>
      <p className="text-sm text-zinc-500">{t("Changed here and on the phone while it was offline: the later change stayed. What didn't:")}</p>
      {!conflicts.length ? (
        <p className="text-sm text-zinc-500">{t("None.")}</p>
      ) : (
        <>
          <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
            {[...conflicts].reverse().map((c) => (
              <li key={`${c.id}-${c.field}`} className="space-y-0.5 px-3 py-2">
                <p>
                  <span className="font-medium">{c.label || c.key}</span> <span className="text-xs text-zinc-500">· {c.field} · {formatDateTime(c.at)}</span>
                </p>
                <p className="text-zinc-600 dark:text-zinc-400">{c.kept === "phone" ? t("The phone's change stayed — here it was “{lost}”.", { lost: show(c.lost) }) : t("This PC's later change stayed — the phone's was “{lost}”.", { lost: show(c.lost) })}</p>
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn-sm" disabled={pending} onClick={() => start(async () => (await clearPhoneConflictsAction(), router.refresh()))}>
            {t("Got it — clear the list")}
          </button>
        </>
      )}
    </section>
  );
}
