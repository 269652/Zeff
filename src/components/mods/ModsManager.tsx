"use client";

import { useCallback, useEffect, useState } from "react";
import { confirmAction } from "@/components/confirm";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { modSourcesAction, modsOverviewAction, removeModAction, restoreModVersionAction, saveModAction, setModAccountsAction, setModEnabledAction, setSafeModeAction, type ModRow } from "@/lib/mods/actions";
import { modAdaptRequest } from "@/lib/mods/requests";
import { RepairButton } from "@/plugins/workspace/ui/repair-button";

type Overview = { mods: ModRow[]; safe: boolean; hooks: number; hooksLive: number; accounts: { id: string; name: string }[]; account: string };

/**
 * The Mods page: mods change Zeff itself (its functions and components, through their hooks — docs/mods.md). Each on or off (switching
 * one on is your approval: it runs with Zeff's rights), why one was switched off (it failed, the AI changed it), the hooks it holds back
 * (Zeff changed them since it was written), its code (to read and change), its versions, and safe mode — Zeff without any mod.
 */
export function ModsManager() {
  const t = useT();
  const [o, setO] = useState<Overview | null>(null);
  const [busy, setBusy] = useState("");
  const [open, setOpen] = useState<{ id: string; files: Record<string, string> } | null>(null);
  const load = useCallback(async () => {
    const r = await modsOverviewAction();
    if (!r.ok) return void toast(r.error, { tone: "error" });
    setO({ mods: r.mods, safe: r.safe, hooks: r.hooks, hooksLive: r.hooksLive, accounts: r.accounts, account: r.account });
  }, []);
  useEffect(() => {
    let live = true;
    void modsOverviewAction().then((r) => live && r.ok && setO({ mods: r.mods, safe: r.safe, hooks: r.hooks, hooksLive: r.hooksLive, accounts: r.accounts, account: r.account }));
    return () => {
      live = false;
    };
  }, []);
  const act = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, done?: string, reload = false) => {
    setBusy(key);
    const r = await fn();
    setBusy("");
    if (!r.ok) return void toast(r.error ?? t("Didn't work."), { tone: "error", ms: 12000 });
    if (done) toast(done, { tone: "ok" });
    await load();
    // (A browser part takes effect with the page loaded again.)
    if (reload) setTimeout(() => window.location.reload(), 400);
  };
  if (!o) return <p className="text-sm text-zinc-400">{t("Loading …")}</p>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-zinc-500">{t("{n} hooks in this Zeff ({live} in use right now)", { n: o.hooks, live: o.hooksLive })}</span>
        <span className="flex-1" />
        <button
          type="button"
          className={`btn btn-sm ${o.safe ? "btn-primary" : ""}`}
          disabled={!!busy}
          title={t("Zeff without any mod — until you switch it off again")}
          onClick={() => void act("safe", () => setSafeModeAction(!o.safe), o.safe ? t("Mods are back.") : t("Safe mode: no mod runs."), true)}
        >
          🛟 {o.safe ? t("Leave safe mode") : t("Safe mode")}
        </button>
      </div>
      {o.safe && <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{t("Safe mode is on: Zeff runs without any mod.")}</p>}
      {o.mods.length === 0 && <p className="card p-4 text-sm text-zinc-500">{t("No mods yet. Ask the Workspace assistant for one (“make a mod that …”) — or put a folder with a zeff-mod.json into the mods folder.")}</p>}
      <ul className="space-y-3">
        {o.mods.map((m) => (
          <li key={m.id} className={`card space-y-2 p-4 ${m.enabled ? "" : "opacity-90"}`}>
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="font-medium">
                  {m.name} <span className="text-xs font-normal text-zinc-400">{m.version}</span>{" "}
                  <span className={`ml-1 rounded px-1.5 py-0.5 text-xs font-medium ${m.enabled ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}>{m.enabled ? t("on") : t("off")}</span>
                </h3>
                <p className="font-mono text-xs text-zinc-400">
                  {m.id} · {m.parts.join(", ") || t("nothing to run")}
                  {m.changedAt ? ` · ${t("changed {when} by {by}", { when: new Date(m.changedAt).toLocaleString(), by: m.by === "ai" ? t("the AI") : t("you") })}` : ""}
                </p>
                {m.description && <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{m.description}</p>}
              </div>
              <button
                type="button"
                className={`btn btn-sm ${m.enabled ? "" : "btn-primary"}`}
                disabled={!!busy}
                onClick={() => {
                  if (!m.enabled && !confirmAction(t("Switch on “{name}”? A mod changes Zeff itself and runs with Zeff's rights — switch it on only when you know what it does (its code is under “Code”).", { name: m.name }))) return;
                  void act(`on-${m.id}`, () => setModEnabledAction(m.id, !m.enabled), m.enabled ? t("Switched off.") : t("Switched on."), true);
                }}
              >
                {busy === `on-${m.id}` ? "…" : m.enabled ? t("Switch off") : t("Switch on")}
              </button>
            </div>
            {!m.enabled && m.disabledReason && <p className="text-xs text-amber-700 dark:text-amber-400">{t("Off: {why}", { why: m.disabledReason })}</p>}
            {m.problems.length > 0 && (
              <ul className="list-disc pl-5 text-xs text-red-600 dark:text-red-400">
                {m.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            {m.stale.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <p className="flex-1 text-xs text-amber-700 dark:text-amber-400">{t("Held back — Zeff changed these since the mod was written for them: {hooks}", { hooks: m.stale.join(", ") })}</p>
                {/* The AI adapts it to the code Zeff has now; it stays off until you switch it on again. */}
                <RepairButton request={modAdaptRequest(m.id, m.name, m.stale)} label={t("Adapt with the AI")} onDone={() => void load()} />
              </div>
            )}
            {m.errors.length > 0 && (
              <details className="text-xs text-red-700 dark:text-red-300">
                <summary className="cursor-pointer">{t("{n} errors", { n: m.errors.length })}</summary>
                <ul className="mt-1 space-y-0.5">
                  {m.errors.map((e, i) => (
                    <li key={i}>
                      {e.at.slice(11, 19)} · {e.where} · <span className="font-mono">{e.hook}</span>: {e.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div className="flex flex-wrap gap-1.5 text-xs">
              {o.accounts.length > 1 && (
                <select
                  className="input w-auto py-0.5 text-xs"
                  value={m.accounts?.length === 1 ? m.accounts[0] : m.accounts?.length ? "some" : ""}
                  aria-label={t("Which accounts it is for")}
                  title={t("A mod changes Zeff in the accounts it is for — the others stay as they are")}
                  onChange={(e) => e.target.value !== "some" && void act(`acc-${m.id}`, () => setModAccountsAction(m.id, e.target.value ? [e.target.value] : null), t("Saved."), m.enabled)}
                >
                  <option value="">👥 {t("Every account")}</option>
                  {m.accounts && m.accounts.length > 1 && <option value="some">👤 {m.accounts.map((a) => o.accounts.find((x) => x.id === a)?.name ?? a).join(", ")}</option>}
                  {o.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      👤 {t("Only “{name}”", { name: a.name })}
                    </option>
                  ))}
                </select>
              )}
              <button type="button" className="btn btn-sm" onClick={() => void modSourcesAction(m.id).then((r) => (r.ok ? setOpen({ id: m.id, files: r.files }) : toast(r.error, { tone: "error" })))}>
                {"</>"} {t("Code")}
              </button>
              {m.versions.length > 0 && (
                <select
                  className="input w-auto py-0.5 text-xs"
                  value=""
                  aria-label={t("Back to a version")}
                  onChange={(e) => e.target.value && confirmAction(t("Back to this version? What it is now is kept as a version; the mod is switched off until you switch it on.")) && void act(`v-${m.id}`, () => restoreModVersionAction(m.id, e.target.value), t("Restored."))}
                >
                  <option value="">🕘 {t("Back to a version …")}</option>
                  {m.versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {new Date(v.at).toLocaleString()}
                    </option>
                  ))}
                </select>
              )}
              <button type="button" className="btn btn-sm" onClick={() => confirmAction(t("Remove “{name}”? It is moved aside (data/mods/.removed), not deleted.", { name: m.name })) && void act(`rm-${m.id}`, () => removeModAction(m.id), t("Removed."), m.enabled)}>
                ✕ {t("Remove")}
              </button>
            </div>
            {open?.id === m.id && <ModCode id={m.id} files={open.files} onClose={() => setOpen(null)} onSaved={() => void load()} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ModCode({ id, files, onClose, onSaved }: { id: string; files: Record<string, string>; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [draft, setDraft] = useState(files);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2 border-t border-zinc-100 pt-2 dark:border-zinc-800">
      {Object.keys(draft).map((name) => (
        <label key={name} className="block space-y-0.5">
          <span className="font-mono text-xs text-zinc-500">{name}</span>
          <textarea className="input min-h-32 w-full font-mono text-xs" spellCheck={false} value={draft[name]} onChange={(e) => setDraft({ ...draft, [name]: e.target.value })} />
        </label>
      ))}
      <div className="flex gap-2">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const { ["zeff-mod.json"]: manifest, ...rest } = draft;
            const r = await saveModAction(manifest, rest);
            setBusy(false);
            if (!r.ok) return void toast(r.error, { tone: "error", ms: 12000 });
            toast(r.problems.length ? t("Saved — but it doesn't build: {p}", { p: r.problems.join("; ") }) : t("Saved and built. Reload the page to see a browser part's change."), { tone: r.problems.length ? "error" : "ok", ms: 10000 });
            onSaved();
          }}
        >
          {busy ? "…" : t("Save")}
        </button>
        <button type="button" className="btn btn-sm" onClick={onClose}>
          {t("Close")}
        </button>
        <span className="self-center font-mono text-xs text-zinc-400">{id}</span>
      </div>
    </div>
  );
}
