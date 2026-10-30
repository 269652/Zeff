import path from "node:path";
import { z } from "zod";

/**
 * External plugins: a folder in <data>/plugins/<id>/ with a zeff-plugin.json — loaded when Zeff
 * runs, no rebuild, no source changes. This is the manifest's definition (docs/plugins/manifest.md
 * is its reference, docs/plugins/zeff-plugin.schema.json its JSON Schema, generated from here).
 *
 * Client-safe: no database, no file access.
 */

/** The version of the extension API this Zeff speaks (a plugin says which it was written for). */
export const API_VERSION = 1;

/**
 * What a plugin may be allowed to do — each named in its manifest, granted by you when you enable it.
 * A permission is an id like "work.read": Zeff brings `prompt`, `exec` and `network`; every plugin that
 * brings API methods brings the permissions they use (see lib/plugins/api.ts, GET /ext/docs for the list).
 */
export type Permission = string;
/** Set by lib/plugins/api-point.ts: whether some plugin brings the permission. Without it, every well-formed id passes. */
let permissionCheck: (p: string) => boolean = () => true;
export const setPermissionCheck = (fn: (p: string) => boolean) => {
  permissionCheck = fn;
};
const permissionId = z.string().regex(/^[a-z][a-z0-9]*(\.[a-z0-9]+)*$/, "a permission id like work.read or exec").refine((p) => permissionCheck(p), "no plugin brings this permission");

/**
 * The events a hook can listen to (docs/plugins/hooks.md). Like permissions they are brought by plugins
 * (Code: work.run.started, work.run.finished, work.changed; Todos: todos.changed; Kanban: kanban.changed …).
 */
export type ExtEvent = string;
let eventCheck: (e: string) => boolean = () => true;
/** Set by lib/plugins/api-point.ts: whether some plugin brings the event. */
export const setEventCheck = (fn: (e: string) => boolean) => {
  eventCheck = fn;
};
const eventId = z.string().regex(/^[a-z][a-z0-9]*(\.[a-z0-9]+)+$/, "an event name like work.run.finished").refine((e) => eventCheck(e), "no plugin brings this event");

/** Ids a plugin can't take: they're Zeff's own paths under /ext. */
export const RESERVED_IDS = ["sdk", "docs", "view", "raw"];

const slug = z
  .string()
  .regex(/^[a-z][a-z0-9-]{1,39}$/, "lower-case letters, digits and dashes, starting with a letter (2–40 characters)")
  .refine((s) => !RESERVED_IDS.includes(s), "this id is reserved");

const shortId = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, "lower-case letters, digits and dashes, starting with a letter");

/** A path inside the plugin's folder: relative, no "..". */
const relPath = z
  .string()
  .min(1)
  .max(200)
  .refine((p) => !path.isAbsolute(p) && !/^[a-zA-Z]:/.test(p) && !p.split(/[\\/]/).includes(".."), "a path inside the plugin's folder (relative, no ..)");

const mcpStdio = z.object({
  command: z.string().min(1).max(300).describe('The program. "node" is the Node that runs Zeff; "./x" is relative to the plugin folder.'),
  args: z.array(z.string().max(1000)).max(50).default([]),
  env: z.record(z.string(), z.string().max(2000)).default({}),
});
const mcpHttp = z.object({
  url: z.url({ protocol: /^https?$/ }).describe("An http(s) MCP endpoint."),
  headers: z.record(z.string(), z.string().max(2000)).default({}),
});

const command = z.object({
  id: shortId,
  label: z.string().min(1).max(40).describe('What the "/" menu shows.'),
  description: z.string().max(200).default(""),
  template: z.string().min(1).max(8000).describe("The text put into the message box when picked. May contain line breaks."),
});

const panel = z.object({
  id: shortId,
  title: z.string().min(1).max(40),
  entry: relPath.describe("The panel's HTML page, relative to the plugin's ui/ folder."),
  placement: z
    .enum(["tab", "session"])
    .default("tab")
    .describe('"tab": a view of its own, linked in Code\'s sidebar. "session": a drawer beside a session, which gets that session\'s ids.'),
});

const app = z.object({
  panel: shortId.describe("The id of one of the plugin's panels (workPanels) this entry opens."),
  label: z.string().min(1).max(30).describe("Its name in the menu."),
  short: z.string().min(1).max(12).describe("Its name in the header, when you put it there."),
  hint: z.string().max(80).default("").describe("A line under the name in the menu."),
});

const hook = z.object({
  command: z.array(z.string().max(1000)).min(1).max(50).describe('Program and arguments, no shell. "node" is the Node that runs Zeff; "./x" is relative to the plugin folder.'),
  timeoutMs: z.number().int().min(200).max(30000).default(5000),
});

const contributes = z.object({
  workerRules: z
    .union([relPath, z.array(relPath).max(10)])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .default([])
    .describe("Text files whose content is added to the rules of every Code worker. Needs the prompt permission."),
  workCommands: z.array(command).max(50).default([]).describe('Entries of the Code message box\'s "/" menu.'),
  workerMcpServers: z.record(shortId, z.union([mcpStdio, mcpHttp])).default({}).describe("MCP servers every Code worker gets (stdio: needs exec; http: needs network)."),
  workPanels: z.array(panel).max(20).default([]).describe("Views in Code, shown in a sandboxed frame."),
  apps: z.array(app).max(10).default([]).describe("Entries in Zeff's menu (Apps) that open one of its panels as a page of its own — you can put them in the header (Menu → Customize)."),
  hooks: z.record(eventId, hook).default({}).describe("Programs Zeff runs when something happens. Needs the exec permission."),
});

export const manifestSchema = z
  .object({
    $schema: z.string().optional(),
    id: slug.describe("Also the plugin folder's name."),
    name: z.string().min(1).max(60),
    version: z.string().max(30).default("0.0.0"),
    description: z.string().max(300).default(""),
    author: z.string().max(100).optional(),
    homepage: z.url().optional(),
    apiVersion: z.number().int().min(1).max(API_VERSION).describe(`The extension API version it was written for (this Zeff speaks up to ${API_VERSION}).`),
    permissions: z.array(permissionId).max(30).default([]).describe("What it may do (granted by you): exec, network, prompt, and the permissions plugins bring (work.read, todos.write, workspace.write …)."),
    contributes: contributes.default({ workerRules: [], workCommands: [], workerMcpServers: {}, workPanels: [], apps: [], hooks: {} }),
  })
  .superRefine((m, ctx) => {
    const has = (p: Permission) => m.permissions.includes(p);
    const need = (p: Permission, path: (string | number)[], what: string) => {
      if (!has(p)) ctx.addIssue({ code: "custom", path, message: `${what} needs the "${p}" permission` });
    };
    if (m.contributes.workerRules.length) need("prompt", ["contributes", "workerRules"], "workerRules");
    if (Object.keys(m.contributes.hooks).length) need("exec", ["contributes", "hooks"], "hooks");
    for (const [name, s] of Object.entries(m.contributes.workerMcpServers)) {
      if ("command" in s) need("exec", ["contributes", "workerMcpServers", name], `The stdio MCP server "${name}"`);
      else need("network", ["contributes", "workerMcpServers", name], `The http MCP server "${name}"`);
    }
    const dup = (list: { id: string }[], key: string) => {
      const seen = new Set<string>();
      list.forEach((x, i) => {
        if (seen.has(x.id)) ctx.addIssue({ code: "custom", path: ["contributes", key, i, "id"], message: `"${x.id}" is used twice` });
        seen.add(x.id);
      });
    };
    dup(m.contributes.workCommands, "workCommands");
    dup(m.contributes.workPanels, "workPanels");
    m.contributes.apps.forEach((a, i) => {
      if (!m.contributes.workPanels.some((p) => p.id === a.panel)) ctx.addIssue({ code: "custom", path: ["contributes", "apps", i, "panel"], message: `no panel "${a.panel}" in workPanels` });
    });
  });

export type Manifest = z.output<typeof manifestSchema>;
export type McpServerDecl = Manifest["contributes"]["workerMcpServers"][string];

/** A manifest as text (JSON) → the manifest, or what's wrong with it, in plain sentences. */
export function parseManifest(text: string): { ok: true; manifest: Manifest } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ""));
  } catch (e) {
    return { ok: false, error: `zeff-plugin.json isn't valid JSON: ${(e as Error).message}` };
  }
  const r = manifestSchema.safeParse(raw);
  if (r.success) return { ok: true, manifest: r.data };
  return {
    ok: false,
    error: r.error.issues
      .slice(0, 6)
      .map((i) => `${i.path.length ? i.path.join(".") : "(manifest)"}: ${i.message}`)
      .join("; "),
  };
}
