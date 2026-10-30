import { moved } from "@/lib/moved";

/** The LLM settings are a part of the AI settings now (/settings/ai#backends). */
export default async function LlmPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return moved("/settings/ai", searchParams, "backends");
}
