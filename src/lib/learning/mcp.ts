import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

type Helpers = {
  run: (fn: () => unknown) => Promise<never>;
  ok: (text: string) => never;
  fail: (text: string) => never;
};

/**
 * The learning loop's MCP tool — ai_quality, read-only: how often the user accepts each AI step's proposals (7/30/90 days,
 * volume, trend), the most rejected patterns and the learned rules. For agents and evals that want to know which step is
 * worth trusting; `json` gives the raw numbers.
 */
export function registerAiQualityTool(server: McpServer, h: Helpers): void {
  server.registerTool(
    "ai_quality",
    {
      title: "AI quality per step",
      description:
        "How useful each of Zeff's AI steps is, counted from the user's own decisions (no AI): per step (booking suggestions, mail review, note review, " +
        "people claims, auto actions, AI fields …) the acceptance rate over 7, 30 and 90 days — accepted ÷ (accepted + rejected + edited), – below 3 " +
        "decisions —, the number of decisions, the trend (last 30 days vs the 30 before), the most rejected patterns (same sender + kind) and the learned rules. Read-only.",
      inputSchema: z.object({
        step: z.string().optional().describe("Only this step (e.g. 'mail-review', 'booking', 'people-claim')."),
        json: z.boolean().optional().describe("The raw report as JSON instead of a table."),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ step, json }) =>
      h.run(async () => {
        const { aiQualityText, aiQualityView } = await import("./index");
        const v = aiQualityView({ step });
        return h.ok(json ? JSON.stringify(v, null, 2) : aiQualityText(v));
      }),
  );
}
