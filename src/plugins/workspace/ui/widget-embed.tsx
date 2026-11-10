"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { wantsOf } from "@/lib/widgets/bridge";
import { addWidgetBlockAction } from "../actions";
import type { WidgetEmbed } from "../chat-embed";
import { AppWidget } from "./app-widget";
import { WS_CHANGED } from "./ChatPanel";

/**
 * A widget the assistant built, under its answer: it runs right there (with Zeff's data bridge — what it writes is asked of
 * you once), and "Add to this page" keeps it as a block of the page you have open (unless it was put there already).
 */
export function WidgetEmbedCard({ embed, pageId }: { embed: WidgetEmbed; pageId?: number }) {
  const t = useT();
  const router = useRouter();
  const [placed, setPlaced] = useState<number | null>(embed.pageId);
  const add = async () => {
    if (!pageId) return;
    const r = await addWidgetBlockAction(pageId, { title: embed.title, html: embed.html, libs: embed.libs, writes: embed.writes, ai: embed.ai });
    if (!r.ok) return void toast(r.error, { tone: "error" });
    setPlaced(r.pageId);
    router.refresh();
    window.dispatchEvent(new Event(WS_CHANGED));
  };
  return (
    <div className="space-y-1 rounded-lg border border-violet-100 p-1.5 dark:border-violet-900/50">
      <div className="flex items-center gap-2 px-1 text-xs">
        <span aria-hidden>🧩</span>
        <span className="flex-1 truncate font-medium">{embed.title}</span>
        {pageId && placed !== pageId && (
          <button type="button" className="text-violet-700 hover:underline dark:text-violet-300" onClick={() => void add()}>
            + {t("Add to this page")}
          </button>
        )}
        {placed === pageId && pageId && <span className="text-zinc-500">{t("On this page")}</span>}
      </div>
      <AppWidget html={embed.html} libs={embed.libs} title={embed.title} wants={wantsOf(embed.writes, embed.ai, embed.flows)} pageId={pageId ?? embed.pageId} />
    </div>
  );
}
