"use client";

import type { CSSProperties, ReactNode } from "react";
import { safeUrl, type VNode } from "../card-template";
import { Tag } from "./cells";

/**
 * A card template's nodes (card-template.ts) drawn: each known tag is one of this page's own components — nothing from the template is
 * ever put in as HTML, a text is a text, an address is checked once more here.
 */

const INLINE = new Set(["b", "i", "small", "muted", "code", "chip", "badge", "a", "grow", "button", "field"]);
const isInline = (n: VNode) => typeof n === "string" || INLINE.has(n.t);

/** More tags drawn by whoever uses these nodes (a view's: buttons, lists, parts …) — undefined: not one of them. */
export type DrawExt = (n: Extract<VNode, object>, key: number, kids: (nodes: VNode[]) => ReactNode) => ReactNode | undefined;

/** The nodes of one level: runs of inline things (text, chips, bold …) share a wrapping line, blocks (row, col, bar …) stand alone. */
export function Level({ nodes, ext }: { nodes: VNode[]; ext?: DrawExt }) {
  const out: ReactNode[] = [];
  let run: VNode[] = [];
  const flush = (key: string) => {
    if (run.some((n) => typeof n !== "string" || n.trim())) {
      out.push(
        <div key={key} className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          {run.map((n, i) => draw(n, i, ext))}
        </div>,
      );
    }
    run = [];
  };
  nodes.forEach((n, i) => {
    if (isInline(n)) run.push(n);
    else {
      flush(`r${i}`);
      out.push(draw(n, i, ext));
    }
  });
  flush("end");
  return <>{out}</>;
}

const gap = (a: Record<string, string>): CSSProperties => (a.gap ? { gap: `${Number(a.gap) * 4}px` } : {});
const textOf = (c: VNode[]): string => c.map((n) => (typeof n === "string" ? n : textOf(n.c))).join("");

export function draw(n: VNode, key: number, ext?: DrawExt): ReactNode {
  if (typeof n === "string") return n;
  if (ext) {
    const own = ext(n, key, (nodes) => <Level nodes={nodes} ext={ext} />);
    if (own !== undefined) return own;
  }
  const kids = n.c.map((c, i) => draw(c, i, ext));
  switch (n.t) {
    case "row":
      return (
        <div
          key={key}
          className="flex items-center gap-x-1.5"
          style={{ flexWrap: n.a.wrap === "false" ? "nowrap" : "wrap", alignItems: n.a.align === "start" ? "flex-start" : n.a.align === "end" ? "flex-end" : n.a.align === "baseline" ? "baseline" : "center", justifyContent: n.a.justify === "between" ? "space-between" : n.a.justify === "end" ? "flex-end" : undefined, ...gap(n.a) }}
        >
          {kids}
        </div>
      );
    case "col":
      return (
        <div key={key} className="flex flex-col gap-1" style={gap(n.a)}>
          <Level nodes={n.c} ext={ext} />
        </div>
      );
    case "grow":
      return <span key={key} className="flex-1" />;
    case "hr":
      return <hr key={key} className="my-1 border-zinc-200 dark:border-zinc-700" />;
    case "b":
      return <strong key={key}>{kids}</strong>;
    case "i":
      return <em key={key}>{kids}</em>;
    case "small":
      return <small key={key} className="text-xs">{kids}</small>;
    case "muted":
      return <span key={key} className="text-xs text-zinc-500 dark:text-zinc-400">{kids}</span>;
    case "code":
      return <code key={key} className="rounded bg-zinc-100 px-1 text-xs dark:bg-zinc-800">{kids}</code>;
    case "clamp":
      return (
        <div key={key} className="text-sm text-zinc-600 dark:text-zinc-300" style={{ display: "-webkit-box", WebkitLineClamp: Math.min(8, Math.max(1, Number(n.a.lines) || 3)), WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {kids}
        </div>
      );
    case "chip":
      return <Tag key={key} option={{ id: textOf(n.c), name: textOf(n.c), color: (n.a.color as never) ?? "gray" }} />;
    case "badge":
      return (
        <span key={key} className="ws-tag" data-color={n.a.color ?? "gray"} style={{ borderRadius: 999 }}>
          {kids}
        </span>
      );
    case "bar": {
      const value = Number(n.a.value) || 0;
      const max = Number(n.a.max) || 1;
      const pct = Math.max(0, Math.min(100, (value / max) * 100));
      const over = value > max;
      return (
        <div key={key} className="h-1.5 w-full overflow-hidden rounded bg-zinc-200 dark:bg-zinc-700" role="progressbar" aria-valuenow={value} aria-valuemax={max} title={`${value} / ${max}`}>
          <div className={`h-full ${over ? "bg-red-500" : "bg-indigo-500"}`} style={{ width: `${over ? 100 : pct}%` }} />
        </div>
      );
    }
    case "img": {
      const src = safeUrl(n.a.src ?? "");
      if (!src) return null;
      // eslint-disable-next-line @next/next/no-img-element -- a picture named by the template: from anywhere, no loader
      return <img key={key} src={src} alt="" loading="lazy" referrerPolicy="no-referrer" className={`w-full ${n.a.round ? "rounded-full" : "rounded-md"}`} style={{ height: n.a.h ? `${Math.min(400, Number(n.a.h))}px` : undefined, objectFit: n.a.fit === "contain" ? "contain" : "cover" }} onError={(e) => (e.currentTarget.style.display = "none")} />;
    }
    case "a": {
      const href = safeUrl(n.a.href ?? "");
      return href ? (
        // (The web in a new tab; Zeff's own pages, a call, a mail in place.)
        <a key={key} href={href} {...(/^https?:/i.test(href) ? { target: "_blank", rel: "noreferrer noopener" } : {})} className="text-indigo-600 hover:underline dark:text-indigo-400" onClick={(e) => e.stopPropagation()}>
          {kids}
        </a>
      ) : (
        <span key={key}>{kids}</span>
      );
    }
    default:
      return <span key={key}>{kids}</span>;
  }
}

/** A rendered template as the body of a card. */
export function TemplateBody({ nodes }: { nodes: VNode[] }) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <Level nodes={nodes} />
    </div>
  );
}
