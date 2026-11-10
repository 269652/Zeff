"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { reserveLessonWorkerAction } from "@/app/learn/actions";

/**
 * The lesson waits for a worker (all of them taken): one more, on top of the others and reserved for Learn's lessons —
 * the waiting message starts on it now, and later lessons have it too (Settings → Code, "Reserved for Learn").
 */
export function ExtraWorkerButton() {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const click = () =>
    start(async () => {
      const r = await reserveLessonWorkerAction();
      if (!r.ok) return void toast(r.error, { tone: "error" });
      toast(t("{n} workers reserved for Learn — the lesson starts.", { n: r.reserved }), { tone: "ok" });
      router.refresh();
    });
  return (
    <button
      type="button"
      className="btn btn-sm btn-primary"
      disabled={pending}
      onClick={click}
      title={t("Starts one more worker on top of the others and keeps it reserved for Learn: this lesson starts now, and lessons no longer wait for Code's workers. Change or take it back in Settings → Code (Reserved for Learn).")}
    >
      {pending ? t("Starting …") : t("Start an extra worker for Learn")}
    </button>
  );
}
