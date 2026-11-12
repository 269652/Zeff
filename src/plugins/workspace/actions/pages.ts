"use server";

import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { docToMarkdown, markdownToDoc } from "../doc";
import * as store from "../store";
import { localDay } from "@/lib/dates";
import { run, type Result } from "./shared";

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export async function treeAction() {
  return run(() => ({ items: store.tree() }));
}

export async function templatesAction() {
  return run(async () => ({ templates: (await import("../templates")).templateMetas() }));
}

/** What the "+" menu's "Automation …" offers (an agent's page, an automation's, the jobs for agents, the rules). */
export async function automationKindsAction() {
  return run(async () => ({ kinds: (await import("../automation-new")).AUTOMATION_KINDS() }));
}

/** A built-in template made as a template of yours (to change it). Returns its page. */
export async function duplicateTemplateAction(key: string) {
  return run(async () => ({ id: (await import("../templates")).duplicateBuiltin(String(key)) }));
}

/** A page copied into your templates (the page stays). Returns the template's page. */
export async function saveAsTemplateAction(id: number) {
  return run(async () => ({ id: (await import("../templates")).saveAsTemplate(Number(id)) }));
}

/** A page moved into your templates, or out of them into the page tree. */
export async function setTemplateAction(id: number, on: boolean) {
  return run(async () => ((await import("../templates")).setTemplate(Number(id), !!on), {}));
}

/** The user's answer to what a worker asked in a job: it goes on (see jobs.ts answerJob). */
export async function answerJobAction(rowId: number, answer: string) {
  return run(async () => {
    await (await import("../jobs")).answerJob(Number(rowId), String(answer ?? ""));
    return {};
  });
}

/** The delivery (push, merge request) proposed again for a job in review that has none (its commits are looked for again). */
export async function proposeJobDeliveryAction(rowId: number) {
  return run(async () => {
    const p = await (await import("../jobs")).proposeJobDelivery(Number(rowId));
    if (!p) throw new Error(t("Nothing to deliver: the worker's branch has no commits."));
    return { text: p.text };
  });
}

/** The delivery proposed under a job, run now: push the branch, open the merge request (the todo's actions). */
export async function runJobDeliveryAction(rowId: number, only?: number[]) {
  return run(async () => {
    const row = store.getPage(Number(rowId));
    if (!row) throw new Error(t("No such row."));
    // The delivery as the card shows it (the todo that carries the branch's actions now).
    const panel = (await (await import("../jobs")).jobPanels([{ id: row.id, cells: row.props }]))[row.id];
    const todoId = panel?.delivery?.todoId;
    if (!todoId) throw new Error(t("No delivery is proposed for this job."));
    const { runTodoOpsNow } = await import("@/lib/ops");
    const r = await runTodoOpsNow(Number(todoId), { only: Array.isArray(only) ? only.map(Number).filter(Number.isInteger) : undefined });
    return { done: r.done };
  });
}

export async function createPageAction(v: { parentId?: number | null; kind?: "page" | "database" | "form"; title?: string; templateKey?: string; /** A new template of yours (at the top of the templates). */ template?: boolean; /** One of "Automation …"'s (an agent, an automation, the jobs, the rules — automation-new.ts). */ automation?: string }) {
  return run(async () => {
    if (v.automation) return { id: (await import("../automation-new")).createAutomation(v.automation, v.parentId ?? null) };
    if (v.templateKey) {
      const { fromTemplate } = await import("../templates");
      return { id: await fromTemplate(v.templateKey, v.parentId ?? null) };
    }
    return { id: store.createPage({ parentId: v.parentId ?? null, kind: v.kind, title: v.title, template: !!v.template }) };
  });
}

/** Today's page: under "Daily notes", made at the first use — with your open todos that are due, as links. Returns its id. */
export async function todayPageAction() {
  return run(async () => {
    const d = new Date();
    const day = localDay(d);
    const topTitle = t("Daily notes");
    const top = store.tree().find((x) => x.parentId === null && x.title === topTitle) ?? null;
    const parentId = top ? top.id : store.createPage({ title: topTitle, icon: "🗓️" });
    const had = store.tree().find((x) => x.parentId === parentId && x.title === day);
    if (had) return { id: had.id };
    const content: object[] = [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: t("Plan") }] }];
    if (isInstalled("todos")) {
      const { listTodos } = await import("@/lib/todos/store");
      const due = listTodos({ status: "open" })
        .filter((x) => x.owner === "me" && x.due && x.due <= day)
        .slice(0, 12);
      if (due.length)
        content.push({
          type: "taskList",
          content: due.map((x) => ({ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "zeffRef", attrs: { kind: "todo", ref: String(x.id), label: `${x.ref} ${x.text}`.slice(0, 80), href: `/t/${x.id}` } }] }] })),
        });
    }
    content.push({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: t("Notes") }] }, { type: "paragraph" });
    return { id: store.createPage({ parentId, title: day, icon: "📅", content: { type: "doc", content } }) };
  });
}

export async function savePageAction(id: number, patch: store.PagePatch, rev?: number): Promise<Result<{ save: store.SaveResult }>> {
  return run(() => {
    const page = store.getPage(Number(id));
    if (!page) throw new Error(t("This page is gone."));
    if (page.locked && (patch.content !== undefined || patch.title !== undefined) && patch.locked === undefined) throw new Error(t("This page is locked."));
    // The editor sends its document as JSON text: ProseMirror's attribute objects have no prototype, which the action protocol can't carry as objects.
    let content = patch.content;
    if (typeof content === "string") {
      try {
        content = JSON.parse(content);
      } catch {
        throw new Error(t("The page content isn't readable."));
      }
    }
    const save = store.updatePage(Number(id), { ...patch, content }, rev);
    // A person's name changed on their page: the profile follows now.
    if (patch.title !== undefined && page.dbId) void import("../pipeline").then((p) => p.syncAfterEdit(Number(id))).catch(() => undefined);
    return { save };
  });
}

/** The favorites put in a new order (dragged in the sidebar). */
export async function favoriteOrderAction(ids: number[]) {
  return run(() => (store.setFavoriteOrder(ids), {}));
}

export async function movePageAction(id: number, parentId: number | null, beforeId?: number | null) {
  return run(() => (store.movePage(Number(id), parentId, beforeId), {}));
}

export async function archivePageAction(id: number) {
  // A row of a two-way source (an appointment): the record goes first - one that can't be deleted there keeps the row.
  return run(async () => {
    await (await import("../source-write")).removeFromSource(Number(id));
    store.archivePage(Number(id));
    return {};
  });
}

export async function restorePageAction(id: number) {
  return run(() => (store.restorePage(Number(id)), {}));
}

export async function deletePageAction(id: number) {
  return run(() => (store.deletePage(Number(id)), {}));
}

export async function emptyTrashAction() {
  return run(() => ({ n: store.emptyTrash() }));
}

export async function duplicatePageAction(id: number) {
  return run(() => ({ id: store.duplicatePage(Number(id)) }));
}

export async function historyAction(pageId: number) {
  return run(() => ({ versions: store.versions(Number(pageId)) }));
}

export async function versionAction(versionId: number) {
  return run(() => {
    const v = store.getVersion(Number(versionId));
    if (!v) throw new Error(t("No such version."));
    return { version: { id: v.id, at: v.at, title: v.title, markdown: docToMarkdown(v.content) } };
  });
}

export async function restoreVersionAction(versionId: number) {
  return run(() => (store.restoreVersion(Number(versionId)), {}));
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

export async function exportMarkdownAction(pageId: number) {
  return run(() => {
    const p = store.getPage(Number(pageId));
    if (!p) throw new Error(t("This page is gone."));
    return { filename: `${(p.title || "page").replace(/[^\p{L}\p{N}_-]+/gu, "_")}.md`, markdown: `${p.title ? `# ${p.title}\n\n` : ""}${docToMarkdown(p.content)}` };
  });
}

/** A page (or a database as its table) as one HTML file that cannot be changed - for sending to a colleague. */
export async function exportHtmlAction(pageId: number) {
  return run(async () => (await import("../export-html")).pageToHtml(Number(pageId)));
}

/** A page from Markdown: its first "# Heading" is the title, else `fallbackTitle` (the file's name). */
export async function importMarkdownAction(markdown: string, fallbackTitle: string, parentId: number | null) {
  return run(() => {
    const md = String(markdown ?? "");
    // A first "# Heading" is the title.
    const m = /^#\s+(.+?)\s*\n+/.exec(md);
    const doc = markdownToDoc(m ? md.slice(m[0].length) : md);
    return { id: store.createPage({ parentId, title: m?.[1] || fallbackTitle || t("Imported page"), content: doc }) };
  });
}

// ---------------------------------------------------------------------------
// Packages
// ---------------------------------------------------------------------------

/** A page and what is below it as a package file (JSON) — to keep, send, or have a plugin ship. */
export async function exportPackageAction(pageId: number, includeRows = false) {
  return run(async () => {
    const p = store.getPage(Number(pageId));
    if (!p) throw new Error(t("No such page."));
    const pkg = (await import("../packages")).exportPackage(p.id, { name: p.title || t("Untitled"), icon: p.icon || undefined, includeRows: !!includeRows });
    return { filename: `${(p.title || "package").replace(/[^\p{L}\p{N}_-]+/gu, "_")}.zeff-package.json`, json: JSON.stringify(pkg, null, 2) };
  });
}

/**
 * A page and what is below it saved as a plugin: a folder in Zeff's plugins folder (zeff-plugin.json + app.json) whose app is
 * offered under New → templates once the plugin is switched on — to keep, to hand on (copy the folder), to install elsewhere.
 * Saved again: the same plugin, its version one up.
 */
export async function savePageAsPluginAction(pageId: number, includeRows = false) {
  return run(async () => {
    const p = store.getPage(Number(pageId));
    if (!p) throw new Error(t("No such page."));
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { pluginsRoot, scanPlugins } = await import("@/lib/ext/registry");
    const { API_VERSION } = await import("@/lib/ext/manifest");
    const name = p.title || t("Untitled");
    const slug = `app-${name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || p.id}`;
    const pkg = (await import("../packages")).exportPackage(p.id, { name, icon: p.icon || undefined, includeRows: !!includeRows });
    const dir = path.join(pluginsRoot(), slug);
    let version = "1.0.0";
    try {
      const had = JSON.parse(fs.readFileSync(path.join(dir, "zeff-plugin.json"), "utf8")) as { version?: string };
      const [a, b, c] = String(had.version ?? "1.0.0").split(".").map((x) => Number(x) || 0);
      version = `${a}.${b}.${c + 1}`;
    } catch {
      /* (new) */
    }
    fs.mkdirSync(dir, { recursive: true });
    const manifest = { id: slug, name: name.slice(0, 60), version, description: t("The app „{name}“ from the Workspace: its pages, databases, widgets and flows.", { name }).slice(0, 300), apiVersion: API_VERSION, permissions: [], contributes: { workspacePackages: ["app.json"] } };
    fs.writeFileSync(path.join(dir, "zeff-plugin.json"), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(dir, "app.json"), JSON.stringify(pkg, null, 2));
    scanPlugins(true);
    return { id: slug, dir, version };
  });
}

/** A package file (its text) made into pages below a page (or at the top). */
export async function installPackageAction(json: string, parentId: number | null) {
  return run(async () => {
    let pkg: unknown;
    try {
      pkg = JSON.parse(String(json));
    } catch {
      throw new Error(t("This is not a package file."));
    }
    const r = await (await import("../package-life")).installTracked(pkg as never, parentId ?? null);
    return { id: r.rootId, tests: r.tests };
  });
}
