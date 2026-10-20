/** Small helpers the plugins' widgets share (server): a name as initials for the row's avatar, a text cut to length. */

/** "Anna Schmidt <anna@x.de>" → "AS"; "netzpolitik.org" → "NE"; nothing usable → "". */
export function initials(name: string | null | undefined): string {
  const s = String(name ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/["“”]/g, "")
    .trim();
  const words = s.split(/[\s._@-]+/).filter((w) => /^[\p{L}]/u.test(w));
  if (!words.length) return "";
  const two = words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2);
  return two.toLocaleUpperCase("de").replace(/[^A-ZÄÖÜ]/g, "").slice(0, 2);
}

export const clip = (s: string | null | undefined, n: number) => {
  const v = (s ?? "").replace(/\s+/g, " ").trim();
  return v.length > n ? `${v.slice(0, n - 1)}…` : v;
};
