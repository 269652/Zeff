"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { postJson } from "@/lib/post-json";
import { blockSignature, BLOCK_PARAM_TYPES, type BlockDef, type BlockParam } from "@/plugins/workspace/blocks";
import { blockLibraryAction, blockVersionsAction, deleteBlockAction, installLibraryBlocksAction, listBlocksAction, removedBlocksAction, restoreBlockVersionAction, saveBlockAction } from "@/plugins/workspace/actions";

/**
 * The blocks of your own (workspace/blocks.ts) as a catalogue: each with how it is used, its parameters, its template or widget
 * code, its flows and its versions (every change is kept; one brought back is a new version). A new one starts as a template or as
 * a widget the AI builds from a sentence; a removed one can be brought back.
 */

type Version = { n: number; at: string; source: string; note: string; size: number };
type Flow = { name: string; pageId: number; title: string };
const STARTER = `<card>\n  <b>{{ props.title }}</b>\n</card>`;
const nameOk = (s: string) => /^[a-z][a-z0-9_-]{0,39}(\.[a-z0-9_-]{1,40}){0,3}$/.test(s);

function Editor({ block, onChanged, onGone, openFlow }: { block: BlockDef; onChanged: () => void; onGone: () => void; openFlow: (pageId: number) => void }) {
  const t = useT();
  const [def, setDef] = useState<BlockDef>(block);
  const [versions, setVersions] = useState<Version[]>([]);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string | null>(null);
  const load = useCallback(() => {
    void blockVersionsAction(block.name).then((r) => {
      if (!r.ok) return;
      setVersions(r.versions as Version[]);
      setFlows(r.flows);
    });
  }, [block.name]);
  useEffect(load, [load]);
  const dirty = JSON.stringify({ ...def, updatedAt: undefined }) !== JSON.stringify({ ...block, updatedAt: undefined });
  const param = (i: number, patch: Partial<BlockParam>) => setDef({ ...def, params: def.params.map((p, j) => (j === i ? { ...p, ...patch } : p)) });

  const save = async () => {
    setBusy(true);
    const r = await saveBlockAction(def);
    setBusy(false);
    if (!r.ok) return setProblems(r.error);
    setProblems(null);
    toast(t("Saved."));
    onChanged();
    load();
  };
  const restore = async (n: number) => {
    const r = await restoreBlockVersionAction(block.name, n);
    if (!r.ok) return toast(r.error, { tone: "error" });
    toast(t("Version {n} is back.", { n }));
    onChanged();
  };
  const remove = async () => {
    if (!window.confirm(t("Remove the block “{name}”? Views that use it then say it is missing. You can bring it back from its versions.", { name: block.name }))) return;
    const r = await deleteBlockAction(block.name, false);
    if (!r.ok) return toast(r.error, { tone: "error" });
    onGone();
  };
  const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">
          {def.icon || "🧩"} {def.title || def.name}
        </h2>
        {def.widget && <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[11px] text-violet-800 dark:bg-violet-950 dark:text-violet-200">{t("widget")}</span>}
        <code className="ml-auto text-xs text-zinc-500">{def.name}</code>
      </div>
      <div className="rounded-lg bg-zinc-50 px-3 py-2 font-mono text-xs break-all text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">{blockSignature(def)}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="label mb-0">{t("Title")}</span>
          <input className="input" value={def.title ?? ""} onChange={(e) => setDef({ ...def, title: e.target.value })} />
        </label>
        <label className="space-y-1">
          <span className="label mb-0">{t("What it does")}</span>
          <input className="input" value={def.description} onChange={(e) => setDef({ ...def, description: e.target.value })} />
        </label>
      </div>

      <div className="space-y-1.5">
        <div className="label mb-0">{t("Parameters")}</div>
        {def.params.map((p, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input className="input w-36 font-mono" value={p.name} onChange={(e) => param(i, { name: e.target.value })} aria-label={t("Name")} />
            <select className="input w-28" value={p.type} onChange={(e) => param(i, { type: e.target.value as BlockParam["type"] })} aria-label={t("Type")}>
              {BLOCK_PARAM_TYPES.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            <input className="input w-36" placeholder={t("Default")} value={p.default ?? ""} onChange={(e) => param(i, { default: e.target.value })} />
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={!!p.required} onChange={(e) => param(i, { required: e.target.checked })} /> {t("required")}
            </label>
            <input className="input min-w-0 flex-1" placeholder={t("Help")} value={p.help ?? ""} onChange={(e) => param(i, { help: e.target.value })} />
            <button type="button" className="icon-btn icon-btn-danger" aria-label={t("Remove")} onClick={() => setDef({ ...def, params: def.params.filter((_, j) => j !== i) })}>
              🗑
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-sm" onClick={() => setDef({ ...def, params: [...def.params, { name: `param${def.params.length + 1}`, type: "text" }] })}>
          + {t("Parameter")}
        </button>
      </div>

      {def.widget ? (
        <div className="space-y-1.5">
          <div className="label mb-0">{t("The widget's code")}</div>
          <textarea className="input h-72 font-mono text-xs" spellCheck={false} value={def.widget.html} onChange={(e) => setDef({ ...def, widget: { ...def.widget!, html: e.target.value } })} />
          <p className="text-xs text-zinc-500">{t("It reads its parameters as zeff.context.params. What it may write or ask is allowed by you where it is shown.")}</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="label mb-0">{t("Template")}</div>
          <textarea className="input h-72 font-mono text-xs" spellCheck={false} value={def.template} onChange={(e) => setDef({ ...def, template: e.target.value })} />
          <div className="label mb-0">{t("Example")}</div>
          <textarea className="input h-16 font-mono text-xs" spellCheck={false} value={def.example ?? ""} onChange={(e) => setDef({ ...def, example: e.target.value })} />
        </div>
      )}
      {problems && (
        <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm whitespace-pre-line text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {problems}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" disabled={busy || !dirty} onClick={() => void save()}>
          {t("Save")}
        </button>
        <button type="button" className="btn" disabled={!dirty} onClick={() => (setDef(block), setProblems(null))}>
          {t("Undo my changes")}
        </button>
        <button type="button" className="btn btn-danger ml-auto" onClick={() => void remove()}>
          {t("Remove the block")}
        </button>
      </div>

      <div className="space-y-1.5">
        <div className="label mb-0">⚡ {t("Its flows")}</div>
        {flows.length ? (
          <ul className="flex flex-wrap gap-2">
            {flows.map((f) => (
              <li key={f.pageId}>
                <button type="button" className="btn btn-sm font-mono" onClick={() => openFlow(f.pageId)}>
                  {f.name}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-500">{t("None. A template calls its own flows as run=\"@name\".")}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="label mb-0">🕘 {t("Versions")}</div>
        <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
          {versions.map((v, i) => (
            <li key={v.n} className="flex items-center gap-2 px-3 py-1.5">
              <span className="font-mono text-xs text-zinc-500">#{v.n}</span>
              <span className="text-xs text-zinc-500">{when(v.at)}</span>
              <span className="rounded bg-zinc-100 px-1.5 text-[11px] dark:bg-zinc-800">{v.source}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-zinc-600 dark:text-zinc-400">{v.note}</span>
              {i === 0 ? (
                <span className="text-xs text-zinc-400">{t("current")}</span>
              ) : (
                <button type="button" className="btn btn-sm" onClick={() => void restore(v.n)}>
                  {t("Bring it back")}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

type LibItem = BlockDef & { category: string; installed: boolean };
const CATEGORY_LABEL: Record<string, string> = { figures: "Figures", charts: "Charts", lists: "Lists & boards", input: "Input", widgets: "Widgets" };

/** The ready-made blocks (workspace/block-library.ts): each added to your blocks with one click. */
function Library({ onChanged, onOpen }: { onChanged: () => void; onOpen: (name: string) => void }) {
  const t = useT();
  const [items, setItems] = useState<LibItem[]>([]);
  const [q, setQ] = useState("");
  const load = useCallback(() => void blockLibraryAction().then((r) => r.ok && setItems(r.library as LibItem[])), []);
  useEffect(load, [load]);
  const add = async (names: string[] | "all") => {
    const r = await installLibraryBlocksAction(names);
    if (!r.ok) return toast(r.error, { tone: "error" });
    toast(r.made.length ? t("{n} blocks added.", { n: r.made.length }) : t("Nothing new."));
    load();
    onChanged();
  };
  const shown = items.filter((b) => !q || `${b.name} ${b.title ?? ""} ${b.description}`.toLowerCase().includes(q.toLowerCase()));
  const cats = [...new Set(shown.map((b) => b.category))];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">📚 {t("The block library")}</h2>
        <input type="search" className="input ml-auto w-56" placeholder={t("Search the library")} value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className="btn" disabled={!items.some((b) => !b.installed)} onClick={() => void add("all")}>
          {t("Add all")}
        </button>
      </div>
      <p className="text-sm text-zinc-500">{t("Ready-made blocks: add one and it is yours to change. Any view uses it as <use block=\"name\"/> — the fields it works on are its parameters.")}</p>
      {cats.map((c) => (
        <section key={c} className="space-y-2">
          <div className="label mb-0">{t(CATEGORY_LABEL[c] ?? c)}</div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {shown
              .filter((b) => b.category === c)
              .map((b) => (
                <div key={b.name} className="card flex flex-col gap-1.5 p-3">
                  <div className="flex items-start gap-2">
                    <span aria-hidden className="text-lg">
                      {b.icon || "🧩"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{b.title || b.name}</div>
                      <code className="block truncate text-[11px] text-zinc-500">{b.name}</code>
                    </div>
                  </div>
                  <p className="flex-1 text-xs text-zinc-600 dark:text-zinc-400">{b.description}</p>
                  {b.example && <code className="block truncate rounded bg-zinc-50 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">{b.example}</code>}
                  {b.installed ? (
                    <button type="button" className="btn btn-sm" onClick={() => onOpen(b.name)}>
                      ✓ {t("Added — open")}
                    </button>
                  ) : (
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => void add([b.name])}>
                      + {t("Add")}
                    </button>
                  )}
                </div>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function NewBlock({ onMade }: { onMade: (name: string) => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"template" | "widget">("template");
  const [ask, setAsk] = useState("");
  const [busy, setBusy] = useState(false);
  const make = async () => {
    setBusy(true);
    try {
      let def: Record<string, unknown>;
      if (kind === "template") def = { name, description: name, params: [{ name: "title", type: "text", default: name }], template: STARTER };
      else {
        const r = await postJson<{ ok: true; widget: { title: string; html: string; libs: string[]; wants: { writes: number[]; ai?: boolean; flows?: string[] } } } | { ok: false; error: string }>("/api/workspace/widget-make", { request: ask });
        if (!r.ok) throw new Error(r.error);
        const w = r.widget;
        def = { name, title: w.title, description: w.title || name, params: [], widget: { html: w.html, libs: w.libs, writes: w.wants.writes, ai: !!w.wants.ai, flows: w.wants.flows ?? [] } };
      }
      const s = await saveBlockAction(def);
      if (!s.ok) throw new Error(s.error);
      onMade(s.block.name);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="max-w-2xl space-y-4">
      <h2 className="text-lg font-semibold">{t("A new block")}</h2>
      <label className="block space-y-1">
        <span className="label mb-0">{t("Name")}</span>
        <input className="input font-mono" placeholder="crm.deal-card" value={name} onChange={(e) => setName(e.target.value.toLowerCase())} />
        <span className="text-xs text-zinc-500">{t("Lowercase, parts joined by dots — how a view uses it: <use block=\"name\"/>.")}</span>
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        {(["template", "widget"] as const).map((k) => (
          <button key={k} type="button" className={`rounded-xl border p-3 text-left ${kind === k ? "border-indigo-500 ring-2 ring-indigo-200 dark:ring-indigo-900" : "border-zinc-200 dark:border-zinc-800"}`} onClick={() => setKind(k)}>
            <div className="font-medium">{k === "template" ? t("A template") : t("A widget")}</div>
            <div className="text-xs text-zinc-500">{k === "template" ? t("Made from the view language — cards, lists, buttons.") : t("Code in a sandbox — a calculator, a 3D model, a plot. The AI builds it from your sentence.")}</div>
          </button>
        ))}
      </div>
      {kind === "widget" && <textarea className="input h-24" placeholder={t("A calculator for …")} value={ask} onChange={(e) => setAsk(e.target.value)} />}
      <button type="button" className="btn btn-primary" disabled={busy || !nameOk(name) || (kind === "widget" && !ask.trim())} onClick={() => void make()}>
        {busy ? t("Working…") : t("Make it")}
      </button>
    </div>
  );
}

export function Blocks({ initial, openFlow }: { initial: string | null; openFlow: (pageId: number) => void }) {
  const t = useT();
  const [blocks, setBlocks] = useState<BlockDef[]>([]);
  const [removed, setRemoved] = useState<{ name: string; at: string }[]>([]);
  const [open, setOpen] = useState<string | "new" | "library" | null>(initial);
  const [q, setQ] = useState("");
  const load = useCallback(() => {
    void listBlocksAction().then((r) => r.ok && setBlocks(r.blocks));
    void removedBlocksAction().then((r) => r.ok && setRemoved(r.removed));
  }, []);
  useEffect(load, [load]);
  const shown = blocks.filter((b) => !q || `${b.name} ${b.title ?? ""} ${b.description}`.toLowerCase().includes(q.toLowerCase()));
  const picked = open && open !== "new" && open !== "library" ? blocks.find((b) => b.name === open) : null;
  return (
    <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
      <div className="space-y-2">
        <button type="button" className="btn btn-primary w-full" onClick={() => setOpen("new")}>
          + {t("Block")}
        </button>
        <button type="button" className={`btn w-full ${open === "library" ? "ring-2 ring-indigo-300" : ""}`} onClick={() => setOpen("library")}>
          📚 {t("Library")}
        </button>
        <input type="search" className="input" placeholder={t("Search the blocks")} value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="space-y-0.5">
          {shown.map((b) => (
            <li key={b.name}>
              <button type="button" className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${open === b.name ? "bg-indigo-50 font-medium text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"}`} onClick={() => setOpen(b.name)}>
                <span aria-hidden>{b.icon || (b.widget ? "🧪" : "🧩")}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{b.title || b.name}</span>
                  <span className="block truncate font-mono text-[11px] text-zinc-500">{b.name}</span>
                </span>
              </button>
            </li>
          ))}
          {!blocks.length && (
            <li className="px-2 text-sm text-zinc-500">
              {t("No blocks yet.")}{" "}
              <button type="button" className="text-indigo-700 underline dark:text-indigo-300" onClick={() => setOpen("library")}>
                {t("Start with the library")}
              </button>
            </li>
          )}
        </ul>
        {removed.length > 0 && (
          <div className="space-y-1 border-t border-zinc-200 pt-2 dark:border-zinc-800">
            <div className="label mb-0">{t("Removed")}</div>
            {removed.map((r) => (
              <button
                key={r.name}
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                title={t("Bring it back")}
                onClick={async () => {
                  const vs = await blockVersionsAction(r.name);
                  if (!vs.ok || !vs.versions.length) return;
                  const back = await restoreBlockVersionAction(r.name, (vs.versions as Version[])[0].n);
                  if (!back.ok) return toast(back.error, { tone: "error" });
                  load();
                  setOpen(r.name);
                }}
              >
                ↶ <span className="min-w-0 flex-1 truncate font-mono text-xs">{r.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="min-w-0">
        {open === "new" && <NewBlock onMade={(n) => (load(), setOpen(n))} />}
        {open === "library" && <Library onChanged={load} onOpen={setOpen} />}
        {picked && <Editor key={`${picked.name}${picked.updatedAt}`} block={picked} onChanged={load} onGone={() => (setOpen(null), load())} openFlow={openFlow} />}
        {!open && <p className="text-sm text-zinc-500">{t("Pick a block, or make a new one. Views use them as <use block=\"name\"/>; the assistant can build them too.")}</p>}
      </div>
    </div>
  );
}
