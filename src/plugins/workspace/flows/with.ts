/** Client-safe. */

/** A button's or <data>'s with="q=Dune, n=5" (or a JSON object) as the flow's input. */
export function parseWith(src: string | undefined): Record<string, unknown> {
  const s = (src ?? "").trim();
  if (!s) return {};
  if (s.startsWith("{")) {
    try {
      const o = JSON.parse(s) as unknown;
      return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  // (A comma only separates where a new name= follows: a value may hold commas.)
  return Object.fromEntries(
    s
      .split(/,\s*(?=[\p{L}_][\p{L}\p{N}_.-]*\s*=)/u)
      .map((part) => {
        const i = part.indexOf("=");
        return i > 0 ? [part.slice(0, i).trim(), part.slice(i + 1).trim()] : [part.trim(), ""];
      })
      .filter(([k]) => !!k),
  );
}

