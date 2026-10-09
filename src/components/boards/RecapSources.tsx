"use client";

import { useState } from "react";
import { entityWhoWhen, type Entity } from "@/lib/entities-shared";
import { ShowMoreToggle, latestPerKind } from "../ShowMore";
import { ExpandableSource } from "../SourceBadge";

/** What a recap's ticket was about, as the badges todos and entries show — each unfolds; of each kind the latest three first. */
export function RecapSources({ entities }: { entities: Entity[] }) {
  const [all, setAll] = useState(false);
  const { shown, hidden } = latestPerKind(
    entities,
    (e) => (e.source === "todo" ? null : { kind: e.source === "gitlab" ? `gitlab-${e.gitlab.kind}` : e.source, at: entityWhoWhen(e).at ?? "" }),
    all,
  );
  if (!entities.length) return null;
  return (
    <div className="space-y-1.5">
      {shown.map((e, i) => (
        <ExpandableSource key={i} entity={e} />
      ))}
      <ShowMoreToggle hidden={hidden} open={all} onToggle={() => setAll(!all)} />
    </div>
  );
}
