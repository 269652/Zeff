"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { archiveFlowAction, createFlowAction, flowSecretsAction, listFlowsAction, pendingAsksAction, setFlowSecretAction } from "@/plugins/workspace/actions";
import { AskForm } from "@/plugins/workspace/ui/flow-asks";
import { STARTERS } from "../starters";
import { FlowEditor } from "./FlowEditor";
import { LifecycleEditor } from "./LifecycleEditor";
import { Lambdas } from "./Lambdas";
import { Blocks } from "./Blocks";
import { NewAutomation } from "./Automations";
import { DetailEditor, NewApp, ScreenEditor, type ScreenDb } from "./Screens";
import { studioScreensAction } from "../server-actions";

/**
 * The Studio: the flows on the left (by the page they belong to — an app's under its app), what waits for your approval, the
 * lifecycles and the secrets; the flow picked in the editor. ?flow=<page> opens one.
 */

type FlowItem = { pageId: number; parentId: number | null; name: string; title?: string; description: string; lookup: boolean; enabled: boolean; lastRunAt: string | null };
type Ask = Parameters<typeof AskForm>[0]["ask"];
type Section = { kind: "flow"; id: number } | { kind: "new" } | { kind: "screen"; db: number; view: string | null } | { kind: "detail"; db: number } | { kind: "newapp" } | { kind: "newauto" } | { kind: "lifecycles" } | { kind: "lambdas"; name: string | null } | { kind: "blocks"; name: string | null } | { kind: "secrets" } | { kind: "waiting" };

function NewFlow({ onMade }: { onMade: (id: number) => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [starter, setStarter] = useState("blank");
  const make = async () => {
    const s = STARTERS.find((x) => x.id === starter)!;
    const r = await createFlowAction(s.def(name.trim().toLowerCase()));
    if (!r.ok) return toast(r.error, { tone: "error" });
    onMade(r.flow.pageId);
  };
  return (
    <div className="max-w-3xl space-y-4">
      <h2 className="text-lg font-semibold">{t("A new flow")}</h2>
      <label className="block space-y-1">
        <span className="label mb-0">{t("Name")}</span>
        <input className="input font-mono" placeholder="movie.enrich" value={name} onChange={(e) => setName(e.target.value)} />
        <span className="text-xs text-zinc-500">{t("Lowercase, parts joined by dots — how views and other flows call it.")}</span>
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        {STARTERS.map((s) => (
          <button key={s.id} type="button" className={`rounded-xl border p-3 text-left transition ${starter === s.id ? "border-indigo-500 ring-2 ring-indigo-200 dark:ring-indigo-900" : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800"}`} onClick={() => setStarter(s.id)}>
            <div className="font-medium">{t(s.label)}</div>
            <div className="text-xs text-zinc-500">{t(s.what)}</div>
          </button>
        ))}
      </div>
      <button type="button" className="btn btn-primary" disabled={!/^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+)*$/.test(name.trim().toLowerCase())} onClick={() => void make()}>
        {t("Make it")}
      </button>
    </div>
  );
}

function Secrets() {
  const t = useT();
  const [list, setList] = useState<{ name: string; updatedAt: string }[]>([]);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const load = useCallback(() => void flowSecretsAction().then((r) => r.ok && setList(r.secrets)), []);
  useEffect(load, [load]);
  const save = async (n: string, v: string) => {
    const r = await setFlowSecretAction(n, v);
    if (!r.ok) return toast(r.error, { tone: "error" });
    setName("");
    setValue("");
    load();
  };
  return (
    <div className="max-w-2xl space-y-4">
      <h2 className="text-lg font-semibold">{t("Secrets")}</h2>
      <p className="text-sm text-zinc-500">{t("API keys and tokens your flows use as {{ secrets.NAME }}. They stay on this computer, are never shown again and never written into a run's log (•••).")}</p>
      <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {list.map((s) => (
          <li key={s.name} className="flex items-center gap-2 px-3 py-2 text-sm">
            <code className="flex-1">{s.name}</code>
            <span className="text-xs text-zinc-500">{new Date(s.updatedAt).toLocaleDateString()}</span>
            <button type="button" className="icon-btn icon-btn-danger" aria-label={t("Remove")} onClick={() => void save(s.name, "")}>
              🗑
            </button>
          </li>
        ))}
        {!list.length && <li className="px-3 py-2 text-sm text-zinc-500">{t("No secrets yet.")}</li>}
      </ul>
      <div className="flex flex-wrap gap-2">
        <input className="input w-48 font-mono" placeholder="TMDB_KEY" value={name} onChange={(e) => setName(e.target.value.toUpperCase())} />
        <input className="input min-w-0 flex-1" type="password" autoComplete="off" placeholder={t("Value")} value={value} onChange={(e) => setValue(e.target.value)} />
        <button type="button" className="btn btn-primary" disabled={!name || !value} onClick={() => void save(name, value)}>
          {t("Set")}
        </button>
      </div>
    </div>
  );
}

function Waiting() {
  const t = useT();
  const [runs, setRuns] = useState<Ask[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => void pendingAsksAction().then((r) => r.ok && setRuns(r.asks as Ask[])), [tick]);
  return (
    <div className="max-w-3xl space-y-3">
      <h2 className="text-lg font-semibold">{t("Waiting for you")}</h2>
      {!runs.length && <p className="text-sm text-zinc-500">{t("No run waits for your approval.")}</p>}
      {runs.map((r) => (
        <div key={r.id} className="card space-y-2 p-3">
          <div className="flex items-baseline gap-2">
            <span className="font-medium">
              {r.source === "agent" ? "🤖" : "💬"} {r.title}
            </span>
            <span className="ml-auto font-mono text-xs text-zinc-500">
              {r.from}
            </span>
          </div>
          {r.text && <p className="text-sm whitespace-pre-line">{r.text}</p>}
          <AskForm ask={r} onDone={() => setTick((x) => x + 1)} />
        </div>
      ))}
    </div>
  );
}

export function Studio() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const asked = Number(params.get("flow")) || null;
  const askedDb = Number(params.get("db")) || null;
  const [flows, setFlows] = useState<FlowItem[]>([]);
  const [dbs, setDbs] = useState<ScreenDb[]>([]);
  const [section, setSection] = useState<Section>(asked ? { kind: "flow", id: asked } : askedDb ? { kind: "screen", db: askedDb, view: params.get("view") } : params.get("lambda") ? { kind: "lambdas", name: params.get("lambda") } : params.get("block") ? { kind: "blocks", name: params.get("block") } : { kind: "newauto" });
  const [q, setQ] = useState("");
  const load = useCallback(() => {
    void listFlowsAction().then((r) => r.ok && setFlows(r.flows));
    void studioScreensAction().then((r) => r.ok && setDbs(r.databases));
  }, []);
  useEffect(load, [load]);
  const screen = (db: number, view: string | null) => {
    setSection({ kind: "screen", db, view });
    router.replace(`?db=${db}${view ? `&view=${view}` : ""}`, { scroll: false });
  };
  const openDb = section.kind === "screen" || section.kind === "detail" ? dbs.find((d) => d.id === section.db) ?? null : null;
  // (Apps first: the databases with a screen of their own; then the rest.)
  const shownDbs = dbs.filter((d) => !q || d.title.toLowerCase().includes(q.toLowerCase())).sort((a, b) => Number(b.views.some((v) => v.custom)) - Number(a.views.some((v) => v.custom)));

  const open = (id: number) => {
    setSection({ kind: "flow", id });
    router.replace(`?flow=${id}`, { scroll: false });
  };
  const archive = async (id: number) => {
    if (!window.confirm(t("Put this flow into the trash?"))) return;
    const r = await archiveFlowAction(id);
    if (!r.ok) return toast(r.error, { tone: "error" });
    setSection({ kind: "newapp" });
    load();
  };
  const shown = flows.filter((f) => !q || `${f.name} ${f.title ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const item = (active: boolean) => `flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${active ? "bg-indigo-50 font-medium text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"}`;

  return (
    <div className="page">
      <aside className="page-aside">
        <h1 className="text-lg font-semibold">{t("Studio")}</h1>
        <div className="grid grid-cols-2 gap-1.5">
          <button type="button" className="btn btn-primary col-span-2" onClick={() => setSection({ kind: "newauto" })}>
            + {t("Automation")}
          </button>
          <button type="button" className="btn px-2" onClick={() => setSection({ kind: "newapp" })}>
            + {t("App")}
          </button>
          <button type="button" className="btn px-2" onClick={() => setSection({ kind: "new" })}>
            + {t("Flow")}
          </button>
        </div>
        <input type="search" className="input" placeholder={t("Search the Studio")} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="label">{t("Apps & screens")}</div>
        <ul className="max-h-[40vh] space-y-0.5 overflow-y-auto">
          {shownDbs.map((d) => {
            const here = openDb?.id === d.id;
            return (
              <li key={d.id}>
                <button type="button" className={item(here && section.kind === "screen")} onClick={() => screen(d.id, d.views.find((v) => v.custom)?.id ?? null)}>
                  <span aria-hidden>{d.icon || "🗂️"}</span>
                  <span className="min-w-0 flex-1 truncate">{d.title || `#${d.id}`}</span>
                  {d.views.some((v) => v.custom) && <span className="text-[10px] text-indigo-600 dark:text-indigo-400">{t("app")}</span>}
                </button>
                {here && (
                  <ul className="ml-6 space-y-0.5 border-l border-zinc-200 pl-2 dark:border-zinc-800">
                    {d.views.map((v) => (
                      <li key={v.id}>
                        <button type="button" className={item(section.kind === "screen" && (section.view ?? d.views.find((x) => x.custom)?.id ?? d.views[0]?.id) === v.id)} onClick={() => screen(d.id, v.id)}>
                          <span className="min-w-0 flex-1 truncate">{v.name}</span>
                          <span className="font-mono text-[10px] text-zinc-500">{v.custom ? "</>" : v.type}</span>
                        </button>
                      </li>
                    ))}
                    <li>
                      <button type="button" className={item(section.kind === "detail")} onClick={() => setSection({ kind: "detail", db: d.id })}>
                        <span className="min-w-0 flex-1 truncate">{t("Detail page")}</span>
                        <span className="font-mono text-[10px] text-zinc-500">{d.detail ? "</>" : "+"}</span>
                      </button>
                    </li>
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
        <div className="label">{t("Flows")}</div>
        <ul className="space-y-0.5">
          {shown.map((f) => (
            <li key={f.pageId}>
              <button type="button" className={item(section.kind === "flow" && section.id === f.pageId)} onClick={() => open(f.pageId)}>
                <span aria-hidden>{f.lookup ? "🔎" : "⚡"}</span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate ${f.enabled ? "" : "text-zinc-400 line-through"}`}>{f.title || f.name}</span>
                  {f.title && <span className="block truncate font-mono text-[11px] text-zinc-500">{f.name}</span>}
                </span>
              </button>
            </li>
          ))}
          {!flows.length && <li className="px-2 text-sm text-zinc-500">{t("No flows yet.")}</li>}
        </ul>
        <div className="space-y-0.5 border-t border-zinc-200 pt-2 dark:border-zinc-800">
          <button type="button" className={item(section.kind === "waiting")} onClick={() => setSection({ kind: "waiting" })}>
            ✋ {t("Waiting for you")}
          </button>
          <button type="button" className={item(section.kind === "lambdas")} onClick={() => setSection({ kind: "lambdas", name: null })}>
            λ {t("Lambdas & lookup sources")}
          </button>
          <button type="button" className={item(section.kind === "blocks")} onClick={() => setSection({ kind: "blocks", name: null })}>
            🧩 {t("Blocks")}
          </button>
          <button type="button" className={item(section.kind === "lifecycles")} onClick={() => setSection({ kind: "lifecycles" })}>
            ⟳ {t("Lifecycles")}
          </button>
          <button type="button" className={item(section.kind === "secrets")} onClick={() => setSection({ kind: "secrets" })}>
            🔑 {t("Secrets")}
          </button>
        </div>
      </aside>
      <main className="min-w-0">
        {section.kind === "flow" && (
          <div className="space-y-2">
            <FlowEditor key={section.id} pageId={section.id} onChanged={load} />
            <div className="flex justify-end gap-2 pt-4">
              <a className="btn btn-sm" href={`/workspace/${section.id}`}>
                {t("Its page")}
              </a>
              <button type="button" className="btn btn-sm btn-danger" onClick={() => void archive(section.id)}>
                {t("Delete the flow")}
              </button>
            </div>
          </div>
        )}
        {section.kind === "new" && <NewFlow onMade={(id) => (load(), open(id))} />}
        {section.kind === "newauto" && <NewAutomation onMade={(v) => (load(), v.flowPage ? open(v.flowPage) : undefined)} />}
        {section.kind === "newapp" && <NewApp onMade={(db) => (load(), screen(db, null))} />}
        {section.kind === "screen" && openDb && <ScreenEditor key={openDb.id} db={openDb} viewId={section.view} onView={(v) => screen(openDb.id, v)} onDetail={() => setSection({ kind: "detail", db: openDb.id })} onChanged={load} />}
        {section.kind === "detail" && openDb && <DetailEditor key={openDb.id} db={openDb} onChanged={load} />}
        {section.kind === "lifecycles" && <LifecycleEditor />}
        {section.kind === "lambdas" && <Lambdas initial={section.name} />}
        {section.kind === "blocks" && <Blocks initial={section.name} openFlow={open} />}
        {section.kind === "secrets" && <Secrets />}
        {section.kind === "waiting" && <Waiting />}
      </main>
    </div>
  );
}
