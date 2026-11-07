"use server";

import { t } from "@/lib/i18n/server";
import { asUndoable, run } from "@/plugins/workspace/actions/shared";

/**
 * A new Agenda note in one go: its fields by name — a tag that isn't there yet becomes one, as the assistant's rows do — its title
 * and its text. One step, so nothing it needs is still on its way from the page (a tag made in the browser a moment before).
 */
export async function addAgendaNoteAction(v: { dbId: number; title: string; values: Record<string, unknown>; markdown?: string }) {
  return run(async () => {
    const title = String(v.title ?? "").trim().slice(0, 300);
    if (!title) throw new Error(t("A note needs a title."));
    const store = await import("@/plugins/workspace/store");
    const { valuesToCells } = await import("@/plugins/workspace/mcp-db");
    const { markdownToDoc } = await import("@/plugins/workspace/doc");
    const d = store.getDatabase(Number(v.dbId));
    if (!d) throw new Error(t("The database is gone."));
    return asUndoable(t("New note: {title}", { title }), async () => {
      const c = await valuesToCells(d.schema, v.values && typeof v.values === "object" ? v.values : {});
      if (c.schema !== d.schema) store.updateSchema(d.page.id, c.schema);
      const id = store.addRow(d.page.id, { title, cells: c.cells });
      const md = String(v.markdown ?? "").trim();
      if (md) store.updatePage(id, { content: markdownToDoc(md) });
      return { id };
    });
  });
}
