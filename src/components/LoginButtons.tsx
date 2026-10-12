"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { checkAllLoginsAction, checkLoginAction, openAllSignInsAction, openServiceLoginAction } from "@/app/actions";
import type { ActionState } from "@/app/action-helpers";
import { toast } from "./Toaster";
import { useT } from "./I18nProvider";

function useAct() {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<ActionState>) =>
    start(async () => {
      const r = await fn();
      toast(r?.ok ? (r.message ?? t("Done.")) : (r?.error ?? t("Didn't work.")), { tone: r?.ok ? "ok" : "error" });
      router.refresh();
    });
  return [pending, act] as const;
}

/** A service's buttons: its sign-in page brought up in the automation Chrome (you sign in there), and a check. */
export function LoginButtons({ service, label, checkable }: { service: string; label: string; checkable: boolean }) {
  const t = useT();
  const [pending, act] = useAct();
  return (
    <div className="flex shrink-0 gap-2">
      {checkable && (
        <button type="button" className="btn btn-sm" disabled={pending} onClick={() => act(() => checkLoginAction(service))} title={t("Asks {service} in the automation Chrome whether you are signed in — opens nothing", { service: label })}>
          {pending ? "…" : t("Check")}
        </button>
      )}
      <button
        type="button"
        className="btn btn-sm btn-primary"
        disabled={pending}
        onClick={() => act(() => openServiceLoginAction(service))}
        title={t("Brings {service} to the front in the automation Chrome (opens it, starts Chrome if needed) — you sign in there yourself", { service: label })}
      >
        {t("Sign in")}
      </button>
    </div>
  );
}

/** A tab per service that isn't signed in yet, in the automation Chrome — the setup's way to show all the login pages at once. */
export function OpenAllSignInsButton() {
  const t = useT();
  const [pending, act] = useAct();
  return (
    <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={() => act(openAllSignInsAction)} title={t("Opens the sign-in page of every service that isn't signed in yet, each in its own tab — you sign in yourself")}>
      {pending ? t("Opening …") : t("Open all sign-in pages")}
    </button>
  );
}

/** Every checkable service checked in turn. */
export function CheckAllLoginsButton() {
  const t = useT();
  const [pending, act] = useAct();
  return (
    <button type="button" className="btn btn-sm" disabled={pending} onClick={() => act(checkAllLoginsAction)}>
      {pending ? t("Checking…") : t("Check all")}
    </button>
  );
}

/** Checks every checkable service once when the step is opened (so the list shows who is signed in, not "unknown"). */
export function AutoCheckLogins() {
  const t = useT();
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    let skip = false;
    try {
      skip = sessionStorage.getItem("zeff-logins-autochecked") === "1";
      sessionStorage.setItem("zeff-logins-autochecked", "1");
    } catch {
      // checked every time, then
    }
    if (skip) return;
    setChecking(true);
    void checkAllLoginsAction().finally(() => {
      setChecking(false);
      router.refresh();
    });
  }, [router]);
  return checking ? <p className="text-xs text-zinc-500">{t("Checking who is signed in …")}</p> : null;
}
