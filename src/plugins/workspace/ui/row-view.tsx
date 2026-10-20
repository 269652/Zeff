"use client";

import { lazy, Suspense, useEffect, useState, type ComponentType, type LazyExoticComponent } from "react";
import { rowViewAction } from "../actions";

/** The custom views plugins bring for the rows of a database, by id — each its plugin's (loaded when shown). */
const VIEWS: Record<string, LazyExoticComponent<ComponentType<{ rowId: number }>>> = {
  person: lazy(() => import("@/plugins/people/ui/PersonView")),
  case: lazy(() => import("@/plugins/cases/ui/CaseView")),
};

/** The custom view of a row — whatever its database's plugin brings; nothing where there is none (its plugin isn't installed). */
export function RowViewHost({ rowId }: { rowId: number }) {
  const [id, setId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void rowViewAction(rowId).then((r) => live && setId(r.ok ? r.view : null));
    return () => {
      live = false;
    };
  }, [rowId]);
  if (id === undefined) return <p className="text-sm text-zinc-400">…</p>;
  const View = id ? VIEWS[id] : undefined;
  if (!View) return null;
  return (
    <Suspense fallback={<p className="text-sm text-zinc-400">…</p>}>
      <View rowId={rowId} />
    </Suspense>
  );
}
