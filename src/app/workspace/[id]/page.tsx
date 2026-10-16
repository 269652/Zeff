import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { getPref } from "@/lib/prefs";
import { isInstalled } from "@/plugins/state";
import { loadDatabaseAction } from "@/plugins/workspace/actions";
import { backlinks, breadcrumbs, getDatabase, getPage, touchOpened, tree } from "@/plugins/workspace/store";
import { PageView } from "@/plugins/workspace/ui/PageView";
import { ArchivedNotice } from "@/plugins/workspace/ui/Trash";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const page = isInstalled("workspace") && Number.isInteger(Number(id)) ? getPage(Number(id)) : null;
  return { title: page?.title || t("Workspace") };
}

/** One page of the Workspace: a document, a database, or a row of one (its properties above its text). */
export default async function WorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  if (!isInstalled("workspace")) return null;
  const { id } = await params;
  const page = Number.isInteger(Number(id)) ? getPage(Number(id)) : null;
  if (!page) notFound();
  if (page.archivedAt) return <ArchivedNotice id={page.id} title={page.title} />;
  touchOpened(page.id);
  const isRow = page.dbId !== null;
  // A database's detail layout (System → Detail views): shown with its arranging controls.
  const detailFolder = getPref<number | null>("system.detailFolder", null);
  const arrangeLayout = !!detailFolder && page.parentId === detailFolder;
  // A row whose database has a detail view: the layout and, for a person, what the blocks show come with the page — nothing to fetch after it.
  const detailId = isRow ? getDatabase(page.dbId!)?.schema.detailPage : undefined;
  const layout = detailId ? getPage(detailId) : null;
  let person: unknown = null;
  if (layout && isInstalled("people")) {
    const { personOfRow, personBundle } = await import("@/plugins/people/blocks");
    const pid = personOfRow(page.id);
    if (pid) person = await personBundle(pid).catch(() => null);
  }
  // Field, related and button blocks work on the row's database: read with the page too (only then).
  const needsData = !!layout && /"zeff(Field|Related|Button)"/.test(JSON.stringify(layout.content));
  const rowData = needsData ? await loadDatabaseAction(page.dbId!) : null;
  const row = isRow && !layout ? await loadDatabaseAction(page.dbId!) : null;
  const database = page.kind === "database" ? await loadDatabaseAction(page.id) : null;
  return (
    <PageView
      key={page.id}
      page={{
        id: page.id,
        kind: page.kind,
        title: page.title,
        icon: page.icon,
        cover: page.cover,
        content: page.content as never,
        rev: page.rev,
        favorite: page.favorite,
        fullWidth: page.fullWidth,
        smallText: page.smallText,
        locked: page.locked,
        template: page.template,
        isRow,
        updatedAt: page.updatedAt,
        crumbs: breadcrumbs(page.id),
        backlinks: backlinks(page.id).map((b) => ({ id: b.id, title: b.title, icon: b.icon })),
        children: tree()
          .filter((x) => x.parentId === page.id)
          .map((x) => ({ id: x.id, title: x.title, icon: x.icon, kind: x.kind })),
      }}
      arrangeLayout={arrangeLayout}
      row={row?.ok ? { initial: row.data, dbId: page.dbId! } : null}
      detail={layout ? { pageId: layout.id, content: layout.content as never, rev: layout.rev, person: person as never, data: rowData?.ok ? rowData.data : null } : null}
      database={database?.ok ? database.data : null}
    />
  );
}
