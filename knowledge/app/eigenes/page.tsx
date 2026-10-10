import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { formatDateTime } from "@/lib/format";
import { listOwn, removeOwn, updateOwn } from "@k/own";
import { AddKnowledgeForm, keepFromForm } from "../AddKnowledge";

export const metadata: Metadata = { title: "Your knowledge" };

const day = (iso: string | null) => (iso ? formatDateTime(iso) : "");
const back = (params: Record<string, string>) => `/eigenes?${new URLSearchParams(params)}`;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/**
 * Your own knowledge: what you add yourself — a fact, a note, how something goes, a link (its page
 * read) — compiled into the graph like the sources' pages, and never removed by a sync. Edit or
 * delete each here; from Zeff it comes in through the Chat tab and agents (add_knowledge).
 */
export default async function OwnKnowledgePage({ searchParams }: { searchParams: Promise<{ added?: string; error?: string; saved?: string; edit?: string }> }) {
  await connection();
  const sp = await searchParams;
  const entries = listOwn();

  async function add(fd: FormData) {
    "use server";
    await keepFromForm(fd, "/eigenes");
  }
  async function save(fd: FormData) {
    "use server";
    const id = String(fd.get("id"));
    try {
      await updateOwn(id, { title: String(fd.get("title") ?? ""), text: String(fd.get("text") ?? ""), url: String(fd.get("url") ?? "") });
    } catch (e) {
      redirect(back({ error: message(e), edit: id }));
    }
    revalidatePath("/", "layout");
    redirect(back({ saved: id }));
  }
  async function remove(fd: FormData) {
    "use server";
    removeOwn(String(fd.get("id")));
    revalidatePath("/", "layout");
    redirect("/eigenes");
  }

  return (
    <>
      <div>
        <h1 className="text-lg font-semibold">Your knowledge</h1>
        <p className="max-w-[75ch] text-sm text-zinc-500">
          What you want to keep without it coming from a source — a fact, a note, how something works, or a link (the page behind it is read). It’s compiled like everything else and then shows up in search, in the{" "}
          <Link href="/graph" className="text-indigo-600 hover:underline dark:text-indigo-400">
            graph
          </Link>
          , in the chat and for agents. No read of the sources deletes it.
        </p>
      </div>
      {sp.error && <p className="alert-error">{sp.error}</p>}
      {sp.added && <p className="alert-ok">Kept ✓ — compiling.</p>}
      {sp.saved && <p className="alert-ok">Saved ✓ — recompiling.</p>}

      <section className="card p-4">
        <AddKnowledgeForm action={add} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">
          {entries.length} {entries.length === 1 ? "entry" : "entries"}
        </h2>
        {entries.map((e) => (
          <article key={e.id} id={e.id} className={`card space-y-2 p-4 ${sp.added === e.id || sp.saved === e.id ? "ring-2 ring-emerald-400/60" : ""}`}>
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="font-medium">{e.title}</h3>
              <span className="text-xs text-zinc-400">{day(e.updatedAt)}</span>
              <span className={`text-xs ${e.compiled ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>{e.compiled ? `compiled · ${e.entities} entities` : "compiling …"}</span>
              <Link href={`/seite/${encodeURIComponent(e.id)}`} className="ml-auto text-xs text-indigo-600 hover:underline dark:text-indigo-400">
                View →
              </Link>
            </div>
            {e.summary && <p className="text-sm text-zinc-600 dark:text-zinc-300">{e.summary}</p>}
            {e.url && (
              <a href={e.url} target="_blank" rel="noreferrer" className="block truncate text-xs text-indigo-600 hover:underline dark:text-indigo-400">
                {e.url}
              </a>
            )}
            <details open={sp.edit === e.id}>
              <summary className="cursor-pointer text-xs text-zinc-500">Edit</summary>
              <form action={save} className="mt-2 space-y-2">
                <input type="hidden" name="id" value={e.id} />
                <input name="title" defaultValue={e.title} className="input" />
                <textarea name="text" defaultValue={e.text} rows={Math.min(16, Math.max(4, e.text.split("\n").length + 1))} className="input resize-y font-mono text-xs" />
                <input name="url" defaultValue={e.url} placeholder="Link (optional)" className="input text-xs" />
                <div className="flex gap-2">
                  <button className="btn btn-primary btn-sm">Save</button>
                </div>
              </form>
              <form action={remove} className="mt-2">
                <input type="hidden" name="id" value={e.id} />
                <button className="btn btn-sm text-red-700 dark:text-red-400">Delete</button>
              </form>
            </details>
          </article>
        ))}
        {!entries.length && <p className="text-sm text-zinc-500">Nothing yet — write above what you want to keep.</p>}
      </section>
    </>
  );
}
