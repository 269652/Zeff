"use client";

import { useCallback, useEffect, useState } from "react";
import { GitlabResolve } from "@/components/GitlabItemBadge";
import { GitlabAddContext } from "@/components/GitlabItemList";
import { SyncControls } from "@/components/SyncControls";
import type { AppViewProps, PartProps, ViewAppModule } from "@/plugins/workspace/ui/app-view";
import { syncGitlabAction } from "../server-actions";
import { gitlabScreenAction, type GitlabScreen } from "../view-actions";

/** GitLab's app view, client side: what its template reads as app.* (view-actions.ts) and the parts where it takes more than the language's tags. */

function useGitlabData(props: AppViewProps) {
  const [data, setData] = useState<GitlabScreen | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    void gitlabScreenAction().then((d) => live && setData(d));
    return () => {
      live = false;
    };
    // (Read again when the rows change: a sync.)
  }, [tick, props.rows.length]);
  return { data: (data ?? {}) as Record<string, unknown>, reload: useCallback(() => setTick((x) => x + 1), []) };
}

const screen = (p: PartProps): GitlabScreen | null => (p.app.items ? (p.app as GitlabScreen) : null);
/** The item of the row the part stands in. */
const itemOf = (p: PartProps) => screen(p)?.items[String(p.rows.find((r) => r.id === p.rowId)?.cells.glkey ?? "")];

function Sync(p: PartProps) {
  const s = screen(p);
  return s ? <SyncControls syncKey="gitlab" sync={syncGitlabAction} syncMinutes={s.syncMinutes} last={s.last} /> : null;
}

function Resolve(p: PartProps) {
  const item = itemOf(p);
  return item ? <GitlabResolve item={item} /> : null;
}

function AddContext(p: PartProps) {
  const s = screen(p);
  const item = itemOf(p);
  return s && item ? <GitlabAddContext item={item} prefixes={new Set(s.prefixes)} /> : null;
}

const GITLAB: ViewAppModule = {
  parts: { "gitlab.sync": Sync, "gitlab.resolve": Resolve, "gitlab.context": AddContext },
  useAppData: useGitlabData,
};
export default GITLAB;
