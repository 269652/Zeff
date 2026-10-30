import { redirect } from "next/navigation";

/** A page that moved: its old address leads to the new one, with the query it was called with (and a section's anchor). */
export async function moved(to: string, searchParams?: Promise<Record<string, string | string[] | undefined>>, hash?: string): Promise<never> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries((await searchParams) ?? {})) for (const x of [v ?? []].flat()) q.append(k, x);
  const query = q.toString();
  redirect(`${to}${query ? `?${query}` : ""}${hash ? `#${hash}` : ""}`);
}
