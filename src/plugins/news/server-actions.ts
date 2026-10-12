"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { NEWS_PAGE, snippetOf, parseInterests, parseMutes, PRESETS, type NewsPrefs, type NewsState } from "./shared";
import { addSource, forgetLearning, getContent, listItems, removeSource, setContent, setPrefs, setState, UNREADABLE, updateSource, vote, type NewsView } from "./store";

/** The News plugin's server actions: the cards' buttons return a result; the settings forms go back to their page with what came of it. */

type Result = { ok: boolean; error?: string; message?: string };
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const back = (params: Record<string, string>): never => redirect(`/settings/news?${new URLSearchParams(params)}`);

function guard(): void {
  if (!isInstalled("news")) throw new Error(t("The News plugin is not installed (Menu → Plugins)."));
}

async function done(rescore: boolean): Promise<Result> {
  if (rescore) await (await import("./sync")).rescoreAll();
  revalidatePath("/news");
  return { ok: true };
}

/** Read / saved / hidden / back to new. */
export async function newsStateAction(id: number, state: string): Promise<Result> {
  try {
    guard();
    if (!["new", "read", "saved", "hidden"].includes(state)) throw new Error("Unknown state.");
    setState(Number(id), state as NewsState);
    return await done(false);
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** Like (1), dislike (−1) or take it back (0): the words and the source learn, the order follows at once. */
export async function newsVoteAction(id: number, value: number): Promise<Result> {
  try {
    guard();
    vote(Number(id), value > 0 ? 1 : value < 0 ? -1 : 0);
    return await done(true);
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** The whole article of an item: kept already, or read from its page now (and kept). */
export async function newsReadAction(id: number): Promise<{ ok: boolean; text?: string; image?: string; url?: string; error?: string }> {
  try {
    guard();
    const have = getContent(Number(id));
    if (!have) throw new Error(t("That item isn't there any more."));
    if (have.content.length > 1) return { ok: true, text: have.content, url: have.url };
    const a = await (await import("./reader")).fetchArticle(have.url);
    setContent(Number(id), a.text, a.image);
    setState(Number(id), "read");
    return { ok: true, text: a.text, image: a.image, url: have.url };
  } catch (e) {
    if (getContent(Number(id))?.content === "") setContent(Number(id), UNREADABLE);
    return { ok: false, error: errorMessage(e) };
  }
}



/** The next page of a view (infinite scroll): items with how old they are, as the page shows them. */
/**
 * A card without a picture came into view: its page is read (that also keeps the whole article, so "Read here" is
 * instant) and the picture taken from it. None found, or the page can't be read: remembered, not asked again.
 */
export async function newsPeekAction(id: number): Promise<{ ok: boolean; image: string; hasContent: boolean; summary: string }> {
  try {
    guard();
    const have = getContent(Number(id));
    if (!have || have.content === UNREADABLE) return { ok: false, image: "", hasContent: false, summary: "" };
    const a = await (await import("./reader")).fetchArticle(have.url);
    setContent(Number(id), a.text, a.image);
    return { ok: true, image: a.image, hasContent: true, summary: snippetOf(a.text) };
  } catch {
    setContent(Number(id), UNREADABLE);
    return { ok: false, image: "", hasContent: false, summary: "" };
  }
}

export async function newsMoreAction(view: string, sourceId: number | null, offset: number): Promise<{ items: import("./shared").NewsItem[]; ago: Record<number, string>; done: boolean }> {
  guard();
  const { formatAgo } = await import("@/lib/format");
  const { getPrefs } = await import("./store");
  const v = (["foryou", "latest", "saved", "hidden"] as string[]).includes(view) ? (view as NewsView) : "foryou";
  const items = listItems({ view: v, sourceId: sourceId ?? undefined, maxAgeDays: getPrefs().maxAgeDays, limit: NEWS_PAGE, offset: Math.max(0, Math.floor(offset)) });
  return { items, ago: Object.fromEntries(items.map((i) => [i.id, formatAgo(i.publishedAt)])), done: items.length < NEWS_PAGE };
}

/** "Refresh": the sync, now. */
export async function refreshNewsAction(): Promise<Result> {
  try {
    guard();
    const r = await (await import("./sync")).syncNews();
    revalidatePath("/news");
    revalidatePath("/settings/news");
    return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** "Overview now": the AI overview of the best unread items. */
export async function newsDigestAction(): Promise<Result> {
  try {
    guard();
    const d = await (await import("./digest")).buildDigest();
    revalidatePath("/news");
    return d ? { ok: true, message: t("The overview is ready.") } : { ok: false, error: t("Nothing unread to sum up.") };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function addSourceFormAction(fd: FormData): Promise<void> {
  try {
    guard();
    addSource({ name: str(fd, "name"), url: str(fd, "url") });
  } catch (e) {
    back({ error: errorMessage(e) });
  }
  revalidatePath("/settings/news");
  back({ ok: t("Source added.") });
}

/** A starter source, one click. */
export async function addPresetFormAction(fd: FormData): Promise<void> {
  try {
    guard();
    const p = PRESETS.find((x) => x.url === str(fd, "url"));
    if (!p) throw new Error(t("Unknown source."));
    addSource({ name: p.name, url: p.url });
  } catch (e) {
    back({ error: errorMessage(e) });
  }
  revalidatePath("/settings/news");
  back({ ok: t("Source added.") });
}

export async function updateSourceFormAction(fd: FormData): Promise<void> {
  try {
    guard();
    const id = Number(str(fd, "id"));
    updateSource(id, {
      name: fd.has("name") ? str(fd, "name") : undefined,
      enabled: fd.has("toggle") ? str(fd, "toggle") === "on" : undefined,
      weight: fd.has("weight") ? Number(str(fd, "weight")) || 1 : undefined,
    });
    await (await import("./sync")).rescoreAll();
  } catch (e) {
    back({ error: errorMessage(e) });
  }
  revalidatePath("/settings/news");
  revalidatePath("/news");
  back({});
}

export async function removeSourceFormAction(fd: FormData): Promise<void> {
  try {
    guard();
    removeSource(Number(str(fd, "id")));
  } catch (e) {
    back({ error: errorMessage(e) });
  }
  revalidatePath("/settings/news");
  revalidatePath("/news");
  back({});
}

const clamp = (n: number, lo: number, hi: number, d: number) => (Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : d);

/** Interests, muted words, language and the switches — then everything is scored again. */
export async function savePrefsFormAction(fd: FormData): Promise<void> {
  try {
    guard();
    const language = str(fd, "language");
    const patch: Partial<NewsPrefs> = {
      interests: parseInterests(String(fd.get("interests") ?? "")),
      mutes: parseMutes(String(fd.get("mutes") ?? "")),
      language: language === "en" || language === "any" ? language : "de",
      topicSearch: fd.get("topicSearch") === "on",
      useWork: fd.get("useWork") === "on",
      digest: fd.get("digest") === "on",
      images: fd.get("images") === "on",
      prefetch: fd.get("prefetch") === "on",
      maxAgeDays: clamp(Number(str(fd, "maxAgeDays")), 1, 30, 7),
      perSource: clamp(Number(str(fd, "perSource")), 5, 100, 25),
      keepDays: clamp(Number(str(fd, "keepDays")), 3, 365, 30),
    };
    setPrefs(patch);
    await (await import("./sync")).rescoreAll();
  } catch (e) {
    back({ error: errorMessage(e) });
  }
  revalidatePath("/settings/news");
  revalidatePath("/news");
  back({ ok: t("Saved.") });
}

/** Taste reset: what the likes and dislikes taught is forgotten. */
export async function forgetLearningFormAction(): Promise<void> {
  try {
    guard();
    forgetLearning();
    await (await import("./sync")).rescoreAll();
  } catch (e) {
    back({ error: errorMessage(e) });
  }
  revalidatePath("/news");
  back({ ok: t("Forgotten — the order is by your interests only again.") });
}
