"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { confirmAction } from "@/components/confirm";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { addSourceAction, checkSourcesAction, installFromSourceAction, removeSourceAction, updateAllFromSourcesAction } from "@/lib/ext/source-actions";
import type { SourceState } from "@/lib/ext/sources";

/**
 * Plugins → Sources: GitHub repositories with plugins and apps in them (each folder with a zeff-plugin.json, its own version). What each
 * has, which is installed, where a newer version waits — installed or updated on a click, all at once with "Update all".
 */
export function PluginSources() {
  const t = useT();
  const router = useRouter();
  const [states, setStates] = useState<SourceState[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [token, setToken] = useState("");
  const [adding, setAdding] = useState(false);
  const load = useCallback(async (fresh = false) => {
    const r = await checkSourcesAction(fresh);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    setStates(r.states);
  }, []);
  // (Read once when the page opens — the answer is kept ten minutes on the server; "Check now" reads again.)
  useEffect(() => {
    let live = true;
    void checkSourcesAction(false).then((r) => {
      if (!live) return;
      if (r.ok) setStates(r.states);
      else toast(r.error, { tone: "error" });
    });
    return () => {
      live = false;
    };
  }, []);
  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => {
    setBusy(key);
    const r = await fn();
    setBusy(null);
    if (!r.ok) return void toast(r.error ?? t("Didn't work."), { tone: "error", ms: 12000 });
    if (r.message) toast(r.message, { tone: "ok", ms: 12000 });
    await load();
    router.refresh();
  };
  const updates = (states ?? []).flatMap((s) => s.plugins.filter((p) => p.updateAvailable));
  return (
    <section className="space-y-2" aria-labelledby="plugin-sources">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="plugin-sources" className="text-sm font-semibold text-zinc-500 uppercase">
          {t("Sources")}
        </h2>
        <span className="flex-1" />
        {updates.length > 0 && (
          <button type="button" className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => void run("all", updateAllFromSourcesAction)}>
            ⬆ {t("Update all ({n})", { n: updates.length })}
          </button>
        )}
        <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => (setBusy("check"), void load(true).finally(() => setBusy(null)))}>
          ↻ {busy === "check" ? t("Checking …") : t("Check now")}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setAdding(!adding)} aria-expanded={adding}>
          ＋ {t("Add a repository")}
        </button>
      </div>
      <p className="max-w-[75ch] text-sm text-zinc-500">{t("GitHub repositories with plugins and apps: every folder with a zeff-plugin.json is one, with its own version. Installed from here, a plugin starts switched off; an update is a click — what you changed in Zeff stays.")}</p>
      {adding && (
        <form
          className="card grid gap-2 p-3 text-sm sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            void run("add", () => addSourceAction(url, branch, token)).then(() => (setUrl(""), setBranch(""), setToken(""), setAdding(false)));
          }}
        >
          <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/owner/repo" aria-label={t("Repository")} required />
          <input className="input" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder={t("Branch (default: the repository's)")} aria-label={t("Branch")} />
          <input className="input" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={t("Token (only for a private one)")} aria-label={t("Token")} />
          <button type="submit" className="btn btn-primary" disabled={!!busy}>
            {t("Add")}
          </button>
        </form>
      )}
      {states === null ? (
        <p className="text-sm text-zinc-400">{t("Checking …")}</p>
      ) : states.length === 0 ? (
        <p className="card p-4 text-sm text-zinc-500">{t("No source yet. Add a GitHub repository — or a plugin names its own in its zeff-plugin.json (repository).")}</p>
      ) : (
        <ul className="space-y-3">
          {states.map((s) => (
            <li key={s.source.id} className="card space-y-2 p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <a href={s.source.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
                  {s.source.url.replace("https://github.com/", "")}
                </a>
                <span className="text-xs text-zinc-500">
                  {s.branch}
                  {s.sha ? ` @ ${s.sha.slice(0, 7)}` : ""}
                  {s.source.hasToken ? ` · 🔑 ${t("with a token")}` : ""}
                  {s.source.fromManifest ? ` · ${t("named by a plugin")}` : ""}
                </span>
                <span className="flex-1" />
                <span className="text-xs text-zinc-400">{t("checked {when}", { when: new Date(s.checkedAt).toLocaleTimeString() })}</span>
                {!s.source.fromManifest && (
                  <button type="button" className="rounded px-1.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => confirmAction(t("Remove this source? Plugins installed from it stay.")) && void run(`rm-${s.source.id}`, () => removeSourceAction(s.source.id))}>
                    ✕ {t("Remove")}
                  </button>
                )}
              </div>
              {s.error && <p className="text-sm text-red-600 dark:text-red-400">{s.error}</p>}
              {s.plugins.length > 0 && (
                <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
                  {s.plugins.map((p) => {
                    const key = `${s.source.id}:${p.id}`;
                    return (
                      <li key={p.id} className="flex flex-wrap items-center gap-2 py-1.5">
                        <span className="min-w-0 flex-1">
                          <b>{p.name}</b> <span className="font-mono text-xs text-zinc-400">{p.path || "/"}</span>
                          {p.description && <span className="block truncate text-xs text-zinc-500">{p.description}</span>}
                        </span>
                        <span className="text-xs text-zinc-500">
                          {p.installed ? (p.updateAvailable ? t("{have} installed · {v} available", { have: p.installed, v: p.version }) : t("{v} · up to date", { v: p.installed })) : t("{v} · not installed", { v: p.version })}
                          {p.installed && !p.enabled ? ` · ${t("off")}` : ""}
                        </span>
                        {(!p.installed || p.updateAvailable) && (
                          <button
                            type="button"
                            className={`btn btn-sm ${p.updateAvailable ? "btn-primary" : ""}`}
                            disabled={!!busy}
                            onClick={() => {
                              if (!p.installed && !confirmAction(t("Install “{name}” {v} from {repo}? It starts switched off — look at what it asks for before you switch it on.", { name: p.name, v: p.version, repo: s.source.url.replace("https://github.com/", "") }))) return;
                              void run(key, () => installFromSourceAction(s.source.id, p.id));
                            }}
                          >
                            {busy === key ? t("Working …") : p.updateAvailable ? `⬆ ${t("Update to {v}", { v: p.version })}` : `＋ ${t("Install")}`}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {s.problems.length > 0 && (
                <details className="text-xs text-amber-700 dark:text-amber-400">
                  <summary className="cursor-pointer">{t("{n} folders don't hold", { n: s.problems.length })}</summary>
                  <ul className="mt-1 list-disc pl-5">
                    {s.problems.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
