"use client";

import Link from "next/link";
import { useActionState } from "react";
import { saveWorkSettingsAction } from "@/plugins/work/server-actions";
import type { ActionState } from "@/app/action-helpers";
import { COPILOT_MODES, copilotModeLabels, PERMISSION_MODES, permissionModeInfo, type WorkSettingsView } from "@/lib/work/shared";
import { SubmitButton } from "../SubmitButton";
import { useT } from "@/components/I18nProvider";

/**
 * The workers: how many at once, what they may do (Claude Code's permission mode), where code
 * work happens (a worktree of its own, or the checkout), the model, a cost cap per run, and house
 * rules for every worker. Which repo a ticket's work goes to is set on the Repos page.
 */
export function WorkSettingsForm({
  s,
  repos,
  defaultModel,
  models,
  provider,
}: {
  s: WorkSettingsView;
  repos: { name: string; ok: boolean }[];
  /** The Settings provider's model ("" = its CLI's default) — preselected, unless the Work tab picked another. */
  defaultModel: string;
  models: { value: string; label: string }[];
  provider: "claude" | "copilot";
}) {
  const t = useT();
  const label = (v: string) => models.find((m) => m.value === v)?.label ?? v;
  const [state, action, pending] = useActionState<ActionState, FormData>(saveWorkSettingsAction, null);
  return (
    <form action={action} className="space-y-4">
      <p className="text-sm text-zinc-500">
        {t("Repos:")}{" "}
        {repos.length ? (
          repos.map((r, i) => (
            <span key={r.name}>
              {i > 0 && ", "}
              <span className={`font-medium ${r.ok ? "text-zinc-700 dark:text-zinc-200" : "text-red-600 dark:text-red-400"}`}>{r.name}</span>
              {!r.ok && ` ${t("(folder missing)")}`}
            </span>
          ))
        ) : (
          <span className="font-medium text-amber-700 dark:text-amber-400">{t("none yet")}</span>
        )}{" "}
        —{" "}
        <Link href="/repos" className="text-indigo-600 hover:underline dark:text-indigo-400">
          {t("set on the Repos page")}
        </Link>
        {t(", by Jira board or ticket.")}
      </p>
      <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
        <div>
          <label className="label" htmlFor="work-parallel">
            {t("Workers at once")}
          </label>
          <input id="work-parallel" name="parallel" type="number" min={1} max={8} className="input" defaultValue={s.parallel} />
        </div>
        <fieldset>
          <legend className="label">{t("What a worker may do (Claude)")}</legend>
          <div className="space-y-1.5">
            {PERMISSION_MODES.map((m) => (
              <label key={m} className="flex items-start gap-2 text-sm">
                <input type="radio" name="permissionMode" value={m} defaultChecked={s.permissionMode === m} className="mt-1 accent-indigo-600" />
                <span>
                  <span className="font-medium">{permissionModeInfo(t)[m].label}</span>
                  <span className="block text-xs text-zinc-500">{permissionModeInfo(t)[m].hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <fieldset>
        <legend className="label">{t("Copilot worker")}</legend>
        <div className="space-y-1.5">
          {COPILOT_MODES.map((m) => (
            <label key={m} className="flex items-start gap-2 text-sm">
              <input type="radio" name="copilotMode" value={m} defaultChecked={s.copilotMode === m} className="mt-1 accent-indigo-600" />
              <span>{copilotModeLabels(t)[m]}</span>
            </label>
          ))}
          <p className="text-xs text-zinc-500">{t("Interactive and Autopilot run as a session on the Work tab: you answer permissions and questions there and can switch the mode any time. Restarting Zeff ends a running session.")}</p>
        </div>
      </fieldset>

      <fieldset>
        <legend className="label">{t("Where code work happens")}</legend>
        <div className="space-y-1.5">
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="isolation" value="worktree" defaultChecked={s.isolation === "worktree"} className="mt-1 accent-indigo-600" />
            <span>
              <span className="font-medium">{t("A worktree of its own (recommended)")}</span>
              <span className="block text-xs text-zinc-500">
                {t(
                  "Each run gets a git worktree next to the repo (…/.zeff-worktrees/) on a new branch zeff/<ticket>-w<n>, from the ticket's branch or the default branch — your checkout and what's in progress there stay untouched, runs go side by side. It commits there; it never pushes. Dependencies (vendor, node_modules, DDEV) aren't in a fresh worktree: it installs what it can, else names the checks it couldn't run.",
                )}
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="isolation" value="checkout" defaultChecked={s.isolation === "checkout"} className="mt-1 accent-indigo-600" />
            <span>
              <span className="font-medium">{t("In the checkout")}</span>
              <span className="block text-xs text-zinc-500">{t("On your current branch, with everything installed — one code run per repo at a time, no commits (changes stay for you to review).")}</span>
            </span>
          </label>
        </div>
      </fieldset>

      <div>
        <label className="label" htmlFor="work-model">
          {t("Model ({provider})", { provider: provider === "copilot" ? "Copilot" : "Claude" })}
        </label>
        <select id="work-model" name="model" className="input" defaultValue={s.model}>
          <option value="">{defaultModel ? t("{model} — as in Settings", { model: label(defaultModel) }) : t("The CLI's default — as in Settings")}</option>
          {s.model && !models.some((m) => m.value === s.model) && <option value={s.model}>{s.model}</option>}
          {models
            .filter((m) => m.value !== defaultModel)
            .map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
        </select>
        <p className="mt-1 text-xs text-zinc-500">{t("Workers use the Settings model unless you pick another here (for this provider; the other one keeps its own).")}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="agent-code">
            {t("Copied instruction — code todos")}
          </label>
          <input id="agent-code" name="agentInstructionCode" className="input text-sm" defaultValue={s.agentInstructions.code} />
        </div>
        <div>
          <label className="label" htmlFor="agent-other">
            {t("Copied instruction — other todos")}
          </label>
          <input id="agent-other" name="agentInstructionOther" className="input text-sm" defaultValue={s.agentInstructions.other} />
        </div>
        <p className="text-xs text-zinc-500 sm:col-span-2">
          {t("What a click on a todo's label (T-35) copies for Copilot or Claude Code — code todos are implement, fix and test.")}{" "}
          <code>$todo.id</code> {t("becomes T-35,")} <code>$todo.ticket</code> {t("its ticket,")} <code>$todo.text</code>{" "}
          {t("what's to do.")}
        </p>
      </div>

      <div>
        <label className="label" htmlFor="work-instructions">
          {t("House rules for every worker")}
        </label>
        <textarea
          id="work-instructions"
          name="instructions"
          rows={3}
          className="input text-sm"
          defaultValue={s.instructions}
          placeholder={t("e.g. Run the Playwright suite with npm run test:e2e in packages/proj-core/Build.")}
        />
      </div>

      <div className="flex items-center gap-3">
        <SubmitButton pending={pending}>{t("Save")}</SubmitButton>
        {state?.ok && <span className="text-sm text-emerald-600 dark:text-emerald-400">{state.message}</span>}
        {state && !state.ok && <span className="text-sm text-red-600 dark:text-red-400">{state.error}</span>}
      </div>
    </form>
  );
}
