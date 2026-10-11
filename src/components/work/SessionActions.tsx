"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { cancelWorkAction, startSessionAction } from "@/plugins/work/server-actions";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";

/** A session's stop button (queued or at work). */
export function StopSessionButton({ runId }: { runId: number }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn btn-sm btn-danger"
      disabled={pending}
      onClick={() =>
        confirm(t("Cancel the session?")) &&
        start(async () => {
          const r = await cancelWorkAction(runId);
          if (!r?.ok) toast(r?.error ?? t("Didn't work."), { tone: "error" });
          router.refresh();
        })
      }
    >
      {t("Cancel")}
    </button>
  );
}

/** A todo handed to a worker as it is (its brief) — a session of its own. */
export function TodoSessionButton({ todoId }: { todoId: number }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn btn-sm shrink-0"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await startSessionAction({ instruction: "", todoId });
          if (!r.ok) return void toast(r.error, { tone: "error" });
          router.push(`/work?run=${r.runId}`);
        })
      }
      title={t("A worker takes over this todo (in a session of its own)")}
    >
      {pending ? t("starting…") : t("Session")}
    </button>
  );
}
