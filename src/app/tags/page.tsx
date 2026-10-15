import { EmptyState } from "@/components/EmptyState";
import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import { rich } from "@/lib/i18n/rich";
import { connection } from "next/server";
import { CreateTagForm } from "@/components/CreateTagForm";
import { EntryTypesEditor } from "@/components/EntryTypesEditor";
import { TagRow } from "@/components/TagRow";
import { entryTypeUsage, listEntryTypes } from "@/lib/entry-types";
import { listTagsWithCounts } from "@/lib/tags";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Tags & types") };
}

export default async function TagsPage() {
  await connection();
  const tags = listTagsWithCounts();
  const types = listEntryTypes();

  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">{t("Tags & types")}</h1>
        <p className="text-sm text-zinc-500">
          {rich(
            t(
              "Tags label entries (typically tickets). Add them here, or just type <code>#tag</code> in an entry description — an autocomplete pops up and the hashtag becomes a tag.",
            ),
            { code: (s) => <code className="code">{s}</code> },
          )}
        </p>
      </div>

      <section className="card space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Entry types")}</h2>
          <p className="mt-1 text-sm text-zinc-500">
            {t(
              "The kind of work an entry is — shown as a colored badge, used by the report rules, type rules and Analysis. Built-in types can be renamed and recolored; your own can be deleted while no entry uses them.",
            )}
          </p>
        </div>
        <EntryTypesEditor key={types.map((ty) => `${ty.key}:${ty.label}:${ty.color}`).join("|")} types={types} usage={entryTypeUsage()} />
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("New tag")}</h2>
        <CreateTagForm />
      </section>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase">{t("All tags ({n})", { n: tags.length })}</h2>
        {tags.length === 0 ? (
          <EmptyState variant="centered">{t("No tags yet.")}</EmptyState>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t("Name")}</th>
                <th scope="col" className="num">{t("Entries")}</th>
                <th scope="col"><span className="sr-only">{t("Actions")}</span></th>
              </tr>
            </thead>
            <tbody>
              {tags.map((tag) => (
                <TagRow key={tag.id} id={tag.id} name={tag.name} count={tag.entryCount} />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
