import "@/plugins/contributions";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { TRUST_REVIEW } from "@/lib/trust/review";
import { decide, openProposals, proposalSourceList } from "@/lib/proposals";
import { reviewLinks, reviewSources, type ReviewEntry, type ReviewSource } from "./point";

/**
 * The review queue (server only): what every installed plugin wants you to confirm, as one list — and the
 * button pressed on an item, sent to the plugin it came from. See ./point for what a plugin contributes.
 */

export type { ReviewAction, ReviewEntry, ReviewLink, ReviewSource } from "./point";

/** An item of the queue: its source's entry, keyed "<source>:<id>", with its kind (the source's label). */
export type ReviewItem = Omit<ReviewEntry, "id"> & { key: string; source: string; kind: string; plugin: string };

export type ReviewQueue = {
  items: ReviewItem[];
  /** What waits on pages of their own (only those with something waiting). */
  links: { id: string; label: string; href: string; count: number }[];
  /** The sources that couldn't say what waits — why. */
  errors: { source: string; label: string; message: string }[];
  /** Everything waiting: the items and the linked pages' counts. */
  count: number;
};

/**
 * The open proposals (@/lib/proposals), a source each: listed as their source shows them, a button decided through `decide()`
 * — the same as the button in the place itself (the people overview, the calendar).
 */
async function proposalReviewSources(): Promise<(ReviewSource & { plugin: string })[]> {
  return (await proposalSourceList())
    .filter((s) => s.review !== false)
    .map((s) => ({
      id: s.id,
      plugin: s.plugin,
      get label() {
        return s.label;
      },
      list: async () => {
        await s.prepare?.();
        const open = openProposals(s.id);
        if (!open.length) return [];
        const shown = await s.entries(open);
        const words = s.labels?.() ?? { yes: t("Right"), no: t("Wrong") };
        return open.map((p, i) => ({
          id: String(p.id),
          title: shown[i]?.title ?? p.why,
          detail: shown[i]?.detail ?? p.why,
          ...(p.confidence == null ? {} : { confidence: p.confidence }),
          ...(shown[i]?.href ? { href: shown[i].href } : {}),
          actions: [
            { id: "yes", label: words.yes, primary: true },
            { id: "no", label: words.no },
          ],
        }));
      },
      act: async (id, action) => {
        if (action !== "yes" && action !== "no") throw new Error(t("Unknown action: {action}", { action }));
        return (await decide(Number(id), action === "yes" ? "accepted" : "dismissed")).message;
      },
    }));
}

/** The open proposals first (one source each), then the plugins' other sources, then Zeff's own: what may be outdated (trust in facts, @/lib/trust). */
const sources = async (): Promise<(ReviewSource & { plugin: string })[]> => [
  ...(await proposalReviewSources()),
  ...reviewSources.list().flatMap((c) => c.impl.map((s) => ({ ...s, plugin: c.plugin }))),
  ...TRUST_REVIEW.map((s) => ({ ...s, plugin: "core" })),
];

/** Everything waiting, source by source in the plugins' order; a source that fails is named in `errors`, the others still there. */
export async function reviewItems(): Promise<ReviewQueue> {
  const items: ReviewItem[] = [];
  const errors: ReviewQueue["errors"] = [];
  for (const s of await sources()) {
    try {
      for (const { id, ...e } of await s.list()) items.push({ ...e, key: `${s.id}:${id}`, source: s.id, kind: s.label, plugin: s.plugin });
    } catch (err) {
      errors.push({ source: s.id, label: s.label, message: errorMessage(err) });
    }
  }
  const links: ReviewQueue["links"] = [];
  for (const l of reviewLinks.list().flatMap((c) => c.impl)) {
    try {
      const count = await l.count();
      if (count > 0) links.push({ id: l.id, label: l.label, href: l.href, count });
    } catch (err) {
      errors.push({ source: l.id, label: l.label, message: errorMessage(err) });
    }
  }
  return { items, links, errors, count: items.length + links.reduce((n, l) => n + l.count, 0) };
}

/** A button pressed on the item `key` ("people-claim:28"): done by its source. What came of it, in words. */
export async function reviewAct(key: string, action: string): Promise<{ message?: string }> {
  const at = key.indexOf(":");
  const source = at > 0 ? (await sources()).find((s) => s.id === key.slice(0, at)) : undefined;
  if (!source || at === key.length - 1) throw new Error(t("Unknown review item: {key}", { key }));
  const message = await source.act(key.slice(at + 1), action);
  return message ? { message } : {};
}
