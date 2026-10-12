"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { parseInterests, parseMutes, PRESETS, type NewsPrefs, type NewsState } from "./shared";
import { addSource, forgetLearning, removeSource, setPrefs, setState, updateSource, vote } from "./store";

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
