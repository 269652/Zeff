/** Small helpers for grouping — linear, not `[...list, x]` per item (quadratic on thousands of rows). */

/** Add `value` to the list under `key` (a new list when there's none). */
export function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
