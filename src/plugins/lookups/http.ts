/** What the sources share: a JSON request that says what went wrong, without the address (it can hold a key). Server only. */

export async function getJson<T>(url: string, who: string, headers: Record<string, string> = {}): Promise<T> {
  const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "Zeff/0.1 (personal app; https://getzeff.com)", ...headers }, signal: AbortSignal.timeout(8000) }).catch((e: unknown) => {
    throw new Error(`${who}: ${e instanceof Error && e.name === "TimeoutError" ? "no answer" : "not reachable"}`);
  });
  const data = (await r.json().catch(() => null)) as { status_message?: string; error?: { message?: string } | string } | null;
  if (!r.ok) throw new Error(`${who}: ${data?.status_message ?? (typeof data?.error === "object" ? data.error?.message : data?.error) ?? r.status}`);
  return data as T;
}

export const short = (s: unknown, max: number): string => {
  const text = String(s ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/** "2021-09-16" → "2021". */
export const year = (date: unknown): string => /^\d{4}/.exec(String(date ?? ""))?.[0] ?? "";

/** "de-DE" → "de"; anything else, English: it goes into addresses. */
export const language2 = (language: string): string => /^[a-z]{2,3}(?=$|-)/.exec(language)?.[0] ?? "en";
