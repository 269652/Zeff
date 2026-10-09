import { Fragment } from "react";
import { parseMarkdown, type MdBlock, type MdInline } from "@/lib/markdown";

/**
 * A context message's Markdown as elements (no raw HTML, so pasted content can't run
 * scripts). `image` turns an image reference ("attachment:12", "paste:…", a URL) into a
 * src to show, or null to show its alt text instead.
 */
export function Markdown({ text, image, className = "" }: { text: string; image?: (target: string) => string | null; className?: string }) {
  const resolve = image ?? ((t: string) => (/^https?:/i.test(t) ? t : null));
  return <div className={`space-y-2 text-sm leading-relaxed ${className}`}>{blocks(parseMarkdown(text), resolve)}</div>;
}

function blocks(bs: MdBlock[], img: (t: string) => string | null) {
  return bs.map((b, i) => <Fragment key={i}>{block(b, img)}</Fragment>);
}

function block(b: MdBlock, img: (t: string) => string | null) {
  switch (b.t) {
    case "p":
      return <p>{inline(b.c, img)}</p>;
    case "h": {
      const cls = b.level <= 2 ? "text-base font-semibold" : "text-sm font-semibold";
      return <p className={cls}>{inline(b.c, img)}</p>;
    }
    case "quote":
      return <blockquote className="space-y-2 border-l-2 border-zinc-300 pl-3 text-zinc-600 dark:border-zinc-600 dark:text-zinc-400">{blocks(b.c, img)}</blockquote>;
    case "list": {
      const items = b.items.map((it, i) => (
        <li key={i}>
          {inline(it.c, img)}
          {it.sub.map((s, k) => (
            <Fragment key={k}>{block(s, img)}</Fragment>
          ))}
        </li>
      ));
      return b.ordered ? <ol className="ml-5 list-decimal space-y-0.5">{items}</ol> : <ul className="ml-5 list-disc space-y-0.5 [&_ul]:list-[circle] [&_ul_ul]:list-[square]">{items}</ul>;
    }
    case "code":
      return <pre className="overflow-x-auto rounded bg-zinc-100 p-2 font-mono text-xs dark:bg-zinc-900">{b.v}</pre>;
    case "table":
      return (
        <div className="overflow-x-auto">
          <table className="border-collapse text-xs">
            <thead>
              <tr>
                {b.head.map((c, i) => (
                  <th key={i} className="border border-zinc-200 px-2 py-1 text-left font-semibold dark:border-zinc-700">{inline(c, img)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, k) => (
                    <td key={k} className="border border-zinc-200 px-2 py-1 align-top dark:border-zinc-700">{inline(c, img)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "hr":
      return <hr className="border-zinc-200 dark:border-zinc-700" />;
  }
}

function inline(c: MdInline[], img: (t: string) => string | null): React.ReactNode {
  return c.map((n, i) => {
    switch (n.t) {
      case "text":
        return <Fragment key={i}>{n.v}</Fragment>;
      case "br":
        return <br key={i} />;
      case "strong":
        return <strong key={i}>{inline(n.c, img)}</strong>;
      case "em":
        return <em key={i}>{inline(n.c, img)}</em>;
      case "del":
        return <del key={i}>{inline(n.c, img)}</del>;
      case "code":
        return <code key={i} className="rounded bg-zinc-100 px-1 font-mono text-[0.85em] dark:bg-zinc-800">{n.v}</code>;
      case "link":
        return (
          <a key={i} href={n.href} target="_blank" rel="noreferrer" className="text-indigo-600 underline decoration-indigo-300 hover:decoration-indigo-600 dark:text-indigo-400">
            {inline(n.c, img)}
          </a>
        );
      case "img": {
        const src = img(n.src);
        if (!src) return <span key={i} className="text-zinc-400">[{n.alt || "image"}]</span>;
        return (
          <a key={i} href={src} target="_blank" rel="noreferrer" className="my-1 block w-fit">
            {/* eslint-disable-next-line @next/next/no-img-element -- pasted images, stored locally */}
            <img src={src} alt={n.alt} className="max-h-80 max-w-full rounded border border-zinc-200 dark:border-zinc-700" />
          </a>
        );
      }
    }
  });
}
