/**
 * The assistant's tools for the server functions plugins bring (a manifest's `contributes.functions`): which there are
 * (workspace_functions) and calling one (workspace_call_function). A function reads or changes Zeff only through what the user granted
 * it in advance (Settings → Notebook → Functions) — an agent calling it gets no more than that. Server only.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { guarded, type Helpers } from "./mcp";

export function registerFunctionTools(server: McpServer, h: Helpers): void {
  server.registerTool(
    "workspace_functions",
    {
      title: "The server functions plugins bring",
      description: "The functions of the plugins that are on: plugin, name, what it does, its arguments, what of Zeff it needs and whether that is granted. Call one with workspace_call_function.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () =>
      guarded(h, async () => {
        if (!(await import("@/plugins/state")).isInstalled("notebook")) return h.fail("The Notebook plugin is not installed — it runs plugin functions (Menu → Plugins).");
        const { listFunctions } = await import("@/plugins/notebook/functions");
        const { needsGranted } = await import("@/plugins/notebook/grants");
        const fns = listFunctions();
        if (!fns.length) return h.ok("No plugin that is on brings a function.");
        return h.ok(fns.map((f) => `${f.plugin}.${f.name} (${f.runtime})${f.title ? ` — ${f.title}` : ""}${f.description ? `: ${f.description}` : ""}${Object.keys(f.input).length ? ` · arguments: ${Object.entries(f.input).map(([k, v]) => `${k} (${v})`).join(", ")}` : ""}${f.needs.length ? ` · needs: ${f.needs.map((n) => `${n}${needsGranted(f.plugin, [n]) ? " ✓" : " ✗ (not granted)"}`).join(", ")}` : ""}`).join("\n"));
      }),
  );

  server.registerTool(
    "workspace_call_function",
    {
      title: "Call a plugin's server function",
      description: "Runs a function a plugin brings (code in a container) with arguments and gives back what it returns. Running code must be switched on (Settings → Notebook); what the function may read or change of Zeff is only what the user granted it.",
      inputSchema: z.object({ plugin: z.string(), name: z.string(), args: z.record(z.string(), z.unknown()).optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ plugin, name, args }) =>
      guarded(h, async () => {
        if (!(await import("@/plugins/state")).isInstalled("notebook")) return h.fail("The Notebook plugin is not installed — it runs plugin functions (Menu → Plugins).");
        const { callFunction } = await import("@/plugins/notebook/functions");
        const r = await callFunction(plugin, name, args ?? {});
        return r.ok ? h.ok(`${JSON.stringify(r.value, null, 2)}${r.log ? `\n\n[log]\n${r.log}` : ""}`) : h.fail(`${r.error}${r.log ? `\n\n[log]\n${r.log}` : ""}`);
      }),
  );

  server.registerTool(
    "workspace_function_source",
    {
      title: "A plugin function's code",
      description: "The code of a function a plugin brings (workspace_functions), its runtime and its earlier versions (id, when, size). Read it before you change it with workspace_save_function — to improve it or to repair it when it fails (the failure is in workspace_flow_runs or what workspace_call_function said). With version: that version's code.",
      inputSchema: z.object({ plugin: z.string(), name: z.string(), version: z.string().optional() }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ plugin, name, version }) =>
      guarded(h, async () => {
        const src = (await import("@/plugins/notebook/function-source")).functionSource(plugin, name);
        if (version) return h.ok((await import("@/plugins/notebook/function-source")).functionVersionCode(plugin, name, version));
        const versions = src.versions.length ? `

Earlier versions (newest first): ${src.versions.map((v) => `${v.id} (${v.at}, ${v.size} B)`).join(", ")}` : "";
        return h.ok(`${plugin}.${name} — ${src.file} (${src.runtime}):

${src.code}${versions}`);
      }),
  );

  server.registerTool(
    "workspace_save_function",
    {
      title: "Change a plugin function's code",
      description:
        "Saves new code for a plugin's function (the code before is kept as a version: workspace_function_source lists them, workspace_restore_function brings one back). A Node.js function's code is the body of an async function with `zeff` and `inputs`; it must parse or nothing is saved. With test (arguments): it is called right after — and if that fails, the code before is put back, unless keep is true. What it may read or change of Zeff stays what the user granted it.",
      inputSchema: z.object({ plugin: z.string(), name: z.string(), code: z.string().min(1).max(200000), test: z.record(z.string(), z.unknown()).optional(), keep: z.boolean().optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ plugin, name, code, test, keep }) =>
      guarded(h, async () => {
        const src = await import("@/plugins/notebook/function-source");
        const before = src.functionSource(plugin, name);
        src.saveFunctionSource(plugin, name, code);
        if (!test) return h.ok(`Saved ${plugin}.${name}.`);
        const r = await (await import("@/plugins/notebook/functions")).callFunction(plugin, name, test);
        if (r.ok) return h.ok(`Saved ${plugin}.${name}; the test returned:
${JSON.stringify(r.value, null, 2)}${r.log ? `

[log]
${r.log}` : ""}`);
        if (!keep) src.saveFunctionSource(plugin, name, before.code);
        return h.fail(`The test failed${keep ? "" : " — the code before is back"}: ${r.error}${r.log ? `

[log]
${r.log}` : ""}`);
      }),
  );

  server.registerTool(
    "workspace_restore_function",
    {
      title: "Bring a plugin function's code back",
      description: "Puts a version of a function's code back (workspace_function_source lists them); the code it has now is kept as a version in turn.",
      inputSchema: z.object({ plugin: z.string(), name: z.string(), version: z.string() }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ plugin, name, version }) =>
      guarded(h, async () => {
        (await import("@/plugins/notebook/function-source")).restoreFunctionSource(plugin, name, version);
        return h.ok(`${plugin}.${name} is back as it was in version ${version}.`);
      }),
  );
}
