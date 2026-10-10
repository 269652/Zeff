import type { AiAnswer } from "@/lib/ai/shared";
import { runClaude } from "@/plugins/claude-cli/cli";
import { runCopilot } from "@/plugins/copilot-cli/cli";
import { getSettings } from "./db";
import { installedBackends, type AiBackend } from "./plugins";

/**
 * The AI for a task — compiling pages, answering — through the backend set for it (an installed
 * plugin: Copilot CLI or Claude CLI; when that one isn't installed, the first that is) and its
 * model. A model the backend doesn't have (any more): the backend's default.
 */
export type AiTask = "compile" | "ask";

export function backendFor(task: AiTask): { backend: AiBackend; model: string } {
  const s = getSettings();
  const want = task === "compile" ? s.compileBackend : s.askBackend;
  const there = installedBackends();
  if (!there.length) throw new Error("Kein KI-Backend installiert (Plugins: Copilot CLI oder Claude CLI).");
  const backend = there.includes(want) ? want : there[0];
  // The model set is for the backend set — another backend: its default.
  return { backend, model: backend === want ? (task === "compile" ? s.compileModel : s.askModel) : "" };
}

const run = <T>(backend: AiBackend, prompt: string, schema: object, model: string | undefined, timeoutMs: number) =>
  backend === "claude" ? runClaude<T>(prompt, schema, { model, timeoutMs }) : runCopilot<T>(prompt, schema, { model, timeoutMs });

export async function ai<T>(task: AiTask, prompt: string, schema: object, opts: { timeoutMs?: number } = {}): Promise<AiAnswer<T>> {
  const { backend, model } = backendFor(task);
  const timeoutMs = opts.timeoutMs ?? 300000;
  try {
    return await run<T>(backend, prompt, schema, model || undefined, timeoutMs);
  } catch (e) {
    if (model && /not available|unknown model|invalid model|model.*not found/i.test(e instanceof Error ? e.message : String(e))) {
      console.warn(`[knowledge] ${backend}: Modell ${model} nicht verfügbar — Standard des Backends.`);
      return run<T>(backend, prompt, schema, undefined, timeoutMs);
    }
    throw e;
  }
}
