import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { compileRunning } from "@k/compile";
import { counts, getSettings, saveSettings } from "@k/db";
import { styleOf } from "@k/graph-style";
import { applyAll, applyProposal, normalizeEntities, normalizeProgress, normalizeRunning, pendingProposals, recentMerges, rejectProposal, stopNormalize } from "@k/normalize";
import { Refresh } from "./Refresh";

export const metadata: Metadata = { title: "Normalisieren" };

const day = (iso: string) => new Date(iso).toLocaleString("de-DE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * Normalizing the entities: the AI finds the ones that are the same ("Moritz Roessler", "Moritz",
 * "Verfasser") and proposes to make them one — here you take or reject each proposal (its name
 * changeable), or all at once. Run it when you like; compiling doesn't need it.
 */
export default async function NormalizePage({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  await connection();
  const { done } = await searchParams;
  const running = normalizeRunning();
  const proposals = running ? [] : pendingProposals();
  const merges = recentMerges(40);
  const s = getSettings();
  const c = counts();

  async function start(fd: FormData) {
    "use server";
    void normalizeEntities({ apply: fd.get("apply") === "1" });
    redirect("/normalisieren");
  }
  async function stop() {
    "use server";
    stopNormalize();
    redirect("/normalisieren");
  }
  async function owner(fd: FormData) {
    "use server";
    saveSettings({ owner: String(fd.get("owner") ?? "").trim() });
    revalidatePath("/normalisieren");
    redirect("/normalisieren?done=owner");
  }
  async function take(fd: FormData) {
    "use server";
    applyProposal(Number(fd.get("id")), String(fd.get("name") ?? ""));
    revalidatePath("/", "layout");
    redirect("/normalisieren");
  }
  async function reject(fd: FormData) {
    "use server";
    rejectProposal(Number(fd.get("id")));
    revalidatePath("/normalisieren");
    redirect("/normalisieren");
  }
  async function takeAll() {
    "use server";
    const n = applyAll();
    revalidatePath("/", "layout");
    redirect(`/normalisieren?done=${n}`);
  }
  async function rejectAll() {
    "use server";
    for (const p of pendingProposals()) rejectProposal(p.id);
    revalidatePath("/normalisieren");
    redirect("/normalisieren");
  }

  return (
    <>
      <Refresh running={running} />
      <div>
        <h1 className="text-lg font-semibold">Entitäten normalisieren</h1>
        <p className="max-w-[75ch] text-sm text-zinc-500">
          Beim Kompilieren entsteht pro Name eine Entität — dieselbe Person steht so oft mehrfach im{" "}
          <Link href="/graph" className="text-indigo-600 hover:underline dark:text-indigo-400">
            Graphen
          </Link>{" "}
          („Moritz Roessler“, „Moritz“, „Verfasser“), dasselbe System in mehreren Schreibweisen. Die KI sucht unter den {c.entities} Entitäten, was wirklich dasselbe ist, und schlägt vor, es zusammenzuführen: Seiten und Beziehungen gehen auf die eine über, die
          anderen Namen werden ihre Aliase — und neues Kompilieren findet sie unter ihnen wieder.
        </p>
      </div>
      {done === "owner" && <p className="alert-ok">Gespeichert ✓</p>}
      {done && /^\d+$/.test(done) && <p className="alert-ok">{done} Zusammenführungen übernommen ✓</p>}

      <section className="card space-y-3 p-4">
        <form action={owner} className="flex flex-wrap items-end gap-2">
          <label className="block min-w-64 flex-1 text-sm">
            <span className="label">Wem gehört diese Wissensbasis?</span>
            <input name="owner" defaultValue={s.owner} placeholder="Dein Name, z. B. Moritz Roessler — „Ich“, „Verfasser“, „Autor“ meinen dann dich" className="input" />
          </label>
          <button className="btn">Speichern</button>
        </form>
        {running ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm">
              <span className="mr-2 inline-block size-2 animate-pulse rounded-full bg-amber-500" />
              Normalisiert … {normalizeProgress()}
            </span>
            <form action={stop}>
              <button className="btn btn-sm">Anhalten</button>
            </form>
          </div>
        ) : (
          <form action={start} className="flex flex-wrap items-center gap-3">
            <button className="btn btn-primary" disabled={compileRunning()}>
              Normalisierung starten
            </button>
            <label className="flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-300">
              <input type="checkbox" name="apply" value="1" />
              Vorschläge gleich übernehmen
            </label>
            <span className="text-xs text-zinc-500">{compileRunning() ? "Es wird gerade kompiliert — danach." : "Einige KI-Aufrufe (Kompilier-Backend), je nach Größe ein paar Minuten."}</span>
          </form>
        )}
      </section>

      {proposals.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-zinc-500 uppercase">{proposals.length} Vorschläge</h2>
            <form action={takeAll} className="ml-auto">
              <button className="btn btn-primary btn-sm">Alle übernehmen</button>
            </form>
            <form action={rejectAll}>
              <button className="btn btn-sm">Alle verwerfen</button>
            </form>
          </div>
          <ul className="space-y-2">
            {proposals.map((p) => (
              <li key={p.id} className="card space-y-2 p-3">
                <div className="flex flex-wrap items-center gap-1.5 text-sm">
                  {p.members.map((m) => (
                    <Link
                      key={m.id}
                      href={`/graph?e=${m.id}`}
                      title={`${styleOf(m.type).label} · ${m.pages} Seiten${m.summary ? ` — ${m.summary}` : ""}`}
                      className={`flex items-center gap-1 rounded-full border px-2 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${m.id === p.keepId ? "border-zinc-500 font-medium" : "border-zinc-200 dark:border-zinc-700"}`}
                    >
                      <span className="size-2 rounded-full" style={{ background: styleOf(m.type).color }} />
                      {m.name}
                      <span className="text-xs text-zinc-400">{m.pages}</span>
                    </Link>
                  ))}
                </div>
                {p.reason && <p className="text-xs text-zinc-500">{p.reason}</p>}
                <div className="flex flex-wrap items-center gap-2">
                  <form action={take} className="flex flex-1 flex-wrap items-center gap-2">
                    <input type="hidden" name="id" value={p.id} />
                    <span className="text-xs text-zinc-500">→</span>
                    <input name="name" defaultValue={p.name} aria-label="Name der zusammengeführten Entität" className="input min-w-48 flex-1 py-1 text-sm" />
                    <span className="flex items-center gap-1 text-xs text-zinc-500">
                      <span className="size-2 rounded-full" style={{ background: styleOf(p.type).color }} />
                      {styleOf(p.type).label}
                    </span>
                    <button className="btn btn-primary btn-sm">Übernehmen</button>
                  </form>
                  <form action={reject}>
                    <input type="hidden" name="id" value={p.id} />
                    <button className="btn btn-sm">Verwerfen</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!running && !proposals.length && <p className="text-sm text-zinc-500">Keine Vorschläge offen{merges.length ? "" : " — starte eine Normalisierung"}.</p>}

      {merges.length > 0 && (
        <section className="card p-4">
          <h2 className="mb-2 text-sm font-semibold text-zinc-500 uppercase">Zuletzt zusammengeführt</h2>
          <ul className="space-y-1 text-sm">
            {merges.map((m, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-zinc-500 line-through decoration-zinc-300">{m.fromName}</span>
                <span className="text-zinc-400">→</span>
                <Link href={`/graph?e=${m.intoId}`} className="font-medium hover:underline">
                  {m.intoName}
                </Link>
                <span className="text-xs text-zinc-400">{day(m.at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
