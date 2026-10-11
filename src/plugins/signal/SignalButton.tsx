"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";

/**
 * A button on the Signal page running one of its server actions (start Signal, its autostart, a chat's
 * whole history) — its answer shown next to it and as a toast. Labels come translated from the page.
 */
export function SignalButton({ run, label, busy, title, primary = false }: { run: () => Promise<{ ok: boolean; error?: string; message?: string } | null>; label: string; busy: string; title?: string; primary?: boolean }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const click = () =>
    start(async () => {
      const r = await run();
      const text = r?.ok ? (r.message ?? t("Done.")) : (r?.error ?? t("That didn't work."));
      setResult(text);
      toast(text, { tone: r?.ok ? "ok" : "error" });
      router.refresh();
    });
  return (
    <span className="flex flex-wrap items-center gap-2">
      <button type="button" className={`btn btn-sm ${primary ? "btn-primary" : ""}`} disabled={pending} onClick={click} title={title}>
        {pending ? busy : label}
      </button>
      {result && !pending && <span className="text-xs text-zinc-500">{result}</span>}
    </span>
  );
}
