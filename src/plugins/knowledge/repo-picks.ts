import type { RepoPick } from "./repo-systems-store";

/** What the knowledge holds about a project for the picking stage: a page, its abstract and the lines that carry a web address. */
export type PickSource = { title: string; space: string; summary: string | null; lines: string[] };

export const PICK_SCHEMA = {
  type: "object",
  properties: {
    systems: {
      type: "array",
      items: {
        type: "object",
        properties: {
          env: { type: "string", enum: ["prod", "test", "dev", "other"] },
          label: { type: "string" },
          url: { type: "string" },
          sure: { type: "boolean" },
        },
        required: ["env", "label", "url", "sure"],
      },
    },
  },
  required: ["systems"],
};

/** Lines that say which system an address is (Prod, Staging, Test, Dev, local, backend …) — they go first when a page has more lines than fit. */
const ENV_LINE = /\b(prod\w*|live|stag(e|ing)|test\w*|abnahme|integration|int|dev\w*|local\w*|qa|preview|backend|cms|typo3|solr|mailpit|mailhog|api|admin|www)\b/i;
export const prioritizeLines = (lines: string[]): string[] => [...lines.filter((l) => ENV_LINE.test(l)), ...lines.filter((l) => !ENV_LINE.test(l))];

const URL_RE = /https?:\/\/[^\s)\]>"'|<]+/g;
const trimUrl = (u: string) => u.replace(/[.,;:!?]+$/, "");
const norm = (u: string) => trimUrl(u).replace(/\/+$/, "").toLowerCase();

/**
 * The picks as the AI answered them, kept only where the address stands word for word in the sources
 * (nothing invented, nothing rewritten), once each, Prod first — then Test, Dev, the rest.
 */
export function verifyPicks(raw: unknown, sources: Pick<PickSource, "lines">[]): RepoPick[] {
  const known = new Map<string, string>();
  for (const s of sources) for (const l of s.lines) for (const m of l.match(URL_RE) ?? []) if (!known.has(norm(m))) known.set(norm(m), trimUrl(m));
  const list = (raw as { systems?: unknown } | null)?.systems;
  const out: RepoPick[] = [];
  const seen = new Set<string>();
  for (const x of Array.isArray(list) ? list : []) {
    if (!x || typeof x !== "object") continue;
    const p = x as Partial<RepoPick>;
    const url = typeof p.url === "string" ? known.get(norm(p.url)) : undefined;
    if (!url || seen.has(norm(url))) continue;
    seen.add(norm(url));
    out.push({ env: p.env === "prod" || p.env === "test" || p.env === "dev" ? p.env : "other", label: String(p.label ?? "").replace(/\s+/g, " ").trim().slice(0, 80), url, sure: p.sure !== false });
  }
  const order = { prod: 0, test: 1, dev: 2, other: 3 } as const;
  return out.sort((a, b) => order[a.env] - order[b.env]);
}

/** The Markdown table of the picked systems (a "?" marks the ones the AI wasn't sure about). */
export function systemsTable(picks: RepoPick[], head: { env: string; system: string; address: string }, envName: Record<RepoPick["env"], string>): string {
  if (!picks.length) return "";
  const cell = (s: string) => s.replace(/\|/g, "/");
  const rows = picks.map((p) => `| ${envName[p.env]} | ${cell(p.label || p.url)}${p.sure ? "" : " (?)"} | [${cell(p.url.replace(/^https?:\/\//, "").replace(/\/$/, ""))}](${p.url}) |`);
  return [`| ${head.env} | ${head.system} | ${head.address} |`, "|---|---|---|", ...rows].join("\n");
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s).replace(/\s+/g, " ");

/** One page of knowledge for a prompt: title, space, abstract, then its address lines — those saying which system it is first. */
export const sourceBlock = (p: PickSource, maxLines = 25): string =>
  [`### „${clip(p.title, 120)}“ (${p.space})`, p.summary ? `Abstract: ${clip(p.summary, 400)}` : "", ...prioritizeLines(p.lines).slice(0, maxLines).map((l) => `- ${clip(l, 220)}`)].filter(Boolean).join("\n");

/** As many of the sources as fit the budget (in the order they are given: the best first). */
export function fitSources(head: string, sources: PickSource[], budget: number, maxLines?: number): string[] {
  const blocks: string[] = [];
  let size = head.length;
  for (const p of sources) {
    const block = sourceBlock(p, maxLines);
    if (size + block.length > budget) break;
    blocks.push(block);
    size += block.length + 2;
  }
  return blocks;
}
