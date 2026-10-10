import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { CLAUDE_MODELS, COPILOT_MODEL_SUGGESTIONS } from "@/lib/ai/shared";
import { copilotModels } from "@/plugins/copilot-cli/cli";
import { compilePages, compileRunning, compileStopping, compilingWith, stopCompile } from "@k/compile";
import { confluenceConfig, confluenceWhere } from "@k/confluence";
import { ACCOUNT_NAME, counts, getSettings, lastRuns, saveSettings } from "@k/db";
import { stopSync, syncPages, syncRunning } from "@k/ingest";
import { kInstalled, type AiBackend } from "@k/plugins";
import { searchEntities, searchPages } from "@k/search";
import { AddKnowledgeForm, keepFromForm } from "./AddKnowledge";
import { BackendPicker, type BackendOption } from "./BackendPicker";
import { RunPanel } from "./RunPanel";

const BACKENDS: { id: AiBackend; label: string; plugin: "copilot-cli" | "claude-cli" }[] = [
  { id: "copilot", label: "GitHub Copilot CLI", plugin: "copilot-cli" },
  { id: "claude", label: "Claude CLI", plugin: "claude-cli" },
];

/**
 * The knowledge server's own page: how far it is (pages, compiled, entities, relations), where it
 * reads from, reading and compiling by hand, a search to try, its settings — which CLI compiles
 * and which answers —, the last runs. Asking (the chat) is in Zeff: the Chat tab.
 */
export default async function Home({ searchParams }: { searchParams: Promise<{ q?: string; done?: string; added?: string; error?: string }> }) {
  await connection();
  const { q = "", done, added, error } = await searchParams;
  const c = counts();
  const s = getSettings();
  const runs = lastRuns(8);
  const busy = syncRunning() || compileRunning();
  // The installed CLIs and their models (Copilot's as it lists them — waited for 3 s at most, else its known ones).
  const copilotList = kInstalled("copilot-cli") ? await Promise.race([copilotModels().catch(() => [] as string[]), new Promise<string[]>((r) => setTimeout(() => r([]), 3000))]) : [];
  const options: BackendOption[] = BACKENDS.filter((b) => kInstalled(b.plugin)).map((b) => ({
    id: b.id,
    label: b.label,
    models:
      b.id === "claude"
        ? [
            { value: "", label: "Standard der CLI" },
            { value: "claude-sonnet-5-5", label: "Sonnet 5.5 — empfohlen" },
            { value: "claude-haiku-5-5", label: "Haiku 5.5" },
            { value: "claude-opus-5-5", label: "Opus 5.5 — gründlich, langsam" },
            ...CLAUDE_MODELS.filter((m) => m.value).map((m) => ({ value: m.value, label: `${m.value} (Alias)` })),
          ]
        : [{ value: "", label: "Standard der CLI" }, ...(copilotList.length ? copilotList : COPILOT_MODEL_SUGGESTIONS).map((m) => ({ value: m, label: m }))],
  }));

  async function save(fd: FormData) {
    "use server";
    const compileBackend: AiBackend = fd.get("compileBackend") === "claude" ? "claude" : "copilot";
    const askBackend: AiBackend = fd.get("askBackend") === "claude" ? "claude" : "copilot";
    saveSettings({
      spaces: String(fd.get("spaces") ?? ""),
      maxPages: Number(fd.get("maxPages")) || 2000,
      // Without an installed CLI the form has no choice: what was set stays.
      compileBackend: fd.has("compileBackend") ? compileBackend : undefined,
      compileModel: fd.has("compileModel") ? String(fd.get("compileModel")).trim() : undefined,
      askBackend: fd.has("askBackend") ? askBackend : undefined,
      askModel: fd.has("askModel") ? String(fd.get("askModel")).trim() : undefined,
      importDir: fd.has("importDir") ? String(fd.get("importDir")) : undefined,
    });
    revalidatePath("/");
    redirect("/?done=saved");
  }
  async function refresh() {
    "use server";
    void syncPages().then(async (r) => {
      if (r.ok) await compilePages();
    });
    revalidatePath("/");
    redirect("/?done=sync");
  }
  async function keep(fd: FormData) {
    "use server";
    await keepFromForm(fd, "/");
  }
  async function compile() {
    "use server";
    void compilePages();
    revalidatePath("/");
    redirect("/?done=compile");
  }

  const pages = q ? searchPages(q, 10) : [];
  const entities = q ? searchEntities(q, 6) : [];
  // What it reads — the installed sources (Confluence only with its plugin: another account's knowledge server has none).
  const where = confluenceWhere();
  const sources: { label: string; href?: string }[] = [
    ...(kInstalled("confluence") && confluenceConfig() && where ? [{ label: where, href: where }] : []),
    ...(kInstalled("zeff") ? [{ label: `Zeff${ACCOUNT_NAME ? ` (${ACCOUNT_NAME})` : ""}` }] : []),
    ...(kInstalled("google-keep") && !kInstalled("zeff") ? [{ label: "Google Keep" }] : []),
    ...(kInstalled("import-folder") && s.importDir ? [{ label: s.importDir }] : []),
  ];
  const noSource = !(kInstalled("confluence") && confluenceConfig()) && !kInstalled("zeff") && !kInstalled("google-keep") && !(kInstalled("import-folder") && s.importDir);

  return (
    <>
      {done && DONE[done] && <p className="alert-ok">{DONE[done]}</p>}
      {added && (
        <p className="alert-ok">
          Gemerkt ✓ — wird kompiliert.{" "}
          <Link href={`/seite/${encodeURIComponent(added)}`} className="underline">
            Ansehen
          </Link>
        </p>
      )}
      {error && <p className="alert-error">{error}</p>}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Wissen</h1>
          <p className="max-w-[75ch] text-sm text-zinc-500">
            Liest{" "}
            {sources.length
              ? sources.map((src, i) => (
                  <span key={i}>
                    {i ? (i === sources.length - 1 ? " und " : ", ") : ""}
                    {src.href ? (
                      <a href={src.href} className="text-indigo-600 hover:underline dark:text-indigo-400">
                        {src.label}
                      </a>
                    ) : (
                      src.label
                    )}
                  </span>
                ))
              : "noch keine Quelle"}
            ,{" "}kompiliert die Seiten zu einem Wissensgraphen und beantwortet Fragen — in Zeff im Chat-Tab.
          </p>
        </div>
        {!busy && (
          <div className="flex flex-wrap items-center gap-2">
            <form action={refresh}>
              <button className="btn btn-primary">Jetzt lesen & kompilieren</button>
            </form>
            <form action={compile}>
              <button className="btn">Nur kompilieren</button>
            </form>
          </div>
        )}
      </div>
      {/* What runs now — following itself, the page around it stays. */}
      {busy && (
        <RunPanel
          initial={{ sync: syncRunning(), compile: compileRunning(), stopping: compileStopping(), with: compilingWith(), compiled: c.compiled, pages: c.pages }}
          stop={async () => {
            "use server";
            stopSync();
            stopCompile();
          }}
        />
      )}
      {noSource && (
        <p className="alert-error">
          Keine Quelle: das Confluence-Plugin (mit CONFLUENCE_URL und CONFLUENCE_PERSONAL_TOKEN in Zeffs .env), das Zeff-, das Google-Keep- oder das Import-Ordner-Plugin (
          <Link href="/plugins" className="underline">
            Plugins
          </Link>
          ).
        </p>
      )}

      <section className="card grid grid-cols-3 gap-4 p-4 sm:grid-cols-6">
        {(
          [
            ["Seiten", c.pages],
            ["kompiliert", c.compiled],
            ["Bereiche", c.spaces],
            ["Abschnitte", c.chunks],
            ["Entitäten", c.entities],
            ["Beziehungen", c.relations],
          ] as const
        ).map(([label, n]) => (
          <div key={label}>
            <div className="text-2xl font-semibold tabular-nums">{n}</div>
            <div className="text-xs text-zinc-500">{label}</div>
          </div>
        ))}
      </section>

      <section className="card space-y-2 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">Wissen hinzufügen</h2>
          <Link href="/eigenes" className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
            Eigenes Wissen →
          </Link>
        </div>
        <AddKnowledgeForm action={keep} compact />
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">Ausprobieren</h2>
        <form className="flex gap-2">
          <input name="q" defaultValue={q} placeholder="Suchen …" className="input" />
          <button className="btn">Suchen</button>
        </form>
        {q && (
          <div className="space-y-2">
            {entities.map((e) => (
              <div key={e.id} className="text-sm">
                <Link href={`/graph?e=${e.id}`} className="font-medium hover:underline">
                  {e.name}
                </Link>{" "}
                <span className="text-xs text-zinc-400">{e.type}</span> — {e.summary}
                {e.related.length > 0 && <div className="text-xs text-zinc-500">{e.related.map((r) => (r.dir === "out" ? `→ ${r.rel} ${r.name}` : `← ${r.name} ${r.rel}`)).join(" · ")}</div>}
              </div>
            ))}
            {pages.map((p) => (
              <div key={p.id} className="rounded-md border border-zinc-200 p-2 text-sm dark:border-zinc-800">
                <Link href={`/seite/${encodeURIComponent(p.id)}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                  {p.title}
                </Link>{" "}
                <span className="text-xs text-zinc-400">{p.space}</span>
                <p className="text-xs text-zinc-600 dark:text-zinc-400">
                  {p.snippet.split(/(⟦[^⟧]*⟧)/g).map((x, i) => (x.startsWith("⟦") ? <mark key={i} className="rounded-sm bg-amber-200 px-0.5 dark:bg-amber-700/60">{x.slice(1, -1)}</mark> : <span key={i}>{x}</span>))}
                </p>
              </div>
            ))}
            {!pages.length && !entities.length && <p className="text-sm text-zinc-500">Nichts gefunden.</p>}
          </div>
        )}
      </section>

      <section className="card space-y-4 p-4">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">Einstellungen</h2>
        <form action={save} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="label">Bereiche</span>
              <input name="spaces" defaultValue={s.spaces} placeholder="Space-Keys, z. B. SUPPORT, DEV — leer: alle sichtbaren" className="input" />
            </label>
            <label className="block text-sm">
              <span className="label">Seiten je Bereich höchstens</span>
              <input name="maxPages" type="number" min={1} defaultValue={s.maxPages} className="input" />
            </label>
          </div>
          <BackendPicker task="compile" label="Kompilieren (Seiten → Wissen)" backends={options} backend={s.compileBackend} model={s.compileModel} />
          <BackendPicker task="ask" label="Antworten (Chat)" backends={options} backend={s.askBackend} model={s.askModel} />
          {!options.length && (
            <p className="alert-error">
              Keine CLI installiert —{" "}
              <Link href="/plugins" className="underline">
                Plugins
              </Link>
              .
            </p>
          )}
          {kInstalled("import-folder") && (
            <label className="block text-sm">
              <span className="label">Import-Ordner</span>
              <input name="importDir" defaultValue={s.importDir} placeholder="C:\…\confluence-export — .json, .md, .html; Unterordner sind Bereiche" className="input font-mono text-xs" />
            </label>
          )}
          <button className="btn btn-primary">Speichern</button>
        </form>
      </section>

      <section className="card p-4">
        <h2 className="mb-2 text-sm font-semibold text-zinc-500 uppercase">Letzte Läufe</h2>
        <table className="table">
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td>{r.kind === "sync" ? "Lesen" : "Kompilieren"}</td>
                <td className="whitespace-nowrap text-zinc-500">{new Date(r.started_at).toLocaleString("de-DE")}</td>
                <td>{r.finished_at ? (r.ok ? <span className="text-emerald-600 dark:text-emerald-400">✓</span> : <span className="text-red-600 dark:text-red-400">✗</span>) : "läuft"}</td>
                <td className="w-full">{r.message}</td>
              </tr>
            ))}
            {!runs.length && (
              <tr>
                <td className="text-zinc-500">noch keine</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}

const DONE: Record<string, string> = {
  saved: "Gespeichert ✓ — gilt ab dem nächsten Lesen und der nächsten Frage.",
  sync: "Liest die Quellen und kompiliert danach, was neu ist — die Zahlen wachsen mit (die Seite lädt sich neu, solange es läuft).",
  compile: "Kompiliert die neuen und geänderten Seiten — die Zahlen wachsen mit.",
  stop: "Wird angehalten — die laufenden Aufrufe enden noch und werden behalten.",
};
