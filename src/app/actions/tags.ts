"use server";

import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { int, revalidateAll, str, type ActionState } from "@/app/action-helpers";

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Entry types (Tags page)
// ---------------------------------------------------------------------------

export async function createEntryTypeAction(label: string, color: string): Promise<ActionState> {
  try {
    const { createEntryType } = await import("@/lib/entry-types");
    const type = createEntryType({ label, color });
    revalidateAll();
    return { ok: true, message: t("Added type {label}.", { label: type.label }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Save renamed / recolored types. */
export async function saveEntryTypesAction(updates: { key: string; label: string; color: string }[]): Promise<ActionState> {
  try {
    const { updateEntryTypes } = await import("@/lib/entry-types");
    const n = updateEntryTypes(updates);
    revalidateAll();
    return { ok: true, message: n === 1 ? t("Saved 1 type.") : t("Saved {n} types.", { n }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function deleteEntryTypeAction(key: string): Promise<ActionState> {
  try {
    const { deleteEntryType } = await import("@/lib/entry-types");
    deleteEntryType(key);
    revalidateAll();
    return { ok: true, message: t("Type deleted.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function createTagAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { createTag } = await import("@/lib/tags");
  try {
    const tag = createTag(str(fd, "name") ?? "", str(fd, "color"));
    revalidateAll();
    return { ok: true, message: t("Added tag #{name}.", { name: tag.name }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function renameTagAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const id = int(fd, "id");
  if (id === undefined) return { ok: false, error: t("Missing tag id.") };
  const { renameTag } = await import("@/lib/tags");
  try {
    const tag = renameTag(id, str(fd, "name") ?? "", str(fd, "color") ?? null);
    revalidateAll();
    return { ok: true, message: t("Saved #{name}.", { name: tag.name }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function deleteTagAction(fd: FormData): Promise<void> {
  const id = int(fd, "id");
  if (id === undefined) return;
  const { deleteTag } = await import("@/lib/tags");
  try {
    deleteTag(id);
    revalidateAll();
  } catch (err) {
    console.error("deleteTagAction", err);
  }
}
