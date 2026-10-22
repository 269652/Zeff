import { aiQualityView } from "@/lib/learning";

/**
 * GET /api/ai-quality[?step=mail-review] — how useful each AI step is, from the user's decisions (read-only, JSON): per
 * step the acceptance over 7/30/90 days, volume and trend, the most rejected patterns, the learned rules.
 */
export async function GET(req: Request) {
  const step = new URL(req.url).searchParams.get("step")?.trim() || undefined;
  return Response.json(aiQualityView({ step }));
}
