/**
 * The teacher's tools over the MCP (a lesson's live Claude session gets them — teacher.ts LEARN_TOOLS): the course's
 * and the step's context, a widget for the lesson, a step mastered, cards to review, the progress. There while the
 * Learn plugin is installed. Server only.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { isInstalled } from "@/plugins/state";
import * as t from "./tools";

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };
type Helpers = { run: (fn: () => Promise<Result> | Result) => Promise<Result>; ok: (text: string) => Result; fail: (text: string) => Result };

const NOT_INSTALLED = "The Learn plugin is not installed in Zeff (Menu → Plugins) — this tool isn't available.";

export function registerLearnTools(server: McpServer, { run, ok, fail }: Helpers): void {
  const ids = { course_id: z.number().int().describe("The course's id (in your rules)"), node_key: z.string().describe("The step's key (in your rules)") };
  const tool = <S extends z.ZodRawShape>(name: string, title: string, description: string, shape: S, readOnly: boolean, fn: (a: z.infer<z.ZodObject<S>>) => string) =>
    server.registerTool(name, { title, description, inputSchema: z.object(shape), annotations: { readOnlyHint: readOnly } }, async (args: unknown) =>
      run(async () => {
        if (!isInstalled("learn")) return fail(NOT_INSTALLED);
        try {
          return ok(fn(args as z.infer<z.ZodObject<S>>));
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      }),
    );

  tool("learn_context", "Learn: the course and the step", "The course's progress and, with node_key, the step: its objectives, what it requires (and whether that's mastered), the widgets made for it with their best results, what was mastered lately.", { course_id: ids.course_id, node_key: ids.node_key.optional() }, true, t.learnContext);
  tool(
    "learn_widget",
    "Learn: show a widget in the lesson",
    "An interactive widget for the lesson, shown at once. Best: `spec`, an exercise set the built-in kit renders with instant feedback, hints, a second try, a summary and the report — { title, intro?, items: [...] } with item types choice, number (tolerance, units), text, formula (compared as functions), cloze, order, match, categorize, hotspot (tap on a picture), slider, code (JavaScript with tests), table, plot (sliders, match a curve), scenario (decision path), cards. Mistakes in a set come back as an error listing each — fix and send again. Or `html`: a widget of your own (a simulation, a 3D model) — a complete HTML fragment with its <script>; ZeffKit (mount, fmt, check.*, expr, plot) is there too. Sandboxed: no network; only the libraries in libs (katex, jsxgraph, three, chart). A widget of your own reports with zeff.report({ score: 0..1, correct, total, answers, done }).",
    {
      ...ids,
      title: z.string(),
      spec: z.record(z.string(), z.unknown()).optional().describe("An exercise set: { title, intro?, items: [{ type, q, … }], lang?, tries?, pass? } — see the teacher's rules for each type"),
      html: z.string().optional().describe("A widget of your own: HTML with inline <script> and <style>"),
      libs: z.array(z.enum(["katex", "jsxgraph", "three", "chart"])).optional(),
    },
    false,
    t.learnWidget,
  );
  tool("learn_master_step", "Learn: the step is mastered", "Mark the lesson's step mastered — when the person has shown the objectives (not just read about them). Gives the experience of the step and of all it completes; unlocks what requires it.", { ...ids, evidence: z.string().optional().describe("What showed it (3 of 3 tasks right …)") }, false, t.learnMasterStep);
  tool("learn_add_cards", "Learn: cards to review", "Cards for spaced repetition (a front with a question, a back with the answer; LaTeX in $…$). They come back when they're due, as a todo.", { ...ids, cards: z.array(z.object({ front: z.string(), back: z.string() })).max(30) }, false, t.learnAddCards);
  tool("learn_progress", "Learn: progress and what's next", "The person's level, experience, streak, today's goal, progress per path, and the next steps.", { course_id: ids.course_id }, true, t.learnProgress);
}
