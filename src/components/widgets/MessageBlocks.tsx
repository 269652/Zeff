"use client";

import { useEffect, useMemo } from "react";
import { Markdown } from "@/components/Markdown";
import { WidgetFrame } from "@/components/widgets/WidgetFrame";
import { blockWidget, splitBlocks } from "@/lib/widgets/inline";
import type { WidgetMessage } from "@/lib/widgets/sandbox";
import { useT } from "@/components/I18nProvider";

type Result = Extract<WidgetMessage, { type: "result" }>;

/**
 * A message with pictures in it (lib/widgets/inline.ts): its prose as Markdown, each ```svg / ```plot / ```chart /
 * ```widget block as a widget right there. A block that can't be shown says why (and `onBroken` hears of it).
 */
export function MessageBlocks({
  text,
  className,
  onResult,
  onBroken,
}: {
  text: string;
  className?: string;
  onResult?: (title: string, r: Result) => void;
  onBroken?: (why: string) => void;
}) {
  const t = useT();
  const segments = useMemo(() => splitBlocks(text).map((s) => ({ s, w: "text" in s ? null : blockWidget(s.kind, s.body) })), [text]);
  // (As one string: the effect runs again only when what's broken changes, not on every render.)
  const broken = segments.flatMap(({ w }) => (w && !w.ok ? [w.why] : [])).join("\n");
  useEffect(() => {
    if (broken) for (const why of broken.split("\n")) onBroken?.(why);
  }, [broken, onBroken]);
  if (segments.length === 1 && "text" in segments[0].s) return <Markdown text={text} className={className} />;
  return (
    <div className="space-y-2">
      {segments.map(({ s, w }, i) => {
        if ("text" in s || !w) return "text" in s ? <Markdown key={i} text={s.text} className={className} /> : null;
        if (!w.ok) {
          return (
            <p key={i} role="status" className="rounded-lg border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-sm dark:bg-amber-950/40">
              {t("This picture couldn't be shown — the teacher has been told.")} <span className="text-xs text-zinc-500">({w.why})</span>
            </p>
          );
        }
        return <WidgetFrame key={i} html={w.html} libs={w.libs} title={w.title} onResult={onResult ? (r) => onResult(w.title, r) : undefined} onError={onBroken} />;
      })}
    </div>
  );
}
