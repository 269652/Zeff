/**
 * The kernel's services filled by external plugins (`contributes.services`, KERNEL_SERVICES in lib/kernel/contract.ts): a place of a
 * fixed shape — web.search — that the rest of Zeff calls the same way whoever answers. The first plugin that is on and fills it answers,
 * through its lambda; the answer is checked against the shape. Server only.
 */
import { enabledPlugins } from "@/lib/ext/registry";
import type { KernelService } from "@/lib/kernel/contract";
import { runOwnLambda } from "./mcp-plugin-tools";

/** Who fills a service now: the plugin and its lambda (none: undefined). */
export function serviceProvider(name: KernelService): { plugin: string; name: string; lambda: string } | undefined {
  for (const p of enabledPlugins()) {
    const s = p.manifest.contributes.services?.find((x) => x.name === name);
    if (s) return { plugin: p.id, name: p.manifest.name, lambda: s.lambda };
  }
  return undefined;
}

const clean = (s: unknown, max: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const web = (u: unknown): string | null => {
  try {
    const url = new URL(String(u));
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
};

/** Each service's answer, checked against its shape. */
const SHAPES: Record<KernelService, (v: unknown) => unknown> = {
  "web.search": (v) => {
    const hits = (v as { hits?: unknown })?.hits;
    if (!Array.isArray(hits)) throw new Error("The web search answered without hits.");
    return {
      hits: hits.slice(0, 10).flatMap((h) => {
        const o = h && typeof h === "object" ? (h as Record<string, unknown>) : {};
        const url = web(o.url);
        return url ? [{ title: clean(o.title, 200), url, snippet: clean(o.snippet, 500) }] : [];
      }),
    };
  },
};

/** A service answered by the plugin that fills it; undefined: none does. */
export async function runService(name: KernelService, input: Record<string, unknown>): Promise<unknown> {
  const p = serviceProvider(name);
  if (!p) return undefined;
  return SHAPES[name](await runOwnLambda(p.plugin, p.lambda, input));
}
