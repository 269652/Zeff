import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Helpers } from "../mcp";

/**
 * The flows over the MCP: the AI (the Workspace assistant, an agent, your own client) reads the catalog of actions, writes flows,
 * runs them and reads their runs; it sets a database's lifecycle and moves rows along it. What a flow may reach (the web, writing
 * databases, the AI, sending) the AI only asks for: it is granted by you in the Studio — so no prompt can give itself more than you
 * gave. Server only.
 */

const node = z.record(z.string(), z.unknown());

function flowReference(): string {
  return [
    "FLOWS — what an app does on the server. A flow: { name (lowercase, dots: movie.enrich), title, description, inputs: [{ name, type: text|number|boolean|json|list|date|url|db|row, required, default, label }], nodes: [...], output (an expression; none: the last node's output), triggers: [{ kind: manual } | { kind: schedule, everyMinutes (+ from: '08:00', to: '22:00' — only in those hours) | at: '07:30', days: [0..6] (0 Sunday) } | { kind: event, event: row.added|row.changed|row.removed|signal|transition|form.submitted, db, field, equals, name }], permissions (asked for: web: ['api.example.com' | '*'], write: [dbId] | 'all', ai: true, send: true, api: true, maxSteps), lookup: { label, what, fields: { name: what it is }, slow } (makes it a lookup source 'flow.<name>': called with input.mode 'search' (input.query, input.language) → hits [{ id, title, subtitle, image }]; mode 'details' (input.id) → the fields) }.",
    "NODES (each has an id; its output is steps.<id> for the nodes after it): { kind: action, action, input: { … } , retry, onError: continue } · { kind: set, vars: { name: value } } (vars.name) · { kind: if, when, then: [], else: [] } · { kind: switch, on, cases: [{ value, nodes }], default: [] } · { kind: foreach, items, as, nodes, max } (item, index; its output: each round's last output) · { kind: parallel, branches: [[…], […]] } · { kind: try, nodes, catch } (error.message) · { kind: script, code, input } (JavaScript in a sandbox: input, steps, vars, item there as data; `return` the output; log(...)) · { kind: ask, title, text, fields: [{ name, kind: scale|number|choice|yesno|text, label, min, max, options, required }], expiresMinutes } (asks the user — a card on every page of Zeff; waits for the answer; output { <field>: answer, at }; unanswered it lapses, a newer one replaces it: a check-in) · { kind: approve, title, text, options } (waits for the user; output { choice, note }) · { kind: wait, minutes | until } · { kind: call, flow, input } (another flow) · { kind: return, value } · { kind: fail, message }.",
    "EXPRESSIONS in any text: {{ input.q }}, {{ steps.search.hits[0].id }}, {{ steps.list.rows | pluck('title') | join(', ') }}, {{ row.Status }} (the row a button or an event is about), {{ secrets.TMDB_KEY }} (keys the user set; never logged), {{ env.today }}, {{ env.local }} (now, local: 2026-11-08T14:00 — for a date field with its time), {{ env.hour }}; a text that is only {{ … }} keeps the value's kind (a list stays a list). Conditions: steps.r.count > 3 and not vars.done. Filters: json, parse, text, trim, upper, lower, number, round(2), default('x'), first, last, count, join(', '), split(','), lines, slice(0, 5), pluck('f'), where('f', v), sort('f', 'desc'), unique, keys, values, sum('f'), urlencode, date, truncate(80), replace('a', 'b'), stripHtml.",
    "In a view: <button run=\"name\" with=\"q={{ state.q }}\" into=\"result\"/>, <data name=\"x\" flow=\"name\" with=\"…\"/> (workspace_view_template_docs).",
  ].join("\n");
}

export function registerFlowTools(server: McpServer, h: Helpers): void {
  // Questions to the user from an agent's run: asked on every page of Zeff; the tool waits for the answer and gives it back.
  const field = z.object({ name: z.string(), kind: z.enum(["scale", "number", "choice", "yesno", "text"]), label: z.string().optional(), min: z.number().optional(), max: z.number().optional(), options: z.array(z.string()).optional(), required: z.boolean().optional() });
  const answerText = (a: { status: string; answers: Record<string, unknown> | null; id: number }) =>
    a.status === "answered" ? `Answered: ${JSON.stringify(a.answers)}` : a.status === "open" ? `Not answered yet (question ${a.id}). Go on with what you can and look again with zeff_ask_result, or say you wait for it.` : `No answer: the user ${a.status === "expired" ? "didn't answer in time" : "skipped it"}. Go on without it.`;
  server.registerTool(
    "zeff_ask",
    {
      title: "Ask the user",
      description:
        "Asks the user a question while you work — it shows as a card on every page of Zeff (and as a notification) — and waits for the answer (up to waitMinutes, default 10), then gives it back so you can go on with it. Ask only what you can't find yourself; one clear question with the answers it needs: fields (a scale min–max, a number, a choice of options, yes/no, a text). No fields: one text answer.",
      inputSchema: z.object({ question: z.string().min(3), details: z.string().optional(), fields: z.array(field).optional(), waitMinutes: z.number().min(0).max(25).optional(), expiresMinutes: z.number().min(1).max(10080).optional() }),
    },
    async (v) =>
      h.run(async () => {
        const { askUser, waitForAnswer } = await import("../asks");
        const { normalizeAskField } = await import("./types");
        const { callerRunId } = await import("@/mcp/caller");
        const runId = callerRunId();
        let from = "Agent";
        if (runId) {
          const { routineOfWorkRun } = await import("../routines");
          const { getPage } = await import("../store");
          const page = routineOfWorkRun(runId);
          if (page) from = getPage(page)?.title || from;
        }
        const fields = (v.fields ?? [{ name: "answer", kind: "text", required: true }]).map(normalizeAskField).filter((f): f is NonNullable<typeof f> => !!f);
        const ask = await askUser({ title: v.question, text: v.details, fields, source: { kind: "agent", label: from, workRunId: runId ?? null }, from, expiresMinutes: v.expiresMinutes ?? 24 * 60 });
        const done = await waitForAnswer(ask.id, (v.waitMinutes ?? 10) * 60000);
        return h.ok(answerText(done ?? ask));
      }),
  );
  server.registerTool(
    "zeff_ask_result",
    {
      title: "The answer to a question",
      description: "The answer to a question you asked with zeff_ask (by its number) — waiting up to waitMinutes for it.",
      inputSchema: z.object({ id: z.number().int(), waitMinutes: z.number().min(0).max(25).optional() }),
      annotations: { readOnlyHint: true },
    },
    async ({ id, waitMinutes }) =>
      h.run(async () => {
        const { getAsk, waitForAnswer } = await import("../asks");
        const a = getAsk(id);
        if (!a) return h.fail("There is no such question.");
        const done = a.status === "open" && waitMinutes ? await waitForAnswer(id, waitMinutes * 60000) : a;
        return h.ok(answerText(done ?? a));
      }),
  );

  server.registerTool(
    "workspace_flow_docs",
    {
      title: "How flows are written, and what they can call",
      description: "The flow language (nodes, expressions, filters, triggers, permissions) and the catalog of actions a node can call, each with its inputs and output. Read it before writing a flow.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () =>
      h.run(async () => {
        const { actionCatalog } = await import("./actions");
        const actions = actionCatalog()
          .map((a) => `- ${a.name} — ${a.summary} Input: ${a.input.map((f) => `${f.name}${f.required ? "*" : ""} (${f.type}${f.options ? `: ${f.options.join("|")}` : ""})`).join(", ") || "none"}. Gives: ${a.output}.${a.needs?.length ? ` Needs: ${a.needs.join(", ")}.` : ""}`)
          .join("\n");
        const { lookupSources } = await import("../lookups");
        return h.ok(`${flowReference()}\n\nACTIONS:\n${actions}\n\nLOOKUP SOURCES (lookup.search source=): ${lookupSources().map((s) => s.id).join(", ") || "none"}`);
      }),
  );

  server.registerTool(
    "workspace_flows",
    {
      title: "The flows",
      description: "Every flow: its name, title, inputs, triggers, whether it is a lookup source, what it may reach and what it asks for.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () =>
      h.run(async () => {
        const { listFlows } = await import("./store");
        const all = listFlows();
        if (!all.length) return h.ok("No flows yet.");
        return h.ok(all.map((f) => `- ${f.name} (page ${f.pageId})${f.title ? ` "${f.title}"` : ""}${f.enabled === false ? " [off]" : ""}${f.lookup ? " [lookup]" : ""} — inputs: ${f.inputs.map((i) => i.name).join(", ") || "none"}; triggers: ${f.triggers.map((t) => t.kind).join(", ")}; may: ${JSON.stringify(f.permissions)}${f.requested ? `; asks for: ${JSON.stringify(f.requested)}` : ""}`).join("\n"));
      }),
  );

  server.registerTool(
    "workspace_read_flow",
    {
      title: "Read a flow",
      description: "A flow's whole definition as JSON (by its name or page id).",
      inputSchema: z.object({ flow: z.string() }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ flow }) =>
      h.run(async () => {
        const f = (await import("./store")).flowByName(flow);
        return f ? h.ok(JSON.stringify(f, null, 2)) : h.fail(`There is no flow “${flow}”.`);
      }),
  );

  server.registerTool(
    "workspace_save_flow",
    {
      title: "Write a flow",
      description:
        "Creates a flow or replaces one (by its name; `page` to rename one). Checked: unknown actions and broken expressions are named. `permissions` are only asked for — the user grants them in the Studio; until then a node that needs them fails with what is missing. Read workspace_flow_docs first.",
      inputSchema: z.object({
        name: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        inputs: z.array(node).optional(),
        nodes: z.array(node),
        output: z.unknown().optional(),
        triggers: z.array(node).optional(),
        permissions: node.optional(),
        lookup: node.optional(),
        enabled: z.boolean().optional(),
        parent: z.number().int().optional().describe("The page it goes under (an app's page) — a new flow only."),
        page: z.number().int().optional().describe("The flow's page, to rename it."),
      }),
    },
    async (v) =>
      h.run(async () => {
        const s = await import("./store");
        const { normalizeFlow } = await import("./types");
        const { checkFlow } = await import("./check");
        const cur = v.page ? s.getFlow(v.page) : s.flowByName(v.name);
        // The AI asks; what is granted stays the user's.
        const def = normalizeFlow({ ...v, permissions: cur?.permissions ?? {}, requested: v.permissions ?? cur?.requested });
        const problems = checkFlow(def);
        if (problems.length) return h.fail(`Not saved — ${problems.join(" · ")}`);
        const saved = cur ? s.saveFlow(cur.pageId, def) : s.createFlow(def, v.parent ?? null);
        const missing = saved.requested ? Object.keys(saved.requested).filter((k) => JSON.stringify(saved.requested![k as keyof typeof saved.requested]) !== JSON.stringify(saved.permissions[k as keyof typeof saved.permissions])) : [];
        return h.ok(`Saved “${saved.name}” (page ${saved.pageId}).${missing.length ? ` It asks for ${missing.join(", ")} — the user grants that in the Studio (open the flow's page); until then those nodes fail.` : ""}`);
      }),
  );

  server.registerTool(
    "workspace_run_flow",
    {
      title: "Run a flow",
      description: "Runs a flow with an input and gives its output (or where it waits, or its error), with the run's log. dry: what writes or sends is only described.",
      inputSchema: z.object({ flow: z.string(), input: node.optional(), row: z.number().int().optional(), dry: z.boolean().optional() }),
    },
    async ({ flow, input, row, dry }) =>
      h.run(async () => {
        const { runFlow } = await import("./engine");
        const { getFlowRun } = await import("./store");
        const r = await runFlow(flow, input ?? {}, { trigger: { kind: "mcp" }, row, dry });
        const log = (getFlowRun(r.runId)?.log ?? []).map((l) => `${"  ".repeat(l.depth)}${l.status === "failed" ? "✗" : l.status === "dry" ? "~" : l.status === "waiting" ? "…" : "✓"} ${l.node} (${l.action ?? l.kind}, ${l.ms} ms)${l.error ? `: ${l.error}` : ""}`).join("\n");
        const head = r.status === "done" ? `Done (run ${r.runId}). Output:\n${JSON.stringify(r.output, null, 2).slice(0, 20000)}` : r.status === "waiting" ? `Waits (run ${r.runId}): ${JSON.stringify(r.waiting)}` : `Failed (run ${r.runId}): ${r.error}`;
        return r.status === "failed" ? h.fail(`${head}\n\n${log}`) : h.ok(`${head}\n\n${log}`);
      }),
  );

  server.registerTool(
    "workspace_flow_runs",
    {
      title: "A flow's runs",
      description: "A flow's last runs: status, input, output, error, and (one run by id) its whole log.",
      inputSchema: z.object({ flow: z.string().optional(), run: z.number().int().optional() }),
      annotations: { readOnlyHint: true },
    },
    async ({ flow, run }) =>
      h.run(async () => {
        const s = await import("./store");
        if (run) {
          const r = s.getFlowRun(run);
          return r ? h.ok(JSON.stringify({ ...r, def: undefined, journal: undefined }, null, 2).slice(0, 40000)) : h.fail("There is no such run.");
        }
        const f = flow ? s.flowByName(flow) : null;
        if (!f) return h.fail("Name the flow (or a run).");
        const runs = s.flowRuns(f.pageId, 10);
        return h.ok(runs.length ? runs.map((r) => `- run ${r.id} · ${r.status} · ${r.startedAt}${r.error ? ` · ${r.error}` : ""}`).join("\n") : "No runs yet.");
      }),
  );

  server.registerTool(
    "workspace_set_lifecycle",
    {
      title: "Set a database's lifecycle",
      description:
        "Makes a status (or select) field a state machine: transitions { name, from: [state names] (none: from any), to: state name, guard (an expression over row: row.Amount < 1000), require: [field names], flow (run after it), confirm }, strict (the field changes only by a transition), enter / leave: { state name: flow name }. States are the field's options (made when missing). Rows then move with <button transition=…> or the action row.transition.",
      inputSchema: z.object({ database: z.union([z.number().int(), z.string()]), field: z.string(), transitions: z.array(node), strict: z.boolean().optional(), enter: z.record(z.string(), z.string()).optional(), leave: z.record(z.string(), z.string()).optional() }),
    },
    async (v) =>
      h.run(async () => {
        const { findDatabase } = await import("../api");
        const { getDatabase, updateSchema } = await import("../store");
        const { newId } = await import("../model");
        const dbId = findDatabase(String(v.database));
        if (!dbId) return h.fail(`There is no database “${v.database}”.`);
        let schema = getDatabase(dbId)!.schema;
        const field = schema.properties.find((p) => p.name.toLowerCase() === v.field.toLowerCase() && (p.type === "status" || p.type === "select"));
        if (!field) return h.fail(`“${v.field}” is no status or select field of that database.`);
        const options = [...(field.options ?? [])];
        const optionId = (name: string) => {
          const n = name.trim();
          const hit = options.find((o) => o.name.toLowerCase() === n.toLowerCase());
          if (hit) return hit.id;
          const o = { id: newId("o"), name: n, color: "gray", ...(field.type === "status" ? { group: "todo" as const } : {}) };
          options.push(o);
          return o.id;
        };
        const propId = (name: string) => schema.properties.find((p) => p.name.toLowerCase() === name.toLowerCase())?.id ?? name;
        const transitions = v.transitions.map((t) => ({
          ...t,
          from: (Array.isArray(t.from) ? t.from : t.from ? [t.from] : []).map((x) => optionId(String(x))),
          to: optionId(String(t.to ?? "")),
          require: (Array.isArray(t.require) ? t.require : []).map((x) => propId(String(x))),
        }));
        const byState = (m?: Record<string, string>) => (m ? Object.fromEntries(Object.entries(m).map(([k, f]) => [optionId(k), f])) : undefined);
        schema = { ...schema, properties: schema.properties.map((p) => (p.id === field.id ? { ...p, options } : p)) };
        schema = { ...schema, lifecycle: { field: field.id, transitions: transitions as never, ...(v.strict ? { strict: true } : {}), ...(v.enter ? { enter: byState(v.enter) } : {}), ...(v.leave ? { leave: byState(v.leave) } : {}) } };
        const saved = updateSchema(dbId, schema);
        const lc = saved.lifecycle;
        return lc ? h.ok(`The lifecycle of “${field.name}”: ${lc.transitions.map((t) => t.name).join(", ")}${lc.strict ? " (strict)" : ""}.`) : h.fail("The lifecycle didn't hold (no transitions with a state to go to?).");
      }),
  );

  server.registerTool(
    "workspace_transition",
    {
      title: "Move a row along its lifecycle",
      description: "A row takes a transition of its database's lifecycle (by the transition's name); its guard and required fields are checked.",
      inputSchema: z.object({ row: z.number().int(), transition: z.string(), note: z.string().optional() }),
    },
    async ({ row, transition, note }) =>
      h.run(async () => {
        const { takeTransition } = await import("./lifecycle");
        const r = await takeTransition(row, transition, { by: "AI", note });
        return h.ok(`Row ${r.id}: ${r.from || "—"} → ${r.to}.`);
      }),
  );
}
