import { API_VERSION } from "@/lib/ext/manifest";

/**
 * The kernel contract (docs/kernel-contract.md, plan: docs/zeff-kernel.md): what Zeff's kernel promises to everything built on it —
 * plugins, packages, views, flows, widgets, functions. A part that uses only what is listed here keeps working across kernel
 * updates of the same contract version.
 *
 * The lists are a snapshot of what the code offers. tests/kernel-contract.test.ts compares them with the code, so a change to the
 * contract is never an accident:
 * - something new in the code → add it here (the contract grows; same version);
 * - something gone or changed in meaning → a deprecation first, then API_VERSION + 1 (lib/ext/manifest.ts) and this list.
 *
 * The version is the extension API version external plugins already declare (`apiVersion` in zeff-plugin.json): one number for the
 * one contract. Data only.
 */
export const CONTRACT_VERSION = API_VERSION;

export const KERNEL_CONTRACT = {
  /**
   * Extension points (lib/plugin-kit/extension-point.ts) — where a plugin plugs in — and how an external plugin reaches each:
   * - `stored`: from its manifest (the key `manifest`), no TypeScript;
   * - `kernel`: stays TypeScript on purpose — it is the kernel's (a sandbox, the API itself); `via` says what a plugin uses instead;
   * - `owner`: a point of one built-in plugin's own domain — it gets its stored form when that plugin is rebuilt as a package;
   * - `covered`: what a plugin needs from it, it already gets another way (`by`: a manifest key, or `view:<element>`) — the point
   *   is how built-in TypeScript does the same;
   * - `todo`: still TypeScript only — the next stored forms to build.
   */
  extensionPoints: {
    "api.methods": { form: "kernel", via: "functions" },
    "correlations.series": { form: "owner", owner: "correlations" },
    "documents.texts": { form: "owner", owner: "documents" },
    // A plugin's lists are its package's databases — every Workspace database is a collection already.
    "items.collections": { form: "covered", by: "workspacePackages" },
    "notebook.kernelLanguages": { form: "kernel", via: "functions" },
    // A plugin asks for your word through the review queue (reviewSources); proposals are how built-ins fill it.
    "proposals.sources": { form: "covered", by: "reviewSources" },
    "questions.views": { form: "owner", owner: "questions" },
    "review.links": { form: "stored", manifest: "reviewLinks" },
    "review.sources": { form: "stored", manifest: "reviewSources" },
    "shell.tabMenus": { form: "stored", manifest: "tabMenus" },
    // An app view's sidebar: the view's own <nav> (the fallback when no TypeScript provider is there).
    "workspace.appNav": { form: "covered", by: "view:nav" },
    "workspace.fieldTypes": { form: "stored", manifest: "fieldTypes" },
    "workspace.flowActions": { form: "stored", manifest: "flowActions" },
    "workspace.formulaFunctions": { form: "stored", manifest: "formulaFunctions" },
    "workspace.lambdas": { form: "kernel", via: "functions" },
    "workspace.lookups": { form: "stored", manifest: "lookups" },
    "workspace.metrics": { form: "stored", manifest: "metrics" },
    "workspace.packages": { form: "stored", manifest: "workspacePackages" },
    // What a plugin shows on its pages: the pages of its package, with their views, blocks and widgets.
    "workspace.pageApps": { form: "covered", by: "workspacePackages" },
    "workspace.pageNav": { form: "stored", manifest: "pageNav" },
    "workspace.rowBadges": { form: "stored", manifest: "rowBadges" },
    "workspace.sources": { form: "stored", manifest: "sources" },
    // A plugin's templates are its packages (offered under New → templates).
    "workspace.templates": { form: "covered", by: "workspacePackages" },
    "workspace.widgets": { form: "stored", manifest: "widgets" },
  },

  /** What a plugin's manifest may bring (`contributes` in zeff-plugin.json, lib/ext/manifest.ts). */
  manifestContributes: ["apps", "chats", "fieldTypes", "flowActions", "formulaFunctions", "functions", "hooks", "language", "locales", "lookups", "metrics", "pageNav", "reviewLinks", "reviewSources", "rowBadges", "schedules", "sources", "tabMenus", "widgets", "workCommands", "workPanels", "workerMcpServers", "workerRules", "workspacePackages"],

  /** What a server function or a Notebook cell may ask Zeff for (`zeff.*` in Python and Node.js; notebook/zeff-access.ts). */
  functionCalls: ["add_row", "ai", "api", "call", "database", "databases", "delete_row", "meta", "metric", "metrics", "output", "outputs", "publish", "table", "tables", "update_row"],

  /** What a widget may ask Zeff for (`zeff.*` in a widget; lib/widgets/bridge.ts). */
  widgetCalls: ["ai", "bus.last", "chat.begin", "chat.send", "chat.state", "db.add", "db.list", "db.rows", "db.schema", "db.update", "emit", "flow.list", "flow.run", "fn.call", "meta.read", "meta.run", "open", "page.get", "page.set", "publish", "state.get", "state.set", "toast", "values.get", "values.list"],

  /** How code reads and changes Zeff's structure (`zeff.meta`, `meta.read` / `meta.run`; workspace/meta.ts). */
  metaOps: ["block.delete", "block.save", "blocks.list", "database.alter", "database.create", "flow.delete", "flow.save", "flows.list", "page.archive", "page.create", "page.delete", "page.update", "plugin.delete", "plugin.save", "plugins.list", "schema", "tree"],

  /** The steps a flow is made of (workspace/flows/types.ts). The actions a step runs come through `workspace.flowActions`. */
  flowNodes: ["action", "set", "if", "switch", "foreach", "parallel", "try", "script", "ask", "approve", "wait", "call", "return", "fail"],

  /** The elements of the view language (workspace/view-template.ts). */
  viewElements: [
    "a", "ask", "avatar", "b", "badge", "bar", "board", "box", "button", "calendar", "callout", "cards", "case", "chart", "chat", "chip", "clamp",
    "code", "codewidget", "col", "column", "copy", "cover", "data", "datatable", "def", "dialog", "divider", "dossier", "dot", "drag", "drop",
    "empty", "entry", "facets", "field", "fill", "form", "gallery", "gauge", "graph", "grid", "groups", "grow", "header", "heading", "heatmap",
    "hr", "i", "img", "input", "kv", "let", "list", "logo", "lookup", "markdown", "menu", "mono", "muted", "nav", "noprint", "on", "otherwise",
    "pair", "pane", "panes", "part", "pivot", "printonly", "progress", "quickadd", "quote", "rating", "row", "schedule", "search", "section",
    "select", "selected", "setting", "settings", "slider", "slot", "small", "sparkline", "split", "state", "step", "steps", "strike", "subview",
    "switch", "tab", "table", "tabs", "tabset", "text", "theme", "tile", "timeline", "todomark", "toggle", "toolbar", "transitions", "truncate",
    "upload", "use", "widget",
  ],

  /** The functions of formulas (views, formula fields; workspace/formula.ts). Plugins add more through `workspace.formulaFunctions`. */
  formulaFunctions: [
    "abs", "and", "ceil", "concat", "contains", "count", "counta", "date", "dateAdd", "dateBetween", "dateSubtract", "day", "empty", "floor",
    "formatDate", "if", "iferror", "ifs", "join", "kennzahl", "length", "lower", "max", "mean", "min", "month", "now", "or", "pow", "product",
    "prop", "replace", "round", "slice", "sqrt", "sum", "text", "toNumber", "today", "trim", "upper", "weekday", "year",
  ],
} as const;

export type ContractSurface = Exclude<keyof typeof KERNEL_CONTRACT, "extensionPoints">;

type PointForm = { form: "stored"; manifest: string } | { form: "kernel"; via: string } | { form: "owner"; owner: string } | { form: "covered"; by: string } | { form: "todo" };

/** Every extension point with how a plugin reaches it. */
export const extensionPointForms = (): [string, PointForm][] => Object.entries(KERNEL_CONTRACT.extensionPoints) as [string, PointForm][];

/** The extension points still TypeScript only, though a plugin should reach them — the stored forms left to build. */
export const pointsWithoutStoredForm = (): string[] =>
  extensionPointForms()
    .filter(([, p]) => p.form === "todo")
    .map(([name]) => name);
