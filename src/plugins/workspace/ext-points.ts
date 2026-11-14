/**
 * The stored forms of extension points (docs/kernel-contract.md, stage 0 of docs/zeff-kernel.md): what a built-in plugin brings to an
 * extension point in TypeScript, an external plugin declares in its manifest, and this file hands to the point through a provider,
 * read again on every look. So a plugin switched on, off or updated is there, gone or changed without a restart, and safe mode (the
 * registry then says every plugin is off) leaves nothing behind.
 *
 * - `formulaFunctions`: a formula of its own, no code. Its arguments are read as prop("name").
 * - `metrics`: a Kennzahl a plugin function gives. Its last answer is shown and asked for again in the background once it is older than
 *   `everyMinutes` (a Kennzahl is read in the middle of a formula, so it never waits for a container).
 * - `rowBadges`: badges a plugin function gives for the rows its sources brought.
 * - `tabMenus`: the entries of a tab's menu, from a plugin function.
 * - `widgets`: a list, figures or one figure from a plugin function; its buttons run another (the answers made safe: widgetDataFrom).
 * - `pageNav`: entries under pages in the Workspace tree, from a plugin function.
 * - `reviewSources` / `reviewLinks`: what waits for your word in the review queue — listed, decided and counted by plugin functions.
 *
 * Functions run as every plugin function does (plugin-fn.ts): through the Notebook plugin, with what the user granted them. Server only.
 */
import path from "node:path";
import { currentAccountId } from "@/db/accounts";
import { builtinLambdasPoint } from "./lambdas/store";
import { enabledPlugins, type ExtPlugin } from "@/lib/ext/registry";
import type { Contributor } from "@/lib/plugin-kit/extension-point";
import { tabMenus } from "@/plugins/tab-menus-point";
import type { TabMenuItem } from "@/plugins/tab-menus-shared";
import type { BadgePart, BadgeTone } from "./badge-shared";
import { evalFormula, isBuiltInFormulaName, type FormulaValue } from "./formula";
import { workspaceFormulaFunctions, type FormulaFunction } from "./formula-point";
import { workspaceMetrics, type MetricProvider } from "./metric-point";
import { runPluginFunction } from "./plugin-fn";
import { rowBadgeSources } from "./row-badge-point";
import { pageNavProviders, type PageNav } from "./app-nav-point";
import { workspaceWidgets, type WidgetData, type WidgetItem, type WidgetTile, type WorkspaceWidget } from "./widget-point";
import { reviewLinks, reviewSources, type ReviewEntry, type ReviewLink, type ReviewSource } from "@/lib/review/point";

const who = (p: ExtPlugin): Contributor => `ext:${p.id}`;
const str = (v: unknown, max = 200) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "").slice(0, max);

// ---------------------------------------------------------------------------
// Formula functions: a formula, no code
// ---------------------------------------------------------------------------

/** A declared formula function as the formula language calls it: its arguments bound by name, its formula worked out. */
export function storedFormulaFunction(d: { name: string; args: string[]; value: string; what: string; unit?: string }): FormulaFunction {
  return {
    name: d.name,
    signature: `${d.name}(${d.args.join(", ")})`,
    what: d.what,
    ...(d.unit ? { unit: d.unit } : {}),
    call: (args: FormulaValue[]) => {
      const byName = new Map(d.args.map((a, i) => [a, args[i] ?? null] as const));
      const r = evalFormula(d.value, { prop: (n) => (byName.has(n) ? byName.get(n) : null) });
      if ("error" in r) throw new Error(`${d.name}: ${r.error}`);
      return r.value;
    },
  };
}

workspaceFormulaFunctions.provide("ext:formulaFunctions", () =>
  enabledPlugins().flatMap((p) => {
    const fns = p.manifest.contributes.formulaFunctions.filter((f) => !isBuiltInFormulaName(f.name)).map(storedFormulaFunction);
    return fns.length ? [{ plugin: who(p), impl: fns }] : [];
  }),
);

// ---------------------------------------------------------------------------
// Kennzahlen: a function's last answer, asked again in the background
// ---------------------------------------------------------------------------

type Kept = { at: number; value: number | null; asking: boolean; error?: string };
const kept: Map<string, Kept> = ((globalThis as { __zeffExtMetrics?: Map<string, Kept> }).__zeffExtMetrics ??= new Map());

/** The number a plugin's metric shows now; when its answer is older than `everyMinutes` (or there is none), it is asked again. */
export function storedMetricValue(plugin: string, m: { id: string; function: string; everyMinutes: number }, now = Date.now()): number | null {
  const key = `${currentAccountId()}|${plugin}|${m.id}`;
  const k = kept.get(key) ?? { at: 0, value: null, asking: false };
  kept.set(key, k);
  if (!k.asking && now - k.at >= m.everyMinutes * 60_000) {
    k.asking = true;
    void runPluginFunction(plugin, m.function, {})
      .then((v) => {
        const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
        k.value = Number.isFinite(n) ? n : null;
        k.error = Number.isFinite(n) ? undefined : "the function gave no number";
      })
      .catch((e) => {
        k.error = e instanceof Error ? e.message : String(e);
      })
      .finally(() => {
        k.at = Date.now();
        k.asking = false;
      });
  }
  return k.value;
}

workspaceMetrics.provide("ext:metrics", () =>
  enabledPlugins().flatMap((p) => {
    const list = p.manifest.contributes.metrics.map((m): MetricProvider => ({ label: m.label, unit: m.unit, what: m.what || p.manifest.name, read: () => storedMetricValue(p.id, m) }));
    return list.length ? [{ plugin: who(p), impl: list }] : [];
  }),
);

// ---------------------------------------------------------------------------
// Row badges and tab menus: a function's answer
// ---------------------------------------------------------------------------

const TONES: BadgeTone[] = ["important", "unread", "activity", "messages"];

/** A badge function's answer ({ "film:12": [{ label, tone?, count? }] }) as the tree's badges, only for refs with this prefix. */
export function badgesFrom(prefix: string, v: unknown): Map<string, BadgePart[]> {
  const out = new Map<string, BadgePart[]>();
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [ref, parts] of Object.entries(v as Record<string, unknown>)) {
    if (!ref.startsWith(prefix) || !Array.isArray(parts)) continue;
    const list = parts.slice(0, 10).flatMap((x): BadgePart[] => {
      const o = x && typeof x === "object" ? (x as Record<string, unknown>) : null;
      const label = str(o?.label, 80);
      if (!o || !label) return [];
      const tone = TONES.includes(o.tone as BadgeTone) ? (o.tone as BadgeTone) : "activity";
      const count = typeof o.count === "number" && o.count > 0 ? Math.min(999, Math.floor(o.count)) : 1;
      return [{ label, tone, count }];
    });
    if (list.length) out.set(ref.slice(0, 200), list);
  }
  return out;
}

rowBadgeSources.provide("ext:rowBadges", () =>
  enabledPlugins().flatMap((p) => {
    const list = p.manifest.contributes.rowBadges.map((b) => ({ prefix: b.prefix, badges: async () => badgesFrom(b.prefix, await runPluginFunction(p.id, b.function, {})) }));
    return list.length ? [{ plugin: who(p), impl: list }] : [];
  }),
);

/** A menu function's answer as a tab's entries: only addresses inside Zeff. */
export function menuFrom(v: unknown): TabMenuItem[] {
  return (Array.isArray(v) ? v : []).slice(0, 50).flatMap((x): TabMenuItem[] => {
    const o = x && typeof x === "object" ? (x as Record<string, unknown>) : null;
    const href = str(o?.href, 300);
    const label = str(o?.label, 80);
    if (!o || !label || !/^\/(?!\/)/.test(href)) return [];
    return [{ href, label, ...(str(o.hint) ? { hint: str(o.hint) } : {}) }];
  });
}

// Lambdas (contributes.lambdas): the folder of an external plugin's lambdas, while it is on — lookups and functions without the Notebook.
builtinLambdasPoint.provide("ext:lambdas", () =>
  enabledPlugins().flatMap((p) => {
    const rel = p.manifest.contributes.lambdas;
    if (!rel) return [];
    const dir = path.resolve(p.dir, rel);
    return dir.startsWith(path.resolve(p.dir) + path.sep) ? [{ plugin: who(p), impl: { dir } }] : [];
  }),
);

tabMenus.provide("ext:tabMenus", () =>
  enabledPlugins().flatMap((p) => p.manifest.contributes.tabMenus.map((m) => ({ plugin: who(p), impl: { tab: m.tab, items: async () => menuFrom(await runPluginFunction(p.id, m.function, {})) } }))),
);

// ---------------------------------------------------------------------------
// Widgets: a function gives the data, another runs the buttons
// ---------------------------------------------------------------------------

const TONE3 = ["good", "warn", "bad"] as const;
type Tone3 = (typeof TONE3)[number];
const tone3 = (v: unknown): { tone?: Tone3 } => (TONE3.includes(v as Tone3) ? { tone: v as Tone3 } : {});
/** A link a widget may have: inside Zeff, or a web address. */
const link = (v: unknown): { href?: string } => {
  const s = str(v, 500);
  return /^\/(?!\/)/.test(s) || /^https?:\/\//.test(s) ? { href: s } : {};
};
const inside = (v: unknown): { href?: string } => {
  const s = str(v, 500);
  return /^\/(?!\/)/.test(s) ? { href: s } : {};
};
const opt = (k: string, v: unknown, max = 200): Record<string, string> => (str(v, max) ? { [k]: str(v, max) } : {});
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const buttons = (v: unknown, extra: (b: Record<string, unknown>) => Record<string, unknown>) =>
  (Array.isArray(v) ? v : []).slice(0, 5).flatMap((a) => {
    const b = obj(a);
    return b && str(b.id, 60) && str(b.label, 60) ? [{ id: str(b.id, 60), label: str(b.label, 60), ...extra(b) }] : [];
  });

/** A row's tiny chart: a few bars (label, a number, a tone), its unit. */
function miniOf(v: unknown): { mini?: NonNullable<WidgetItem["mini"]> } {
  const m = obj(v);
  if (!m || !Array.isArray(m.bars)) return {};
  const bars = m.bars.slice(0, 12).flatMap((b) => {
    const o = obj(b);
    return o && typeof o.value === "number" && Number.isFinite(o.value) ? [{ label: str(o.label, 40), value: o.value, ...tone3(o.tone) }] : [];
  });
  return bars.length ? { mini: { bars, ...opt("unit", m.unit, 12) } } : {};
}

/** A widget function's answer as the Workspace draws widgets: a list, figures or one figure — anything else is said, not drawn. */
export function widgetDataFrom(v: unknown): WidgetData {
  const o = obj(v);
  if (o?.kind === "list" && Array.isArray(o.items)) {
    const items = o.items.slice(0, 100).flatMap((x): WidgetItem[] => {
      const i = obj(x);
      if (!i || !str(i.id) || !str(i.text)) return [];
      const actions = buttons(i.actions, (b) => opt("icon", b.icon, 8));
      return [
        {
          id: str(i.id),
          text: str(i.text, 300),
          ...opt("detail", i.detail, 500),
          ...opt("icon", i.icon, 8),
          ...opt("meta", i.meta, 40),
          ...opt("badge", i.badge, 40),
          ...link(i.href),
          ...tone3(i.tone),
          ...(typeof i.done === "boolean" ? { done: i.done } : {}),
          ...(i.wrap === true ? { wrap: true } : {}),
          ...(actions.length ? { actions } : {}),
          ...miniOf(i.mini),
        },
      ];
    });
    const footer = obj(o.footer);
    const footerHref = footer ? link(footer.href).href : undefined;
    return {
      kind: "list",
      items,
      ...opt("title", o.title, 80),
      ...opt("empty", o.empty),
      ...(typeof o.count === "number" ? { count: o.count } : {}),
      ...(typeof o.urgent === "number" ? { urgent: o.urgent } : {}),
      ...(footer && str(footer.text) && footerHref ? { footer: { text: str(footer.text, 80), href: footerHref } } : {}),
    };
  }
  if (o?.kind === "stats" && Array.isArray(o.tiles)) {
    const tiles = o.tiles.slice(0, 12).flatMap((x): WidgetTile[] => {
      const t = obj(x);
      if (!t || !str(t.label)) return [];
      const bar = obj(t.bar);
      return [{ label: str(t.label, 60), value: str(t.value, 40), ...opt("detail", t.detail), ...tone3(t.tone), ...link(t.href), ...(bar && typeof bar.value === "number" && typeof bar.max === "number" && bar.max > 0 ? { bar: { value: bar.value, max: bar.max } } : {}) }];
    });
    return { kind: "stats", tiles };
  }
  if (o?.kind === "figure") return { kind: "figure", value: str(o.value, 40), caption: str(o.caption, 120), ...opt("detail", o.detail), ...link(o.href) };
  return { kind: "error", message: "The plugin's function gave no widget data (a list, stats or a figure)." };
}

/** A plugin's part run: its lambda (no Notebook) or its function. */
async function runPart(plugin: string, part: { function?: string; lambda?: string }, args: Record<string, unknown>): Promise<unknown> {
  if (part.lambda) return (await import("./mcp-plugin-tools")).runOwnLambda(plugin, part.lambda, args);
  return runPluginFunction(plugin, part.function!, args);
}

/** The daily series you may see, as a select's options — your own databases' fields first (optionsFrom: "series"). */
function seriesOptions(): { value: string; label: string }[] {
  try {
    // (lib/series reads the kernel's series — the series.catalog flow action's list)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { seriesCatalog } = require("@/lib/series/series") as typeof import("@/lib/series/series");
    return seriesCatalog()
      .sort((a, b) => Number(b.id.startsWith("db:")) - Number(a.id.startsWith("db:")))
      .map((s) => ({ value: s.id, label: s.label }));
  } catch {
    return [];
  }
}

workspaceWidgets.provide("ext:widgets", () =>
  enabledPlugins().flatMap((p) => {
    const list = p.manifest.contributes.widgets.map(
      (w): WorkspaceWidget => ({
        // (a port takes over the built-in widget's id it replaces: the widgets on your pages are its own then)
        id: w.replaces ?? `${p.id}.${w.id}`,
        label: w.label,
        icon: w.icon,
        description: w.description || p.manifest.name,
        size: w.size,
        ttl: w.ttl,
        ...(w.replaces ? { replaces: w.replaces } : {}),
        get settings() {
          return w.settings.map(({ optionsFrom, ...s }) => (optionsFrom === "series" ? { ...s, kind: "select" as const, options: seriesOptions(), default: s.default ?? seriesOptions()[0]?.value ?? "" } : s));
        },
        data: async (config) => widgetDataFrom(await runPart(p.id, { function: w.function, lambda: w.lambda }, { config })),
        ...(w.act || w.actLambda
          ? {
              act: async (action: string, payload: Record<string, string>, config: Record<string, string | number | boolean>) => {
                const v = await runPart(p.id, { function: w.act, lambda: w.actLambda }, { action, payload, config });
                return obj(v)?.kind ? widgetDataFrom(v) : undefined;
              },
            }
          : {}),
      }),
    );
    return list.length ? [{ plugin: who(p), impl: list }] : [];
  }),
);

// ---------------------------------------------------------------------------
// Entries under pages in the Workspace tree
// ---------------------------------------------------------------------------

/** A page-nav function's answer: per page (by id) its entries. */
export function pageNavFrom(v: unknown): PageNav[] {
  return (Array.isArray(v) ? v : []).slice(0, 50).flatMap((x): PageNav[] => {
    const o = obj(x);
    const pageId = Number(o?.pageId);
    if (!o || !Number.isInteger(pageId) || pageId <= 0 || !Array.isArray(o.entries)) return [];
    const entries = o.entries.slice(0, 100).flatMap((e) => {
      const n = obj(e);
      if (!n || !str(n.id) || !str(n.label)) return [];
      return [{ id: str(n.id, 200), label: str(n.label, 80), icon: str(n.icon, 8) || "•", n: typeof n.n === "number" ? Math.max(0, Math.floor(n.n)) : 0, ...opt("group", n.group, 60), ...inside(n.href) }];
    });
    return [{ pageId, entries }];
  });
}

pageNavProviders.provide("ext:pageNav", () =>
  enabledPlugins().flatMap((p) => p.manifest.contributes.pageNav.map((n) => ({ plugin: who(p), impl: { navs: async () => pageNavFrom(await runPluginFunction(p.id, n.function, {})) } }))),
);

// ---------------------------------------------------------------------------
// The review queue: what waits for your word, and links to pages where things wait
// ---------------------------------------------------------------------------

/** A review list function's answer as the queue's entries (each needs at least one button). */
export function reviewEntriesFrom(v: unknown): ReviewEntry[] {
  return (Array.isArray(v) ? v : []).slice(0, 200).flatMap((x): ReviewEntry[] => {
    const o = obj(x);
    if (!o || !str(o.id) || !str(o.title)) return [];
    const actions = buttons(o.actions, (b) => (b.primary === true ? { primary: true } : {}));
    if (!actions.length) return [];
    return [{ id: str(o.id, 200), title: str(o.title, 500), ...opt("detail", o.detail, 2000), ...(typeof o.confidence === "number" ? { confidence: Math.max(0, Math.min(1, o.confidence)) } : {}), ...inside(o.href), actions }];
  });
}

reviewSources.provide("ext:reviewSources", () =>
  enabledPlugins().flatMap((p) => {
    const list = p.manifest.contributes.reviewSources.map(
      (s): ReviewSource => ({
        id: `${p.id}-${s.id}`,
        label: s.label,
        list: async () => reviewEntriesFrom(await runPluginFunction(p.id, s.list, {})),
        act: async (item, action) => {
          const v = await runPluginFunction(p.id, s.act, { item, action });
          return typeof v === "string" ? v.slice(0, 500) : undefined;
        },
      }),
    );
    return list.length ? [{ plugin: who(p), impl: list }] : [];
  }),
);

reviewLinks.provide("ext:reviewLinks", () =>
  enabledPlugins().flatMap((p) => {
    const list = p.manifest.contributes.reviewLinks.map(
      (l): ReviewLink => ({
        id: `${p.id}-${l.id}`,
        label: l.label,
        href: l.href,
        count: async () => {
          const n = Number(await runPluginFunction(p.id, l.count, {}));
          return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
        },
      }),
    );
    return list.length ? [{ plugin: who(p), impl: list }] : [];
  }),
);
