import { getPref, setPref } from "@/lib/prefs";
import { fillPrompt, promptText } from "@/lib/prompts";
import { analyze, cosine } from "./keyphrase";
import { getPrefs, tasteSignals } from "./store";

/**
 * Your taste, written down: a short description of what you like to read, kept by Zeff and growing as you go. Every article you
 * like (👍), save (🔖) or reject (👎) is a signal; the signals are fed — a few at a time — to the AI together with the current
 * description, which rewrites it: new likes added, vague ones sharpened, contradictions out. Along with the text it keeps the
 * terms you like, the ones you avoid and searches that would find more. This description is the basis of Discover: it plans
 * the searches for new sources and is matched against the unread news already fetched. Without an AI the description is built
 * from the tags of what you liked. You can edit it yourself; the AI continues from your version.
 */
export type Signal = { id: number; kind: "like" | "save" | "dislike"; title: string; summary: string; tags: string[]; at: string };
export type Taste = { text: string; likes: string[]; avoids: string[]; queries: string[]; updatedAt: string | null; pending: Signal[]; edited: boolean };

const KEY = "news:taste";
const EMPTY: Taste = { text: "", likes: [], avoids: [], queries: [], updatedAt: null, pending: [], edited: false };

export const getTaste = (): Taste => ({ ...EMPTY, ...getPref<Partial<Taste>>(KEY, {}) });
export const setTaste = (patch: Partial<Taste>): Taste => {
  const next = { ...getTaste(), ...patch };
  setPref(KEY, next);
  return next;
};

/** A like, a save or a dislike on an item: queued for the next update of the description (the opposite one for the same item replaces it). */
export function recordSignal(item: { id: number; title: string; summary: string; terms?: string[] }, kind: Signal["kind"]): void {
  const t = getTaste();
  const rest = t.pending.filter((p) => p.id !== item.id || p.kind === kind);
  if (rest.some((p) => p.id === item.id && p.kind === kind)) return;
  setTaste({ pending: [...rest, { id: item.id, kind, title: item.title, summary: item.summary.slice(0, 300), tags: (item.terms ?? []).slice(0, 4), at: new Date().toISOString() }].slice(-60) });
}

/** Its instructions — a page of System → Prompts. */
export const TASTE_INSTRUCTIONS = "Du führst eine kurze Beschreibung davon, was eine Person gern liest — ihr Nachrichten-Geschmack. Sie wächst mit jedem Artikel, den die Person mit 👍 oder Merken markiert (oder mit 👎 ablehnt).\nSchreibe die Beschreibung fort: neue Vorlieben aufnehmen, Vages schärfen, Widersprüche auflösen, Muster erkennen (Themen, Tonfall, Tiefe, Regionen, Quellenarten) — nicht jeden Artikel einzeln erwähnen. Höchstens 900 Zeichen, Fließtext, Du-Form. Was die Person selbst geschrieben hat, bleibt erhalten, außer es widerspricht den Signalen.\nGib außerdem likes (bis 16 konkrete Begriffe, deutsch und englisch), avoids (bis 8) und queries (bis 6 Suchanfragen, 2–5 Wörter, auch Nachbarthemen) heraus. Nutze nur, was unten steht.";

/** A signal taken back (the 👍 removed, the 🔖 undone): it leaves the queue. */
export function withdrawSignal(itemId: number, kind: Signal["kind"]): void {
  const t = getTaste();
  if (t.pending.some((p) => p.id === itemId && p.kind === kind)) setTaste({ pending: t.pending.filter((p) => !(p.id === itemId && p.kind === kind)) });
}

type Update = { description?: string; likes?: string[]; avoids?: string[]; queries?: string[] };

const SCHEMA = {
  type: "object",
  properties: {
    description: { type: "string", description: "Die fortgeschriebene Beschreibung, was die Person gern liest — höchstens 900 Zeichen, Fließtext in der Du-Form." },
    likes: { type: "array", items: { type: "string" }, description: "Bis zu 16 konkrete Fachbegriffe/Themen/Namen, die die Person mag — jeweils auf Deutsch UND Englisch (Artikel sind oft englisch), keine allgemeinen Wörter wie Technologie oder Gesundheit." },
    avoids: { type: "array", items: { type: "string" }, description: "Bis zu 8 Begriffe/Themen, die sie meiden will." },
    queries: { type: "array", items: { type: "string" }, description: "Bis zu 6 konkrete Suchanfragen (2–5 Wörter) nach Forschung/Berichten zu den Themen — keine Produkt-, Shopping- oder Werbe-Begriffe." },
  },
  required: ["description", "likes", "avoids", "queries"],
};

export function tastePrompt(current: Taste, signals: Signal[], profile: string[]): string {
  const line = (s: Signal) => `- ${s.title}${s.tags.length ? ` [${s.tags.join(", ")}]` : ""}${s.summary ? ` — ${s.summary.slice(0, 160)}` : ""}`;
  const of = (k: Signal["kind"]) => signals.filter((s) => s.kind === k);
  return [
    promptText("news-taste", TASTE_INSTRUCTIONS),
    "",
    `Bisherige Beschreibung: ${current.text || "(noch keine)"}`,
    `Bisherige Begriffe, die sie mag: ${current.likes.join(", ") || "(keine)"}; meiden: ${current.avoids.join(", ") || "(keine)"}`,
    "",
    "Neue Signale:",
    ...(of("like").length ? ["👍 gefällt:", ...of("like").map(line)] : []),
    ...(of("save").length ? ["🔖 gemerkt:", ...of("save").map(line)] : []),
    ...(of("dislike").length ? ["👎 abgelehnt:", ...of("dislike").map(line)] : []),
    "",
    "Was sonst über die Person bekannt ist:",
    ...(profile.length ? profile.map((p) => `- ${p}`) : ["- (nichts)"]),
  ].join("\n");
}

/** The description without an AI: the tags of what was liked and saved, most often first (and what was rejected). */
export function fallbackTaste(current: Taste, signals: Signal[]): Update {
  const count = (kind: Signal["kind"][]) => {
    const m = new Map<string, number>();
    for (const s of signals.filter((x) => kind.includes(x.kind))) for (const t of s.tags) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  };
  const liked = [...new Set([...count(["like", "save"]), ...current.likes])].slice(0, 12);
  const avoid = [...new Set([...count(["dislike"]), ...current.avoids])].slice(0, 8);
  const text = [liked.length ? `Du liest gern über ${liked.slice(0, 8).join(", ")}.` : "", avoid.length ? `Eher nicht: ${avoid.slice(0, 5).join(", ")}.` : ""].filter(Boolean).join(" ");
  return { description: current.edited && current.text ? `${current.text}${liked.length ? ` Außerdem: ${liked.slice(0, 5).join(", ")}.` : ""}`.slice(0, 900) : text, likes: liked, avoids: avoid, queries: liked.slice(0, 6) };
}

export type TasteDeps = { ask?: (prompt: string) => Promise<Update>; profile?: () => Promise<string[]> | string[]; batch?: number; now?: () => number };

let updating = false;
export const isUpdatingTaste = () => updating;

/** Feeds the queued signals (up to `batch` at a time) to the AI with the current description, and keeps what comes back. Returns how many signals were taken in. */
export async function updateTaste(deps: TasteDeps = {}): Promise<number> {
  if (updating) return 0;
  const cur = getTaste();
  const batch = cur.pending.slice(0, deps.batch ?? 12);
  if (!batch.length) return 0;
  updating = true;
  try {
    const profile = await (deps.profile ?? (async () => (await import("./similar")).profileLines("")))();
    let out: Update | null = null;
    try {
      const ask =
        deps.ask ??
        (await (async () => {
          const { isInstalled } = await import("@/plugins/state");
          if (!isInstalled("llm")) return null;
          const { runAi } = await import("@/lib/ai");
          return async (prompt: string) => (await runAi<Update>(prompt, SCHEMA, { task: "news-digest", timeoutMs: 3 * 60000, maxBudgetUsd: 0.2 })).output;
        })());
      if (ask) out = await ask(tastePrompt(cur, batch, profile));
    } catch {
      out = null;
    }
    const clean = (l: unknown, n: number) => [...new Set((Array.isArray(l) ? l : []).filter((x): x is string => typeof x === "string").map((x) => x.replace(/\s+/g, " ").trim()).filter((x) => x.length >= 2 && x.length <= 60))].slice(0, n);
    const next = out?.description && out.description.trim().length >= 20 ? out : fallbackTaste(cur, batch);
    setTaste({
      text: String(next.description ?? cur.text).trim().slice(0, 1200),
      likes: clean(next.likes, 12),
      avoids: clean(next.avoids, 8),
      queries: clean(next.queries, 6),
      updatedAt: new Date((deps.now ?? Date.now)()).toISOString(),
      // The batch is taken in; signals that came meanwhile stay queued.
      pending: getTaste().pending.filter((p) => !batch.some((b) => b.id === p.id && b.kind === p.kind)),
      edited: false,
    });
    return batch.length;
  } finally {
    updating = false;
  }
}

/** A like or save: the update runs half a minute later (a burst of them becomes one call). */
const g = globalThis as { __zeffTasteTimer?: ReturnType<typeof setTimeout> };
export function scheduleTasteUpdate(ms = 30_000): void {
  if (g.__zeffTasteTimer) clearTimeout(g.__zeffTasteTimer);
  g.__zeffTasteTimer = setTimeout(() => {
    g.__zeffTasteTimer = undefined;
    void updateTaste().catch(() => undefined);
  }, ms);
  g.__zeffTasteTimer.unref?.();
}

/** The first time: what was liked and saved before this existed becomes the first signals. */
export function seedFromHistory(limit = 24): number {
  const t = getTaste();
  if (t.text || t.pending.length) return 0;
  const signals = tasteSignals(limit);
  if (signals.length) setTaste({ pending: signals });
  return signals.length;
}

/** Items scored against the description: closeness (TF-IDF) to it, the terms you like in them, the ones you avoid against them. Pure. */
export function matchTaste(taste: Pick<Taste, "text" | "likes" | "avoids">, items: { id: number; title: string; summary: string; terms?: string[] }[]): { id: number; score: number }[] {
  if (!items.length || !(taste.text || taste.likes.length)) return [];
  const docs = [{ id: -1, title: taste.likes.join(" "), summary: taste.text }, ...items.map((i) => ({ id: i.id, title: i.title, summary: i.summary }))];
  const a = analyze(docs);
  const target = a.vectors.get(-1) ?? new Map();
  const likes = taste.likes.map((l) => l.toLowerCase()).filter((l) => l.length >= 3);
  const avoids = taste.avoids.map((l) => l.toLowerCase()).filter((l) => l.length >= 3);
  return items
    .map((i) => {
      const text = `${i.title} ${i.summary} ${(i.terms ?? []).join(" ")}`.toLowerCase();
      let s = cosine(a.vectors.get(i.id) ?? new Map(), target);
      let hits = 0;
      for (const l of likes) if (text.includes(l)) hits++;
      s += Math.min(0.2, hits * 0.05) * (hits >= 2 ? 1 : 0.5);
      for (const l of avoids) if (text.includes(l)) s -= 0.15;
      return { id: i.id, score: s };
    })
    .sort((x, y) => y.score - x.score);
}

export const tasteReady = () => {
  const t = getTaste();
  return !!(t.text || t.likes.length || getPrefs().interests.length);
};
