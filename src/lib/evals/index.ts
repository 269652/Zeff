/**
 * The AI steps the eval harness knows (npm run eval -- <step>). A new one: an adapter in adapters/ (build its cases
 * from your decisions, run its prompt builder, say which items an answer covers), added here, a line in docs/evals.md.
 */
import type { EvalAdapter } from "./harness";
import { autoActionsAdapter } from "./adapters/auto-actions";
import { mailAdapter } from "./adapters/mail";
import { notesAdapter } from "./adapters/notes";
import { peopleAdapter } from "./adapters/people";

export const EVAL_ADAPTERS: EvalAdapter<never>[] = [mailAdapter, notesAdapter, peopleAdapter, autoActionsAdapter] as unknown as EvalAdapter<never>[];

export const evalAdapter = (step: string): EvalAdapter<never> | undefined => EVAL_ADAPTERS.find((a) => a.step === step);
