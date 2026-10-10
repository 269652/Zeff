"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { cancelWorkAction, startSessionAction } from "@/plugins/work/server-actions";
import { toast } from "@/components/Toaster";

/** A session's stop button (queued or at work). */
export function StopSessionButton({ runId }: { runId: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn btn-sm btn-danger"
      disabled={pending}
      onClick={() =>
        confirm("Session abbrechen?") &&
        start(async () => {
          const r = await cancelWorkAction(runId);
          if (!r?.ok) toast(r?.error ?? "Ging nicht.", { tone: "error" });
          router.refresh();
        })
      }
    >
      Abbrechen
    </button>
  );
}

/** A todo handed to a worker as it is (its brief) — a session of its own. */
export function TodoSessionButton({ todoId }: { todoId: number }) {
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
      title="Ein Worker übernimmt dieses Todo (in einer eigenen Session)"
    >
      {pending ? "startet …" : "Session"}
    </button>
  );
}
