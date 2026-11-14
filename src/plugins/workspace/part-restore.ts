import { partVersion, type PartKind } from "./part-versions";
import { getDatabase, getPage, updateSchema } from "./store";
import type { Property } from "./model";

/**
 * A part brought back to one of its versions (part-versions.ts). What it is now is kept as a version in turn (the change goes through the
 * same place as any other), so a restore can be undone the same way. Safe by design:
 * - a flow or routine keeps the permissions it has now and whether it is switched on (an old version does not give back what was taken);
 * - a database's fields come back as they were, but a field added since stays (with its data): fields are never removed by a restore.
 * Server only.
 */
export async function restorePart(versionId: number): Promise<{ kind: PartKind; ref: number; title: string }> {
  const v = partVersion(Number(versionId));
  if (!v || !v.body || typeof v.body !== "object") throw new Error("There is no such version.");
  const body = v.body as Record<string, unknown>;
  const title = getPage(v.ref)?.title ?? `#${v.ref}`;
  if (v.kind === "flow") {
    const { getFlow, saveFlow } = await import("./flows/store");
    const cur = getFlow(v.ref);
    if (!cur) throw new Error("That flow is gone.");
    saveFlow(v.ref, { ...body, permissions: cur.permissions, enabled: cur.enabled });
  } else if (v.kind === "routine") {
    const { getRoutine, updateRoutine } = await import("./routines");
    if (!getRoutine(v.ref)) throw new Error("That routine is gone.");
    updateRoutine(v.ref, { triggers: body.triggers as never, steps: body.steps as never, ...(body.provider ? { provider: body.provider as never } : {}) });
  } else if (v.kind === "form") {
    const { saveForm } = await import("./forms");
    saveForm(v.ref, body);
  } else if (v.kind === "fields") {
    const cur = getDatabase(v.ref);
    if (!cur) throw new Error("That database is gone.");
    const then = (Array.isArray(body.properties) ? body.properties : []) as Property[];
    const thenIds = new Set(then.map((p) => p.id));
    // (A relation to a database that is gone now can't come back as it was: left out.)
    const back = then.filter((p) => p.type !== "relation" || p.relationDb === undefined || !!getDatabase(p.relationDb));
    const added = cur.schema.properties.filter((p) => !thenIds.has(p.id));
    updateSchema(v.ref, { ...cur.schema, ...(typeof body.titleName === "string" ? { titleName: body.titleName } : {}), properties: [...back, ...added] });
  }
  return { kind: v.kind, ref: v.ref, title };
}
