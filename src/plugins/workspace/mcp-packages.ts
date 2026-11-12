/**
 * The assistant's tools for packages that live (package-life.ts): what is installed and on offer, what a package asks for, install, update in
 * place, history, roll back, the package's own tests. Server only.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { guarded, type Helpers } from "./mcp";

const testLines = (r: { ok: boolean; name: string; detail: string }[]) => r.map((t) => `${t.ok ? "✓" : "✗"} ${t.name}: ${t.detail}`).join("\n");

export function registerPackageTools(server: McpServer, h: Helpers): void {
  server.registerTool(
    "workspace_packages",
    {
      title: "Packages: installed and on offer",
      description: "The apps (packages) installed with their version and whether a newer one is on offer, and the packages on offer from the plugins that are on, with what each needs.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () =>
      guarded(h, async () => {
        const life = await import("./package-life");
        const { listPackages } = await import("./packages");
        const installed = await life.packageStatus();
        const lines = [
          "INSTALLED:",
          ...(installed.length ? installed.map((p) => `- ${p.id} ${p.version}${p.updateAvailable ? ` -> ${p.offered} on offer` : ""} (page ${p.rootId}; ${p.lastChange}; versions kept: ${p.versionsKept.join(", ") || "none"})`) : ["(none)"]),
          "ON OFFER:",
          ...listPackages().map((o) => `- ${life.packageIdOf(o.pkg)}${o.pkg.version ? ` ${o.pkg.version}` : ""} "${o.name}"${o.description ? ` - ${o.description}` : ""}${o.pkg.requires?.length ? ` · needs ${o.pkg.requires.map((r) => r.package + (r.version ? ` ${r.version}` : "")).join(", ")}` : ""}${o.pkg.plugins?.length ? ` · plugins ${o.pkg.plugins.join(", ")}` : ""}`),
        ];
        return h.ok(lines.join("\n"));
      }),
  );

  server.registerTool(
    "workspace_package_permissions",
    {
      title: "What a package asks for",
      description: "Before installing: the flows' permissions, routines, widgets with code, plugins and other packages a package on offer needs, and what stands in the way.",
      inputSchema: z.object({ package: z.string() }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ package: key }) =>
      guarded(h, async () => {
        const life = await import("./package-life");
        const pkg = await life.findOffered(key);
        if (!pkg) return h.fail(`No package "${key}" is on offer (workspace_packages lists them).`);
        const p = life.packagePermissions(pkg);
        const problems = life.checkRequirements(pkg);
        return h.ok([`${pkg.name} ${pkg.version ?? ""}`.trim(), problems.length ? `IN THE WAY: ${problems.join(" ")}` : "Nothing in the way.", `FLOWS: ${p.flows.join(" | ") || "none"}`, `ROUTINES: ${p.routines.join(" | ") || "none"}`, `WIDGETS: ${p.widgets.join(" | ") || "none"}`, `PLUGINS: ${p.plugins.join(", ") || "none"}`, `PACKAGES: ${p.requires.join(", ") || "none"}`].join("\n"));
      }),
  );

  server.registerTool(
    "workspace_package_install",
    {
      title: "Install a package",
      description: "Installs a package on offer (new pages under the given page, or at the top); remembered when it has a version, so a newer one updates it in place. Flows and routines come in without permissions / switched off. The package's own tests run.",
      inputSchema: z.object({ package: z.string(), parentId: z.number().int().optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ package: key, parentId }) =>
      guarded(h, async () => {
        const life = await import("./package-life");
        const pkg = await life.findOffered(key);
        if (!pkg) return h.fail(`No package "${key}" is on offer.`);
        const r = await life.installTracked(pkg, parentId ?? null);
        return h.ok(`Installed "${pkg.name}" as page ${r.rootId}${r.remembered ? ` (version ${pkg.version} remembered)` : " (no version: not remembered)"}.${r.tests.length ? `\nTESTS:\n${testLines(r.tests)}` : ""}`);
      }),
  );

  server.registerTool(
    "workspace_package_update",
    {
      title: "Update an installed package in place",
      description: "Brings an installed package to the newest version on offer: new parts are added, what the package changed and you did not is updated, what you changed stays (force=true: the package's version replaces yours), declared migrations change the data. Says what was changed and kept, and runs the tests.",
      inputSchema: z.object({ id: z.string(), force: z.boolean().optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ id, force }) =>
      guarded(h, async () => {
        const life = await import("./package-life");
        const pkg = await life.offeredPackage(id);
        if (!pkg) return h.fail(`No newer package is on offer for "${id}".`);
        const r = await life.updateTracked(id, pkg, { force: force === true });
        return h.ok(`${r.id}: ${r.from} -> ${r.to}\nCHANGED:\n${r.changes.map((c) => `- ${c}`).join("\n")}\nKEPT (yours):\n${r.kept.map((c) => `- ${c}`).join("\n") || "- nothing"}${r.tests.length ? `\nTESTS:\n${testLines(r.tests)}` : ""}`);
      }),
  );

  server.registerTool(
    "workspace_package_history",
    {
      title: "A package's history",
      description: "Every install, update and roll-back of a package with what changed and the test results, and which versions can be rolled back to.",
      inputSchema: z.object({ id: z.string() }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ id }) =>
      guarded(h, async () => {
        const life = await import("./package-life");
        const p = life.getInstalled(id);
        if (!p) return h.fail(`The package "${id}" is not installed.`);
        return h.ok([`${p.name} ${p.version} · versions kept: ${life.versionsKept(id).join(", ") || "none"}`, ...p.history.map((e) => `${e.at.slice(0, 16)} ${e.action} ${e.from ?? "-"} -> ${e.to}: ${e.changes.join("; ")}${e.tests ? ` [tests ${e.tests.filter((t) => t.ok).length}/${e.tests.length}]` : ""}`)].join("\n"));
      }),
  );

  server.registerTool(
    "workspace_package_rollback",
    {
      title: "Roll a package back to a version kept",
      description: "Brings the structure of an older version of a package back over the pages (the package's version replaces yours there). Data migrated by newer versions is not undone.",
      inputSchema: z.object({ id: z.string(), version: z.string() }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ id, version }) =>
      guarded(h, async () => {
        const r = await (await import("./package-life")).rollbackTracked(id, version);
        return h.ok(`${r.id}: ${r.from} -> ${r.to}\n${r.changes.map((c) => `- ${c}`).join("\n")}`);
      }),
  );

  server.registerTool(
    "workspace_package_test",
    {
      title: "Run a package's own tests",
      description: "Runs the checks that ship with an installed package (pages and properties there, row counts, views that hold together, flows in a dry run).",
      inputSchema: z.object({ id: z.string() }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ id }) =>
      guarded(h, async () => {
        const r = await (await import("./package-life")).runPackageTests(id);
        return h.ok(r.length ? testLines(r) : "This package ships no tests.");
      }),
  );
}
