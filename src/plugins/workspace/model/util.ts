/** The small readers the normalizers of the model share (a positive integer, a trimmed string, a list of ids), and new ids. */

export const posInt = (v: unknown): number | undefined => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
export const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
export const strs = (v: unknown): string[] | undefined => {
  const out = Array.isArray(v) ? v.map(str).filter((x): x is string => !!x) : [];
  return out.length ? out : undefined;
};
export const ids = (v: unknown): number[] | undefined => {
  const out = [...new Set((Array.isArray(v) ? v : []).map(posInt).filter((x): x is number => !!x))];
  return out.length ? out : undefined;
};
/** Only what's set (no undefined keys: a step compares as it's stored). */
export const defined = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== false)) as T;

export const newId = (prefix = "x"): string => `${prefix}${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
