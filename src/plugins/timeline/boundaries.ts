/**
 * The timeline and the data boundaries (lib/boundaries): an event carries the label of where it came from — its source's
 * (WhatsApp, Signal, the bank: personal by default; any source you set to secret), a mail's by its account (Outlook,
 * Gmail), a Workspace row's change by the row's databases, a payment matched to a case also by the case's row. What a
 * reader may see of it: the same rules as the MCP guard — secret for nobody, not even you; personal for you and the agents
 * whose routine may read personal data. The timeline's pages, its API, its MCP tools and the questions' timeline view all
 * leave out what the reader may not see. Server only.
 */
import { allows, currentClearance, maxLabel, refSourceKey, sourceLabel, type Clearance, type Label } from "@/lib/boundaries";
import { labelResolver } from "@/plugins/workspace/sensitivity";
import type { TimelineEvent } from "./store";

type Labelled = Pick<TimelineEvent, "source" | "sourceRef" | "url">;

/** A labeller of events for one batch (the sources' and the pages' labels read once). */
export function eventLabeller(): (e: Labelled) => Label {
  const pages = labelResolver();
  const sources = new Map<string, Label>();
  const of = (key: string) => {
    if (!sources.has(key)) sources.set(key, sourceLabel(key));
    return sources.get(key)!;
  };
  return (e) => {
    // A mail: Outlook's or Gmail's (the mail table holds both) — the timeline's own source says only "mail".
    // (a page's edit: the page's own label; an action you clicked: the todos')
    let label = e.source === "mail" ? of(refSourceKey(`mail:${e.sourceRef}`) ?? "mail") : e.source === "workspace" || e.source === "pages" ? "open" : of(e.source === "actions" ? "todos" : e.source);
    const row = /^\/workspace\/(\d+)/.exec(e.url ?? "");
    if (row && (e.source === "workspace" || e.source === "pages" || e.source === "bank")) label = maxLabel(label, pages.page(Number(row[1])));
    return label;
  };
}

/** Whether a reader with this clearance (default: the code running's) may see an event — for one batch. */
export function eventFilter(clearance: Clearance = currentClearance()): (e: Labelled) => boolean {
  const label = eventLabeller();
  return (e) => allows(clearance, label(e));
}

/**
 * Up to `limit` events a reader may see, newest first: page after page of `fetch` (each `limit` long, after the last one
 * read, at most 1000 a page) until enough are left or there are no more — so what is left out doesn't shorten the list.
 */
export function visibleEvents(fetch: (page: { limit: number; before?: { at: string; id: number } }) => TimelineEvent[], limit: number, opts: { before?: { at: string; id: number }; keep?: (e: TimelineEvent) => boolean; rounds?: number } = {}): TimelineEvent[] {
  const keep = opts.keep ?? eventFilter();
  const out: TimelineEvent[] = [];
  // (The store reads at most 1000 at a time.)
  const size = Math.min(limit, 1000);
  let before = opts.before;
  for (let round = 0; round < (opts.rounds ?? 10) && out.length < limit; round++) {
    const page = fetch({ limit: size, before });
    out.push(...page.filter(keep));
    if (page.length < size) break;
    const last = page[page.length - 1];
    before = { at: last.at, id: last.id };
  }
  return out.slice(0, limit);
}
