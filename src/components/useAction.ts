"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";

type ActionResult = { ok: boolean; error?: string; message?: string } | null | undefined;

/**
 * Run a server action from a click: pending while it runs, a toast when it fails (or says
 * something), the page refreshed after. `run` resolves true when it worked.
 *
 *   quiet     messages not worth a toast: a list of them ("Saved."), or true for none
 *   done      the toast for a success that has no message of its own ("Done.")
 *   fallback  the toast for a failure that has no error of its own (default "That didn't work.")
 *   refresh   refresh the route afterwards (default yes)
 */
export function useAction<R extends ActionResult = ActionResult>({ quiet = [], done, fallback, refresh = true }: { quiet?: string[] | true; done?: string; fallback?: string; refresh?: boolean } = {}) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<R>, after?: (r: NonNullable<R>) => void): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      start(async () => {
        let r: ActionResult;
        try {
          r = await fn();
        } catch (e) {
          r = { ok: false, error: String((e as Error)?.message ?? e) };
        }
        if (!r?.ok) {
          const text = r?.error ?? fallback ?? t("That didn't work.");
          setError(text);
          toast(text, { tone: "error" });
        } else {
          setError(null);
          const text = r.message ?? done;
          if (text && quiet !== true && !quiet.includes(text)) toast(text, { tone: "ok" });
          after?.(r as NonNullable<R>);
        }
        if (refresh) router.refresh();
        resolve(!!r?.ok);
      });
    });
  return { run, pending, error };
}
