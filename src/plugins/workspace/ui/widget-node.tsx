"use client";

import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { widgetActAction, widgetCatalogAction, widgetDataAction } from "../actions";
import type { CatalogWidget } from "../widgets";
import type { WidgetData, WidgetItem, WidgetTile } from "../widget-point";
import { WS_CHANGED } from "./ChatPanel";
import { TemplateBody } from "./card-template";

/**
 * A widget a plugin supplies, as a block of a page (the dashboard is a page of them): live data with an action right there. The plugin
 * gives the data (a list or a figure); every widget is drawn alike. It reads again every minute, when you come back to the tab and
 * when something changed in the Workspace.
 */

let catalogMemo: Promise<CatalogWidget[]> | null = null;
const catalog = () => (catalogMemo ??= widgetCatalogAction().then((r) => (r.ok ? r.widgets : [])));

const parseConfig = (s: unknown): Record<string, string | number | boolean> => {
  try {
    const o = JSON.parse(String(s || "{}")) as unknown;
    return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, string | number | boolean>) : {};
  } catch {
    return {};
  }
};

const TONE_BADGE = {
  none: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  good: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  warn: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  bad: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
};
const TONE_BAR = { none: "border-l-zinc-300 dark:border-l-zinc-600", good: "border-l-emerald-500", warn: "border-l-amber-500", bad: "border-l-red-500" };
const TONE_BAR_FILL = { none: "bg-indigo-500", good: "bg-emerald-500", warn: "bg-amber-500", bad: "bg-red-500" };

function Tile({ tile }: { tile: WidgetTile }) {
  const tone = tile.tone ?? "none";
  const body = (
    <>
      <span className="block text-xs text-zinc-500 dark:text-zinc-400">{tile.label}</span>
      <span className="block text-2xl leading-tight font-semibold tabular-nums">{tile.value}</span>
      {tile.detail && <span className="block text-xs text-zinc-500 dark:text-zinc-400">{tile.detail}</span>}
      {tile.bar && (
        <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <span className={`block h-full rounded-full ${TONE_BAR_FILL[tone]}`} style={{ width: `${Math.max(0, Math.min(100, (tile.bar.value / (tile.bar.max || 1)) * 100))}%` }} />
        </span>
      )}
    </>
  );
  const cls = `block min-w-0 rounded-lg border border-l-4 border-zinc-200 bg-white px-3 py-2 shadow-sm dark:border-zinc-700 dark:bg-zinc-900 ${TONE_BAR[tone]}`;
  return tile.href ? (
    <Link href={tile.href} className={`${cls} text-inherit no-underline transition hover:shadow-md`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function ItemRow({ item, busy, act }: { item: WidgetItem; busy: boolean; act: (action: string, id: string) => void }) {
  const external = !!item.href && /^https?:\/\//.test(item.href);
  const body = (
    <>
      <span className={`min-w-0 flex-1 ${item.done ? "text-zinc-400 line-through" : ""}`}>
        <span className="line-clamp-2 break-words">{item.text}</span>
        {item.detail && <span className="line-clamp-2 text-xs text-zinc-500">{item.detail}</span>}
      </span>
      {item.badge && <span className={`max-w-28 shrink-0 truncate rounded-full px-2 text-xs ${TONE_BADGE[item.tone ?? "none"]}`}>{item.badge}</span>}
    </>
  );
  const link = "flex min-w-0 items-start gap-2 text-inherit no-underline hover:underline";
  return (
    <li className="space-y-1 pb-1.5 text-sm">
      {item.href ? (
        external ? (
          <a href={item.href} target="_blank" rel="noreferrer" className={link}>
            {body}
          </a>
        ) : (
          <Link href={item.href} className={link}>
            {body}
          </Link>
        )
      ) : (
        <div className="flex min-w-0 items-start gap-2">{body}</div>
      )}
      {!!item.actions?.length && (
        <div className="flex flex-wrap gap-1">
          {item.actions.map((a) => (
            <button key={a.id} type="button" className="btn btn-sm" disabled={busy} onClick={() => act(a.id, item.id)}>
              {a.label}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}

function WidgetBody({ data, busy, act }: { data: WidgetData; busy: boolean; act: (action: string, id: string) => void }) {
  if (data.kind === "error") return <p className="text-sm text-amber-700 dark:text-amber-400">{data.message}</p>;
  if (data.kind === "figure")
    return (
      <div>
        <p className="text-3xl font-semibold tabular-nums">{data.value}</p>
        <p className="text-sm text-zinc-500">{data.caption}</p>
        {data.detail && <p className="text-xs text-zinc-400">{data.detail}</p>}
      </div>
    );
  if (data.kind === "stats") return <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(9.5rem,1fr))]">{data.tiles.map((x) => <Tile key={x.label} tile={x} />)}</div>;
  if (data.kind === "cards")
    return (
      <div className="space-y-2">
        {data.cards.length ? (
          <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]">
            {data.cards.map((c) => {
              const inner = <TemplateBody nodes={c.nodes} />;
              const cls = "block min-w-0 rounded-lg border border-zinc-200 bg-white p-2.5 text-inherit no-underline shadow-sm transition hover:shadow-md dark:border-zinc-700 dark:bg-zinc-900";
              return c.href ? (
                <Link key={c.id} href={c.href} className={cls}>
                  {inner}
                </Link>
              ) : (
                <div key={c.id} className={cls}>
                  {inner}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-zinc-400">{data.empty ?? "—"}</p>
        )}
        {data.footer && (
          <Link href={data.footer.href} className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
            {data.footer.text} →
          </Link>
        )}
      </div>
    );
  return (
    <div className="space-y-1.5">
      {data.title && <p className="text-xs text-zinc-500">{data.title}</p>}
      {data.items.length ? (
        <ul className="space-y-1.5">
          {data.items.map((i) => (
            <ItemRow key={i.id} item={i} busy={busy} act={act} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-zinc-400">{data.empty ?? "—"}</p>
      )}
      {data.footer && (
        <Link href={data.footer.href} className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
          {data.footer.text} →
        </Link>
      )}
    </div>
  );
}

function WidgetView({ node, updateAttributes, editor, getPos, deleteNode }: NodeViewProps) {
  const t = useT();
  const id = String(node.attrs.widget ?? "");
  const config = parseConfig(node.attrs.config);
  const configKey = JSON.stringify(config);
  const [defs, setDefs] = useState<CatalogWidget[]>([]);
  const [data, setData] = useState<WidgetData | null>(null);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState(false);
  const live = useRef(true);
  const def = defs.find((d) => d.id === id);
  useEffect(() => {
    live.current = true;
    void catalog().then((d) => live.current && setDefs(d));
    return () => {
      live.current = false;
    };
  }, []);
  const load = useCallback(async () => {
    if (!id) return;
    const r = await widgetDataAction(id, JSON.parse(configKey));
    if (live.current) setData(r.ok ? r.data : { kind: "error", message: r.error });
  }, [id, configKey]);
  useEffect(() => {
    void load();
    const every = setInterval(() => document.visibilityState === "visible" && void load(), 60000);
    const again = () => void load();
    window.addEventListener(WS_CHANGED, again);
    document.addEventListener("visibilitychange", again);
    return () => {
      clearInterval(every);
      window.removeEventListener(WS_CHANGED, again);
      document.removeEventListener("visibilitychange", again);
    };
  }, [load]);
  const act = async (action: string, itemId: string) => {
    setBusy(true);
    const r = await widgetActAction(id, action, { id: itemId }, JSON.parse(configKey));
    setBusy(false);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    setData(r.data);
    window.dispatchEvent(new Event(WS_CHANGED));
  };
  const setConfig = (key: string, value: string | number | boolean) => updateAttributes({ config: JSON.stringify({ ...config, [key]: value }) });
  return (
    <NodeViewWrapper className="ws-widget ws-module-block my-2" contentEditable={false} data-app-block="widget">
      {editor.isEditable && (
        <div className="ws-grip-bar" contentEditable={false}>
          <span data-drag-handle className="ws-grip-btn" title="Drag to move" aria-label="Drag to move">
            ⠿
          </span>
          <span className="ws-grip-label">{def?.label ?? "widget"}</span>
          <button
            type="button"
            title="A new line after this block"
            aria-label="A new line after this block"
            onClick={() => {
              const pos = typeof getPos === "function" ? getPos() : undefined;
              if (pos !== undefined) editor.chain().focus().insertContentAt(pos + node.nodeSize, { type: "paragraph" }).run();
            }}
          >
            ＋
          </button>
          <button type="button" title="Remove this block" aria-label="Remove this block" onClick={() => deleteNode()}>
            ✕
          </button>
        </div>
      )}
      {!id ? (
        <section className="space-y-1.5 rounded-lg border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
          <h4 className="text-xs font-semibold text-zinc-500 uppercase">{t("Pick a widget")}</h4>
          {defs.length === 0 && <p className="text-sm text-zinc-400">{t("No plugin brings a widget yet.")}</p>}
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {defs.map((d) => (
              <li key={d.id}>
                <button type="button" className="block w-full rounded-md border border-zinc-200 p-2 text-left text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800" onClick={() => updateAttributes({ widget: d.id, config: "{}" })}>
                  <span className="font-medium">
                    {d.icon} {d.label}
                  </span>
                  <span className="block text-xs text-zinc-500">{d.description}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className={data?.kind === "stats" ? "space-y-2" : "space-y-2 rounded-xl border border-zinc-200 bg-zinc-50/50 p-3 dark:border-zinc-800 dark:bg-zinc-900/30"} data-widget={id}>
          <div className="flex items-center gap-2">
            <h4 className="flex-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
              {def ? `${def.icon} ${def.label}` : id}
            </h4>
            <button type="button" className="icon-btn" title={t("Read again")} aria-label={t("Read again")} onClick={() => void load()}>
              ↻
            </button>
            {editor.isEditable && !!def?.settings.length && (
              <button type="button" className="icon-btn" title={t("Settings")} aria-label={t("Settings")} aria-pressed={settings} onClick={() => setSettings(!settings)}>
                ⚙
              </button>
            )}
          </div>
          {settings && def && (
            <div className="flex flex-wrap items-center gap-3 rounded-md bg-zinc-50 p-2 text-xs dark:bg-zinc-900/50">
              {def.settings.map((s) => (
                <label key={s.key} className="flex items-center gap-1.5">
                  {s.label}
                  {s.kind === "select" ? (
                    <select className="input w-auto py-0.5 text-xs" value={String(config[s.key] ?? s.default ?? "")} onChange={(e) => setConfig(s.key, e.target.value)}>
                      {s.options?.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : s.kind === "checkbox" ? (
                    <input type="checkbox" checked={config[s.key] === undefined ? !!s.default : config[s.key] === true} onChange={(e) => setConfig(s.key, e.target.checked)} />
                  ) : (
                    <input className="input w-20 py-0.5 text-xs" type={s.kind === "number" ? "number" : "text"} min={s.min} max={s.max} value={String(config[s.key] ?? s.default ?? "")} onChange={(e) => setConfig(s.key, s.kind === "number" ? Number(e.target.value) : e.target.value)} />
                  )}
                </label>
              ))}
            </div>
          )}
          {data ? <WidgetBody data={data} busy={busy} act={(a, itemId) => void act(a, itemId)} /> : <div className="h-14 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" aria-hidden />}
        </section>
      )}
    </NodeViewWrapper>
  );
}

/** A plugin's widget as a block of a page. */
export const ZeffWidget = Node.create({
  name: "zeffWidget",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { widget: { default: "" }, config: { default: "{}" } };
  },
  parseHTML() {
    return [{ tag: "div[data-zeff-widget]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-zeff-widget": "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(WidgetView);
  },
});
