/**
 * Tools external plugins bring (a manifest's `contributes.tools`, capability A of docs/plugins/runtime-conversion.md): each a plugin
 * function the AI calls by its own name, beside Zeff's own tools — in Zeff's MCP, the Workspace chat and agents. Registered after Zeff's
 * own: a name that is taken (Zeff's, or another plugin's) is left out, so a port can take over a built-in's tool name once the built-in
 * is gone. The plugin must be on when the tool is called (safe mode: every plugin is off), and its function does only what the user
 * granted it. Server only.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { enabledPlugins } from "@/lib/ext/registry";
import type { Manifest } from "@/lib/ext/manifest";

type Helpers = { run: (fn: () => unknown) => Promise<never>; ok: (text: string) => never; fail: (text: string) => never };
type ToolDecl = Manifest["contributes"]["tools"][number];

const ARG: Record<ToolDecl["input"][number]["type"], () => z.ZodType> = {
  text: () => z.string(),
  number: () => z.number(),
  boolean: () => z.boolean(),
  json: () => z.unknown(),
  list: () => z.array(z.unknown()),
};

/** A declared tool's arguments as the schema the AI sees. */
export function toolSchema(t: ToolDecl): z.ZodObject<Record<string, z.ZodType>> {
  return z.object(Object.fromEntries(t.input.map((a) => {
    const s = ARG[a.type]().describe(a.description || a.name);
    return [a.name, a.required ? s : s.optional()];
  })));
}

/** A function's answer as the tool's text: text as it is, anything else as JSON (long answers cut). */
export function toolText(v: unknown): string {
  const s = typeof v === "string" ? v : JSON.stringify(v ?? null, null, 2);
  return s.length > 60_000 ? `${s.slice(0, 60_000)}\n… (cut: ${s.length} characters)` : s;
}

/** One of the plugin's own lambdas (kind function) run with these arguments — never another plugin's or yours. */
export async function runOwnLambda(pluginId: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  const { getLambda } = await import("./lambdas/store");
  const l = getLambda(name);
  if (!l || l.plugin !== `ext:${pluginId}`) throw new Error(`The plugin has no lambda “${name}”.`);
  if (l.manifest.kind !== "function") throw new Error(`“${name}” is a lookup, not a function.`);
  const { runLambda } = await import("./lambdas/run");
  const r = await runLambda(l, args);
  if (!r.ok) throw new Error(r.error);
  return r.result;
}

/** The tools of the plugins that are on now, registered where Zeff's own are. Returns the names registered. */
export function registerPluginTools(server: McpServer, h: Helpers): string[] {
  const done: string[] = [];
  let plugins: ReturnType<typeof enabledPlugins> = [];
  try {
    plugins = enabledPlugins();
  } catch {
    return done; // (no account database yet)
  }
  for (const p of plugins) {
    for (const t of p.manifest.contributes.tools) {
      try {
        server.registerTool(
          t.name,
          {
            title: t.title || t.name,
            description: `${t.description} (From the plugin “${p.manifest.name}”.)`,
            inputSchema: toolSchema(t),
            annotations: { readOnlyHint: t.readOnly, openWorldHint: true },
          },
          async (args: Record<string, unknown>) =>
            h.run(async () => {
              const { getPlugin } = await import("@/lib/ext/registry");
              if (!getPlugin(p.id)?.enabled) return h.fail(`The plugin “${p.manifest.name}” is off — this tool isn't available.`);
              if (t.lambda) return h.ok(toolText(await runOwnLambda(p.id, t.lambda, args ?? {})));
              const { runPluginFunction } = await import("./plugin-fn");
              return h.ok(toolText(await runPluginFunction(p.id, t.function!, args ?? {})));
            }),
        );
        done.push(t.name);
      } catch {
        // (a name that is taken: Zeff's own, or another plugin's — left out)
      }
    }
  }
  return done;
}

/** The names of the tools the plugins that are on bring (a built-in whose port is on leaves its name to it). */
export function pluginToolNames(): Set<string> {
  try {
    return new Set(enabledPlugins().flatMap((p) => p.manifest.contributes.tools.map((t) => t.name)));
  } catch {
    return new Set();
  }
}
