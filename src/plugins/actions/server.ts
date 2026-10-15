import "@/plugins/contributions";
import { setOpsDictionaryExtras } from "@/lib/boards/shared";
import { apiPoint } from "@/lib/plugins/api-point";
import type { ApiMethod } from "@/lib/plugins/api-kit";
import { setZeffDoCheck } from "./zeff-do";

/**
 * What the actions plugin registers on the server for "Do in Zeff" (actions/zeff-do.ts): the methods plugins offer
 * to the AI — read from the API registry's contributions, so an uninstalled plugin's methods are not offered —,
 * how an AI's proposal of one is checked, and the lines they add to the AI's dictionary. Loaded through plugins/contributions.
 */

/** The API methods the installed plugins offer to the AI, by name. */
export function offeredMethods(): Record<string, ApiMethod & { offer: NonNullable<ApiMethod["offer"]> }> {
  const out: Record<string, ApiMethod & { offer: NonNullable<ApiMethod["offer"]> }> = {};
  for (const c of apiPoint.list()) for (const [name, m] of Object.entries(c.impl.methods)) if (m.offer && !(name in out)) out[name] = m as ApiMethod & { offer: NonNullable<ApiMethod["offer"]> };
  return out;
}

setZeffDoCheck((method, raw) => {
  const m = offeredMethods()[method];
  if (!m) return null;
  const params = m.offer.check(raw);
  if (!params) return null;
  const d = m.offer.describe(params);
  // What the AI wrote (not the checked parameters) is kept: the run checks it again against what is offered then.
  return { args: raw, title: d.title, body: d.body ?? "" };
});

setOpsDictionaryExtras(() =>
  Object.entries(offeredMethods()).map(
    ([name, m]) =>
      `  · method „${name}“ — ${m.offer.label}: ${m.offer.when} args: ${Object.entries(m.offer.fields)
        .map(([k, d]) => `${k} (${d})`)
        .join(", ")}. Beispiel: ${JSON.stringify({ type: "zeff-do", method: name, args: JSON.stringify(m.offer.example) })}`,
  ),
);

/**
 * What exists now, for the AI that writes an action about a todo (and for agents over the MCP): the lines every offered
 * method's `context` gives for it — the current instructions, the boards, what the knowledge base says. A method whose
 * lookup fails adds nothing. Empty when nothing is offered or nothing is there.
 */
export async function offerContext(q: { ticket: string; text: string }): Promise<string[]> {
  const lists = await Promise.all(
    Object.entries(offeredMethods()).map(async ([name, m]) => {
      try {
        const lines = (await m.offer.context?.(q)) ?? [];
        return lines.length ? [`Für method „${name}“:`, ...lines.map((l) => `  ${l}`)] : [];
      } catch {
        return [];
      }
    }),
  );
  return lists.flat();
}
