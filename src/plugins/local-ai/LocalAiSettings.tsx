"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { probeLocalAiAction, saveLocalAiAction, testLocalAiAction } from "./server-actions";

const PRESETS = [
  { label: "Ollama", url: "http://127.0.0.1:11434" },
  { label: "LM Studio", url: "http://127.0.0.1:1234" },
];

/** The local AI's page: which server (Ollama, LM Studio or an address), its model (asked from it), a test, and what goes there. */
export function LocalAiSettings({ initial }: { initial: { url: string; model: string; secretLocal: boolean } }) {
  const t = useT();
  const router = useRouter();
  const [url, setUrl] = useState(initial.url);
  const [model, setModel] = useState(initial.model);
  const [secretLocal, setSecretLocal] = useState(initial.secretLocal);
  const [server, setServer] = useState<{ ok: true; kind: "ollama" | "openai"; models: string[] } | { ok: false; error: string } | null>(null);
  const [pending, start] = useTransition();
  const [testing, startTest] = useTransition();

  // The server asked for its models as the address changes (a moment after typing stops).
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      void probeLocalAiAction(url).then((r) => live && setServer(r));
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [url]);

  const save = () =>
    start(async () => {
      const r = await saveLocalAiAction({ url, model, secretLocal });
      toast(r?.ok ? (r.message ?? t("Saved.")) : (r?.error ?? t("Didn't work.")), { tone: r?.ok ? "ok" : "error" });
      router.refresh();
    });

  return (
    <div className="space-y-4">
      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Server")}</h2>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button key={p.url} type="button" onClick={() => setUrl(p.url)} aria-pressed={url === p.url} className={`btn btn-sm ${url === p.url ? "btn-primary" : ""}`}>
              {p.label}
            </button>
          ))}
        </div>
        <label className="block text-sm">
          <span className="label">{t("Address")}</span>
          <input className="input font-mono text-xs" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
        </label>
        <p role="status" className="text-sm">
          {!server ? (
            <span className="text-zinc-500">{t("Looking…")}</span>
          ) : server.ok ? (
            <span className="text-emerald-700 dark:text-emerald-400">
              {server.kind === "ollama" ? t("Ollama answers — {n} models.", { n: server.models.length }) : t("A server answers — {n} models.", { n: server.models.length })}
            </span>
          ) : (
            <span className="text-amber-800 dark:text-amber-300">{server.error}</span>
          )}
        </p>
        {server && !server.ok && (
          <div className="rounded-md bg-zinc-100 p-3 text-xs text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
            <p className="font-medium">{t("Getting started with Ollama")}</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5">
              <li>
                {t("Install it from")}{" "}
                <a href="https://ollama.com/download" target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline dark:text-indigo-300">
                  ollama.com/download
                </a>
              </li>
              <li>
                {t("Fetch a model, in a terminal:")} <code className="font-mono">ollama pull qwen3:8b</code> {t("(about 5 GB; with 16 GB of memory or more: qwen3:14b)")}
              </li>
              <li>{t("Come back here — the model shows up below.")}</li>
            </ol>
          </div>
        )}
        <label className="block text-sm">
          <span className="label">{t("Model")}</span>
          {server?.ok && server.models.length ? (
            <select className="input" value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="">{t("The first one ({model})", { model: server.models[0] })}</option>
              {model && !server.models.includes(model) && <option value={model}>{t("{model} (not on the server)", { model })}</option>}
              {server.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : (
            <input className="input font-mono text-xs" value={model} onChange={(e) => setModel(e.target.value)} placeholder="qwen3:8b" />
          )}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-sm"
            disabled={testing || !server?.ok}
            onClick={() =>
              startTest(async () => {
                const r = await testLocalAiAction({ url, model });
                toast(r?.ok ? (r.message ?? t("Works.")) : (r?.error ?? t("Didn't work.")), { tone: r?.ok ? "ok" : "error" });
              })
            }
          >
            {testing ? t("Testing…") : t("Test")}
          </button>
          <span className="text-xs text-zinc-500">{t("The first answer takes longer: the model is loaded into memory.")}</span>
        </div>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("What goes to it")}</h2>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1 accent-indigo-600" checked={secretLocal} onChange={(e) => setSecretLocal(e.target.checked)} />
          <span>
            <span className="font-medium">{t("What is marked secret goes only to the local AI")}</span>
            <span className="block text-zinc-600 dark:text-zinc-400">
              {t("A prompt with lines from a secret source or database (Settings → Data boundaries — e.g. your bank, Signal) goes whole to this computer's AI instead of to a cloud AI without them. Everything else goes where the AI settings say.")}
            </span>
          </span>
        </label>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {t("To run everything locally: choose the local AI as the default under")}{" "}
          <Link href="/settings/ai" className="text-indigo-700 hover:underline dark:text-indigo-300">
            {t("Settings → AI")}
          </Link>
          {t(" — or only single tasks (the mail review, the briefing …) in the table there.")}
        </p>
      </section>

      <button type="button" className="btn btn-primary" disabled={pending} onClick={save}>
        {pending ? t("Saving…") : t("Save")}
      </button>
    </div>
  );
}
