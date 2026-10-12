"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { newsStateAction, newsVoteAction } from "./server-actions";
import type { NewsItem } from "./shared";

/**
 * One news item: the headline (opens the article in a new tab and counts as read), where it is from and how old
 * it is, why it is up here, and the buttons that teach Zeff your taste — 👍 👎 — keep it (save) or put it away (hide).
 */
export function NewsCard({ item, ago }: { item: NewsItem; ago: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast(r.error ?? t("Didn't work."), { tone: "error" });
      router.refresh();
    });
  const read = item.state === "read";
  const btn = (on: boolean) => `btn btn-sm ${on ? "btn-primary" : ""}`;
  return (
    <li className={`card space-y-1.5 p-4 ${read ? "opacity-70" : ""} ${pending ? "opacity-50" : ""}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer noopener"
            className="font-medium hover:underline"
            onClick={() => {
              if (item.state === "new") void newsStateAction(item.id, "read").then(() => router.refresh());
            }}
          >
            {item.title}
          </a>
          <p className="text-xs text-zinc-500">
            {item.sourceName} · {ago}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button type="button" className={btn(item.vote === 1)} disabled={pending} title={t("More like this")} onClick={() => run(() => newsVoteAction(item.id, item.vote === 1 ? 0 : 1))}>
            👍
          </button>
          <button type="button" className={btn(item.vote === -1)} disabled={pending} title={t("Less like this")} onClick={() => run(() => newsVoteAction(item.id, item.vote === -1 ? 0 : -1))}>
            👎
          </button>
          <button type="button" className={btn(item.state === "saved")} disabled={pending} title={item.state === "saved" ? t("Not saved any more") : t("Save for later")} onClick={() => run(() => newsStateAction(item.id, item.state === "saved" ? "read" : "saved"))}>
            🔖
          </button>
          <button type="button" className="btn btn-sm" disabled={pending} title={item.state === "hidden" ? t("Show again") : t("Hide")} onClick={() => run(() => newsStateAction(item.id, item.state === "hidden" ? "new" : "hidden"))}>
            {item.state === "hidden" ? "↩" : "✕"}
          </button>
        </div>
      </div>
      {item.summary && <p className="line-clamp-3 text-sm text-zinc-600 dark:text-zinc-300">{item.summary}</p>}
      {item.reasons.length > 0 && (
        <p className="flex flex-wrap gap-1 text-[11px] text-zinc-500">
          {item.reasons.slice(0, 4).map((r) => (
            <span key={r} className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">
              {r.startsWith("like ") ? t("like {words}", { words: r.slice(5) }) : r.startsWith("work: ") ? t("your work: {words}", { words: r.slice(6) }) : r === "fresh" ? t("fresh") : r}
            </span>
          ))}
        </p>
      )}
    </li>
  );
}
