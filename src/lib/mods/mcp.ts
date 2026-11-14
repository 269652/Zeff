/**
 * The assistant's tools for mods (docs/mods.md): find a hook (and read its code, where Zeff's sources are), the mods there with their
 * state and errors, a mod's code, a mod written (built — it stays off until the user switches it on: a mod runs with Zeff's rights).
 * Server only.
 */
import fs from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { withEmbeds, type ModEmbed } from "@/plugins/workspace/chat-embed";

type Helpers = { run: <T>(fn: () => T | Promise<T>) => Promise<T>; ok: (t: string) => never; fail: (t: string) => never };

export const MOD_DOCS = `MODS change Zeff itself — any exported function or component of its code, without touching that code. (A plugin works inside Zeff: apps, functions, flows. A mod is for changing how Zeff behaves or looks.)

WHEN A MOD: only when Zeff itself must look or behave differently (a built-in page, a menu, a component the user didn't build). What the user built (a view, its template, a widget, a block, fields, a flow) or a plugin's function is changed with their own tools, not with a mod: a mod runs with Zeff's rights. When the user pointed at something ("[Gezeigt: …]"), its hook names are the components that draw it, innermost first: read that one's code (workspace_mod_hooks id + code: true) and hook exactly it.

HOOKS: every exported function and component has a hook, named by its file below src/ and its name: "plugins/workspace/store#updateSchema", "plugins/workspace/ui/PageView#PageView". workspace_mod_hooks finds them (and shows their code). side: server (runs on the server) or client (runs in the browser; a client component also renders on the server).

A MOD is a folder: zeff-mod.json { id ("sidebar-clock"), name, version, description, server: "server.ts", client: "client.tsx", css: "style.css" } (each part optional) and those files. Each part exports one function that registers what it does:

  // client.tsx — runs in the browser (and where a client component renders on the server)
  import type { ModApi } from "@zeff/mod";
  export default (mod: ModApi) => {
    mod.wrap("plugins/workspace/ui/PageView#PageView", (Orig) => (props) => (<><div className="text-xs">hello</div><Orig {...props} /></>));
  };
  // server.ts — runs on the server
  export default (mod) => {
    mod.after("plugins/workspace/store#getPage", (page) => page);               // change a result (a Promise's value for async)
    mod.before("plugins/workspace/store#updatePage", (args) => args);            // change the arguments (return the new list)
    mod.around("lib/attention#listAttention", async (next, ...args) => (await next(...args)).slice(0, 5));
    mod.replace("some/file#fn", (...args) => …);                                 // instead of it
  };

- mod.host.React is Zeff's React (import React from "react" gives the same); a server part may import Node's modules ("node:fs"). Nothing else from outside the mod's folder — no npm packages; bring your own code (several files in the folder are bundled).
- css: plain CSS for the whole app (Tailwind classes exist only where Zeff uses them).
- SAFE BY DESIGN: a hook that throws is passed by (the original runs, or its result is kept); a mod failing 5 times is switched off. A mod records the code hash of each hook it names (filled in on save): when Zeff changes that function, the hook is held back (shown on the Mods page) — adapt the mod to the new code.
- A mod you save is built at once (its problems come back) and stays OFF until the user switches it on in Plugins → Mods (a mod runs with Zeff's rights). Tell the user that.
- Hook exported functions, not inside them: when what you need is in the middle of a function, wrap the function (around) and change what goes in or comes out; if that can't reach it, say so.`;

export function registerModTools(server: McpServer, h: Helpers): void {
  server.registerTool(
    "workspace_mod_docs",
    { title: "How mods work", description: "How a mod is written (its hooks, its parts, what it may do) — read before writing one.", inputSchema: z.object({}), annotations: { readOnlyHint: true, idempotentHint: true } },
    async () => h.run(() => h.ok(MOD_DOCS)),
  );

  server.registerTool(
    "workspace_mod_hooks",
    {
      title: "Find a hook",
      description: "The hooks of Zeff's functions and components that match the words (a file, a name: \"PageView\", \"workspace/store update\"), with their parameters, side (server/client) and place. With code: true and one id, that function's code (where Zeff's sources are here).",
      inputSchema: z.object({ query: z.string().max(200), side: z.enum(["server", "client"]).optional(), id: z.string().max(300).optional(), code: z.boolean().optional(), limit: z.number().int().min(1).max(200).optional() }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ query, side, id, code, limit }) =>
      h.run(async () => {
        const { hookCatalog } = await import("./store");
        const all = hookCatalog();
        if (!all.length) return h.fail("No catalog of hooks here (zeff-hooks.json is made by the build).");
        if (id) {
          const p = all.find((x) => x.id === id);
          if (!p) return h.fail(`No hook “${id}”.`);
          let src = "";
          if (code) {
            try {
              const lines = fs.readFileSync(/*turbopackIgnore: true*/ path.join(process.cwd(), p.file), "utf8").split("\n");
              src = `\n\n${lines.slice(p.line - 1, p.line + 80).join("\n")}`;
            } catch {
              src = "\n\n(Zeff's sources are not here — only its build.)";
            }
          }
          return h.ok(`${p.id} · ${p.kind}${p.async ? " (async)" : ""} · ${p.side} · ${p.file}:${p.line} · (${p.params}) · hash ${p.hash}${src}`);
        }
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        const hits = all.filter((p) => (!side || p.side === side) && words.every((w) => p.id.toLowerCase().includes(w)));
        return h.ok(hits.length ? `${hits.length} hooks${hits.length > (limit ?? 40) ? ` (first ${limit ?? 40})` : ""}:\n${hits.slice(0, limit ?? 40).map((p) => `- ${p.id} · ${p.kind}${p.async ? " async" : ""} · ${p.side} · (${p.params})`).join("\n")}` : "No hook matches.");
      }),
  );

  server.registerTool(
    "workspace_mods",
    { title: "The mods", description: "The mods here: on or off (and why off), their parts, errors, the hooks they hold back (Zeff changed them since), versions.", inputSchema: z.object({}), annotations: { readOnlyHint: true, idempotentHint: true } },
    async () =>
      h.run(async () => {
        const r = await (await import("./actions")).modsOverviewAction();
        if (!r.ok) return h.fail(r.error);
        if (!r.mods.length) return h.ok(`No mods yet.${r.safe ? " (Safe mode is on.)" : ""}`);
        return h.ok([r.safe ? "SAFE MODE IS ON: no mod runs." : "", ...r.mods.map((m) => `- ${m.id} ${m.version} “${m.name}” · ${m.enabled ? "ON" : `off${m.disabledReason ? ` (${m.disabledReason})` : ""}`} · ${m.parts.join(", ")}${m.problems.length ? ` · BUILD: ${m.problems.join("; ")}` : ""}${m.stale.length ? ` · HELD BACK: ${m.stale.join(", ")}` : ""}${m.errors.length ? ` · ERRORS: ${m.errors.map((e) => `${e.hook}: ${e.message}`).join(" | ")}` : ""}`)].filter(Boolean).join("\n"));
      }),
  );

  server.registerTool(
    "workspace_mod_read",
    { title: "A mod's code", description: "A mod's files: its zeff-mod.json and its parts.", inputSchema: z.object({ id: z.string() }), annotations: { readOnlyHint: true, idempotentHint: true } },
    async ({ id }) =>
      h.run(async () => {
        const files = (await import("./store")).modSources(id);
        return h.ok(Object.entries(files).map(([n, s]) => `=== ${n}\n${s}`).join("\n\n"));
      }),
  );

  server.registerTool(
    "workspace_mod_save",
    {
      title: "Write a mod",
      description:
        "Makes or changes a mod: its manifest (id, name, version, description, server/client/css file names) and its files by name. It is built at once — its problems come back to fix — and stays OFF (a changed one is switched off) until the user switches it on: under your answer (a card with “Switch on”) or in Plugins → Mods. for: which accounts it changes — \"this\" (the account the user is in: the default for a new mod, a wish for one's own case stays there) or \"all\"; a changed mod keeps what it had unless you say. Read workspace_mod_docs first.",
      inputSchema: z.object({ manifest: z.record(z.string(), z.unknown()), files: z.record(z.string(), z.string()), for: z.enum(["this", "all"]).optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ manifest, files, for: scope }) =>
      h.run(async () => {
        const store = await import("./store");
        const build = await import("./build");
        const m = store.normalizeManifest(manifest);
        const isNew = !store.getMod(m.id);
        const targets = build.targetsOf(Object.values(files));
        const unknown = [...Object.values(files).join("\n").matchAll(/["'`]([\w./[\]()-]+#[\w$]+)["'`]/g)].map((x) => x[1]).filter((x) => !(x in targets));
        m.targets = targets;
        store.writeMod(m, files, "ai");
        // Which accounts: a new mod the one the user is in (unless "all"); a changed one as it was (unless said).
        const { currentAccountId, listAccounts } = await import("@/db/accounts");
        if (scope === "all") store.setModState(m.id, { accounts: undefined });
        else if ((scope === "this" || isNew) && listAccounts().length > 1) store.setModState(m.id, { accounts: [currentAccountId()] });
        const b = await build.buildMod(m.id);
        const state = store.modState(m.id);
        const embed: ModEmbed = { kind: "mod", href: `/mods#${m.id}`, id: m.id, name: m.name, description: m.description, problems: b.problems, isNew, hooks: Object.keys(targets), ...(state.accounts?.length ? { accounts: state.accounts } : {}) };
        // (The result with a card under the answer: the user switches the mod on there.)
        const res = (h.ok as unknown as (t: string) => object)(
          [
            b.ok ? `Saved and built: ${m.id}.` : `Saved, but it doesn't build — fix these:\n- ${b.problems.join("\n- ")}`,
            unknown.length ? `Not hooks of this Zeff (check the names with workspace_mod_hooks): ${[...new Set(unknown)].join(", ")}` : "",
            `Hooks it names: ${Object.keys(targets).join(", ") || "none"}.`,
            state.accounts?.length ? `It is for the account(s) ${state.accounts.join(", ")} only.` : "It is for every account.",
            "It is OFF: the user switches it on with the card under your answer (or in Plugins → Mods) — tell them in one sentence what it changes and where they will see it.",
          ]
            .filter(Boolean)
            .join("\n"),
        );
        return (b.ok ? withEmbeds(res, [embed]) : res) as never;
      }),
  );
}
