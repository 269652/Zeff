import "@/plugins/contributions";
import { errorMessage } from "@/lib/errors";
import { workspaceWidgets, type WidgetConfig, type WidgetData, type WidgetSetting, type WorkspaceWidget } from "./widget-point";
import { currentAccountId } from "@/db/accounts";

/** The widgets of the installed plugins, and their data: settings held to their definition, the data kept a moment, a failing widget an error line. */

export type CatalogWidget = { id: string; plugin: string; label: string; icon: string; description: string; settings: WidgetSetting[]; actions: boolean };

const all = (): (WorkspaceWidget & { plugin: string })[] => workspaceWidgets.list().flatMap((c) => c.impl.map((w) => ({ ...w, plugin: c.plugin })));

export const widgetCatalog = (): CatalogWidget[] => all().map((w) => ({ id: w.id, plugin: w.plugin, label: w.label, icon: w.icon, description: w.description, settings: w.settings ?? [], actions: !!w.act }));

const find = (id: string) => {
  const w = all().find((x) => x.id === id);
  if (!w) throw new Error(`There is no such widget “${id}”.`);
  return w;
};

/** A configuration as the widget's settings allow it: numbers within their range, a choice among its options, else the defaults. */
export function checkedConfig(w: WorkspaceWidget, raw: Record<string, unknown>): WidgetConfig {
  const out: WidgetConfig = {};
  for (const s of w.settings ?? []) {
    const v = raw[s.key];
    if (s.kind === "number") {
      const n = Number(v);
      const base = Number.isFinite(n) && v !== undefined && v !== "" ? n : Number(s.default ?? 0);
      out[s.key] = Math.min(s.max ?? Infinity, Math.max(s.min ?? -Infinity, Math.round(base)));
    } else if (s.kind === "select") out[s.key] = s.options?.some((o) => o.value === String(v)) ? String(v) : String(s.default ?? s.options?.[0]?.value ?? "");
    else if (s.kind === "checkbox") out[s.key] = v === undefined ? !!s.default : v === true || v === "true";
    else out[s.key] = typeof v === "string" ? v.slice(0, 200) : String(s.default ?? "");
  }
  // The page the block stands on (widget-node.tsx): a person's widget on their page takes them.
  const page = Number(raw.__page);
  if (Number.isInteger(page) && page > 0) out.__page = page;
  return out;
}

const cache = new Map<string, { at: number; data: WidgetData }>();

/** A widget's data for these settings (kept `ttl` seconds). A widget that fails is an error line, not an error. */
export async function widgetData(id: string, rawConfig: Record<string, unknown>): Promise<WidgetData> {
  const w = find(id);
  const config = checkedConfig(w, rawConfig);
  // Per account (two served side by side): one's widget data is never the other's.
  const key = `${currentAccountId()}:${id}:${JSON.stringify(config)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (w.ttl ?? 30) * 1000) return hit.data;
  let data: WidgetData;
  try {
    data = await w.data(config);
  } catch (e) {
    return { kind: "error", message: errorMessage(e) };
  }
  cache.set(key, { at: Date.now(), data });
  return data;
}

/** A button of a widget: the plugin's `act` runs; the data after it (its answer, else read again). */
export async function widgetAct(id: string, action: string, payload: Record<string, string>, rawConfig: Record<string, unknown>): Promise<WidgetData> {
  const w = find(id);
  if (!w.act) throw new Error(`The widget “${w.label}” has no actions.`);
  const config = checkedConfig(w, rawConfig);
  const answer = await w.act(action, payload, config);
  for (const k of [...cache.keys()]) if (k.startsWith(`${currentAccountId()}:${id}:`)) cache.delete(k);
  return answer ?? (await widgetData(id, config));
}
