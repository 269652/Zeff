"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { automationKindsAction } from "../actions";
import type { AutomationKind } from "../automation-new";
import { Modal } from "./kit";

/**
 * The "+" menu's "Automation …": what can work for you — an agent's page, an automation's, the jobs for agents, the rules — each a
 * button with what it does. A click makes it (onPick), the dialog closes.
 */
export function AutomationChooser({ onPick, onClose }: { onPick: (key: string) => void; onClose: () => void }) {
  const t = useT();
  const [kinds, setKinds] = useState<AutomationKind[] | null>(null);
  useEffect(() => {
    void automationKindsAction().then((r) => setKinds(r.ok ? r.kinds : []));
  }, []);
  return (
    <Modal title={t("Automation")} onClose={onClose}>
      {!kinds ? (
        <p className="text-sm text-zinc-500">…</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {kinds.map((k) => (
            <li key={k.key}>
              <button type="button" className="flex h-full w-full items-start gap-2 rounded-lg border border-zinc-200 p-3 text-left hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900" onClick={() => (onClose(), onPick(k.key))}>
                <span className="text-xl" aria-hidden>
                  {k.icon}
                </span>
                <span>
                  <span className="block font-medium">{k.name}</span>
                  <span className="block text-xs text-zinc-500">{k.description}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
