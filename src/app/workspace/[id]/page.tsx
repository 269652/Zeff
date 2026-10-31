import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { loadDatabaseAction } from "@/plugins/workspace/actions";
import { backlinks, breadcrumbs, getDatabase, getPage, inTemplates, templateTree, touchOpened, tree } from "@/plugins/workspace/store";
import { PageView } from "@/plugins/workspace/ui/PageView";
import { ArchivedNotice } from "@/plugins/workspace/ui/Trash";
import { LageStrip } from "@/plugins/jira-lage/LageStrip";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const page = isInstalled("workspace") && Number.isInteger(Number(id)) ? getPage(Number(id)) : null;
  return { title: page?.title || t("Workspace") };
}

/** One page of the Workspace: a document, a database, a form, or a row of a database (its properties above its text). */
export default async function WorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  if (!isInstalled("workspace")) return null;
  const { id } = await params;
  const page = Number.isInteger(Number(id)) ? getPage(Number(id)) : null;
  if (!page) notFound();
  if (page.archivedAt) return <ArchivedNotice id={page.id} title={page.title} />;
  touchOpened(page.id);
  const isRow = page.dbId !== null;
  // A row whose database has a custom view (a person's page): its page starts with that view's block — written once, here.
  const rowViews = isRow ? await import("@/plugins/workspace/row-views") : null;
  rowViews?.ensureRowView(page.id);
  const fresh = getPage(page.id) ?? page;
  // What a person's page shows comes with the page — nothing to fetch after it.
  let person: unknown = null;
  if (isRow && isInstalled("people") && getDatabase(page.dbId!)?.schema.dataType === "people") {
    const { personOfRow, personBundle } = await import("@/plugins/people/blocks");
    const pid = personOfRow(page.id);
    if (pid) person = await personBundle(pid).catch(() => null);
  }
  const row = isRow ? await loadDatabaseAction(page.dbId!) : null;
  const database = page.kind === "database" ? await loadDatabaseAction(page.id) : null;
  const form = page.kind === "form" ? (await import("@/plugins/workspace/forms")).getForm(page.id) : null;
  const ofTemplates = !isRow && inTemplates(page.id);
  const view = (
    <PageView
      key={page.id}
      page={{
        id: page.id,
        kind: page.kind,
        title: page.title,
        icon: page.icon,
        cover: page.cover,
        content: fresh.content as never,
        rev: fresh.rev,
        favorite: page.favorite,
        fullWidth: page.fullWidth,
        smallText: page.smallText,
        locked: page.locked,
        template: page.template,
        inTemplates: ofTemplates,
        isRow,
        layoutFits: !!rowViews?.rowLayoutFits(page.id),
        updatedAt: page.updatedAt,
        crumbs: breadcrumbs(page.id),
        backlinks: backlinks(page.id).map((b) => ({ id: b.id, title: b.title, icon: b.icon })),
        children: (ofTemplates ? templateTree() : tree())
          // (A day list's log is its History tab, not a sub-page.)
          .filter((x) => x.parentId === page.id && !x.dayLogOf)
          .map((x) => ({ id: x.id, title: x.title, icon: x.icon, kind: x.kind })),
      }}
      row={row?.ok ? { initial: row.data, dbId: page.dbId! } : null}
      person={person as never}
      database={database?.ok ? database.data : null}
      form={form}
    />
  );
  // The Jira briefing's run buttons over its databases (Meine Lage, a Jira board's).
  if (page.kind !== "database") return view;
  return (
    <>
      <LageStrip dbId={page.id} />
      {view}
    </>
  );
}
