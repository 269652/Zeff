"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { setBoundaryLabelAction } from "./actions";

/** A row's label in the Data boundaries matrix: open, personal, secret — or "default" (what it would be without yours). */
export function LabelPicker({ kind, rowKey, label, own, name }: { kind: "source" | "database"; rowKey: string; label: string; own: boolean; name: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const set = (v: string) =>
    start(async () => {
      const r = await setBoundaryLabelAction(kind, rowKey, v === "" ? null : v);
      if (!r.ok) toast(r.error, { tone: "error" });
      router.refresh();
    });
  return (
    <select className="input w-auto py-0.5 text-sm" value={own ? label : ""} disabled={pending} aria-label={t("Sensitivity of {name}", { name })} onChange={(e) => set(e.target.value)}>
      <option value="">{t("Default ({label})", { label: label === "open" ? t("Open") : label === "personal" ? t("Personal") : t("Secret") })}</option>
      <option value="open">{t("Open")}</option>
      <option value="personal">🔒 {t("Personal")}</option>
      <option value="secret">🔒 {t("Secret")}</option>
    </select>
  );
}
