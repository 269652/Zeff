import { moved } from "@/lib/moved";

/** The prompts are a part of the AI settings now (/settings/ai#prompts) — with the query (?zeit, the branch naming's ?todo). */
export default async function PromptsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return moved("/settings/ai", searchParams, "prompts");
}
