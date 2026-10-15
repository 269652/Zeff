"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { saveClaudeSessionSettingsAction } from "@/plugins/work/server-actions";
import type { ActionState } from "@/app/action-helpers";
import { CLAUDE_MODES, EFFORTS, type ClaudeMode, type ClaudeSessionSettings } from "@/lib/work/shared";
import { useT } from "../I18nProvider";
import { rich } from "@/lib/i18n/rich";
import { modeText } from "./mode-text";
import { SubmitButton } from "../SubmitButton";

/**
 * Live Claude sessions: on or off (one-shot runs as before), the mode your sessions start in and
 * the one Zeff's own runs start in (interactive or automatic), effort, whether Bypass may be
 * picked, and how long a run nobody watches waits for an answer.
 */
export function ClaudeSessionSettingsForm({ s, admin }: { s: ClaudeSessionSettings; /** The Admin sessions plugin is installed. */ admin: boolean }) {
  const t = useT();
  const [state, action, pending] = useActionState<ActionState, FormData>(saveClaudeSessionSettingsAction, null);
  const [bypass, setBypass] = useState(s.allowBypass);
  const modes = CLAUDE_MODES.filter((m) => m !== "bypassPermissions" || bypass);
  const select = (name: string, value: ClaudeMode, id: string) => (
    <select id={id} name={name} className="input" defaultValue={value}>
      {modes.map((m) => (
        <option key={m} value={m}>
          {modeText(t, m).label} — {modeText(t, m).hint}
        </option>
      ))}
    </select>
  );
  return (
    <form action={action} className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">{t("Claude sessions")}</h2>
        <p className="text-sm text-zinc-500">
          {t("Claude workers as live sessions, like Claude Code: you talk to them, they ask you (permissions, plans, questions) on the Code tab, you switch their mode any time. They keep running when Zeff restarts.")}
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="live" defaultChecked={s.live} />
        {t("Live sessions (off: one-shot runs that refuse what isn't allowed, as before)")}
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="cs-mode">
            {t("Your sessions start in")}
          </label>
          {select("mode", s.mode, "cs-mode")}
          <p className="mt-1 text-xs text-zinc-500">{t("Interactive: Ask or Plan. You can switch in the session.")}</p>
        </div>
        <div>
          <label className="label" htmlFor="cs-auto">
            {t("Runs Zeff starts on its own start in")}
          </label>
          {select("autoMode", s.autoMode, "cs-auto")}
          <p className="mt-1 text-xs text-zinc-500">{t("Automatic: Auto (asks only when it would block) or Don't ask (never asks).")}</p>
        </div>
        <div>
          <label className="label" htmlFor="cs-effort">
            {t("Effort")}
          </label>
          <select id="cs-effort" name="effort" className="input" defaultValue={s.effort}>
            {EFFORTS.map((e) => (
              <option key={e} value={e}>
                {e || t("The model's default")}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="cs-timeout">
            {t("A question in a run Zeff started: refused after (minutes, 0 = it waits)")}
          </label>
          <input id="cs-timeout" name="askTimeoutMin" type="number" min={0} max={1440} className="input" defaultValue={s.askTimeoutMin} />
        </div>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="allowBypass" checked={bypass} onChange={(e) => setBypass(e.target.checked)} className="mt-1" />
        <span>
          {t("Bypass may be picked — no permission checks at all.")}
          <span className="block text-xs text-zinc-500">{t("Only where nothing can go wrong: a worktree, a sandbox. Applies to sessions started from now on.")}</span>
        </span>
      </label>
      <p className="text-sm text-zinc-500">
        {admin
          ? rich(t("Sessions as administrator: <link>Admin sessions</link>."), { link: (s) => <Link href="/work/admin" className="text-indigo-600 hover:underline dark:text-indigo-400">{s}</Link> })
          : rich(t("Sessions as administrator (Windows) come with the “Admin sessions” plugin — <link>Plugins</link>."), {
              link: (s) => (
                <Link href="/plugins" className="text-indigo-600 hover:underline dark:text-indigo-400">
                  {s}
                </Link>
              ),
            })}
      </p>
      <div className="flex items-center gap-3">
        <SubmitButton pending={pending}>{t("Save")}</SubmitButton>
        {state && <span className={`text-sm ${state.ok ? "text-emerald-600" : "text-red-600"}`}>{state.ok ? (state.message ?? t("Saved.")) : state.error}</span>}
      </div>
    </form>
  );
}
