import { mergeText } from "@/lib/ext/git";

/**
 * Three-way merges of an app's parts (docs/zeff-kernel.md: "merged per field and line"): an update brings the package's new version
 * (theirs) onto a part you changed (mine), with the version installed before as the base. What only one side changed is taken from
 * that side. Where both changed the same thing differently, yours is kept and the spot is named as a conflict. Things are matched by
 * their stable ids, never by position or name: a database's fields and views, a flow's steps, a form's questions. A page's text is
 * merged block by block (a paragraph, a heading, a widget is one line), the way git merges lines. Server only.
 */

export type Conflict = { where: string };
export type Merged<T> = { value: T; conflicts: Conflict[]; /** What came from the new version. */ took: string[] };

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const hasIds = (v: unknown): v is Record<string, unknown>[] => Array.isArray(v) && v.length > 0 && v.every((x) => isPlain(x) && typeof x.id === "string" && x.id !== "");

/**
 * One value: whichever side changed it; both, differently: mine, and a conflict. `older`: what older versions of the package had there —
 * a value you left as one of them had it counts as unchanged too (a part that missed an update is still reached by the next one).
 */
export function merge3<T>(base: T | undefined, mine: T, theirs: T, where: string, older: unknown[] = []): Merged<T> {
  if (same(mine, theirs)) return { value: mine, conflicts: [], took: [] };
  if (same(mine, base) || older.some((o) => same(mine, o))) return { value: theirs, conflicts: [], took: [where] };
  if (same(theirs, base)) return { value: mine, conflicts: [], took: [] };
  // Both changed it: an object, or a list of things with ids, is merged inside — only what both changed in the same place conflicts.
  if (isPlain(mine) && isPlain(theirs)) return mergeRecord(isPlain(base) ? base : {}, mine, theirs, where, older.filter(isPlain)) as Merged<T>;
  if (hasIds(mine) && hasIds(theirs)) return mergeById(hasIds(base) ? base : [], mine, theirs, where, older.filter(hasIds)) as unknown as Merged<T>;
  return { value: mine, conflicts: [{ where }], took: [] };
}

/** An object, key by key. */
export function mergeRecord(base: Record<string, unknown>, mine: Record<string, unknown>, theirs: Record<string, unknown>, where: string, older: Record<string, unknown>[] = []): Merged<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const conflicts: Conflict[] = [];
  const took: string[] = [];
  for (const k of new Set([...Object.keys(mine), ...Object.keys(theirs), ...Object.keys(base)])) {
    const r = merge3(base[k], mine[k], theirs[k], `${where}.${k}`, older.map((o) => o[k]));
    if (r.value !== undefined) out[k] = r.value;
    conflicts.push(...r.conflicts);
    took.push(...r.took);
  }
  return { value: out, conflicts, took };
}

const label = (x: Record<string, unknown>) => String(x.name ?? x.title ?? x.label ?? x.id);

/**
 * A list of things with ids (fields, views, steps), by id: each merged on its own; one the new version adds is added; one it dropped
 * goes only if you left it as it was (else it stays, a conflict); one you added stays. Your order stays, new ones go where the new version
 * has them (after the one before them).
 */
export function mergeById(base: Record<string, unknown>[], mine: Record<string, unknown>[], theirs: Record<string, unknown>[], where: string, older: Record<string, unknown>[][] = []): Merged<Record<string, unknown>[]> {
  const byId = (l: Record<string, unknown>[]) => new Map(l.map((x) => [String(x.id), x]));
  const b = byId(base);
  const t = byId(theirs);
  const olds = older.map(byId);
  const conflicts: Conflict[] = [];
  const took: string[] = [];
  const out: Record<string, unknown>[] = [];
  for (const m of mine) {
    const id = String(m.id);
    const at = `${where}[${label(m)}]`;
    if (t.has(id)) {
      const r = merge3(b.get(id), m, t.get(id)!, at, olds.map((o) => o.get(id)).filter((x) => x !== undefined));
      out.push(r.value as Record<string, unknown>);
      conflicts.push(...r.conflicts);
      took.push(...r.took);
    } else if (b.has(id)) {
      // The new version dropped it: gone if you left it alone, kept (and said) if you changed it.
      if (same(m, b.get(id))) took.push(`${at} removed`);
      else {
        out.push(m);
        conflicts.push({ where: `${at} (removed by the update, changed by you)` });
      }
    } else out.push(m); // yours
  }
  const have = new Set(out.map((x) => String(x.id)));
  theirs.forEach((x, i) => {
    const id = String(x.id);
    if (have.has(id) || b.has(id)) return; // (there, or dropped by you)
    const prev = i > 0 ? out.findIndex((y) => String(y.id) === String(theirs[i - 1].id)) : -1;
    out.splice(prev + 1, 0, x);
    have.add(id);
    took.push(`${where}[${label(x)}] added`);
  });
  return { value: out, conflicts, took };
}

/** A page's text (its document), block by block — each top-level block one line for git's merge. */
export async function mergeDoc(base: { content?: unknown[] } | null | undefined, mine: { content?: unknown[] }, theirs: { content?: unknown[] }, where: string): Promise<Merged<{ type: string; content: unknown[] }>> {
  const lines = (d: { content?: unknown[] } | null | undefined) => (d?.content ?? []).map((n) => JSON.stringify(n)).join("\n") + "\n";
  const r = await mergeText(lines(base), lines(mine), lines(theirs), { favorMine: true });
  const content = r.text
    .split("\n")
    .filter((l) => l.trim())
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as unknown];
      } catch {
        return [];
      }
    });
  const changed = lines(theirs) !== lines(base);
  return { value: { type: "doc", content }, conflicts: r.conflicts ? [{ where: `${where} (${r.conflicts} place${r.conflicts === 1 ? "" : "s"} both changed)` }] : [], took: changed && lines(mine) !== r.text ? [`${where} text`] : [] };
}
