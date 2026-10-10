import type { Metadata } from "next";
import { connection } from "next/server";
import { CreateTagForm } from "@/components/CreateTagForm";
import { EntryTypesEditor } from "@/components/EntryTypesEditor";
import { TagRow } from "@/components/TagRow";
import { entryTypeUsage, listEntryTypes } from "@/lib/entry-types";
import { listTagsWithCounts } from "@/lib/tags";

export const metadata: Metadata = { title: "Tags & types" };

export default async function TagsPage() {
  await connection();
  const tags = listTagsWithCounts();
  const types = listEntryTypes();

  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">Tags &amp; types</h1>
        <p className="text-sm text-zinc-500">
          Tags label entries (typically tickets). Add them here, or just type{" "}
          <code className="code">#tag</code> in an entry description — an autocomplete pops up and the
          hashtag becomes a tag.
        </p>
      </div>

      <section className="card space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">Entry types</h2>
          <p className="mt-1 text-sm text-zinc-500">
            The kind of work an entry is — shown as a colored badge, used by the report rules, type rules and
            Analysis. Built-in types can be renamed and recolored; your own can be deleted while no entry uses them.
          </p>
        </div>
        <EntryTypesEditor key={types.map((t) => `${t.key}:${t.label}:${t.color}`).join("|")} types={types} usage={entryTypeUsage()} />
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">New tag</h2>
        <CreateTagForm />
      </section>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase">All tags ({tags.length})</h2>
        {tags.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-500">No tags yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th className="num">Entries</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tags.map((t) => (
                <TagRow key={t.id} id={t.id} name={t.name} count={t.entryCount} />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
