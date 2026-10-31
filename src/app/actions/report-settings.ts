"use server";

import { applyReportRuleTagsToEntries, reapplyMeetingJobRules, applyTypeRulesToEntries } from "@/lib/entries";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import { revalidateAll, str, type ActionState } from "@/app/action-helpers";

// ---------------------------------------------------------------------------
// Report settings
// ---------------------------------------------------------------------------

/** Save the report rules; "Save & tag existing entries" (apply=1) also gives older entries their rule's tags. */
export async function saveReportSettingsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { updateReportSettings } = await import("@/lib/report");
  const { parseRules } = await import("@/lib/report-shared");
  try {
    const rules = parseRules(str(fd, "rules") ?? null);
    updateReportSettings({ rules });
    const tagged = fd.get("apply") === "1" ? applyReportRuleTagsToEntries() : null;
    revalidateAll();
    return {
      ok: true,
      message:
        tagged === null
          ? t("Report rules saved.")
          : tagged === 1
            ? t("Report rules saved; tagged 1 existing entry.")
            : t("Report rules saved; tagged {n} existing entries.", { n: tagged }),
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function saveMeetingJobRulesAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { updateReportSettings, parseMeetingJobRules } = await import("@/lib/report");
  const { listJobs } = await import("@/lib/jobs");
  try {
    const rules = parseMeetingJobRules(str(fd, "meetingJobRules") ?? null);
    const defaultJob = str(fd, "meetingDefaultJob") ?? null;
    if (defaultJob && !listJobs({ includeInactive: true }).some((j) => j.number === defaultJob)) {
      return { ok: false, error: t("Unknown job {job}.", { job: defaultJob }) };
    }
    updateReportSettings({ meetingJobRules: rules, meetingDefaultJob: defaultJob });
    // "Save & reapply" (apply=1): also re-book already imported meetings that match a rule.
    const moves = fd.get("apply") === "1" ? reapplyMeetingJobRules(rules) : null;
    revalidateAll();
    if (moves === null) {
      return { ok: true, message: rules.length === 1 ? t("Saved 1 meeting rule.") : t("Saved {n} meeting rules.", { n: rules.length }) };
    }
    const saved = rules.length === 1 ? t("Saved 1 meeting rule") : t("Saved {n} meeting rules", { n: rules.length });
    const moved = moves.length === 1 ? t("moved 1 imported meeting") : t("moved {n} imported meetings", { n: moves.length });
    const shown = moves
      .slice(0, 5)
      .map((m) => `${formatDate(m.date, { weekday: false })} “${m.description}” → ${m.to}`)
      .join("; ");
    return {
      ok: true,
      message:
        `${saved}; ${moved}` +
        (moves.length ? `: ${shown}${moves.length > 5 ? "; …" : ""}.` : "."),
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * Exclude / Include toggle on the import page: excluding adds the meeting's title as an
 * exclude rule (unless one already matches it); including removes every rule matching it.
 * Returns the resulting rules so the page can re-check its other meetings.
 */
export async function setMeetingExcludedAction(
  title: string,
  exclude: boolean,
): Promise<{ ok: boolean; error?: string; rules?: string[] }> {
  const { getMeetingExcludeRules, getReportSettings, updateReportSettings } = await import("@/lib/report");
  const { isExcludedMeeting } = await import("@/lib/calendar/meetings");
  const name = (title ?? "").trim();
  if (!name) return { ok: false, error: t("The meeting has no title.") };
  try {
    const rules = getMeetingExcludeRules(getReportSettings());
    const next = exclude
      ? isExcludedMeeting(name, rules) ? rules : [...rules, name]
      : rules.filter((r) => !isExcludedMeeting(name, [r]));
    updateReportSettings({ meetingExcludeRules: next });
    revalidateAll();
    return { ok: true, rules: next };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Save the entry type rules; the "Save & apply" button (apply=1) also re-types existing entries. */
export async function saveTypeRulesAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { updateReportSettings } = await import("@/lib/report");
  const { parseTypeRules } = await import("@/lib/type-rules-shared");
  const { listJobs } = await import("@/lib/jobs");
  try {
    const rules = parseTypeRules(str(fd, "typeRules") ?? null);
    const known = new Set(listJobs({ includeInactive: true }).map((j) => j.number));
    const unknown = rules.find((r) => r.jobNumber && !known.has(r.jobNumber));
    if (unknown) return { ok: false, error: t("Unknown job {job}.", { job: unknown.jobNumber }) };
    updateReportSettings({ typeRules: rules });
    const applied = fd.get("apply") === "1" ? applyTypeRulesToEntries() : null;
    revalidateAll();
    const n = rules.length;
    if (applied === null) return { ok: true, message: n === 1 ? t("Saved 1 type rule.") : t("Saved {n} type rules.", { n }) };
    const saved = n === 1 ? t("Saved 1 type rule") : t("Saved {n} type rules", { n });
    const retyped = applied === 1 ? t("re-typed 1 existing entry.") : t("re-typed {n} existing entries.", { n: applied });
    return { ok: true, message: `${saved}; ${retyped}` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function saveMeetingExcludeRulesAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { parseMeetingExcludeRules, updateReportSettings } = await import("@/lib/report");
  try {
    const rules = parseMeetingExcludeRules(str(fd, "meetingExcludeRules") ?? null);
    updateReportSettings({ meetingExcludeRules: rules });
    revalidateAll();
    return { ok: true, message: rules.length === 1 ? t("Saved 1 exclude rule.") : t("Saved {n} exclude rules.", { n: rules.length }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
