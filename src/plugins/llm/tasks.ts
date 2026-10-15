/**
 * The LLM plugin's tasks — what Zeff has an AI do, as building blocks the other plugins call:
 * each its own backend and model (or the default), all with your instructions and context.
 * Client-safe.
 */
import { translator, type T } from "@/lib/i18n/shared";
import { pluginById, type PluginId } from "@/plugins/catalog";
import { LLM_TASK_LISTS } from "@/plugins/llm-tasks.generated";

/** The ids of all tasks (known to the compiler from the plugins' lists). */
export type LlmTaskId = ReturnType<(typeof LLM_TASK_LISTS)[number]>[number]["id"];

/** What a plugin says of a task it has Zeff run. */
export type LlmTaskDecl = { plugin: PluginId; id: LlmTaskId; label: string; what: string; idempotent?: true };

/**
 * The tasks — their names and what each does in the language of `t` (English without). Every plugin
 * brings its own (`export const <NAME>_LLM_TASKS` in a file of its folder, found by `npm run plugins:index`),
 * in the order of the plugins.
 */
export const llmTasks = (t: T = translator("en")): readonly LlmTaskDecl[] =>
  (LLM_TASK_LISTS as readonly ((t: T) => readonly LlmTaskDecl[])[])
    .flatMap((list) => list(t))
    .map((task, i) => ({ task, i, rank: pluginById(task.plugin)?.order ?? 1e6 }))
    .sort((x, y) => x.rank - y.rank || x.i - y.i)
    .map((x) => x.task);
export const LLM_TASKS = llmTasks();

/**
 * The tasks where identical input must give an equal answer (a repeat within minutes is answered
 * from memory, see run.ts). Never the reviews of mail, notes and documents, nor anything where a
 * second look may find more.
 */
export const IDEMPOTENT_TASKS: ReadonlySet<LlmTaskId> = new Set(LLM_TASKS.filter((t) => "idempotent" in t).map((t) => t.id));
export const isLlmTask = (v: unknown): v is LlmTaskId => LLM_TASKS.some((t) => t.id === v);

/** A task's own backend and model ("" = the default). */
export type LlmTaskSetting = { provider?: "" | "copilot" | "claude" | "codex"; model?: string };

export type LlmSettings = {
  /** What goes with every prompt and to every agent: how to work, what never to do. */
  instructions: string;
  /** Who you are, what you work on — the background every task gets. */
  context: string;
  tasks: Partial<Record<LlmTaskId, LlmTaskSetting>>;
};

export const EMPTY_LLM_SETTINGS: LlmSettings = { instructions: "", context: "", tasks: {} };

/** At most this much of instructions and context goes with a prompt (Copilot takes it on the command line). */
export const LLM_PREAMBLE_MAX = 2500;
