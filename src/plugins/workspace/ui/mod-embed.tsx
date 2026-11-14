"use client";

import { useState } from "react";
import { confirmAction } from "@/components/confirm";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { setModEnabledAction } from "@/lib/mods/actions";
import type { ModEmbed } from "../chat-embed";

/**
 * A mod the assistant wrote, under its answer (ChatPanel.tsx): what it changes, and "Switch on and try" right here — no trip to the Mods
 * page. Switching it on is your approval (a mod runs with Zeff's rights); the page loads again so the change shows. Not what you wanted:
 * "Undo what this answer changed" under the answer takes it back (a new mod is moved aside, a changed one goes back to its version before).
 */
export function ModEmbedCard({ embed, onOn }: { embed: ModEmbed; onOn?: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [on, setOn] = useState(false);
  return (
    <div className="space-y-1.5 rounded-lg border border-violet-200 p-2 text-xs dark:border-violet-900/60">
      <div className="flex items-start gap-2">
        <span aria-hidden>🧩</span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {embed.name} <span className="font-normal text-zinc-400">· {embed.isNew ? t("new mod") : t("mod changed")}</span>
          </p>
          {embed.description && <p className="text-zinc-600 dark:text-zinc-300">{embed.description}</p>}
          <p className="text-zinc-400">{embed.accounts?.length ? t("Only in this account") : t("In every account")}</p>
        </div>
      </div>
      {embed.problems.length > 0 ? (
        <p className="text-red-600 dark:text-red-400">{t("It doesn't build: {p}", { p: embed.problems.join("; ") })}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy || on}
            onClick={async () => {
              if (!confirmAction(t("Switch on “{name}”? A mod changes Zeff itself and runs with Zeff's rights. The page loads again to show it; “Undo what this answer changed” takes it back.", { name: embed.name }))) return;
              setBusy(true);
              const r = await setModEnabledAction(embed.id, true);
              setBusy(false);
              if (!r.ok) return void toast(r.error, { tone: "error", ms: 12000 });
              setOn(true);
              onOn?.();
              toast(t("Switched on — loading the page again …"), { tone: "ok" });
              // (A browser part takes effect with the page loaded again.)
              setTimeout(() => window.location.reload(), 500);
            }}
          >
            {busy ? "…" : on ? t("on") : t("Switch on and try")}
          </button>
          <a className="text-zinc-500 hover:underline" href={embed.href}>
            {"</>"} {t("Code and settings")}
          </a>
        </div>
      )}
    </div>
  );
}
