/** What the server actions share: reading a form, refreshing the pages, an action's answer. Server-only (not "use server": its helpers aren't actions). */

import { revalidatePath } from "next/cache";
import type { EntryType } from "@/db/schema";

export type ActionState = { ok: boolean; error?: string; message?: string } | null;

export function tagsFrom(fd: FormData, key = "tags"): string[] {
  return fd.getAll(key).map((v) => String(v).trim()).filter(Boolean);
}

/** The picked entry type (a configured type key, checked when the entry is saved). */
export function entryTypeFrom(fd: FormData): EntryType | undefined {
  return str(fd, "type");
}

export function str(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

export function num(fd: FormData, key: string): number | undefined {
  const s = str(fd, key);
  if (s === undefined) return undefined;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

export function int(fd: FormData, key: string): number | undefined {
  const n = num(fd, key);
  return n !== undefined && Number.isInteger(n) ? n : undefined;
}

/** Everything reads from the same SQLite file, so refresh every route after a write. */
export function revalidateAll() {
  try {
    revalidatePath("/", "layout");
  } catch {
    // outside a request (a script, a test): there is no page to refresh
  }
}

export async function accountsOn(): Promise<string | null> {
  const { t } = await import("@/lib/i18n/server");
  return (await import("@/plugins/state")).isInstalled("accounts") ? null : t("Accounts is not installed (Menu → Plugins).");
}
