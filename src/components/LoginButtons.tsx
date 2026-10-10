"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { checkAllLoginsAction, checkLoginAction, openServiceLoginAction } from "@/app/actions";
import type { ActionState } from "@/app/action-helpers";
import { toast } from "./Toaster";

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<ActionState>) =>
    start(async () => {
      const r = await fn();
      toast(r?.ok ? (r.message ?? "Done.") : (r?.error ?? "Didn't work."), { tone: r?.ok ? "ok" : "error" });
      router.refresh();
    });
  return [pending, act] as const;
}

/** A service's buttons: its sign-in page brought up in the automation Chrome (you sign in there), and a check. */
export function LoginButtons({ service, label, checkable }: { service: string; label: string; checkable: boolean }) {
  const [pending, act] = useAct();
  return (
    <div className="flex shrink-0 gap-2">
      {checkable && (
        <button type="button" className="btn btn-sm" disabled={pending} onClick={() => act(() => checkLoginAction(service))} title={`Asks ${label} in the automation Chrome whether you are signed in — opens nothing`}>
          {pending ? "…" : "Check"}
        </button>
      )}
      <button
        type="button"
        className="btn btn-sm btn-primary"
        disabled={pending}
        onClick={() => act(() => openServiceLoginAction(service))}
        title={`Brings ${label} to the front in the automation Chrome (opens it, starts Chrome if needed) — you sign in there yourself`}
      >
        Sign in
      </button>
    </div>
  );
}

/** Every checkable service checked in turn. */
export function CheckAllLoginsButton() {
  const [pending, act] = useAct();
  return (
    <button type="button" className="btn btn-sm" disabled={pending} onClick={() => act(checkAllLoginsAction)}>
      {pending ? "Checking…" : "Check all"}
    </button>
  );
}
