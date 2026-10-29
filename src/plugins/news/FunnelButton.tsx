"use client";

import { useTransition } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { newsFunnelAction } from "./server-actions";

/** "Let the agent look now": a round of the funnel in the background; what it lets through comes in as "N new". */
export function FunnelButton({ className = "" }: { className?: string }) {
  const t = useT();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={`btn btn-sm ${className}`}
      disabled={pending}
      title={t("The agent reads the best new headlines it hasn't seen yet now, instead of after the next fetch")}
      onClick={() =>
        start(async () => {
          const r = await newsFunnelAction();
          toast(r.ok ? (r.message ?? t("Done.")) : (r.error ?? t("Didn't work.")), r.ok ? {} : { tone: "error" });
        })
      }
    >
      🔎 {t("Let the agent look now")}
    </button>
  );
}
