/**
 * The assistant's tools for versions and copies of what is built in the Workspace: the history of a page's text, a flow, a database's
 * fields, a routine and a form (part-versions.ts — views, widgets, blocks and functions have tools of their own), a kept version of an app
 * as a new app or template, a page tree saved as a template or exported as a package. Server only.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { guarded, type Helpers } from "./mcp";

const MAX_EXPORT = 400_000;

export function registerVersionTools(server: McpServer, h: Helpers): void {
  server.registerTool(
    "workspace_part_versions",
    {
      title: "Versions of a flow, fields, a routine, a form",
      description:
        "Earlier versions of a part (newest first, who changed it from that one: you or the ai): kind flow (ref = the flow's page id), fields (ref = the database's id: its properties), routine (ref = the routine's page id), form (ref = the form's page id). With version: that one in full. Bring one back with workspace_restore_part. (View templates: workspace_view_versions; widgets, blocks, functions: their own version tools; page text: workspace_page_versions.)",
      inputSchema: z.object({ kind: z.enum(["flow", "fields", "routine", "form"]), ref: z.number().int(), version: z.number().int().optional() }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ kind, ref, version }) =>
      guarded(h, async () => {
        const pv = await import("./part-versions");
        if (version !== undefined) {
          const v = pv.partVersion(version);
          if (!v || v.kind !== kind || v.ref !== ref) return h.fail("There is no such version of that part.");
          return h.ok(`${v.kind} ${v.ref} · version ${v.id} · ${v.at} · changed from it by ${v.by || "?"}\n${JSON.stringify(v.body, null, 2)}`);
        }
        const list = pv.partVersions(kind, ref);
        return h.ok(list.length ? list.map((v) => `- version ${v.id} · ${v.at} · ${v.by || "?"} · ${v.size} chars`).join("\n") : "No earlier versions yet (one is kept each time it changes).");
      }),
  );

  server.registerTool(
    "workspace_restore_part",
    {
      title: "Bring a flow, fields, a routine or a form back to a version",
      description:
        "Brings a part back to a version from workspace_part_versions; what it is now is kept as a version in turn. A flow or routine keeps the permissions it has now and whether it is on; fields come back as they were, but fields added since stay with their data (none is removed).",
      inputSchema: z.object({ version: z.number().int() }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ version }) =>
      guarded(h, async () => {
        const r = await (await import("./part-restore")).restorePart(version);
        return h.ok(`Restored: ${r.kind} of “${r.title}” (${r.ref}) is as in version ${version}.`);
      }),
  );

  server.registerTool(
    "workspace_page_versions",
    {
      title: "Versions of a page's text",
      description: "Earlier versions of a page's title and text (one kept per ten minutes of editing, newest first); with version: that one as Markdown. Bring one back with workspace_restore_page_version.",
      inputSchema: z.object({ pageId: z.number().int(), version: z.number().int().optional() }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ pageId, version }) =>
      guarded(h, async () => {
        const store = await import("./store");
        if (version !== undefined) {
          const v = store.getVersion(version);
          if (!v || v.pageId !== pageId) return h.fail("There is no such version of that page.");
          const { docToMarkdown } = await import("./doc");
          return h.ok(`version ${v.id} · ${v.at} · “${v.title}”\n${docToMarkdown(v.content)}`);
        }
        const list = store.versions(pageId);
        return h.ok(list.length ? list.map((v) => `- version ${v.id} · ${v.at} · “${v.title}” · ${v.size} chars`).join("\n") : "No earlier versions yet.");
      }),
  );

  server.registerTool(
    "workspace_restore_page_version",
    {
      title: "Bring a page's text back to a version",
      description: "A page's title and text as in a version from workspace_page_versions; what it is now is kept as a version first.",
      inputSchema: z.object({ version: z.number().int() }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ version }) =>
      guarded(h, async () => {
        (await import("./store")).restoreVersion(version);
        return h.ok(`Restored version ${version}.`);
      }),
  );

  server.registerTool(
    "workspace_package_version_as_new",
    {
      title: "A kept version of an app as a new app or a template",
      description:
        "Makes a kept version or a save point of an installed package (workspace_app_history lists both) a separate app at the top of the tree — or, template: true, one of the user's templates. The installed app stays as it is. A version keeps the structure, not the entries: its databases start empty. Its flows get no permissions, its routines are off; where the installed app has a flow of the same name, the copy uses that one.",
      inputSchema: z.object({ id: z.string(), version: z.string().optional(), savePoint: z.number().int().optional(), template: z.boolean().optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ id, version, savePoint, template }) =>
      guarded(h, async () => {
        const life = await import("./package-life");
        if (!version && !savePoint) return h.fail("Give a version or a savePoint (workspace_app_history lists both).");
        const r = savePoint ? await life.savePointAsNew(id, savePoint, { template: template === true }) : await life.snapshotAsNew(id, version!, { template: template === true });
        return h.ok(`${template ? "Template" : "New app"}: “${r.title}” (page ${r.rootId}).`);
      }),
  );

  server.registerTool(
    "workspace_save_as_template",
    {
      title: "Save a page (and what is under it) as a template",
      description: "Copies a page with everything under it (sub-pages, databases with their rows, flows, forms) into the user's templates; the page itself stays. New → templates offers it from then on.",
      inputSchema: z.object({ pageId: z.number().int() }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ pageId }) =>
      guarded(h, async () => {
        const id = (await import("./templates")).saveAsTemplate(pageId);
        return h.ok(`Saved as a template (page ${id}).`);
      }),
  );

  server.registerTool(
    "workspace_export_package",
    {
      title: "Export as a package",
      description:
        "A package file's content (JSON, format 1) — what can be downloaded and installed elsewhere: either a page with everything under it as it is now (pageId; includeRows: its databases' rows too), or a kept version of an installed package (id + version). Installed again with workspace_package_install only when a plugin offers it; the user installs a file from the sidebar.",
      inputSchema: z.object({ pageId: z.number().int().optional(), includeRows: z.boolean().optional(), id: z.string().optional(), version: z.string().optional() }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ pageId, includeRows, id, version }) =>
      guarded(h, async () => {
        let pkg: unknown;
        if (id && version) pkg = (await import("./package-life")).snapshotPackage(id, version);
        else if (pageId !== undefined) {
          const page = (await import("./store")).getPage(pageId);
          if (!page) return h.fail("There is no such page.");
          pkg = (await import("./packages")).exportPackage(pageId, { name: page.title || "Package", icon: page.icon, includeRows: includeRows === true });
        } else return h.fail("Give pageId, or id and version.");
        const text = JSON.stringify(pkg);
        if (text.length > MAX_EXPORT) return h.fail(`The package is too large to send here (${text.length} characters); the user can download it from the page's menu (Export → Package).`);
        return h.ok(text);
      }),
  );

  server.registerTool(
    "workspace_app_history",
    {
      title: "The whole app's history",
      description:
        "An installed app's history as its top page shows it: its save points (the app with every page below it at one moment: pages, fields, views, flows, forms — not the entries; kept on request and by themselves before every update, roll-back and going back) and the versions installs and updates kept. id: the package id, or pageId: the app's top page.",
      inputSchema: z.object({ id: z.string().optional(), pageId: z.number().int().optional() }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ id, pageId }) =>
      guarded(h, async () => {
        const life = await import("./package-life");
        const app = id ? life.getInstalled(id) : pageId !== undefined ? life.appOfPage(pageId) : null;
        if (!app) return h.fail("No installed app there (workspace_packages lists them; pageId must be an app's top page).");
        const hist = life.appHistory(app.id);
        return h.ok([`${hist.name} (${hist.id}) ${hist.version}, top page ${app.rootId}`, "SAVE POINTS:", ...(hist.savePoints.length ? hist.savePoints.map((p) => `- savePoint ${p.n} · ${p.at} · ${p.auto ? "by itself" : p.by} · ${p.version}${p.label ? ` · ${p.label}` : ""}`) : ["(none)"]), `VERSIONS: ${hist.versions.join(", ") || "none"}`].join("\n"));
      }),
  );

  server.registerTool(
    "workspace_keep_app_state",
    {
      title: "Keep the whole app's current state",
      description: "A save point of an installed app now — before you change several of its parts, so the user (or you) can bring all of it back at once. label: what it is, in a few words.",
      inputSchema: z.object({ id: z.string(), label: z.string().max(200).optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ id, label }) =>
      guarded(h, async () => {
        const sp = (await import("./package-life")).keepAppState(id, label?.trim() || "Kept by the AI");
        return h.ok(sp ? `Kept: save point ${sp.n}.` : "Nothing changed since the last save point.");
      }),
  );

  server.registerTool(
    "workspace_restore_app",
    {
      title: "Bring the whole app back to a save point",
      description: "The whole app (every page below its top page) as it was at a save point from workspace_app_history; what it is now is kept as a save point first. Entries stay; pages added since stay. (Back to a version an update kept: workspace_package_rollback.)",
      inputSchema: z.object({ id: z.string(), savePoint: z.number().int() }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ id, savePoint }) =>
      guarded(h, async () => {
        const r = await (await import("./package-life")).restoreSavePoint(id, savePoint);
        return h.ok(`Back to save point ${savePoint}:\n${r.changes.map((c) => `- ${c}`).join("\n")}`);
      }),
  );
}
