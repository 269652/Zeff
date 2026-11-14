"use client";

import { useState, useTransition } from "react";
import { saveExtPluginSettingsAction } from "@/lib/ext/actions";
import { useT } from "@/components/I18nProvider";

export type ExtSettingView = { key: string; label: string; kind: "text" | "secret" | "number" | "checkbox" | "select"; help: string; required: boolean; options?: string[]; value: string | number | boolean | null; isSet: boolean };

/** An external plugin's settings (lib/ext/plugin-settings.ts): a secret is never shown again — only whether one is set; empty keeps it. */
export function ExtSettings({ id, settings }: { id: string; settings: ExtSettingView[] }) {
  const t = useT();
  const [values, setValues] = useState<Record<string, unknown>>(() => Object.fromEntries(settings.filter((s) => s.kind !== "secret").map((s) => [s.key, s.value ?? (s.kind === "checkbox" ? false : "")])));
  const [clear, setClear] = useState<string[]>([]);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const set = (k: string, v: unknown) => setValues((x) => ({ ...x, [k]: v }));
  return (
    <details className="border-t border-zinc-100 pt-2 text-sm dark:border-zinc-800">
      <summary className="cursor-pointer text-xs font-medium text-zinc-600 dark:text-zinc-300">
        ⚙️ {t("Settings")}
        {settings.some((s) => s.required && !s.isSet && (s.value === null || s.value === "")) && <span className="ml-1 text-amber-700 dark:text-amber-400">· {t("needs setting up")}</span>}
      </summary>
      <form
        className="mt-2 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await saveExtPluginSettingsAction(id, values, clear);
            setSaid(r.ok ? (r.message ?? t("Saved.")) : (r.error ?? ""));
            if (r.ok) setClear([]);
          });
        }}
      >
        {settings.map((s) => (
          <label key={s.key} className="block space-y-0.5">
            <span className="text-xs font-medium">
              {s.label}
              {s.required ? " *" : ""}
            </span>
            {s.kind === "checkbox" ? (
              <input type="checkbox" className="ml-2 align-middle" checked={!!values[s.key]} onChange={(e) => set(s.key, e.target.checked)} />
            ) : s.kind === "select" ? (
              <select className="input w-full" value={String(values[s.key] ?? "")} onChange={(e) => set(s.key, e.target.value)}>
                <option value="">—</option>
                {(s.options ?? []).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="input w-full"
                type={s.kind === "secret" ? "password" : s.kind === "number" ? "number" : "text"}
                autoComplete="off"
                placeholder={s.kind === "secret" && s.isSet && !clear.includes(s.key) ? t("set — leave empty to keep it") : ""}
                value={String(values[s.key] ?? "")}
                onChange={(e) => set(s.key, e.target.value)}
              />
            )}
            {s.kind === "secret" && s.isSet && !clear.includes(s.key) && (
              <button type="button" className="text-xs text-red-600 hover:underline dark:text-red-400" onClick={() => setClear((c) => [...c, s.key])}>
                {t("Remove")}
              </button>
            )}
            {s.help && <span className="block text-xs text-zinc-500">{s.help}</span>}
          </label>
        ))}
        <div className="flex items-center gap-2">
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
            {t("Save")}
          </button>
          {said && <span className="text-xs text-zinc-500">{said}</span>}
        </div>
      </form>
    </details>
  );
}
