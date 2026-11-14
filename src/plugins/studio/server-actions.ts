"use server";

import { t } from "@/lib/i18n/server";
import { pluginAction } from "@/lib/action-result";

/** The Studio's own actions: the screens (every database's views and detail page), a new view, a detail page, a new app. */

const run = pluginAction("studio", () => t("The Studio plugin is off (Menu → Plugins)."));

/** Every database with its views (which are drawn from a template), its detail page and a row to show it with. */
export async function studioScreensAction() {
  return run(async () => {
    const { tree, rowsOf } = await import("@/plugins/workspace/store");
    const { rowViewOf } = await import("@/plugins/workspace/row-views");
    const databases = tree()
      .filter((p) => p.kind === "database" && !p.system)
      .flatMap((p) => {
        const d = rowsOf(p.id);
        if (!d) return [];
        const plugin = rowViewOf(d.schema.dataType);
        return [
          {
            id: p.id,
            title: p.title || "",
            icon: p.icon ?? "",
            parentId: p.parentId,
            dataType: d.schema.dataType ?? null,
            views: d.schema.views.map((v) => ({ id: v.id, name: v.name, type: v.type, app: v.app ?? null, custom: v.type === "app" })),
            detail: plugin ? ("plugin" as const) : d.schema.rowTemplate ? ("own" as const) : null,
            firstRow: d.rows[0]?.id ?? null,
            lifecycle: !!d.schema.lifecycle,
          },
        ];
      });
    return { databases };
  });
}

/** A new view drawn from a template on a database (the template given, else a start that shows its rows): its id. */
export async function addScreenAction(dbId: number, name: string, template?: string) {
  return run(async () => {
    const { getDatabase, updateSchema } = await import("@/plugins/workspace/store");
    const { newView } = await import("@/plugins/workspace/model");
    const { TEMPLATE_VIEW } = await import("@/plugins/workspace/view-apps");
    const d = getDatabase(Number(dbId));
    if (!d) throw new Error(t("The database is gone."));
    const view = { ...newView(String(name).trim().slice(0, 80) || t("New view"), "app"), app: "template", template: template?.trim() || TEMPLATE_VIEW.defaultTemplate(t) };
    updateSchema(d.page.id, { ...d.schema, views: [...d.schema.views, view] });
    return { viewId: view.id };
  });
}

/** A database's rows get a detail page of their own (their fields, their lifecycle) — to change in the Studio. */
export async function addDetailPageAction(dbId: number) {
  return run(async () => {
    const { getDatabase, saveSchema } = await import("@/plugins/workspace/store");
    const { detailTemplate } = await import("./apps");
    const d = getDatabase(Number(dbId));
    if (!d) throw new Error(t("The database is gone."));
    if (!d.schema.rowTemplate) saveSchema(d.page.id, { ...d.schema, rowTemplate: detailTemplate(d.schema) });
    return {};
  });
}

/** A row to show a detail page with: the first, or a new one when there is none. */
export async function sampleRowAction(dbId: number) {
  return run(async () => {
    const { rowsOf, addRow } = await import("@/plugins/workspace/store");
    const d = rowsOf(Number(dbId));
    if (!d) throw new Error(t("The database is gone."));
    return { rowId: d.rows[0]?.id ?? addRow(Number(dbId), { title: t("Example") }) };
  });
}

/** A new app of a kind: its database (its screen the first view), its flows, its detail page. */
export async function createAppAction(kind: string, title: string) {
  return run(async () => {
    const { APP_KINDS, createApp } = await import("./apps");
    if (!(APP_KINDS as readonly string[]).includes(kind)) throw new Error(`“${kind}” is no kind of app.`);
    return createApp(kind as (typeof APP_KINDS)[number], String(title).slice(0, 120));
  });
}

/** Every lambda: Zeff's (or your change of one) and yours — what each is, what it still needs. */
export async function lambdasAction() {
  return run(async () => {
    const { listLambdas } = await import("@/plugins/workspace/lambdas/store");
    const { lambdaMissing } = await import("@/plugins/workspace/lambdas/sources");
    return { lambdas: listLambdas().map((l) => ({ name: l.manifest.name, label: l.manifest.label, what: l.manifest.what, kind: l.manifest.kind, builtin: l.builtin, changed: l.changed, missing: lambdaMissing(l.manifest, l.plugin) })) };
  });
}

/** A lambda whole: its manifest and files. */
export async function lambdaAction(name: string) {
  return run(async () => {
    const l = (await import("@/plugins/workspace/lambdas/store")).getLambda(String(name));
    if (!l) throw new Error(`There is no lambda “${name}”.`);
    return { lambda: l };
  });
}

/** A lambda saved (lambda.json is part of the files: its manifest). */
export async function saveLambdaAction(files: Record<string, string>, previous?: string) {
  return run(async () => {
    const manifest = JSON.parse(String(files["lambda.json"] ?? "{}"));
    const { saveLambda } = await import("@/plugins/workspace/lambdas/store");
    return { lambda: saveLambda({ manifest, files, previous }) };
  });
}

/** A new lambda of yours, from a start. */
export async function createLambdaAction(name: string, kind: "lookup" | "function") {
  return run(async () => {
    const { STARTER } = await import("@/plugins/workspace/lambdas/types");
    const { createLambda } = await import("@/plugins/workspace/lambdas/store");
    return { lambda: createLambda(STARTER(String(name).trim().toLowerCase(), kind === "function" ? "function" : "lookup")) };
  });
}

/** A copy of a lambda under a new name (yours, to change). */
export async function duplicateLambdaAction(name: string, as: string) {
  return run(async () => {
    const { getLambda, createLambda } = await import("@/plugins/workspace/lambdas/store");
    const l = getLambda(String(name));
    if (!l) throw new Error(`There is no lambda “${name}”.`);
    return { lambda: createLambda({ manifest: { ...l.manifest, name: String(as).trim().toLowerCase(), label: t("{label} (my own)", { label: l.manifest.label }) }, files: l.files }) };
  });
}

/** Yours deleted — a changed built-in back to Zeff's. */
export async function deleteLambdaAction(name: string) {
  return run(async () => {
    (await import("@/plugins/workspace/lambdas/store")).deleteLambda(String(name));
    return {};
  });
}

type Draft = Record<string, string>;
const lambdaOf = async (files: Draft) => {
  const { normalizeManifest, normalizeFiles } = await import("@/plugins/workspace/lambdas/types");
  let manifest;
  try {
    manifest = normalizeManifest(JSON.parse(String(files["lambda.json"] ?? "{}")));
  } catch (e) {
    throw new Error(e instanceof SyntaxError ? `lambda.json: ${e.message}` : (e as Error).message);
  }
  return { manifest, files: normalizeFiles(files), builtin: false, changed: false, updatedAt: null };
};

/** A lambda run as it is in the editor (saved or not) with this event: its output checked, its log, how long it took. */
export async function testLambdaAction(files: Draft, event: unknown) {
  return run(async () => {
    const l = await lambdaOf(files);
    const { runLambda } = await import("@/plugins/workspace/lambdas/run");
    const { checkFields, checkHits, checkSchema } = await import("@/plugins/workspace/lambdas/validate");
    const r = await runLambda(l, event);
    if (!r.ok) return { run: r, problems: [] as string[] };
    const mode = (event as { mode?: string } | null)?.mode;
    const c = l.manifest.kind === "lookup" ? (mode === "search" ? checkHits(r.result) : checkFields(r.result, l.manifest)) : null;
    const problems = c ? (c.ok ? [] : c.problems) : l.manifest.output ? checkSchema(r.result, l.manifest.output) : [];
    return { run: r, problems };
  });
}

/** Its dependencies installed (as they are in the editor): what npm said. */
export async function installLambdaAction(files: Draft) {
  return run(async () => {
    const l = await lambdaOf(files);
    const { materialize } = await import("@/plugins/workspace/lambdas/run");
    return (await materialize(l)).install;
  });
}

/** The typings of its installed dependencies, for the editor's completion (each package's own, or its @types). */
export async function lambdaTypesAction(files: Draft) {
  return run(async () => {
    const l = await lambdaOf(files);
    const { typingsOf } = await import("@/plugins/workspace/lambdas/typings");
    return { libs: await typingsOf(l) };
  });
}
