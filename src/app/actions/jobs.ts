"use server";

import { redirect } from "@/lib/redirect";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { setDefaultTags } from "@/lib/default-tags";
import { createJob, updateJob, deleteJob } from "@/lib/jobs";
import { int, revalidateAll, str, tagsFrom, type ActionState } from "@/app/action-helpers";

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export async function createJobAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const job = createJob({
      number: str(fd, "number") ?? "",
      name: str(fd, "name") ?? "",
      customer: str(fd, "customer"),
      description: str(fd, "description"),
    });
    setDefaultTags({ job: job.id }, tagsFrom(fd, "defaultTags"));
    revalidateAll();
    return { ok: true, message: t("Created job {number} — {name}.", { number: job.number, name: job.name }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function updateJobAction(
  id: number,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  try {
    const job = updateJob(id, {
      number: str(fd, "number") ?? "",
      name: str(fd, "name") ?? "",
      customer: str(fd, "customer") ?? "",
      description: str(fd, "description") ?? "",
      active: fd.get("active") === "on",
    });
    setDefaultTags({ job: job.id }, tagsFrom(fd, "defaultTags"));
    revalidateAll();
    return { ok: true, message: t("Saved job {number}.", { number: job.number }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function toggleJobActiveAction(fd: FormData): Promise<void> {
  const id = int(fd, "id");
  if (id === undefined) return;
  try {
    updateJob(id, { active: fd.get("active") === "true" });
    revalidateAll();
  } catch (err) {
    console.error("toggleJobActiveAction", err);
  }
}

export async function deleteJobAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const id = int(fd, "id");
  if (id === undefined) return { ok: false, error: t("Missing job id.") };
  try {
    deleteJob(id);
    revalidateAll();
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
  redirect("/jobs");
}
