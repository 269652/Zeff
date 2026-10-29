"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { useOverlayFocus } from "@/components/Overlay";
import { toast } from "@/components/Toaster";
import { reportSeen } from "./NewsCard";
import { newsStateAction, newsVoteAction } from "./server-actions";
import type { NewsItem } from "./shared";
import type { StoryGroup } from "./story-groups";

/** How long one report stays before the next comes (held down, it waits). */
const SHOW_MS = 8000;

/** A colour of its own for a report without a picture (by its source, so a source keeps its colour). */
function tint(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `linear-gradient(160deg, hsl(${h} 55% 32%), hsl(${(h + 50) % 360} 60% 14%))`;
}

/**
 * The stories strip above the feed: one round picture per story ("Important", then the stories running through your news),
 * ringed in colour while it has something you haven't seen. A tap plays it full screen.
 */
export function NewsStories({ groups, ago, showImages }: { groups: StoryGroup[]; ago: Record<number, string>; showImages: boolean }) {
  const t = useT();
  const [open, setOpen] = useState<number | null>(null);
  const [seen, setSeen] = useState<Set<number>>(() => new Set(groups.flatMap((g) => g.items.filter((i) => i.seen).map((i) => i.id))));
  if (!groups.length) return null;
  const label = (g: StoryGroup) => (g.kind === "story" ? g.label : t(g.label));
  return (
    <>
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pt-1 pb-2" role="list" aria-label={t("Stories")}>
        {groups.map((g, k) => {
          const fresh = g.items.some((i) => !seen.has(i.id));
          const pic = showImages ? g.items.find((i) => i.image)?.image : "";
          return (
            // (The list item around the button: the role on the button itself would hide that it is a button.)
            <div key={g.key} role="listitem" className="contents">
              <button type="button" onClick={() => setOpen(k)} className="group flex w-20 shrink-0 flex-col items-center gap-1 text-center" title={`${label(g)} · ${t("{n} reports", { n: g.items.length })}`}>
                <span className={`rounded-full p-[3px] ${fresh ? (g.kind === "top" ? "bg-gradient-to-tr from-amber-400 via-rose-500 to-fuchsia-600" : "bg-gradient-to-tr from-sky-400 via-indigo-500 to-fuchsia-500") : "bg-zinc-300 dark:bg-zinc-700"}`}>
                  <span className="block rounded-full bg-white p-[2px] dark:bg-zinc-950">
                    {pic ? (
                      // eslint-disable-next-line @next/next/no-img-element -- pictures of other sites, shown as they are
                      <img src={pic} alt="" referrerPolicy="no-referrer" className="h-16 w-16 rounded-full object-cover transition-transform group-hover:scale-105" />
                    ) : (
                      <span className="flex h-16 w-16 items-center justify-center rounded-full text-2xl text-white" style={{ background: tint(g.label) }}>
                        {g.kind === "top" ? "★" : g.kind === "best" ? "✦" : "🧵"}
                      </span>
                    )}
                  </span>
                </span>
                <span className={`line-clamp-2 w-full text-[11px] leading-tight ${fresh ? "font-medium" : "text-zinc-500"}`}>{label(g)}</span>
              </button>
            </div>
          );
        })}
      </div>
      {open !== null && (
        <StoryViewer
          groups={groups}
          start={open}
          ago={ago}
          showImages={showImages}
          label={label}
          onSeen={(id) => setSeen((s) => (s.has(id) ? s : new Set(s).add(id)))}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

/**
 * A story played full screen, one report at a time: the bars on top show where you are, a report moves on by itself after a
 * few seconds (holding it down waits), a tap on the right is the next, on the left the one before, and after the last report
 * the next story begins. ←/→, Space (wait), L (like), S (save), Enter (open the article), Esc (close).
 */
function StoryViewer({ groups, start, ago, showImages, label, onSeen, onClose }: { groups: StoryGroup[]; start: number; ago: Record<number, string>; showImages: boolean; label: (g: StoryGroup) => string; onSeen: (id: number) => void; onClose: () => void }) {
  const t = useT();
  const [pos, setPos] = useState({ g: start, i: Math.max(0, groups[start].items.findIndex((x) => !x.seen)) });
  const [progress, setProgress] = useState(0);
  const [held, setHeld] = useState(false);
  const [votes, setVotes] = useState<Record<number, Partial<NewsItem>>>({});
  const [heart, setHeart] = useState(0);
  const downAt = useRef(0);
  const dialog = useRef<HTMLDivElement>(null);
  useOverlayFocus(dialog, true);
  const group = groups[pos.g];
  const base = group.items[pos.i];
  const item = { ...base, ...votes[base.id] };

  const next = useCallback(() => {
    setProgress(0);
    setPos((p) => (p.i + 1 < groups[p.g].items.length ? { g: p.g, i: p.i + 1 } : p.g + 1 < groups.length ? { g: p.g + 1, i: 0 } : (onClose(), p)));
  }, [groups, onClose]);
  const prev = useCallback(() => {
    setProgress(0);
    setPos((p) => (p.i > 0 ? { g: p.g, i: p.i - 1 } : p.g > 0 ? { g: p.g - 1, i: groups[p.g - 1].items.length - 1 } : p));
  }, [groups]);

  // Seen once it is on screen.
  useEffect(() => {
    reportSeen(base.id);
    onSeen(base.id);
  }, [base.id, onSeen]);

  // The clock: the bar fills, then the next report.
  useEffect(() => {
    if (held) return;
    const from = performance.now() - progress * SHOW_MS;
    let raf = 0;
    const tick = (now: number) => {
      const p = (now - from) / SHOW_MS;
      if (p >= 1) return next();
      setProgress(p);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restarts per report and when let go, from where it was
  }, [held, pos.g, pos.i, next]);

  const like = useCallback(() => {
    const v = item.vote === 1 ? 0 : 1;
    setVotes((m) => ({ ...m, [item.id]: { ...m[item.id], vote: v } }));
    if (v) setHeart((h) => h + 1);
    void newsVoteAction(item.id, v).then((r) => !r.ok && toast(r.error ?? t("Didn't work."), { tone: "error" }));
  }, [item.id, item.vote, t]);
  const save = useCallback(() => {
    const s = item.state === "saved" ? "read" : "saved";
    setVotes((m) => ({ ...m, [item.id]: { ...m[item.id], state: s } }));
    void newsStateAction(item.id, s).then((r) => (r.ok ? s === "saved" && toast(t("Saved.")) : toast(r.error ?? t("Didn't work."), { tone: "error" })));
  }, [item.id, item.state, t]);
  const openArticle = useCallback(() => {
    window.open(item.url, "_blank", "noopener,noreferrer");
    if (item.state === "new") void newsStateAction(item.id, "read");
    setHeld(true);
  }, [item.id, item.state, item.url]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === " ") (e.preventDefault(), setHeld((h) => !h));
      else if (e.key === "l" || e.key === "L") like();
      else if (e.key === "s" || e.key === "S") save();
      else if (e.key === "Enter") openArticle();
      else return;
    };
    window.addEventListener("keydown", key);
    const html = document.documentElement;
    const before = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", key);
      html.style.overflow = before;
    };
  }, [next, prev, like, save, openArticle, onClose]);

  const pic = showImages && item.image ? item.image : "";
  return (
    <div ref={dialog} className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-0 backdrop-blur sm:p-4" role="dialog" aria-modal aria-label={label(group)} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="relative h-full w-full max-w-md overflow-hidden bg-zinc-900 text-white shadow-2xl select-none sm:h-[min(92vh,860px)] sm:rounded-2xl"
        style={pic ? undefined : { background: tint(item.sourceName) }}
        onPointerDown={() => {
          downAt.current = Date.now();
          setHeld(true);
        }}
        onPointerUp={(e) => {
          setHeld(false);
          if (Date.now() - downAt.current > 300) return;
          if ((e.target as HTMLElement).closest("button,a")) return;
          const r = e.currentTarget.getBoundingClientRect();
          if (e.clientX - r.left < r.width / 3) prev();
          else next();
        }}
        onPointerLeave={() => setHeld(false)}
      >
        {pic && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- the picture blurred behind, and whole in front */}
            <img src={pic} alt="" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-50 blur-2xl" />
            {/* eslint-disable-next-line @next/next/no-img-element -- pictures of other sites, shown as they are */}
            <img key={item.id} src={pic} alt="" referrerPolicy="no-referrer" className="absolute inset-x-0 top-[12%] max-h-[48%] w-full object-cover" />
          </>
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/90" />

        {/* Where you are: a bar per report of this story. */}
        <div className="absolute inset-x-3 top-3 flex gap-1">
          {group.items.map((x, k) => (
            <span key={x.id} className="h-0.5 flex-1 overflow-hidden rounded bg-white/30">
              <span className="block h-full bg-white" style={{ width: `${k < pos.i ? 100 : k === pos.i ? progress * 100 : 0}%` }} />
            </span>
          ))}
        </div>
        <div className="absolute inset-x-3 top-6 flex items-center gap-2 text-sm">
          <span className="truncate font-semibold">{group.kind === "top" ? "★ " : group.kind === "story" ? "🧵 " : ""}{label(group)}</span>
          <span className="text-white/60">{pos.g + 1}/{groups.length}</span>
          <span className="flex-1" />
          {held && <span className="text-xs text-white/70">❚❚</span>}
          <button type="button" className="rounded-full px-2 text-xl leading-none text-white/80 hover:text-white" onClick={onClose} aria-label={t("Close")}>
            ×
          </button>
        </div>

        {heart > 0 && (
          <span key={heart} className="pointer-events-none absolute inset-0 flex items-center justify-center text-8xl" style={{ animation: "news-heart 0.9s ease-out forwards" }}>
            ❤️
          </span>
        )}

        <div className="absolute inset-x-0 bottom-0 space-y-3 p-5">
          <p className="text-xs text-white/70">
            {item.sourceName} · {ago[item.id] ?? ""}
            {item.storySources >= 2 && ` · ${t("{n} outlets", { n: item.storySources })}`}
          </p>
          <h2 className="text-2xl leading-tight font-semibold">{item.title}</h2>
          {item.summary && <p className="line-clamp-5 text-sm leading-relaxed text-white/85">{item.summary}</p>}
          {item.gateWhy && item.gate !== "drop" && (
            <p className={`inline-block rounded-full px-2.5 py-1 text-xs ${item.gate === "top" ? "bg-amber-400/90 text-amber-950" : "bg-emerald-400/90 text-emerald-950"}`}>
              {item.gate === "top" ? "★" : "✓"} {item.gateWhy}
            </p>
          )}
          <div className="flex items-center gap-2 pt-1">
            <button type="button" className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-white/90" onClick={openArticle}>
              {t("Open article")} ↗
            </button>
            <span className="flex-1" />
            <button type="button" className={`rounded-full px-3 py-2 text-lg ${item.vote === 1 ? "bg-rose-500" : "bg-white/15 hover:bg-white/25"}`} onClick={like} title={`${t("More like this")} (L)`} aria-label={t("More like this")} aria-pressed={item.vote === 1}>
              {item.vote === 1 ? "❤️" : "🤍"}
            </button>
            <button type="button" className={`rounded-full px-3 py-2 text-lg ${item.state === "saved" ? "bg-indigo-500" : "bg-white/15 hover:bg-white/25"}`} onClick={save} title={`${t("Save for later")} (S)`} aria-label={t("Save for later")} aria-pressed={item.state === "saved"}>
              🔖
            </button>
          </div>
        </div>
      </div>
      <style>{"@keyframes news-heart { 0% { opacity: 0; transform: scale(0.4) } 25% { opacity: 1; transform: scale(1.15) } 60% { opacity: 1; transform: scale(1) } 100% { opacity: 0; transform: scale(1.3) } }"}</style>
    </div>
  );
}
