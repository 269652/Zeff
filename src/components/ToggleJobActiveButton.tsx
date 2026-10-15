"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toggleJobActiveAction } from "@/app/actions";
import { useT } from "@/components/I18nProvider";
import { toast } from "./Toaster";

/** Deactivate / Activate a job; a toast says what happened and offers to flip it back. */
export function ToggleJobActiveButton({ id, active, number }: { id: number; active: boolean; number: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const flip = (to: boolean, undo: boolean) =>
    start(async () => {
      const fd = new FormData();
      fd.set("id", String(id));
      fd.set("active", to ? "true" : "false");
      await toggleJobActiveAction(fd);
      if (!undo) {
        toast(to ? t("Job {number} activated.", { number }) : t("Job {number} deactivated.", { number }), {
          ms: 12000,
          action: { label: t("Undo"), run: () => flip(!to, true) },
        });
      }
      router.refresh();
    });
  return (
    <button type="button" className="btn btn-sm" disabled={pending} onClick={() => flip(!active, false)}>
      {pending ? "…" : active ? t("Deactivate") : t("Activate")}
    </button>
  );
}
