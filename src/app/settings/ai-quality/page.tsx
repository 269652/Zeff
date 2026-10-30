import { moved } from "@/lib/moved";

/** AI quality is a part of the AI settings now (/settings/ai#ai-quality). */
export default async function AiQualityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return moved("/settings/ai", searchParams, "ai-quality");
}
