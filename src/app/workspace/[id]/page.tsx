import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { loadDatabaseAction } from "@/plugins/workspace/actions";
import { backlinks, breadcrumbs, getPage, touchOpened, tree } from "@/plugins/workspace/store";
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
  const row = isRow ? await loadDatabaseAction(page.dbId!) : null;
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
      row={row?.ok ? { initial: row.data, dbId: page.dbId! } : null}
      database={database?.ok ? database.data : null}
    />
  );
}
