"use server";

import { redirect } from "next/navigation";
import { errorMessage } from "@/lib/errors";
import { formatHours } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import { setDefaultTags } from "@/lib/default-tags";
import { createProject, updateProject, deleteProject } from "@/lib/projects";
import { entryTypeFrom, int, num, revalidateAll, str, tagsFrom, type ActionState } from "@/app/action-helpers";

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

function projectFields(fd: FormData) {
  return {
    title: str(fd, "title") ?? "",
    description: str(fd, "description") ?? "",
    customer: str(fd, "customer") ?? "",
    jobNumber: str(fd, "jobNumber") ?? "",
    startDate: str(fd, "startDate") ?? "",
    endDate: str(fd, "endDate") ?? "",
  };
}

export async function createProjectAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const project = createProject(projectFields(fd));
    setDefaultTags({ project: project.id }, tagsFrom(fd, "defaultTags"));
    revalidateAll();
    return {
      ok: true,
      message: project.job
        ? t("Created project {title} on {job}.", { title: project.title, job: project.job.number })
        : t("Created project {title} (no job yet).", { title: project.title }),
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function updateProjectAction(
  id: number,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  try {
    const { project, moved } = updateProject(id, { ...projectFields(fd), active: fd.get("active") === "on" });
    setDefaultTags({ project: project.id }, tagsFrom(fd, "defaultTags"));
    revalidateAll();
    const where = project.job ? `${project.job.number} — ${project.job.name}` : t("No job yet");
    return {
      ok: true,
      message:
        t("Saved project {title}.", { title: project.title }) +
        (moved ? ` ${moved === 1 ? t("Moved 1 entry to {where}.", { where }) : t("Moved {n} entries to {where}.", { n: moved, where })}` : ""),
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Book one entry per working day of a date range on a project (e.g. a 3-day training). */
export async function bookProjectDaysAction(
  projectId: number,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  try {
    const { bookProjectDays } = await import("@/lib/project-days");
    const { booked, skipped } = bookProjectDays({
      projectId,
      from: str(fd, "from") ?? "",
      to: str(fd, "to") ?? "",
      hours: num(fd, "hours"),
      fillUp: fd.get("fillUp") === "on",
      description: str(fd, "description") ?? "",
      type: entryTypeFrom(fd),
    });
    revalidateAll();
    const total = booked.reduce((a, b) => a + b.hours, 0);
    const skippedText = skipped.length
      ? ` ${t("Skipped {days}.", { days: skipped.map((s) => `${s.date} (${s.reason})`).join(", ") })}`
      : "";
    if (booked.length === 0) return { ok: false, error: `${t("Nothing to book.")}${skippedText}` };
    return {
      ok: true,
      message:
        (booked.length === 1
          ? t("Booked {hours} h on 1 day.", { hours: formatHours(total) })
          : t("Booked {hours} h on {n} days.", { hours: formatHours(total), n: booked.length })) + skippedText,
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function toggleProjectActiveAction(fd: FormData): Promise<void> {
  const id = int(fd, "id");
  if (id === undefined) return;
  try {
    updateProject(id, { active: fd.get("active") === "true" });
    revalidateAll();
  } catch (err) {
    console.error("toggleProjectActiveAction", err);
  }
}

export async function deleteProjectAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const id = int(fd, "id");
  if (id === undefined) return { ok: false, error: t("Missing project id.") };
  try {
    deleteProject(id);
    revalidateAll();
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
  redirect("/projects");
}
