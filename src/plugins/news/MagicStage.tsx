"use client";

import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/I18nProvider";
import { useOverlayFocus } from "@/components/Overlay";
import type { NewsItem } from "./shared";

export type Box = { left: number; top: number; width: number; height: number };

const hash = (n: number) => {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};
const GLYPHS = ["✦", "✧", "✨", "⋆", "✶", "✷"];
const COLORS = ["#fde68a", "#f9a8d4", "#a5f3fc", "#c4b5fd", "#fff"];

/**
 * "More like this": the card flies out of the feed to the middle of the screen, grows, and sparkles — a spinning rainbow rim,
 * twinkling stars round it, glitter rising from it — while the AI reads, thinks and searches; when the finds are there (and it
 * has been up for a moment) it glides back to its place and the new cards are below it. People who prefer less motion get
 * the overlay and the glow without the flight and the twinkling.
 */
export function MagicStage({ item, from, done, onGone, showImage }: { item: NewsItem; from: Box; done: boolean; onGone: () => void; showImage: boolean }) {
  const t = useT();
  const stage = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const end = useRef("none");
  const born = useRef(0);
  const leaving = useRef(false);
  // Focus goes into the overlay while it is up (no Escape: it leaves by itself) and back afterwards.
  useOverlayFocus(backdrop, true);

  const sparkles = useMemo(
    () =>
      Array.from({ length: 34 }, (_, i) => {
        // On a ring a little outside the card, and a few on it.
        const a = hash(i + 1) * Math.PI * 2;
        const r = 0.62 + hash(i + 50) * 0.5;
        return { x: 50 + Math.cos(a) * r * 62, y: 50 + Math.sin(a) * r * 62, size: 9 + hash(i + 9) * 16, delay: hash(i + 21) * 2.6, dur: 1.3 + hash(i + 33) * 1.6, glyph: GLYPHS[i % GLYPHS.length], color: COLORS[i % COLORS.length] };
      }),
    [],
  );
  const glitter = useMemo(() => Array.from({ length: 26 }, (_, i) => ({ x: 6 + hash(i + 70) * 88, size: 2 + hash(i + 80) * 4, delay: hash(i + 90) * 3, dur: 2 + hash(i + 100) * 2.2, color: COLORS[i % COLORS.length] })), []);

  useEffect(() => {
    born.current = Date.now();
    const el = stage.current;
    const back = backdrop.current;
    if (!el || !back) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scale = Math.max(1, Math.min(1.6, (vw * 0.56) / from.width, (vh * 0.62) / from.height));
    const dx = vw / 2 - (from.left + from.width / 2);
    const dy = vh / 2 - (from.top + from.height / 2);
    end.current = `translate(${dx}px, ${dy}px) scale(${scale})`;
    back.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reduce ? 1 : 450, fill: "forwards" });
    el.animate([{ transform: "none" }, { transform: end.current }], { duration: reduce ? 1 : 700, easing: "cubic-bezier(.2,.9,.25,1.12)", fill: "forwards" });
  }, [from]);

  // The finds are in: after at least a moment of magic, glide back.
  useEffect(() => {
    if (!done || leaving.current) return;
    const wait = Math.max(0, 1800 - (Date.now() - born.current));
    const id = setTimeout(() => {
      const el = stage.current;
      const back = backdrop.current;
      if (!el || !back) return onGone();
      leaving.current = true;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      back.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduce ? 1 : 550, fill: "forwards" });
      el.animate([{ transform: end.current }, { transform: "none" }], { duration: reduce ? 1 : 650, easing: "cubic-bezier(.5,0,.2,1)", fill: "forwards" }).finished.then(onGone, onGone);
    }, wait);
    return () => clearTimeout(id);
  }, [done, onGone]);

  const body = (
    <div ref={backdrop} className="fixed inset-0 z-[60] bg-zinc-950/55 opacity-0 backdrop-blur-[3px]" role="dialog" aria-modal="true" aria-label={t("More like this")}>
      <style>{`
        @keyframes zeff-twinkle{0%,100%{opacity:0;transform:scale(.2) rotate(0deg)}45%{opacity:1;transform:scale(1) rotate(90deg)}70%{opacity:.7;transform:scale(.75) rotate(160deg)}}
        @keyframes zeff-rise{0%{opacity:0;transform:translateY(0) scale(.6)}15%{opacity:1}100%{opacity:0;transform:translateY(-230px) scale(1.2)}}
        @keyframes zeff-spin{to{transform:rotate(360deg)}}
        @keyframes zeff-glow{0%,100%{box-shadow:0 0 28px 6px rgba(168,85,247,.45),0 0 70px 18px rgba(251,191,36,.25)}50%{box-shadow:0 0 44px 12px rgba(236,72,153,.5),0 0 90px 28px rgba(34,211,238,.3)}}
        @media (prefers-reduced-motion:reduce){.zeff-fx{animation:none!important}.zeff-fx-twinkle{opacity:.8!important}}
      `}</style>
      <div ref={stage} className="absolute will-change-transform" style={{ left: from.left, top: from.top, width: from.width, height: from.height }}>
        {/* the sparkles round the card */}
        <div className="pointer-events-none absolute -inset-[40%]" aria-hidden>
          {sparkles.map((s, i) => (
            <span key={i} className="zeff-fx zeff-fx-twinkle absolute leading-none" style={{ left: `${s.x}%`, top: `${s.y}%`, fontSize: s.size, color: s.color, textShadow: `0 0 8px ${s.color}, 0 0 16px ${s.color}`, animation: `zeff-twinkle ${s.dur}s ease-in-out ${s.delay}s infinite`, opacity: 0 }}>
              {s.glyph}
            </span>
          ))}
        </div>
        {/* the card, in a spinning rainbow rim */}
        <div className="zeff-fx relative h-full overflow-hidden rounded-2xl" style={{ animation: "zeff-glow 2.4s ease-in-out infinite" }}>
          <div className="zeff-fx absolute -inset-[60%]" style={{ background: "conic-gradient(from 0deg, #f472b6, #fbbf24, #34d399, #22d3ee, #818cf8, #f472b6)", animation: "zeff-spin 3.2s linear infinite" }} />
          <article className="absolute inset-[3px] overflow-hidden rounded-[13px] bg-white dark:bg-zinc-900">
            {showImage && item.image && (
              // eslint-disable-next-line @next/next/no-img-element -- the same picture as on the card, shown bigger
              <img src={item.image} alt="" referrerPolicy="no-referrer" className="aspect-video w-full object-cover" />
            )}
            <div className="space-y-1.5 p-4">
              <p className="font-medium">{item.title}</p>
              <p className="text-xs text-zinc-500">{item.sourceName}</p>
              {item.summary && <p className="line-clamp-4 text-sm text-zinc-600 dark:text-zinc-300">{item.summary}</p>}
            </div>
            {/* glitter rising from the card */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 overflow-hidden" aria-hidden>
              {glitter.map((g, i) => (
                <span key={i} className="zeff-fx absolute bottom-0 rounded-full" style={{ left: `${g.x}%`, width: g.size, height: g.size, background: g.color, boxShadow: `0 0 6px 2px ${g.color}`, animation: `zeff-rise ${g.dur}s ease-out ${g.delay}s infinite`, opacity: 0 }} />
              ))}
            </div>
          </article>
        </div>
        <p className="absolute top-full left-1/2 mt-5 w-[max(100%,20rem)] -translate-x-1/2 text-center text-sm font-medium text-white drop-shadow">
          ✨ {done ? t("Found something — bringing it back …") : t("Reading it, thinking about you, searching the world …")}
        </p>
      </div>
    </div>
  );
  return typeof document === "undefined" ? null : createPortal(body, document.body);
}
