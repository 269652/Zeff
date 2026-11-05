import { promptText } from "@/lib/prompts";
import { bumpFunnel, clearStale, funnelCandidates, getPrefs, setGate, tasteSignals } from "./store";

/**
 * The funnel: thousands of headlines come in a day, a few dozen are worth your time. The scoring (interests, what you liked,
 * your sources, freshness) puts the best first; then — if you switch it on — an agent (the AI) reads the best new ones like
 * an editor who knows you: your written taste, your interests, what you liked and rejected, what Zeff knows about you. It
 * lets through what interests you (pass), marks what is important (top: a big event or something that concerns you) and
 * filters out the rest (drop), each with a short why. For you then shows only what it let through; what it filtered out
 * stays a day in its own view, so you can see what it does — a 👍 there teaches it.
 */

/** Its instructions — a page of System → Prompts. */
export const FUNNEL_INSTRUCTIONS = "Du bist der Nachrichten-Filter einer Person: Du siehst die neuen Meldungen, bevor sie sie sieht, und lässt nur durch, was sie wirklich interessiert — wie eine Redakteurin, die sie gut kennt.\nEntscheide für jede nummerierte Meldung:\n- top: wichtig — ein großes Ereignis, das man heute kennen sollte (auch außerhalb ihrer Interessen), oder etwas, das sie direkt betrifft (ihre Arbeit, ihre Themen, ihr Umfeld). Selten: höchstens jede zehnte Meldung.\n- pass: passt zu dem, was sie gern liest (Geschmack, Interessen, was sie gemocht hat), oder ist ungewöhnlich lesenswert.\n- drop: alles andere — Routine, Klatsch, Füllstoff, Ratgeber, Werbung, Themen, die sie meidet, das Zweite über dasselbe Ereignis.\nSei wählerisch, aber verliere nichts, was klar zu ihren Interessen passt: im Zweifel bei einem ihrer Themen durchlassen, bei allem anderen filtern.\nwhy: ein kurzer Satz (höchstens 12 Wörter) auf Deutsch — bei pass und top so, dass sie sieht, was es mit ihr zu tun hat; bei drop, warum nicht.\nNutze nur, was unten steht. Gib für jede Nummer genau einen Eintrag.";

type Verdict = { n?: number; verdict?: unknown; why?: unknown };
type Answer = { items?: Verdict[] };

const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          n: { type: "integer" },
          verdict: { type: "string", enum: ["top", "pass", "drop"] },
          why: { type: "string", description: "Ein kurzer Satz, höchstens 12 Wörter." },
        },
        required: ["n", "verdict", "why"],
      },
    },
  },
  required: ["items"],
};

export type FunnelContext = { taste: string; likes: string[]; avoids: string[]; profile: string[]; liked: string[]; disliked: string[] };

export function funnelPrompt(ctx: FunnelContext, items: { n: number; source: string; title: string; summary: string }[]): string {
  return [
    promptText("news-funnel", FUNNEL_INSTRUCTIONS),
    "",
    `Ihr Geschmack: ${ctx.taste || "(noch nicht beschrieben)"}`,
    ...(ctx.likes.length ? [`Mag: ${ctx.likes.join(", ")}`] : []),
    ...(ctx.avoids.length ? [`Meidet: ${ctx.avoids.join(", ")}`] : []),
    ...ctx.profile,
    ...(ctx.liked.length ? ["Zuletzt gemocht oder gemerkt:", ...ctx.liked.map((t) => `- ${t}`)] : []),
    ...(ctx.disliked.length ? ["Zuletzt abgelehnt:", ...ctx.disliked.map((t) => `- ${t}`)] : []),
    "",
    "Neue Meldungen:",
    ...items.map((i) => `${i.n}. [${i.source}] ${i.title}${i.summary ? ` — ${i.summary.replace(/\s+/g, " ").slice(0, 200)}` : ""}`),
  ].join("\n");
}

/** What the agent goes on: the taste description, its terms, what Zeff knows about you, what you liked and rejected lately. */
async function context(): Promise<FunnelContext> {
  const { getTaste } = await import("./taste");
  const taste = getTaste();
  let profile: string[] = [];
  try {
    profile = await (await import("./similar")).profileLines("");
  } catch {
    // the profile is a bonus
  }
  const signals = tasteSignals(30);
  return {
    taste: taste.text,
    likes: taste.likes,
    avoids: taste.avoids,
    profile,
    liked: signals.filter((s) => s.kind !== "dislike").slice(0, 12).map((s) => s.title),
    disliked: signals.filter((s) => s.kind === "dislike").slice(0, 8).map((s) => s.title),
  };
}

/** How far the agent is with what was waiting when it started: what the button shows, and what became of it. */
export type FunnelProgress = { running: boolean; judged: number; passed: number; top: number; dropped: number; total: number; error: string };

const g = globalThis as { __zeffFunnelRunning?: boolean; __zeffFunnelProgress?: FunnelProgress };
const idle: FunnelProgress = { running: false, judged: 0, passed: 0, top: 0, dropped: 0, total: 0, error: "" };
export const funnelProgress = (): FunnelProgress => g.__zeffFunnelProgress ?? idle;

/**
 * One round of the agent: the best items it hasn't looked at yet go to the AI, its verdicts are kept. Returns what it
 * decided. `ask` is the AI call (tests give their own); without the LLM plugin or with the funnel off nothing happens.
 */
export async function runFunnel(deps: { ask?: (prompt: string) => Promise<Answer>; context?: () => Promise<FunnelContext> | FunnelContext; size?: number; nowMs?: number } = {}): Promise<{ judged: number; passed: number; top: number; dropped: number }> {
  const none = { judged: 0, passed: 0, top: 0, dropped: 0 };
  const prefs = getPrefs();
  if (!prefs.funnel || g.__zeffFunnelRunning) return none;
  // Stale headlines go first: they wouldn't be shown any more, so nobody pays for reading them.
  const cleared = clearStale(deps.nowMs);
  if (cleared) bumpFunnel({ cleared }, deps.nowMs);
  if (!deps.ask) {
    const { isInstalled } = await import("@/plugins/state");
    if (!isInstalled("llm")) return none;
  }
  const items = funnelCandidates(Math.max(5, Math.min(150, deps.size ?? prefs.funnelBatch)), deps.nowMs);
  if (!items.length) return none;
  g.__zeffFunnelRunning = true;
  try {
    const ask =
      deps.ask ??
      (async (prompt: string) => {
        const { runAi } = await import("@/lib/ai");
        return (await runAi<Answer>(prompt, SCHEMA, { task: "news-funnel", timeoutMs: 5 * 60000, maxBudgetUsd: 0.4 })).output;
      });
    const ctx = await (deps.context ?? context)();
    const answer = await ask(funnelPrompt(ctx, items.map((it, i) => ({ n: i + 1, source: it.sourceName, title: it.title, summary: it.summary }))));
    const seen = new Set<number>();
    const entries = (answer.items ?? []).flatMap((a) => {
      const it = items[(Number(a.n) || 0) - 1];
      const gate: "top" | "pass" | "drop" | null = a.verdict === "top" || a.verdict === "pass" || a.verdict === "drop" ? a.verdict : null;
      if (!it || !gate || seen.has(it.id)) return [];
      seen.add(it.id);
      return [{ id: it.id, gate, why: typeof a.why === "string" ? a.why.replace(/\s+/g, " ").trim() : "" }];
    });
    // An item the answer left out is looked at again next round (it stays as it was).
    setGate(entries, deps.nowMs);
    const out = { judged: entries.length, passed: entries.filter((e) => e.gate === "pass").length, top: entries.filter((e) => e.gate === "top").length, dropped: entries.filter((e) => e.gate === "drop").length };
    bumpFunnel(out, deps.nowMs);
    return out;
  } finally {
    g.__zeffFunnelRunning = false;
  }
}

/** Rounds one after the other until nothing is left to read (or `max` rounds): a backlog of hundreds is worked off, not one batch at a time. */
export async function runFunnelRounds(max = 10, deps: Parameters<typeof runFunnel>[0] = {}, onRound?: (total: { judged: number; passed: number; top: number; dropped: number }) => void): Promise<{ judged: number; passed: number; top: number; dropped: number }> {
  const total = { judged: 0, passed: 0, top: 0, dropped: 0 };
  for (let i = 0; i < max; i++) {
    const r = await runFunnel(deps);
    if (!r.judged) break;
    total.judged += r.judged;
    total.passed += r.passed;
    total.top += r.top;
    total.dropped += r.dropped;
    onRound?.(total);
  }
  return total;
}

/** A run started by hand (the page's "Let the agent look now"): in the background, `funnelProgress` says how far it is and how it ended. */
export function startFunnel(deps: Parameters<typeof runFunnel>[0] = {}): boolean {
  if (g.__zeffFunnelRunning || funnelProgress().running || !getPrefs().funnel) return false;
  g.__zeffFunnelProgress = { ...idle, running: true, total: funnelCandidates(1000, deps.nowMs).length };
  const update = (patch: Partial<FunnelProgress>) => (g.__zeffFunnelProgress = { ...funnelProgress(), ...patch });
  void runFunnelRounds(10, deps, (total) => update(total))
    .then((total) => update({ ...total, running: false }))
    .catch((e) => update({ running: false, error: e instanceof Error ? e.message : String(e) }));
  return true;
}
