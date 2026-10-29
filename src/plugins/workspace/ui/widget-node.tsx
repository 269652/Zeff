"use client";

import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { widgetActAction, widgetCatalogAction, widgetDataAction } from "../actions";
import type { CatalogWidget } from "../widgets";
import type { WidgetData, WidgetItem, WidgetTile } from "../widget-point";
import { WS_CHANGED } from "./ChatPanel";
import { TemplateBody } from "./card-template";

/**
 * A widget a plugin supplies, as a block of a page (the dashboard is a page of them): live data with an action right there. The plugin
 * gives the data (figures, a list, cards); every widget is drawn alike — a quiet card with its name, the rows, their actions on hover.
 * It reads again every minute, when you come back to the tab and when something changed in the Workspace.
 */

let catalogMemo: Promise<CatalogWidget[]> | null = null;
const catalog = () => (catalogMemo ??= widgetCatalogAction().then((r) => (r.ok ? r.widgets : [])));

type Config = Record<string, string | number | boolean>;
const parseConfig = (s: unknown): Config => {
  try {
    const o = JSON.parse(String(s || "{}")) as unknown;
    return o && typeof o === "object" && !Array.isArray(o) ? (o as Config) : {};
  } catch {
    return {};
  }
};

type Tone = "none" | "good" | "warn" | "bad";
const TONE_TEXT: Record<Tone, string> = { none: "text-zinc-500 dark:text-zinc-400", good: "text-emerald-600 dark:text-emerald-400", warn: "text-amber-600 dark:text-amber-400", bad: "text-red-600 dark:text-red-400" };
const TONE_BADGE: Record<Tone, string> = {
  none: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  good: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/15 dark:bg-emerald-950/60 dark:text-emerald-300",
  warn: "bg-amber-50 text-amber-800 ring-1 ring-amber-600/20 dark:bg-amber-950/60 dark:text-amber-300",
  bad: "bg-red-50 text-red-700 ring-1 ring-red-600/15 dark:bg-red-950/60 dark:text-red-300",
};
const TONE_DOT: Record<Tone, string> = { none: "bg-zinc-300 dark:bg-zinc-600", good: "bg-emerald-500", warn: "bg-amber-500", bad: "bg-red-500" };
const TONE_FILL: Record<Tone, string> = { none: "bg-indigo-500", good: "bg-emerald-500", warn: "bg-amber-500", bad: "bg-red-500" };
const AVATAR = ["bg-indigo-100 text-indigo-700", "bg-emerald-100 text-emerald-700", "bg-amber-100 text-amber-800", "bg-rose-100 text-rose-700", "bg-sky-100 text-sky-700", "bg-violet-100 text-violet-700"];
const hash = (s: string) => [...s].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);

const external = (href: string) => /^https?:\/\//.test(href);
function Go({ href, className, children, title }: { href?: string; className: string; children: ReactNode; title?: string }) {
  if (!href) return <div className={className}>{children}</div>;
  return external(href) ? (
    <a href={href} target="_blank" rel="noreferrer" className={className} title={title}>
      {children}
    </a>
  ) : (
    <Link href={href} className={className} title={title}>
      {children}
    </Link>
  );
}

/** What leads a row: an emoji in a soft square, initials in a circle, else a small dot in the row's tone. */
function Lead({ icon, tone }: { icon?: string; tone: Tone }) {
  if (!icon) return <span className={`mt-[0.45rem] size-2 shrink-0 rounded-full ${TONE_DOT[tone]}`} aria-hidden />;
  if (/^[A-ZÄÖÜ]{1,2}$/.test(icon))
    return (
      <span className={`grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${AVATAR[hash(icon) % AVATAR.length]} dark:bg-zinc-800 dark:text-zinc-200`} aria-hidden>
        {icon}
      </span>
    );
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-zinc-100 text-[15px] leading-none dark:bg-zinc-800" aria-hidden>
      {icon}
    </span>
  );
}

/** A row's tiny chart: a few bars side by side, each with its value above and its label below. */
function MiniBars({ mini }: { mini: NonNullable<WidgetItem["mini"]> }) {
  const max = Math.max(...mini.bars.map((b) => Math.abs(b.value)), 1e-9);
  return (
    <span className="mt-1.5 flex items-end gap-2" aria-hidden>
      {mini.bars.map((b) => (
        <span key={b.label} className="flex w-16 flex-col items-center gap-0.5">
          <span className="text-[10px] text-zinc-500 tabular-nums">{`${Math.round(b.value * 10) / 10}${mini.unit ? ` ${mini.unit}` : ""}`}</span>
          <span className="flex h-8 w-6 items-end overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800">
            <span className={`block w-full rounded ${TONE_FILL[b.tone ?? "none"]}`} style={{ height: `${Math.max(4, (Math.abs(b.value) / max) * 100)}%` }} />
          </span>
          <span className="max-w-16 truncate text-[10px] text-zinc-400" title={b.label}>
            {b.label}
          </span>
        </span>
      ))}
    </span>
  );
}

function ItemRow({ item, busy, act }: { item: WidgetItem; busy: boolean; act: (action: string, id: string) => void }) {
  const tone: Tone = item.tone ?? "none";
  const big = !!item.icon;
  return (
    <li className={`group/item relative flex items-start gap-3 rounded-xl px-2 ${big ? "py-1.5" : "py-1"} transition hover:bg-zinc-50 dark:hover:bg-zinc-800/50`}>
      <Lead icon={item.icon} tone={tone} />
      <Go href={item.href} className="min-w-0 flex-1 text-inherit no-underline" title={item.text}>
        <span className={`block ${item.wrap ? "" : "truncate"} text-sm ${item.done ? "text-zinc-400 line-through" : "font-medium text-zinc-800 dark:text-zinc-100"}`}>{item.text}</span>
        {item.detail && <span className={`block ${item.wrap ? "" : "truncate"} text-xs text-zinc-500 dark:text-zinc-400`}>{item.detail}</span>}
        {item.mini && <MiniBars mini={item.mini} />}
      </Go>
      <span className="flex shrink-0 items-center gap-1.5 self-center">
        {item.badge && <span className={`max-w-32 truncate rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE_BADGE[tone]}`}>{item.badge}</span>}
        {item.meta && <span className="text-xs whitespace-nowrap text-zinc-400 tabular-nums group-hover/item:hidden group-focus-within/item:hidden">{item.meta}</span>}
        {!!item.actions?.length && (
          <span className="hidden items-center gap-0.5 group-hover/item:flex group-focus-within/item:flex [@media(hover:none)]:flex">
            {item.actions.map((a) => (
              <button
                key={a.id}
                type="button"
                disabled={busy}
                title={a.label}
                aria-label={a.label}
                onClick={() => act(a.id, item.id)}
                className={a.icon ? "grid size-7 place-items-center rounded-lg text-sm text-zinc-500 hover:bg-white hover:text-zinc-800 hover:shadow-sm disabled:opacity-40 dark:hover:bg-zinc-700 dark:hover:text-zinc-100" : "rounded-lg px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-white hover:shadow-sm disabled:opacity-40 dark:text-indigo-300 dark:hover:bg-zinc-700"}
              >
                {a.icon ?? a.label}
              </button>
            ))}
          </span>
        )}
      </span>
    </li>
  );
}

function Tile({ tile }: { tile: WidgetTile }) {
  const tone: Tone = tile.tone ?? "none";
  return (
    <Go href={tile.href} className={`group/tile block min-w-0 rounded-2xl border border-zinc-200/80 bg-white p-4 text-inherit no-underline shadow-sm transition dark:border-zinc-800 dark:bg-zinc-900 ${tile.href ? "hover:-translate-y-px hover:shadow-md" : ""}`}>
      <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {tone !== "none" && <span className={`size-1.5 rounded-full ${TONE_DOT[tone]}`} aria-hidden />}
        {tile.label}
      </span>
      <span className="mt-1 block text-3xl leading-none font-semibold tracking-tight text-zinc-900 tabular-nums dark:text-white">{tile.value}</span>
      {tile.detail && <span className={`mt-2 block truncate text-xs ${TONE_TEXT[tone]}`}>{tile.detail}</span>}
      {tile.bar && (
        <span className="mt-2 block h-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <span className={`block h-full rounded-full ${TONE_FILL[tone]}`} style={{ width: `${Math.max(0, Math.min(100, (tile.bar.value / (tile.bar.max || 1)) * 100))}%` }} />
        </span>
      )}
    </Go>
  );
}

function Footer({ footer }: { footer?: { text: string; href: string } }) {
  if (!footer) return null;
  return (
    <Go href={footer.href} className="ws-widget-link mt-1 inline-flex items-center gap-1 px-2 text-xs font-medium text-indigo-600 no-underline hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300">
      {footer.text} <span aria-hidden>→</span>
    </Go>
  );
}

function Empty({ text }: { text?: string }) {
  return (
    <p className="flex items-center gap-2 px-2 py-1.5 text-sm text-zinc-400 dark:text-zinc-500">
      <span className="grid size-5 place-items-center rounded-full bg-zinc-100 text-[10px] dark:bg-zinc-800" aria-hidden>
        ✓
      </span>
      {text ?? "—"}
    </p>
  );
}

function WidgetBody({ data, busy, act, hideTitle = false }: { data: WidgetData; busy: boolean; act: (action: string, id: string) => void; /** Without its header the list's own title goes too (a person's todos on their page). */ hideTitle?: boolean }) {
  if (data.kind === "error") return <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">{data.message}</p>;
  if (data.kind === "figure")
    return (
      <Go href={data.href} className="block px-2 text-inherit no-underline">
        <span className="block text-4xl leading-none font-semibold tracking-tight tabular-nums">{data.value}</span>
        <span className="mt-1 block text-sm text-zinc-500">{data.caption}</span>
        {data.detail && <span className="block text-xs text-zinc-400">{data.detail}</span>}
      </Go>
    );
  if (data.kind === "stats")
    return (
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(10.5rem,1fr))]">
        {data.tiles.map((x) => (
          <Tile key={x.label} tile={x} />
        ))}
      </div>
    );
  if (data.kind === "cards")
    return (
      <div className="space-y-2">
        {data.cards.length ? (
          <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]">
            {data.cards.map((c) => (
              <Go key={c.id} href={c.href} className="block min-w-0 rounded-xl border border-zinc-200/80 bg-white p-3 text-inherit no-underline shadow-sm transition hover:-translate-y-px hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900">
                <TemplateBody nodes={c.nodes} />
              </Go>
            ))}
          </div>
        ) : (
          <Empty text={data.empty} />
        )}
        <Footer footer={data.footer} />
      </div>
    );
  return (
    <div>
      {data.title && !hideTitle && <p className="px-2 pb-1 text-xs text-zinc-500">{data.title}</p>}
      {data.items.length ? (
        <ul className="-mx-0.5 space-y-0.5">
          {data.items.map((i) => (
            <ItemRow key={i.id} item={i} busy={busy} act={act} />
          ))}
        </ul>
      ) : (
        <Empty text={data.empty} />
      )}
      <Footer footer={data.footer} />
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2 px-2 py-1" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="size-8 shrink-0 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
          <span className="h-3 flex-1 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" style={{ maxWidth: `${80 - i * 15}%` }} />
        </div>
      ))}
    </div>
  );
}

/** The widgets to pick from, by the plugin that brings them: a gallery of cards. */
function Picker({ defs, pick }: { defs: CatalogWidget[]; pick: (id: string) => void }) {
  const t = useT();
  const [q, setQ] = useState("");
  const shown = useMemo(() => defs.filter((d) => !q.trim() || `${d.label} ${d.description}`.toLowerCase().includes(q.trim().toLowerCase())), [defs, q]);
  return (
    <section className="space-y-3 rounded-2xl border border-dashed border-zinc-300 bg-white/60 p-4 dark:border-zinc-700 dark:bg-zinc-900/40">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="flex-1 text-sm font-semibold">{t("Pick a widget")}</h4>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search …")} className="input w-48 py-1 text-sm" aria-label={t("Search")} />
      </div>
      {defs.length === 0 && <p className="text-sm text-zinc-400">{t("No plugin brings a widget yet.")}</p>}
      <ul className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(14rem,1fr))]">
        {shown.map((d) => (
          <li key={d.id}>
            <button type="button" className="flex h-full w-full items-start gap-3 rounded-xl border border-zinc-200 bg-white p-3 text-left shadow-sm transition hover:-translate-y-px hover:border-indigo-300 hover:shadow-md dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-indigo-700" onClick={() => pick(d.id)}>
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-indigo-50 text-lg dark:bg-indigo-950" aria-hidden>
                {d.icon}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{d.label}</span>
                <span className="mt-0.5 line-clamp-3 block text-xs text-zinc-500">{d.description}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function WidgetView({ node, updateAttributes, editor, getPos, deleteNode, extension }: NodeViewProps) {
  const t = useT();
  const id = String(node.attrs.widget ?? "");
  const config = parseConfig(node.attrs.config);
  // The page it stands on goes with what is asked (not kept in the block): a person's widget on their page takes them.
  const pageId = Number((extension.options as { pageId?: number }).pageId) || 0;
  const configKey = JSON.stringify(pageId ? { ...config, __page: pageId } : config);
  const ownTitle = String(node.attrs.title ?? "");
  const [defs, setDefs] = useState<CatalogWidget[]>([]);
  const [data, setData] = useState<WidgetData | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
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
  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- it reads whether the block is still there (a ref) when its answer comes
  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const r = await widgetDataAction(id, JSON.parse(configKey));
    if (!live.current) return;
    setLoading(false);
    setData(r.ok ? r.data : { kind: "error", message: r.error });
    // eslint-disable-next-line react-hooks/preserve-manual-memoization -- see above
  }, [id, configKey]);
  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- see load
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read when shown, again every minute and when the workspace changes
    void load();
    const every = setInterval(() => document.visibilityState === "visible" && void load(), 60000);
    const again = () => document.visibilityState === "visible" && void load();
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
  const label = ownTitle || def?.label || id;
  const count = data && (data.kind === "list" || data.kind === "cards") ? data.count : undefined;
  // Figures stand on their own: no card around the tiles.
  const bare = data?.kind === "stats";
  // Its header line (its name): as the block says, else as the widget wants it — without it the controls float top right.
  const head = String(node.attrs.header ?? "");
  const showHeader = head === "show" ? true : head === "hide" ? false : def?.header !== false;
  const controls = (
    <span className={`flex items-center gap-0.5 transition ${showHeader ? "" : "absolute top-1.5 right-1.5 z-10 rounded-lg bg-white/90 shadow-sm dark:bg-zinc-900/90"} ${settings ? "opacity-100" : "opacity-0 group-hover/widget:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100"}`}>
      <button type="button" className="grid size-7 place-items-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200" title={t("Read again")} aria-label={t("Read again")} onClick={() => void load()}>
        <span className={loading ? "inline-block animate-spin" : ""}>↻</span>
      </button>
      {editor.isEditable && (
        <button type="button" className="grid size-7 place-items-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200" title={t("Settings")} aria-label={t("Settings")} aria-pressed={settings} onClick={() => setSettings(!settings)}>
          ⚙
        </button>
      )}
    </span>
  );
  return (
    <NodeViewWrapper className="ws-widget ws-module-block my-1" contentEditable={false} data-app-block="widget">
      {editor.isEditable && (
        <div className="ws-grip-bar" contentEditable={false}>
          <span data-drag-handle className="ws-grip-btn" title="Drag to move" aria-label="Drag to move">
            ⠿
          </span>
          <span className="ws-grip-label">{label || "widget"}</span>
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
        <Picker defs={defs} pick={(w) => updateAttributes({ widget: w, config: "{}" })} />
      ) : (
        <section className={`group/widget relative ${bare ? "" : "rounded-2xl border border-zinc-200/80 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"}`} data-widget={id}>
          {!showHeader && controls}
          {showHeader && (
          <header className={`flex items-center gap-2 ${bare ? "mb-2 px-1" : "mb-1.5 px-1"}`}>
            {def && !bare && (
              <span className="text-base leading-none" aria-hidden>
                {def.icon}
              </span>
            )}
            <h4 className={`min-w-0 flex-1 truncate ${bare ? "text-xs font-medium tracking-wide text-zinc-500 uppercase" : "text-sm font-semibold text-zinc-800 dark:text-zinc-100"}`}>
              {label}
              {count !== undefined && count > 0 && <span className="ml-2 rounded-full bg-indigo-50 px-1.5 py-0.5 align-middle text-[11px] font-semibold text-indigo-700 tabular-nums dark:bg-indigo-950 dark:text-indigo-300">{count}</span>}
            </h4>
            {controls}
          </header>
          )}
          {settings && (
            <div className="mb-2 flex flex-wrap items-end gap-3 rounded-xl bg-zinc-50 p-3 text-xs dark:bg-zinc-800/60">
              <label className="flex flex-col gap-1">
                <span className="text-zinc-500">{t("Title")}</span>
                <input className="input w-44 py-1 text-xs" value={ownTitle} placeholder={def?.label} onChange={(e) => updateAttributes({ title: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-zinc-500">{t("Header")}</span>
                <input type="checkbox" className="size-4" checked={showHeader} onChange={(e) => updateAttributes({ header: e.target.checked ? "show" : "hide" })} />
              </label>
              {def?.settings.map((s) => (
                <label key={s.key} className="flex flex-col gap-1">
                  <span className="text-zinc-500">{s.label}</span>
                  {s.kind === "select" ? (
                    <select className="input w-auto py-1 text-xs" value={String(config[s.key] ?? s.default ?? "")} onChange={(e) => setConfig(s.key, e.target.value)}>
                      {s.options?.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : s.kind === "checkbox" ? (
                    <input type="checkbox" className="size-4" checked={config[s.key] === undefined ? !!s.default : config[s.key] === true} onChange={(e) => setConfig(s.key, e.target.checked)} />
                  ) : (
                    <input className={`input py-1 text-xs ${s.kind === "number" ? "w-20" : "w-52"}`} type={s.kind === "number" ? "number" : "text"} min={s.min} max={s.max} value={String(config[s.key] ?? s.default ?? "")} onChange={(e) => setConfig(s.key, s.kind === "number" ? Number(e.target.value) : e.target.value)} />
                  )}
                </label>
              ))}
              <button type="button" className="ml-auto text-xs text-zinc-500 hover:text-zinc-800 hover:underline dark:hover:text-zinc-200" onClick={() => setSettings(false)}>
                {t("Done")}
              </button>
            </div>
          )}
          {data ? <WidgetBody data={data} busy={busy} act={(a, itemId) => void act(a, itemId)} hideTitle={!showHeader} /> : <Skeleton />}
        </section>
      )}
    </NodeViewWrapper>
  );
}

/** A plugin's widget as a block of a page (`pageId`: the page — or the row — it stands on). */
export const ZeffWidget = Node.create<{ pageId: number }>({
  name: "zeffWidget",
  addOptions() {
    return { pageId: 0 };
  },
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    // header: "" as the widget wants it, "show" / "hide" as set on this block.
    return { widget: { default: "" }, config: { default: "{}" }, title: { default: "" }, header: { default: "" } };
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

/** A widget shown by itself (a view template's <widget id=… />): read when shown and when the workspace changes; its actions work. */
export function WidgetBlock({ id, config, title }: { id: string; config: Record<string, unknown>; title?: string }) {
  const configKey = JSON.stringify(config);
  const [data, setData] = useState<WidgetData | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    const load = () => void widgetDataAction(id, JSON.parse(configKey)).then((r) => live && setData(r.ok ? r.data : { kind: "error", message: r.error }));
    load();
    window.addEventListener(WS_CHANGED, load);
    return () => {
      live = false;
      window.removeEventListener(WS_CHANGED, load);
    };
  }, [id, configKey]);
  const act = async (action: string, itemId: string) => {
    setBusy(true);
    const r = await widgetActAction(id, action, { id: itemId }, JSON.parse(configKey));
    setBusy(false);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    setData(r.data);
    window.dispatchEvent(new Event(WS_CHANGED));
  };
  return (
    <div className="space-y-2">
      {title && <h3 className="text-sm font-semibold">{title}</h3>}
      {data ? <WidgetBody data={data} busy={busy} act={(a, i) => void act(a, i)} /> : <Skeleton />}
    </div>
  );
}
