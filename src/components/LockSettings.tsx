"use client";

import { FormError } from "@/components/FormError";
import { useT } from "@/components/I18nProvider";
import { lockEnable, lockStep } from "@/components/lock-client";
import { useAction } from "@/components/useAction";

/** Settings → Lock: switch the lock on (the key's PIN and a touch), lock now, switch it off. */
export function LockSettings({ enabled, hasKeys }: { enabled: boolean; hasKeys: boolean }) {
  const t = useT();
  // (A failure shows under the buttons, not as a toast.)
  const { run: act, pending, error } = useAction<{ ok: true } | { ok: false; error: string }>({ quiet: true, toastErrors: false });
  const run = (go: () => Promise<{ ok: true } | { ok: false; error: string }>) => void act(go);

  const lockNow = () =>
    run(async () => {
      const r = await lockStep("lock-now");
      if (r.ok) location.reload();
      return r;
    });

  return (
    <div className="space-y-3">
      {enabled ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-medium text-emerald-700 dark:text-emerald-400">{t("The lock is on.")}</span>
          <button type="button" className="btn btn-sm" disabled={pending} onClick={lockNow}>
            {t("Lock now")}
          </button>
          <button type="button" className="btn btn-sm" disabled={pending} onClick={() => run(() => lockStep("disable"))}>
            {t("Switch the lock off")}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button type="button" className="btn btn-sm" disabled={pending || !hasKeys} onClick={() => run(lockEnable)}>
            {t("Switch the lock on")}
          </button>
          {!hasKeys && <span className="text-zinc-500">{t("Register a security key first (above).")}</span>}
          {pending && <span className="text-zinc-500">{t("Enter the PIN and touch the key when it blinks…")}</span>}
        </div>
      )}
      {error && <FormError as="p">{error}</FormError>}
    </div>
  );
}
