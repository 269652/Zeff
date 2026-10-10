"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "@/components/Toaster";
import { setExtensionInstalledAction } from "@/plugins/extension-actions";

export type ExtensionRow = { id: string; name: string; description: string; origin: string; available: boolean; missing: string[]; chosen: boolean; installed: boolean; defaultInstalled: boolean };

/** A plugin's extensions (what other plugins bring it): each on or off — those still missing a plugin greyed, with what they need. */
export function PluginExtensions({ rows }: { rows: ExtensionRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!rows.length) return null;
  const toggle = (r: ExtensionRow, on: boolean) =>
    start(async () => {
      const res = await setExtensionInstalledAction(r.id, on);
      toast(res.ok ? (res.message ?? "") : (res.error ?? "Ging nicht."), { tone: res.ok ? "ok" : "error" });
      router.refresh();
    });
  return (
    <div className="space-y-1.5 border-t border-zinc-100 pt-2 dark:border-zinc-800">
      <p className="text-xs font-medium text-zinc-500">Erweiterungen</p>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.id} className={`flex items-start gap-2 text-sm ${r.available ? "" : "opacity-60"}`}>
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-indigo-600"
              checked={r.available ? r.installed : r.chosen}
              disabled={pending || !r.available}
              onChange={(e) => toggle(r, e.target.checked)}
              aria-label={r.name}
            />
            <span>
              <span className="font-medium">{r.name}</span> <span className="text-xs text-zinc-400">{r.origin}{r.defaultInstalled ? " · Standard" : ""}</span>
              <span className="block text-xs text-zinc-500">{r.description}</span>
              {!r.available && <span className="block text-xs text-amber-700 dark:text-amber-400">Erscheint, sobald installiert: {r.missing.join(", ")}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
