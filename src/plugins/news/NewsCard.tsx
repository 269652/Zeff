"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { ListenButton } from "./Listen";
import { newsReadAction, newsSourceAction, newsStateAction, newsTopicAction, newsVoteAction } from "./server-actions";
import type { NewsItem } from "./shared";

/** The pages of the cards in view are looked at three at a time (a route: server actions would wait in one queue). */
const waiting: (() => void)[] = [];
let running = 0;
async function peek(id: number): Promise<{ ok: boolean; image: string; hasContent: boolean; summary: string }> {
  if (running >= 3) await new Promise<void>((go) => waiting.push(go));
  running++;
  try {
    const r = await fetch("/api/news/peek", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    return (await r.json()) as { ok: boolean; image: string; hasContent: boolean; summary: string };
  } catch {
    return { ok: false, image: "", hasContent: false, summary: "" };
  } finally {
    running--;
    waiting.shift()?.();
  }
}

/**
 * One news item as a card: its picture, the headline (opens the article in a new tab and counts as read), where it is
 * from and how old it is, a short text — or the whole article, read here — why it is up here, and the buttons that teach
 * Zeff your taste (👍 👎), keep it (save) or put it away (hide). `onChange` tells the feed what changed, so it updates in place.
 */
export function NewsCard({ item, ago, showImage, onChange, onDrop }: { item: NewsItem; ago: string; showImage: boolean; onChange: (patch: Partial<NewsItem>) => void; /** The feed this card is from is off: all its cards leave. */ onDrop: (gone: (i: NewsItem) => boolean) => void }) {
  const t = useT();
  const [pending, start] = useTransition();
  const [broken, setBroken] = useState(false);
  const [menu, setMenu] = useState(false);
  // A topic search's card ("Google News: term") has no source of its own: its feed is the search.
  const topic = !item.sourceId && item.sourceName.startsWith("Google News: ") ? item.sourceName.slice(13) : "";
  const stop = (mode: "pause" | "remove") =>
    start(async () => {
      const r = await newsSourceAction(item.sourceId!, mode);
      if (!r.ok) return void toast(r.error ?? t("Didn't work."), { tone: "error" });
      setMenu(false);
      onDrop((i) => i.sourceId === item.sourceId);
      toast(mode === "pause" ? t("{source} paused — none of its news will show.", { source: item.sourceName }) : t("{source} removed.", { source: item.sourceName }), mode === "pause" ? { action: { label: t("Undo"), run: () => void newsSourceAction(item.sourceId!, "resume").then(() => window.location.reload()) } } : {});
    });
  const stopTopic = () =>
    start(async () => {
      const r = await newsTopicAction(topic, "stop");
      if (!r.ok) return void toast(r.error ?? t("Didn't work."), { tone: "error" });
      setMenu(false);
      onDrop((i) => i.sourceName === item.sourceName);
      toast(t("No more searches for “{topic}”.", { topic }), { action: { label: t("Undo"), run: () => void newsTopicAction(topic, "back").then(() => window.location.reload()) } });
    });
  const card = useRef<HTMLElement>(null);
  // A picture to look for, or no summary of its own (a feed that only links): the page is read for it, once.
  const wantsPicture = (showImage && !item.image && !item.imageChecked) || (!item.summary && !item.hasContent);
  // No picture known yet: when the card comes into view, its page is looked at (once; the answer is kept).
  useEffect(() => {
    const el = card.current;
    if (!wantsPicture || !el) return;
    const io = new IntersectionObserver((e) => {
      if (!e.some((x) => x.isIntersecting)) return;
      io.disconnect();
      void peek(item.id).then((r) => onChange({ image: r.image, imageChecked: true, ...(r.hasContent ? { hasContent: true } : {}), ...(r.summary ? { summary: r.summary } : {}) }));
    }, { rootMargin: "1200px" });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per card
  }, [wantsPicture, item.id]);
  const [reader, setReader] = useState<{ open: boolean; busy: boolean; text: string; error: string }>({ open: false, busy: false, text: "", error: "" });
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, patch: Partial<NewsItem>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast(r.error ?? t("Didn't work."), { tone: "error" });
      else onChange(patch);
    });
  const read = item.state === "read";
  const btn = (on: boolean) => `btn btn-sm ${on ? "btn-primary" : ""}`;
  const toggleReader = () => {
    if (reader.open) return setReader({ ...reader, open: false });
    if (reader.text) return setReader({ ...reader, open: true });
    setReader({ open: true, busy: true, text: "", error: "" });
    void newsReadAction(item.id).then((r) => {
      setReader({ open: true, busy: false, text: r.text ?? "", error: r.ok ? "" : (r.error ?? t("Didn't work.")) });
      if (r.ok) onChange({ hasContent: true, ...(item.state === "new" ? { state: "read" as const } : {}), ...(r.image && !item.image ? { image: r.image } : {}) });
    });
  };
  return (
    <article ref={card} className={`card overflow-hidden ${read ? "opacity-75" : ""} ${pending ? "opacity-50" : ""}`}>
      {showImage && item.image && !broken && (
        // eslint-disable-next-line @next/next/no-img-element -- pictures of other sites, shown as they are (no optimiser on the way)
        <img src={item.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="aspect-video w-full bg-zinc-100 object-cover dark:bg-zinc-800" />
      )}
      <div className="space-y-2 p-4">
        <div>
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer noopener"
            className="font-medium hover:underline"
            onClick={() => {
              if (item.state === "new") void newsStateAction(item.id, "read").then(() => onChange({ state: "read" }));
            }}
          >
            {item.title}
          </a>
          <p className="text-xs text-zinc-500">
            {item.sourceName} · {ago}
          </p>
        </div>
        {item.summary && !reader.open && <p className="line-clamp-4 text-sm text-zinc-600 dark:text-zinc-300">{item.summary}</p>}
        {reader.open && (
          <div className="max-h-96 overflow-auto rounded border border-zinc-200 bg-zinc-50 p-3 text-sm leading-relaxed whitespace-pre-line dark:border-zinc-700 dark:bg-zinc-900">
            {reader.busy ? t("Reading the article …") : reader.error ? <span className="text-red-600 dark:text-red-400">{reader.error}</span> : reader.text}
          </div>
        )}
        {item.reasons.length > 0 && (
          <p className="flex flex-wrap gap-1 text-[11px] text-zinc-500">
            {item.reasons.slice(0, 4).map((r) => (
              <span key={r} className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">
                {r.startsWith("like ") ? t("like {words}", { words: r.slice(5) }) : r.startsWith("work: ") ? t("your work: {words}", { words: r.slice(6) }) : r.startsWith("profile: ") ? `✨ ${r.slice(9).replace(/^([^·]+) · (.*)$/, (_m, term: string, why: string) => `${term} (${why.replace(/^work: /, t("your work") + " ").replace(/^you: /, "").replace(/^ticket: /, t("ticket") + " ")})`)}` : r === "fresh" ? t("fresh") : r}
              </span>
            ))}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1">
          <button type="button" className={btn(reader.open)} disabled={pending} onClick={toggleReader} title={item.hasContent ? t("The whole article, read here") : t("Fetches the article and shows its text here")}>
            {reader.open ? t("Close") : item.hasContent ? t("Read here") : t("Read")}
          </button>
          {reader.open && reader.text && <ListenButton text={`${item.title}.\n\n${reader.text}`} lang="de" />}
          <span className="flex-1" />
          <button type="button" className={btn(item.vote === 1)} disabled={pending} title={t("More like this")} onClick={() => run(() => newsVoteAction(item.id, item.vote === 1 ? 0 : 1), { vote: item.vote === 1 ? 0 : 1 })}>
            👍
          </button>
          <button type="button" className={btn(item.vote === -1)} disabled={pending} title={t("Less like this")} onClick={() => run(() => newsVoteAction(item.id, item.vote === -1 ? 0 : -1), { vote: item.vote === -1 ? 0 : -1 })}>
            👎
          </button>
          <button
            type="button"
            className={btn(item.state === "saved")}
            disabled={pending}
            title={item.state === "saved" ? t("Not saved any more") : t("Save for later")}
            onClick={() => run(() => newsStateAction(item.id, item.state === "saved" ? "read" : "saved"), { state: item.state === "saved" ? "read" : "saved" })}
          >
            🔖
          </button>
          {(item.sourceId || topic) && (
            <button type="button" className={btn(menu)} disabled={pending} title={t("Stop this feed …")} aria-expanded={menu} onClick={() => setMenu(!menu)}>
              ⋯
            </button>
          )}
          <button type="button" className="btn btn-sm" disabled={pending} title={item.state === "hidden" ? t("Show again") : t("Hide")} onClick={() => run(() => newsStateAction(item.id, item.state === "hidden" ? "new" : "hidden"), { state: item.state === "hidden" ? "new" : "hidden" })}>
            {item.state === "hidden" ? "↩" : "✕"}
          </button>
        </div>
        {menu && (
          <div className="flex flex-wrap items-center gap-2 rounded border border-zinc-200 bg-zinc-50 p-2 text-xs dark:border-zinc-700 dark:bg-zinc-900">
            <span className="text-zinc-600 dark:text-zinc-300">{topic ? t("The search “{topic}” brought this.", { topic }) : t("From {source}.", { source: item.sourceName })}</span>
            {topic ? (
              <button type="button" className="btn btn-sm" disabled={pending} onClick={stopTopic}>
                {t("Stop this topic")}
              </button>
            ) : (
              <>
                <button type="button" className="btn btn-sm" disabled={pending} onClick={() => stop("pause")} title={t("Its news stop showing; you can resume it in the settings")}>
                  {t("Pause this feed")}
                </button>
                <button type="button" className="btn btn-sm" disabled={pending} onClick={() => stop("remove")} title={t("Removes the source and its items (saved ones stay)")}>
                  {t("Remove this feed")}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
