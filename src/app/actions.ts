"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createEntry, deleteEntry, updateEntry } from "@/lib/entries";
import { errorMessage } from "@/lib/errors";
import { formatHours } from "@/lib/format";
import { createJob, deleteJob, updateJob } from "@/lib/jobs";

export type ActionState = { ok: boolean; error?: string; message?: string } | null;

function str(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

function num(fd: FormData, key: string): number | undefined {
  const s = str(fd, key);
  if (s === undefined) return undefined;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

function int(fd: FormData, key: string): number | undefined {
  const n = num(fd, key);
  return n !== undefined && Number.isInteger(n) ? n : undefined;
}

/** Everything reads from the same SQLite file, so refresh every route after a write. */
function revalidateAll() {
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------------------
// Time entries
// ---------------------------------------------------------------------------

export async function createEntryAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const hours = num(fd, "hours");
    if (hours === undefined) return { ok: false, error: "Hours is required (e.g. 1.5)." };
    const entry = createEntry(
      {
        jobNumber: str(fd, "jobNumber") ?? "",
        date: str(fd, "date") ?? "",
        hours,
        description: str(fd, "description") ?? "",
        ticket: str(fd, "ticket"),
        reportedBy: str(fd, "reportedBy"),
      },
      "web",
    );
    revalidateAll();
    return {
      ok: true,
      message: `Booked ${formatHours(entry.hours)}h on ${entry.job.number} for ${entry.date}.`,
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function updateEntryAction(
  id: number,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  let date: string;
  try {
    const hours = num(fd, "hours");
    if (hours === undefined) return { ok: false, error: "Hours is required (e.g. 1.5)." };
    const entry = updateEntry(id, {
      jobNumber: str(fd, "jobNumber"),
      date: str(fd, "date"),
      hours,
      description: str(fd, "description"),
      ticket: str(fd, "ticket") ?? null,
      reportedBy: str(fd, "reportedBy"),
    });
    date = entry.date;
    revalidateAll();
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
  redirect(`/?week=${date}`);
}

export async function deleteEntryAction(fd: FormData): Promise<void> {
  const id = int(fd, "id");
  if (id === undefined) return;
  let redirectTo: string | undefined;
  try {
    const entry = deleteEntry(id);
    redirectTo = str(fd, "redirectTo")?.replace("{date}", entry.date);
    revalidateAll();
  } catch (err) {
    console.error("deleteEntryAction", err);
    return;
  }
  if (redirectTo) redirect(redirectTo);
}

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
    revalidateAll();
    return { ok: true, message: `Created job ${job.number} — ${job.name}.` };
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
    revalidateAll();
    return { ok: true, message: `Saved job ${job.number}.` };
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
  if (id === undefined) return { ok: false, error: "Missing job id." };
  try {
    deleteJob(id);
    revalidateAll();
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
  redirect("/jobs");
}
