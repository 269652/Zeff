import type { Metadata } from "next";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { compileRunning, compileSoon, markForRecompile } from "@k/compile";
import { pageDetail } from "@k/graph";
import { isOwn } from "@k/own";
import { styleOf } from "@k/graph-style";

export const metadata: Metadata = { title: "Seite" };

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleString("de-DE", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

/** One page of the knowledge: its text as read, and what compiling made of it — the summary, the entities it names (each into the graph), the relations it states. */
export default async function KnowledgePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string }> }) {
  await connection();
  const id = decodeURIComponent((await params).id);
  const { done } = await searchParams;
  const p = pageDetail(id);
  if (!p) notFound();
  async function recompile() {
    "use server";
    markForRecompile([id]);
    compileSoon();
    revalidatePath(`/seite/${encodeURIComponent(id)}`);
    redirect(`/seite/${encodeURIComponent(id)}?done=recompile`);
  }
  const own = isOwn(p.id);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <article className="card min-w-0 space-y-3 p-4">
        <div>
          <p className="text-xs text-zinc-500">
            {p.space}
            {p.author ? ` · ${p.author}` : ""}
            {p.updatedAt ? ` · ${day(p.updatedAt)}` : ""}
          </p>
          <h1 className="text-lg font-semibold break-words">{p.title}</h1>
          <div className="flex flex-wrap gap-3 text-xs">
            {p.url && /^https?:/.test(p.url) && (
              <a href={p.url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline dark:text-indigo-400">
                Quelle öffnen ↗
              </a>
            )}
            <form action={recompile}>
              <button className="text-indigo-600 hover:underline dark:text-indigo-400" title="Die KI wertet die Seite noch einmal aus (Zusammenfassung, Entitäten, Beziehungen)">
                Neu kompilieren
              </button>
            </form>
            {own && (
              <Link href={`/eigenes#${encodeURIComponent(p.id)}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                Eigenes Wissen — bearbeiten
              </Link>
            )}
          </div>
        </div>
        {done === "recompile" && <p className="alert-ok">Wird neu kompiliert{compileRunning() ? " — nach dem laufenden Kompilieren" : ""}. Lade die Seite gleich neu.</p>}
        {p.summary ? (
          <p className="rounded-md bg-zinc-50 p-3 text-sm dark:bg-zinc-900">{p.summary}</p>
        ) : (
          !p.compiled && <p className="text-sm text-amber-600 dark:text-amber-400">Noch nicht kompiliert.</p>
        )}
        <pre className="font-sans text-sm leading-relaxed break-words whitespace-pre-wrap">{p.body}</pre>
      </article>
      <aside className="space-y-3">
        <section className="card space-y-2 p-4">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase">Entitäten ({p.entities.length})</h2>
          <ul className="flex flex-wrap gap-1.5">
            {p.entities.map((e) => (
              <li key={e.id}>
                <Link href={`/graph?e=${e.id}`} className="flex items-center gap-1 rounded-full border border-zinc-200 px-2 py-0.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800" title={styleOf(e.type).label}>
                  <span className="size-2 rounded-full" style={{ background: styleOf(e.type).color }} />
                  {e.name}
                </Link>
              </li>
            ))}
            {!p.entities.length && <li className="text-xs text-zinc-500">keine</li>}
          </ul>
        </section>
        {p.relations.length > 0 && (
          <section className="card space-y-2 p-4">
            <h2 className="text-xs font-semibold text-zinc-500 uppercase">Beziehungen ({p.relations.length})</h2>
            <ul className="space-y-1.5 text-xs">
              {p.relations.map((r, i) => (
                <li key={i}>
                  <Link href={`/graph?e=${r.src.id}`} className="font-medium hover:underline">
                    {r.src.name}
                  </Link>{" "}
                  <span className="text-zinc-500">{r.rel}</span>{" "}
                  <Link href={`/graph?e=${r.dst.id}`} className="font-medium hover:underline">
                    {r.dst.name}
                  </Link>
                  {r.fact && <p className="text-zinc-500">{r.fact}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </aside>
    </div>
  );
}
