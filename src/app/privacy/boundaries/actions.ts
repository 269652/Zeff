"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";

/** Settings → Data boundaries: a source's or a database's label set (null: back to its default). */
export async function setBoundaryLabelAction(kind: "source" | "database", key: string, label: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const b = await import("@/lib/boundaries");
    if (label !== null && !b.isLabel(label)) throw new Error(t("No such label."));
    if (kind === "source") {
      if (!b.BOUNDARY_SOURCES.some((s) => s.key === key)) throw new Error(t("No such source."));
      b.setSourceLabel(key, label);
    } else {
      const id = Number(key);
      const { getDatabase } = await import("@/plugins/workspace/store");
      if (!Number.isInteger(id) || !getDatabase(id)) throw new Error(t("This page is gone."));
      (await import("@/plugins/workspace/sensitivity")).setDatabaseLabel(id, label);
    }
    revalidatePath("/privacy/boundaries");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}
