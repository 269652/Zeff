"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { checkAllLoginsAction, checkLoginAction, openServiceLoginAction, type ActionState } from "@/app/actions";
import { toast } from "./Toaster";

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<ActionState>) =>
    start(async () => {
      const r = await fn();
      toast(r?.ok ? (r.message ?? "Erledigt.") : (r?.error ?? "Ging nicht."), { tone: r?.ok ? "ok" : "error" });
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
        <button type="button" className="btn btn-sm" disabled={pending} onClick={() => act(() => checkLoginAction(service))} title={`Fragt ${label} im Automations-Chrome, ob du angemeldet bist — öffnet nichts`}>
          {pending ? "…" : "Prüfen"}
        </button>
      )}
      <button
        type="button"
        className="btn btn-sm btn-primary"
        disabled={pending}
        onClick={() => act(() => openServiceLoginAction(service))}
        title={`Holt ${label} im Automations-Chrome nach vorne (öffnet es, startet den Chrome wenn nötig) — anmelden tust du dich dort selbst`}
      >
        Anmelden
      </button>
    </div>
  );
}

/** Every checkable service checked in turn. */
export function CheckAllLoginsButton() {
  const [pending, act] = useAct();
  return (
    <button type="button" className="btn btn-sm" disabled={pending} onClick={() => act(checkAllLoginsAction)}>
      {pending ? "Prüft…" : "Alle prüfen"}
    </button>
  );
}
