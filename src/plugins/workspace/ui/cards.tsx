"use client";

import { useT } from "@/components/I18nProvider";
import { cellText, type Property, type Row } from "../model";
import { CellView, type CellCtx } from "./cells";

/**
 * A row as a card (the gallery and the board), made to look right for any shape of data: a cover when a URL property holds
 * a picture, the title, the choices (select/status/tags) as chips, one passage of text, the other values as small
 * label/value pairs (or one quiet line on a board), checked boxes as badges — only what has a value, the rest counted ("+3").
 */

const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i;

type Kind = "chip" | "flag" | "text" | "meta";
const kindOf = (p: Property): Kind => (p.type === "select" || p.type === "status" || p.type === "multi_select" ? "chip" : p.type === "checkbox" ? "flag" : p.type === "text" || p.type === "ai" ? "text" : "meta");

const filled = (p: Property, row: Row): boolean => {
  const v = row.cells[p.id];
  if (p.type === "checkbox") return v === true;
  if (v === undefined || v === null || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
};

/** The first URL cell that holds a picture: the card's cover. */
function coverOf(visible: Property[], row: Row): { prop: Property; src: string } | null {
  for (const p of visible) {
    const v = row.cells[p.id];
    if (p.type === "url" && typeof v === "string" && IMAGE.test(v.trim())) return { prop: p, src: v.trim() };
  }
  return null;
}

export function RowCard({ row, visible, ctx, mode }: { row: Row; visible: Property[]; ctx: CellCtx; mode: "gallery" | "board" }) {
  const t = useT();
  const gallery = mode === "gallery";
  const cover = coverOf(visible, row);
  const props = visible.filter((p) => p.id !== cover?.prop.id && filled(p, row));
  const chips = props.filter((p) => kindOf(p) === "chip");
  const flags = props.filter((p) => kindOf(p) === "flag");
  // The one passage of text: the longest text value, when it is long enough to be a passage (shorter ones are plain facts: a director, a place).
  const len = (p: Property) => cellText(p, row.cells[p.id]).length;
  const text = props.filter((p) => kindOf(p) === "text" && len(p) >= 40).sort((a, b) => len(b) - len(a))[0];
  const metaAll = props.filter((p) => kindOf(p) === "meta" || (kindOf(p) === "text" && p !== text));
  const metaMax = gallery ? 4 : 3;
  const meta = metaAll.slice(0, metaMax);
  const more = metaAll.length - meta.length;
  return (
    <>
      {cover && (
        // eslint-disable-next-line @next/next/no-img-element -- a picture from anywhere on the web, shown as it is
        <img src={cover.src} alt="" loading="lazy" className={`ws-card-cover ${gallery ? "aspect-[16/10]" : "aspect-[16/8]"}`} onError={(e) => (e.currentTarget.style.display = "none")} />
      )}
      <div className="ws-card-title">
        {row.icon && <span aria-hidden>{row.icon}</span>}
        <span className="min-w-0 flex-1 break-words">{row.title || <span className="text-zinc-400">{t("Untitled")}</span>}</span>
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {chips.map((p) => (
            <CellView key={p.id} p={p} row={row} ctx={ctx} />
          ))}
        </div>
      )}
      {text && <p className={`ws-card-text ${gallery ? "line-clamp-3" : "line-clamp-2"}`}>{cellText(text, row.cells[text.id])}</p>}
      {meta.length > 0 &&
        (gallery ? (
          <dl className="ws-card-meta">
            {meta.map((p) => (
              <div key={p.id} className="min-w-0">
                <dt>{p.name}</dt>
                <dd className="truncate">
                  <CellView p={p} row={row} ctx={ctx} />
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
            {meta.map((p) => (
              <span key={p.id} className="inline-flex max-w-full min-w-0 items-center gap-1 truncate" title={p.name}>
                <CellView p={p} row={row} ctx={ctx} />
              </span>
            ))}
          </div>
        ))}
      {(flags.length > 0 || more > 0) && (
        <div className="flex flex-wrap items-center gap-1 text-xs">
          {flags.map((p) => (
            <span key={p.id} className="ws-chip" data-kind="flag">
              ✓ {p.name}
            </span>
          ))}
          {more > 0 && (
            <span className="text-zinc-400" title={metaAll.slice(metaMax).map((p) => p.name).join(", ")}>
              +{more}
            </span>
          )}
        </div>
      )}
    </>
  );
}
