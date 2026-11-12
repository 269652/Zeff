/**
 * Versions as packages write them: "1.2.3", compared, and ranges ("^1.0.0", "~1.2.0", ">=1.0.0", "*"). Pure.
 */

const parseVersion = (v: string): [number, number, number] | null => {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a) ?? [0, 0, 0];
  const y = parseVersion(b) ?? [0, 0, 0];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}
/** Whether a version fits a range: "" / "*" (any), "1.2.3", ">=1.2.0", "^1.2.0" (same major; 0.x: same minor), "~1.2.0" (same minor). */
export function satisfies(version: string, range: string | undefined): boolean {
  const r = (range ?? "").trim();
  if (!r || r === "*") return true;
  const v = parseVersion(version);
  if (!v) return false;
  const op = /^(\^|~|>=|<=|>|<|=)?\s*(\d+\.\d+\.\d+)$/.exec(r);
  if (!op) return false;
  const base = parseVersion(op[2])!;
  const c = compareVersions(version, op[2]);
  switch (op[1]) {
    case "^":
      return c >= 0 && (base[0] > 0 ? v[0] === base[0] : v[0] === 0 && v[1] === base[1]);
    case "~":
      return c >= 0 && v[0] === base[0] && v[1] === base[1];
    case ">=":
      return c >= 0;
    case "<=":
      return c <= 0;
    case ">":
      return c > 0;
    case "<":
      return c < 0;
    default:
      return c === 0;
  }
}
