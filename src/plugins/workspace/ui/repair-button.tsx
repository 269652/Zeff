"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { askWorkspace } from "./chat-client";

/**
 * "Repair with the AI" for a part that went wrong — a flow, a plugin's function, an installed app. The Workspace assistant gets what is
 * wrong and how to find it (the tools to read, try and save it; the versions to go back to when a change broke it), works it through,
 * and says what it did. Nothing happens by itself: it is a click, as for a view's template and a widget.
 */
export function RepairButton({ request, pageId, label, className, onDone }: { request: string; pageId?: number; label?: string; className?: string; onDone?: () => void }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={className ?? "btn btn-sm"}
      disabled={busy}
      title={t("The Workspace assistant looks for what is wrong, repairs it and tells you what it did")}
      onClick={async () => {
        setBusy(true);
        toast(t("The AI is on it …"), { ms: 5000 });
        const r = await askWorkspace([{ role: "user", text: request }], pageId);
        setBusy(false);
        toast(r.ok ? r.reply || t("Done.") : r.error, { tone: r.ok ? "ok" : "error", ms: 15000 });
        if (!r.ok) return;
        if (onDone) onDone();
        else router.refresh();
      }}
    >
      {busy ? t("The AI is on it …") : `🩹 ${label ?? t("Repair with the AI")}`}
    </button>
  );
}
