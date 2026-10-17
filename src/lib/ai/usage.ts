import { getSqlite } from "@/db";
import { getPref, setPref } from "@/lib/prefs";
import type { AiAnswer, AiUsage } from "./shared";

/**
 * What the AI costs: every answer of the LLM layer is written down - when, which task, backend and model, its tokens and its cost.
 * The cost is the one the CLI reports (Claude does); else it is worked out from the tokens with the prices you keep (per million
 * tokens, a line "model in out") and marked as an estimate; with neither it stays unknown - a subscription has no price per token. Server only.
 */

const PRICES = "ai.prices";

function table() {
  const sqlite = getSqlite();
  sqlite.exec("create table if not exists ai_usage (id integer primary key autoincrement, at text not null, task text not null, provider text not null, model text not null, input integer not null default 0, output integer not null default 0, cache_read integer not null default 0, cache_write integer not null default 0, cost real, estimated integer not null default 0, ms integer)");
  sqlite.exec("create index if not exists ai_usage_at on ai_usage (at)");
  return sqlite;
}

export type Price = { model: string; inPerM: number; outPerM: number };

/** The prices as lines "model in out" (dollars per million tokens); a line that is none is ignored. */
export function parsePrices(text: string): Price[] {
  return text
    .split("\n")
    .map((l) => /^\s*(\S+)\s+(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)\s*$/.exec(l))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ model: m[1], inPerM: Number(m[2].replace(",", ".")), outPerM: Number(m[3].replace(",", ".")) }));
}
export const pricesText = (): string => getPref<string>(PRICES, "");
export const setPricesText = (text: string): void => setPref(PRICES, text.slice(0, 4000));

/** The cost of an answer: reported, else tokens x the model's price (a price for a model's name or for the start of it). */
export function costOf(model: string, usage: AiUsage | undefined, reported: number | null | undefined, prices: Price[] = parsePrices(pricesText())): { cost: number | null; estimated: boolean } {
  if (typeof reported === "number") return { cost: reported, estimated: false };
  const price = usage ? prices.find((p) => model === p.model || model.startsWith(p.model)) : undefined;
  if (!usage || !price) return { cost: null, estimated: false };
  return { cost: (usage.input / 1e6) * price.inPerM + (usage.output / 1e6) * price.outPerM, estimated: true };
}

/** An answer written down (never fails the call). */
export function recordUsage(task: string, provider: string, model: string | undefined, answer: AiAnswer<unknown>): void {
  try {
    const name = answer.model ?? model ?? "";
    const u = answer.usage;
    const { cost, estimated } = costOf(name, u, answer.costUsd);
    table()
      .prepare("insert into ai_usage (at, task, provider, model, input, output, cache_read, cache_write, cost, estimated, ms) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(new Date().toISOString(), task, provider, name, u?.input ?? 0, u?.output ?? 0, u?.cacheRead ?? 0, u?.cacheWrite ?? 0, cost, estimated ? 1 : 0, answer.durationMs);
  } catch {
    // The count never stops an answer.
  }
}

export type UsageGroup = { key: string; calls: number; input: number; output: number; cost: number; unknownCost: number };
export type UsageSummary = { days: number; total: UsageGroup; byDay: UsageGroup[]; byTask: UsageGroup[]; byModel: UsageGroup[]; estimated: boolean };

export function usageSummary(days = 30): UsageSummary {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const rows = table().prepare("select at, task, model, provider, input, output, cost, estimated from ai_usage where at >= ? order by at").all(since) as { at: string; task: string; model: string; provider: string; input: number; output: number; cost: number | null; estimated: number }[];
  const group = (key: (r: (typeof rows)[number]) => string): UsageGroup[] => {
    const m = new Map<string, UsageGroup>();
    for (const r of rows) {
      const k = key(r);
      const g = m.get(k) ?? { key: k, calls: 0, input: 0, output: 0, cost: 0, unknownCost: 0 };
      g.calls++;
      g.input += r.input;
      g.output += r.output;
      if (r.cost === null) g.unknownCost++;
      else g.cost += r.cost;
      m.set(k, g);
    }
    return [...m.values()];
  };
  const total = group(() => "total")[0] ?? { key: "total", calls: 0, input: 0, output: 0, cost: 0, unknownCost: 0 };
  return {
    days,
    total,
    byDay: group((r) => r.at.slice(0, 10)),
    byTask: group((r) => r.task).sort((a, b) => b.cost - a.cost || b.calls - a.calls),
    byModel: group((r) => r.model || r.provider).sort((a, b) => b.cost - a.cost || b.calls - a.calls),
    estimated: rows.some((r) => r.estimated === 1),
  };
}
