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
        confirm("Cancel the session?") &&
        start(async () => {
          const r = await cancelWorkAction(runId);
          if (!r?.ok) toast(r?.error ?? "Didn't work.", { tone: "error" });
          router.refresh();
        })
      }
    >
      Cancel
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
      title="A worker takes over this todo (in a session of its own)"
    >
      {pending ? "starting…" : "Session"}
    </button>
  );
}
