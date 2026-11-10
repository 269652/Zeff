"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import { Markdown } from "@/components/Markdown";
import { WidgetFrame } from "@/components/widgets/WidgetFrame";
import { blockWidget, splitBlocks, type BlockWidget } from "@/lib/widgets/inline";
import type { WidgetMessage } from "@/lib/widgets/sandbox";
import { useT } from "@/components/I18nProvider";

type Result = Extract<WidgetMessage, { type: "result" }>;
export type ShownWidget = Extract<BlockWidget, { ok: true }>;

/**
 * A message with pictures in it (lib/widgets/inline.ts): its prose as Markdown, each ```svg / ```plot / ```chart /
 * ```widget block as a widget right there. A block that can't be shown says why (and `onBroken` hears of it). Who shows
 * it may draw the widgets itself (`render`: the Workspace's chat gives them its data bridge) and say its own notes.
 */
export function MessageBlocks({
  text,
  className,
  onResult,
  onBroken,
  render,
  brokenNote,
  errorNote,
}: {
  text: string;
  className?: string;
  onResult?: (title: string, r: Result) => void;
  onBroken?: (why: string) => void;
  render?: (w: ShownWidget, key: number) => ReactNode;
  /** Said when a block can't be shown (default: that it couldn't). */
  brokenNote?: string;
  /** The note a widget shows when it breaks. */
  errorNote?: string;
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
              {brokenNote ?? t("This picture couldn't be shown.")} <span className="text-xs text-zinc-500">({w.why})</span>
            </p>
          );
        }
        if (render) return render(w, i);
        return <WidgetFrame key={i} html={w.html} libs={w.libs} title={w.title} errorNote={errorNote} onResult={onResult ? (r) => onResult(w.title, r) : undefined} onError={onBroken} />;
      })}
    </div>
  );
}
