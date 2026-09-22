import type { Metadata } from "next";
import { connection } from "next/server";
import { CreateTagForm } from "@/components/CreateTagForm";
import { TagRow } from "@/components/TagRow";
import { listTagsWithCounts } from "@/lib/tags";

export const metadata: Metadata = { title: "Tags" };

export default async function TagsPage() {
  await connection();
  const tags = listTagsWithCounts();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Tags</h1>
        <p className="text-sm text-zinc-500">
          Tags label entries (typically tickets). Add them here, or just type{" "}
          <code className="code">#tag</code> in an entry description — an autocomplete pops up and the
          hashtag becomes a tag.
        </p>
      </div>

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
