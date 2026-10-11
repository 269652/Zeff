"use client";

import { Fragment, startTransition, useActionState, useState } from "react";
import { saveMeetingJobRulesAction } from "@/app/actions";
import type { ActionState } from "@/app/action-helpers";
import type { MeetingJobRule } from "@/lib/calendar/meetings";
import { useT } from "@/components/I18nProvider";
import { SubmitButton } from "./SubmitButton";

/** Meeting title → job rules (one row each) plus the job for every other meeting. */
export function MeetingJobRulesForm({
  initialRules,
  initialDefaultJob,
  jobs,
}: {
  initialRules: MeetingJobRule[];
  initialDefaultJob: string | null;
  jobs: { number: string; name: string }[];
}) {
  const t = useT();
  const [rules, setRules] = useState<MeetingJobRule[]>(initialRules);
  const [defaultJob, setDefaultJob] = useState(initialDefaultJob ?? "");
  const [state, action, pending] = useActionState<ActionState, FormData>(saveMeetingJobRulesAction, null);

  const setRule = (i: number, patch: Partial<MeetingJobRule>) =>
    setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const removeRule = (i: number) => setRules((rs) => rs.filter((_, j) => j !== i));
  const addRule = () => setRules((rs) => [...rs, { match: "", jobNumber: jobs[0]?.number ?? "" }]);

  if (jobs.length === 0) {
    return <p className="text-sm text-zinc-500">{t("Create a job first — rules book meetings on a job number.")}</p>;
  }

  const jobOptions = jobs.map((j) => (
    <option key={j.number} value={j.number}>
      {j.number} — {j.name}
    </option>
  ));

  return (
    <form
      // Submitted by hand, not via `action`: React resets a form after an action, which snaps
      // controlled selects back to the job they showed when the page loaded. The clicked
      // button rides along so "Save & reapply" can re-book imported meetings too.
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        startTransition(() => action(fd));
      }}
      className="space-y-3"
    >
      <input type="hidden" name="meetingJobRules" value={JSON.stringify(rules.filter((r) => r.match.trim() && r.jobNumber))} />
      <input type="hidden" name="meetingDefaultJob" value={defaultJob} />

      <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)_2rem] items-center gap-2">
        <span className="text-xs font-medium text-zinc-500 uppercase">{t("Meeting title contains")}</span>
        <span className="text-xs font-medium text-zinc-500 uppercase">{t("Book on job")}</span>
        <span />

        {rules.length === 0 && (
          <p className="col-span-3 text-sm text-zinc-500">
            {t("No rules yet — e.g. title contains")} <code className="code">Mob Programming</code> {t("→ your Relaunch job.")}
          </p>
        )}
        {rules.map((r, i) => (
          <Fragment key={i}>
            <input
              className="input py-1 text-sm"
              value={r.match}
              placeholder="Mob Programming"
              aria-label={t("Rule {n}: meeting title contains", { n: i + 1 })}
              onChange={(e) => setRule(i, { match: e.target.value })}
            />
            <select
              className="input py-1 text-sm"
              value={r.jobNumber}
              aria-label={t("Rule {n}: job", { n: i + 1 })}
              onChange={(e) => setRule(i, { jobNumber: e.target.value })}
            >
              {jobOptions}
            </select>
            <button
              type="button"
              className="btn btn-sm btn-danger w-8 justify-center px-0"
              onClick={() => removeRule(i)}
              aria-label={t("Remove rule")}
            >
              ✕
            </button>
          </Fragment>
        ))}

        <div className="col-span-3 border-t border-zinc-100 dark:border-zinc-800" />
        <span className="text-sm text-zinc-600 dark:text-zinc-300">{t("All other meetings")}</span>
        <select
          className="input py-1 text-sm"
          value={defaultJob}
          aria-label={t("Job for all other meetings")}
          onChange={(e) => setDefaultJob(e.target.value)}
        >
          <option value="">{t("— first job in the list —")}</option>
          {jobOptions}
        </select>
        <span />
      </div>

      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-sm" onClick={addRule}>{t("+ Add rule")}</button>
        <SubmitButton className="btn btn-primary btn-sm" pendingText={t("Saving…")} pending={pending}>
          {t("Save rules")}
        </SubmitButton>
        <SubmitButton className="btn btn-sm" pendingText={t("Reapplying…")} pending={pending} name="apply" value="1">
          {t("Save & reapply")}
        </SubmitButton>
        {state?.ok && <span className="text-sm text-emerald-600">{state.message}</span>}
        {state?.error && <span className="alert-error">{state.error}</span>}
      </div>
      <p className="text-xs text-zinc-400">
        {t(
          "Matching is case-insensitive; the first matching rule wins, and any other meeting gets the “All other meetings” job. This pre-selects the Job column on the import page — you can still change any meeting before booking.",
        )}{" "}
        <strong>{t("Save & reapply")}</strong>{" "}
        {t("also moves already imported meetings that match a rule onto its job (meetings no rule matches keep theirs).")}
      </p>
    </form>
  );
}
