import { getDatabase, getPage } from "./store";

/**
 * A row of a two-way source deleted: the record it came from goes first (an appointment of Zeff's own calendars) - one that
 * can't be deleted there (Outlook's, Google's) throws, and the row stays. Call it before archiving a row. Server only.
 */
export async function removeFromSource(rowId: number): Promise<void> {
  const page = getPage(rowId);
  const d = page?.dbId ? getDatabase(page.dbId) : null;
  if (!page || !d) return;
  const ref = String(page.props.srcref ?? "");
  if (!ref) return;
  const exts = (d.schema.pipeline?.steps ?? []).filter((s) => s.kind === "source" && s.from === "ext");
  if (!exts.length) return;
  const all = await (await import("./source-point")).extSources();
  for (const s of exts) await all.find((x) => x.id === s.ext)?.remove?.(d.page.id, ref);
}
