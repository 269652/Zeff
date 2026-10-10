"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { knowledgeSyncAction } from "@/app/actions";
import { toast } from "@/components/Toaster";

/** Read the sources now (and compile what's new) — on the knowledge server, in the background. */
export function KnowledgeSyncButton({ busy }: { busy: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      className="btn btn-sm"
      disabled={pending || busy}
      onClick={() =>
        start(async () => {
          const r = await knowledgeSyncAction();
          toast(r?.ok ? (r.message ?? "Läuft.") : (r?.error ?? "Ging nicht."), { tone: r?.ok ? "ok" : "error" });
          router.refresh();
        })
      }
    >
      {busy ? "läuft …" : "Quellen jetzt lesen"}
    </button>
  );
}
