"use client";

import { FormError } from "@/components/FormError";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { removeTouchKeyAction, setTouchGuardAction } from "@/app/touch-actions";
import { useT } from "@/components/I18nProvider";
import { touchApprove, touchRegister } from "@/components/touch-client";

/** What the dropdown offers (the name is only for you, to tell keys apart). */
const KEY_NAMES = ["YubiKey 5 NFC", "YubiKey 5C NFC", "YubiKey 5C", "YubiKey 5Ci", "YubiKey 5 Nano", "YubiKey 5C Nano", "YubiKey Bio", "Security Key by Yubico"];
const OTHER = "__other";

export type TouchKeyView = { id: string; label: string; rpId: string; createdAt: string };

/** Settings → Touch to approve: the registered security keys, and which actions wait for a touch. */
export function TouchSettings({ keys, exportGuarded }: { keys: TouchKeyView[]; exportGuarded: boolean }) {
  const t = useT();
  const router = useRouter();
  const [choice, setChoice] = useState(KEY_NAMES[0]);
  const [custom, setCustom] = useState("");
  const label = choice === OTHER ? custom : choice;
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const hasKeys = keys.length > 0;

  /** Ask for the touch the settings need (when a key exists), then do the change. */
  const change = (run: () => Promise<{ ok: boolean; error?: string; message?: string } | null>) =>
    start(async () => {
      setError(null);
      setNote(null);
      const touch = hasKeys ? await touchApprove("touch-settings") : { ok: true as const };
      if (!touch.ok) return setError(touch.error);
      const r = await run();
      if (r && !r.ok) setError(r.error ?? t("Couldn't save."));
      else if (r?.message) setNote(r.message);
      router.refresh();
    });

  return (
    <div className="space-y-3">
      {hasKeys ? (
        <ul className="space-y-1 text-sm">
          {keys.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center gap-3">
              <span className="font-medium">{k.label}</span>
              <span className="text-zinc-500">
                {k.rpId} · {k.createdAt.slice(0, 10)}
              </span>
              <button type="button" className="btn btn-sm" disabled={pending} onClick={() => change(() => removeTouchKeyAction(k.id))}>
                {t("Remove")}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-zinc-500">{t("No security key registered yet.")}</p>
      )}

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            setError(null);
            setNote(null);
            const r = await touchRegister(label, hasKeys);
            if (!r.ok) setError(r.error);
            else {
              setCustom("");
              setNote(t("Key added."));
            }
            router.refresh();
          });
        }}
      >
        <select className="input w-auto" value={choice} onChange={(e) => setChoice(e.target.value)} aria-label={t("Name of the key")}>
          {KEY_NAMES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
          <option value={OTHER}>{t("Other…")}</option>
        </select>
        {choice === OTHER && <input className="input w-auto" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={t("Name of the key")} aria-label={t("Name of the key")} />}
        <button type="submit" className="btn btn-sm" disabled={pending}>
          {hasKeys ? t("Add another key") : t("Register a key")}
        </button>
        {pending && <span className="text-sm text-zinc-500">{t("Touch the key when it blinks…")}</span>}
      </form>

      <label className={`flex items-center gap-2 text-sm ${hasKeys ? "" : "opacity-60"}`}>
        <input type="checkbox" checked={exportGuarded} disabled={pending || !hasKeys} onChange={(e) => change(() => setTouchGuardAction(e.target.checked ? ["booking-export"] : []))} />
        {t("Ask for a touch before anything is filled into Chrono or Punch (dry runs never ask)")}
      </label>

      {note && <p className="text-sm text-emerald-700 dark:text-emerald-400">{note}</p>}
      {error && <FormError as="p">{error}</FormError>}
    </div>
  );
}
