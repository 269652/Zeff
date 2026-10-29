"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { confirmAction } from "@/components/confirm";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { deletePageAction, emptyTrashAction, restorePageAction } from "../actions";
import { kindIcon } from "../model";

type Item = { id: number; title: string; icon: string; kind: string; archivedAt: string; below: number };

/** What was moved to the trash: bring it back, or delete it for good. */
export function TrashList({ items }: { items: Item[] }) {
  const t = useT();
  const router = useRouter();
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <div className="flex items-center gap-2">
        <h1 className="flex-1 text-2xl font-bold">🗑 {t("Trash")}</h1>
        {items.length > 0 && (
          <button
            type="button"
            className="btn btn-sm btn-danger"
            onClick={async () => {
              if (!confirmAction(t("Delete everything in the trash for good?"))) return;
              const r = await emptyTrashAction();
              if (!r.ok) toast(r.error, { tone: "error" });
              router.refresh();
            }}
          >
            {t("Empty the trash")}
          </button>
        )}
      </div>
      {items.length ? (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span>{i.icon || kindIcon(i.kind)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{i.title || t("Untitled")}</span>
                <span className="text-xs text-zinc-500">
                  {t("Deleted {when}", { when: new Date(i.archivedAt).toLocaleString() })}
                  {i.below > 0 ? ` · ${t("{n} pages below", { n: i.below })}` : ""}
                </span>
              </span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={async () => {
                  const r = await restorePageAction(i.id);
                  if (!r.ok) return toast(r.error, { tone: "error" });
                  router.refresh();
                  router.push(`/workspace/${i.id}`);
                }}
              >
                {t("Restore")}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={async () => {
                  if (!confirmAction(t("Delete “{title}” for good? This can't be undone.", { title: i.title || t("Untitled") }))) return;
                  const r = await deletePageAction(i.id);
                  if (!r.ok) toast(r.error, { tone: "error" });
                  router.refresh();
                }}
              >
                {t("Delete for good")}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">{t("The trash is empty.")}</p>
      )}
    </div>
  );
}

/** A page in the trash, opened by its link. */
export function ArchivedNotice({ id, title }: { id: number; title: string }) {
  const t = useT();
  const router = useRouter();
  return (
    <div className="mx-auto max-w-xl space-y-3 rounded-lg border border-zinc-200 p-6 text-sm dark:border-zinc-800">
      <h1 className="text-lg font-semibold">{t("“{title}” is in the trash", { title: title || t("Untitled") })}</h1>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={async () => {
            const r = await restorePageAction(id);
            if (!r.ok) return toast(r.error, { tone: "error" });
            router.refresh();
          }}
        >
          {t("Restore")}
        </button>
        <Link href="/workspace/trash" className="btn btn-sm">
          {t("Open the trash")}
        </Link>
      </div>
    </div>
  );
}
