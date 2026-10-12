import Link from "next/link";
import { layout, type Bubble } from "./explore-core";

const KIND: Record<Bubble["kind"], string> = {
  trend: "bg-rose-100 text-rose-900 ring-rose-300 hover:bg-rose-200 dark:bg-rose-950 dark:text-rose-100 dark:ring-rose-800",
  related: "bg-indigo-100 text-indigo-900 ring-indigo-300 hover:bg-indigo-200 dark:bg-indigo-950 dark:text-indigo-100 dark:ring-indigo-800",
  yours: "bg-emerald-100 text-emerald-900 ring-emerald-300 hover:bg-emerald-200 dark:bg-emerald-950 dark:text-emerald-100 dark:ring-emerald-800",
  wild: "bg-amber-100 text-amber-900 ring-amber-300 hover:bg-amber-200 dark:bg-amber-950 dark:text-amber-100 dark:ring-amber-800",
};

const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

/**
 * A field of bubbles: the thing you are on in the middle, what hangs together with it round it — each one a link to hop to
 * (it becomes the middle). Bigger means more news on it; the colour says why it is there (rising, related, yours, out there).
 * Plain server markup with CSS motion: bubbles drift gently, and stand still for people who ask for less motion.
 */
export function BubbleField({ center, bubbles, href, rings = 2 }: { center: { label: string; sub?: string; href?: string }; bubbles: Bubble[]; href: (term: string) => string; rings?: number }) {
  const spots = layout(bubbles.map((b) => b.term), { rings });
  return (
    <div className="relative mx-auto aspect-[16/11] w-full max-w-5xl overflow-hidden rounded-2xl border border-zinc-200 bg-gradient-to-br from-zinc-50 via-white to-indigo-50 dark:border-zinc-800 dark:from-zinc-950 dark:via-zinc-900 dark:to-indigo-950/40">
      <style>{`@keyframes zeff-bob{0%,100%{transform:translate(-50%,-50%) translateY(0)}50%{transform:translate(-50%,-50%) translateY(-9px)}}@media (prefers-reduced-motion:reduce){.zeff-bubble{animation:none!important}}`}</style>
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        {spots.map((p, i) => (
          <line key={bubbles[i].term} x1="50" y1="50" x2={p.x} y2={p.y} stroke="currentColor" strokeWidth="0.18" className="text-zinc-300 dark:text-zinc-700" style={{ opacity: 0.35 + bubbles[i].weight * 0.5 }} />
        ))}
      </svg>
      <div className="absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-1/2 text-center">
        <div className="rounded-full bg-zinc-900 px-6 py-5 text-lg font-semibold text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900">
          {center.label}
          {center.sub && <div className="text-xs font-normal opacity-70">{center.sub}</div>}
        </div>
      </div>
      {bubbles.map((b, i) => {
        const h = hash(b.term);
        const size = 0.78 + b.weight * 0.42; // rem of text; the bubble grows with it
        return (
          <Link
            key={b.term}
            href={href(b.term)}
            className={`zeff-bubble absolute flex max-w-[11rem] items-center justify-center rounded-full px-3.5 py-2 text-center leading-tight font-medium shadow-sm ring-1 transition-transform hover:z-20 hover:scale-110 ${KIND[b.kind]}`}
            style={{ left: `${spots[i].x}%`, top: `${spots[i].y}%`, fontSize: `${size}rem`, animation: `zeff-bob ${5 + (h % 4)}s ease-in-out ${-(h % 5)}s infinite`, transform: "translate(-50%,-50%)" }}
            title={`${b.term} — ${b.count}`}
          >
            <span className="truncate">{b.term}</span>
            <span className="ml-1.5 shrink-0 text-[0.65em] opacity-60 tabular-nums">{b.count}</span>
          </Link>
        );
      })}
    </div>
  );
}
