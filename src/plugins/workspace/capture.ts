import { getPref, setPref } from "@/lib/prefs";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { markdownToDoc } from "./doc";
import { newProperty, newView, type DbSchema } from "./model";
import { addRow, createPage, getDatabase, updatePage } from "./store";

/**
 * Quick capture: a note, a thought, a photo typed or taken on the phone (workspace/capture) lands as a row of the database "Capture"
 * - the first line its title, the whole text its page, files attached through Documents - to sort later (by hand or by an AI step).
 * Made once; a gone one is not made again. Server only.
 */

const CAPTURE = "workspace.captureDb";

export function captureDatabase(): number | null {
  const id = getPref<number | null>(CAPTURE, null);
  return id && getDatabase(id) && !getDatabase(id)!.page.archivedAt ? id : null;
}

/** The database "Capture" (made at the first capture, or when the Workspace opens). */
export function ensureCaptureDatabase(): number | null {
  if (!isInstalled("workspace")) return null;
  const known = captureDatabase();
  if (known) return known;
  if (getPref<number | null>(CAPTURE, null) !== null) return null;
  const done = { ...newProperty("Sorted", "checkbox"), id: "capdone" };
  const from = { ...newProperty("From", "text"), id: "capfrom" };
  const schema: DbSchema = { titleName: t("Note"), properties: [from, done], views: [{ ...newView(t("Open"), "table"), filter: { op: "and", rules: [{ prop: "capdone", cond: "unchecked" }] }, hidden: [] }, newView(t("All"), "table"), newView(t("Cards"), "gallery")] };
  const id = createPage({ kind: "database", title: t("Capture"), icon: "⚡", schema });
  updatePage(id, { fullWidth: true });
  setPref(CAPTURE, id);
  return id;
}

/** A capture: its text (the first line is the title) and the files that came with it - made a row, the files kept in Documents. */
export async function capture(text: string, files: { name: string; data: Buffer; type: string }[], from = "capture"): Promise<{ id: number; attached: number }> {
  const db = ensureCaptureDatabase();
  if (!db) throw new Error(t("The Workspace is not installed (Menu → Plugins)."));
  const body = text.trim();
  if (!body && !files.length) throw new Error(t("Write something, or add a photo."));
  const lines: string[] = [];
  let attached = 0;
  if (files.length && isInstalled("documents")) {
    const { addDocument } = await import("@/plugins/documents/store");
    const { startProcessing } = await import("@/plugins/documents/process");
    for (const f of files.slice(0, 10)) {
      try {
        const { doc } = addDocument(f.name || "photo", f.data, f.type);
        lines.push(f.type.startsWith("image/") ? `![${doc.name}](/api/documents/${doc.id}/file)` : `[${doc.name}](/api/documents/${doc.id}/file?open=1)`);
        attached++;
      } catch {
        // a file that cannot be kept (empty, too large) is left out
      }
    }
    if (attached) startProcessing();
  }
  const title = (body.split("\n").find((l) => l.trim()) ?? t("Photo")).replace(/^#+\s*/, "").slice(0, 120);
  const id = addRow(db, { title, cells: { capfrom: from } });
  updatePage(id, { content: markdownToDoc([body, ...lines].filter(Boolean).join("\n\n")) });
  return { id, attached };
}
