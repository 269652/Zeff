"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { NEWS_PAGE, parseInterests, parseMutes, PRESETS, type NewsPrefs, type NewsState } from "./shared";
import { addSource, addSources, forgetLearning, getContent, getPrefs, listItems, listSources, removeSource, setContent, setPrefs, setState, UNREADABLE, updateSource, vote, type NewsView } from "./store";

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
export async function newsMoreAction(view: string, sourceId: number | null, category: string, offset: number, term = ""): Promise<{ items: import("./shared").NewsItem[]; ago: Record<number, string>; done: boolean }> {
  guard();
  const { formatAgo } = await import("@/lib/format");
  const { getPrefs } = await import("./store");
  const v = (["foryou", "latest", "saved", "hidden"] as string[]).includes(view) ? (view as NewsView) : "foryou";
  const items = listItems({ view: v, sourceId: sourceId ?? undefined, category: category || undefined, term: term || undefined, maxAgeDays: getPrefs().maxAgeDays, limit: NEWS_PAGE, offset: Math.max(0, Math.floor(offset)) });
  return { items, ago: Object.fromEntries(items.map((i) => [i.id, formatAgo(i.publishedAt)])), done: items.length < NEWS_PAGE };
}

/** Ask your news: a question answered from the fetched items, with the sources it used. */
export async function askNewsAction(question: string): Promise<{ ok: boolean; answer?: string; sources?: { n: number; id: number; title: string; url: string; sourceName: string }[]; error?: string }> {
  try {
    guard();
    const { isInstalled } = await import("@/plugins/state");
    if (!isInstalled("llm")) throw new Error(t("Asking needs the LLM plugin (Menu → Plugins)."));
    const r = await (await import("./ask")).askNews(String(question ?? "").slice(0, 400));
    return { ok: true, answer: r.answer, sources: r.sources };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** From a card: pause the whole feed it is from (its items leave the lists), take it back, or remove it. */
export async function newsSourceAction(sourceId: number, mode: string): Promise<Result> {
  try {
    guard();
    if (mode === "pause") updateSource(Number(sourceId), { enabled: false });
    else if (mode === "resume") updateSource(Number(sourceId), { enabled: true });
    else if (mode === "remove") removeSource(Number(sourceId));
    else throw new Error("Unknown action.");
    return await done(true);
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** From a card of a topic search ("Google News: term"): stop searching for that term (it leaves your interests); with `back`, take it back. */
export async function newsTopicAction(term: string, mode: string, weight = 1): Promise<Result> {
  try {
    guard();
    const prefs = getPrefs();
    const clean = String(term).trim();
    const rest = prefs.interests.filter((i) => i.term.toLowerCase() !== clean.toLowerCase());
    if (mode === "stop") setPrefs({ interests: rest });
    else if (mode === "back") setPrefs({ interests: [...rest, { term: clean, weight: Math.max(1, Math.min(3, Math.round(weight))) }] });
    else throw new Error("Unknown action.");
    return await done(true);
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** The empty page's "Start": the starter pack on, the first fetch going in the background. */
export async function newsStartAction(): Promise<Result> {
  try {
    guard();
    const { starterFeeds } = await import("./catalog");
    const n = addSources(starterFeeds());
    const { startSync } = await import("@/lib/sync/registry");
    startSync("news");
    revalidatePath("/news");
    return { ok: true, message: t("{n} sources added — fetching their news in the background.", { n }) };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
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

/** An address (a feed, or any website): the feed behind it is found and added. */
export async function addSourceFormAction(fd: FormData): Promise<void> {
  try {
    guard();
    const url = str(fd, "url");
    const found = await (await import("./discover")).discoverFeeds(url);
    if (!found.length) throw new Error(t("No feed found at that address."));
    addSource({ name: str(fd, "name") || found[0].title, url: found[0].url, category: "Added" });
  } catch (e) {
    back({ error: errorMessage(e) });
  }
  revalidatePath("/settings/news");
  back({ ok: t("Source added.") });
}

type Found = { url: string; title: string; items: number; newest: string; sample: string[]; domain: string; via: string; why: string; topic: string };

/** The feed finder: feeds worth reading on a topic (news search + the AI's outlets, each checked) — or, without a topic, for your top interests. */
export async function findFeedsAction(topic: string): Promise<{ ok: boolean; found: Found[]; error?: string }> {
  try {
    guard();
    const { findFeeds } = await import("./finder");
    const prefs = getPrefs();
    const have = new Set(listSources().map((s) => { try { return new URL(s.url).hostname.replace(/^www\./, ""); } catch { return ""; } }));
    const { workWords } = await import("./sync");
    const profile = [...prefs.interests.map((i) => i.term), ...(await workWords(10))];
    const topics = topic.trim() ? [topic.trim()] : [...prefs.interests].sort((a, b) => b.weight - a.weight).slice(0, 3).map((i) => i.term);
    if (!topics.length) throw new Error(t("Name a topic, or add interests under What suits you first."));
    const all: Found[] = [];
    for (const tp of topics) for (const s of await findFeeds(tp, { have, profile, language: prefs.language, limit: 12 })) if (!all.some((x) => x.url === s.feed.url)) all.push({ ...s.feed, domain: s.domain, via: s.via, why: s.why, topic: tp });
    return { ok: true, found: all };
  } catch (e) {
    return { ok: false, found: [], error: errorMessage(e) };
  }
}

/** A found feed, added (category "Discovered"). */
export async function addFoundFeedAction(url: string, name: string): Promise<Result> {
  try {
    guard();
    addSource({ name: name.slice(0, 80) || url, url, category: "Discovered", lang: getPrefs().language === "any" ? "" : getPrefs().language });
    revalidatePath("/settings/news");
    return { ok: true, message: t("Source added.") };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** The whole starter pack (about fifty well-known feeds across topics and languages), one click. */
export async function addStarterFormAction(): Promise<void> {
  let n = 0;
  try {
    guard();
    const { starterFeeds } = await import("./catalog");
    n = addSources(starterFeeds());
  } catch (e) {
    back({ error: errorMessage(e) });
  }
  revalidatePath("/settings/news");
  back({ ok: t("{n} sources added.", { n }) });
}

/** A category of the catalog (optionally only one language): all its feeds. */
export async function addCategoryFormAction(fd: FormData): Promise<void> {
  let n = 0;
  try {
    guard();
    const { ALL_FEEDS } = await import("./catalog");
    const category = str(fd, "category");
    const lang = str(fd, "lang");
    n = addSources(ALL_FEEDS.filter((f) => f.category === category && (!lang || f.lang === lang)));
  } catch (e) {
    back({ error: errorMessage(e) });
  }
  revalidatePath("/settings/news");
  back({ ok: t("{n} sources added.", { n }) });
}

/** A starter source, one click. */
export async function addPresetFormAction(fd: FormData): Promise<void> {
  try {
    guard();
    const { ALL_FEEDS } = await import("./catalog");
    const p = ALL_FEEDS.find((x) => x.url === str(fd, "url"));
    if (!p) throw new Error(t("Unknown source."));
    addSource({ name: p.name, url: p.url, category: p.category, lang: p.lang });
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
      useProfile: fd.get("useProfile") === "on",
      diversity: fd.get("diversity") === "on",
      digest: fd.get("digest") === "on",
      autoDiscover: fd.get("autoDiscover") === "on",
      images: fd.get("images") === "on",
      prefetch: fd.get("prefetch") === "on",
      maxAgeDays: clamp(Number(str(fd, "maxAgeDays")), 1, 30, 7),
      perSource: clamp(Number(str(fd, "perSource")), 5, 100, 25),
      perRun: clamp(Number(str(fd, "perRun")), 10, 1000, 150),
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
