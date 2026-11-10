"use client";

import { useT } from "@/components/I18nProvider";
import { BADGE_TONES, badgeSegments, type BadgeConfig, type BadgeCounts, type BadgePartId } from "@/lib/todos/badge";
import type { T } from "@/lib/i18n/shared";

const cap = (n: number) => (n > 999 ? "999+" : String(n));

/** What a segment's number means, for its tooltip. */
const segmentTitle = (t: T, id: BadgePartId, n: number) =>
  id === "open"
    ? t("{n} open todos", { n })
    : id === "late"
      ? t("{n} overdue", { n })
      : id === "today"
        ? t("{n} due today", { n })
        : n === 1
          ? t("1 unseen change")
          : t("{n} unseen changes", { n });

/** The Todos badge: one split pill of the numbers switched on, in their order and colours (lib/todos/badge.ts). */
export function TodoBadgePill({ config, counts, className = "" }: { config: BadgeConfig; counts: BadgeCounts; className?: string }) {
  const t = useT();
  const segments = badgeSegments(config, counts);
  if (!segments.length) return null;
  return (
    <span className={`inline-flex overflow-hidden rounded-full text-[11px] font-semibold leading-4 tabular-nums normal-case ${className}`}>
      {segments.map((s) => (
        <span key={s.id} className={`px-1.5 ${BADGE_TONES[s.color]}`} title={segmentTitle(t, s.id, s.n)}>
          {cap(s.n)}
        </span>
      ))}
    </span>
  );
}
