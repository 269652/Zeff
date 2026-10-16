import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getSettings, saveSettings } from "@k/db";
import { zeffCatalog, type ZeffCatalogEntry } from "@k/zeff";

/**
 * What this knowledge server reads from Zeff: every source Zeff has (Jira, Teams, Mail, WhatsApp …) and every database of
 * its Workspace, each picked or not. Nothing picked yet: what Zeff exports by default (every source, the databases switched
 * into the knowledge there). Pages of what's unpicked leave with the next read.
 */
export default async function ZeffPickPage({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  await connection();
  const { done } = await searchParams;
  let catalog: ZeffCatalogEntry[] = [];
  let error = "";
  try {
    catalog = await zeffCatalog();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const picked = getSettings().zeffInclude.trim();
  const on = new Set(picked ? picked.split(",") : catalog.filter((c) => c.selected).map((c) => c.id));

  async function save(fd: FormData) {
    "use server";
    if (fd.get("reset") === "1") saveSettings({ zeffInclude: "" });
    else saveSettings({ zeffInclude: fd.getAll("id").map(String).filter(Boolean).join(",") });
    revalidatePath("/plugins/zeff");
    redirect(`/plugins/zeff?done=${encodeURIComponent("Saved — it counts from the next read.")}`);
  }

  const group = (kind: ZeffCatalogEntry["kind"], title: string) => (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-zinc-500 uppercase">{title}</h2>
      <ul className="grid gap-1 md:grid-cols-2">
        {catalog
          .filter((c) => c.kind === kind)
          .map((c) => (
            <li key={c.id}>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="id" value={c.id} defaultChecked={on.has(c.id)} />
                <span className="flex-1">{c.name}</span>
                <span className="text-xs text-zinc-400">{c.count}</span>
              </label>
            </li>
          ))}
      </ul>
    </section>
  );

  return (
    <>
      <div>
        <h1 className="text-lg font-semibold">Zeff: what to read</h1>
        <p className="max-w-[75ch] text-sm text-zinc-500">
          Every source Zeff has and every database of its Workspace — pick what this knowledge server reads. Unpicked ones leave with the next read. <Link href="/plugins" className="text-indigo-600 hover:underline dark:text-indigo-400">Plugins</Link>
        </p>
      </div>
      {done && <p className="alert-ok">{done}</p>}
      {error && <p className="alert-error">{error}</p>}
      {!error && (
        <form action={save} className="space-y-4">
          {group("source", "Sources")}
          {group("database", "Workspace databases")}
          <div className="flex gap-2">
            <button className="btn btn-primary btn-sm">Save</button>
            {picked && (
              <button name="reset" value="1" className="btn btn-sm">
                Back to Zeff&apos;s default
              </button>
            )}
          </div>
        </form>
      )}
    </>
  );
}
