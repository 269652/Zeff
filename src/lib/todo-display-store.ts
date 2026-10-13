import { getPref, setPref } from "@/lib/prefs";
import { AREAS, DEFAULT_OFF, KNOWLEDGE_KINDS } from "@/lib/todo-display";

const KEY = "todo.display";
const VALID = new Set<string>([...AREAS.map((a) => `area:${a}`), ...KNOWLEDGE_KINDS.map((k) => `kind:${k}`), "entities", "links"]);

/** The ids switched off (until someone sets it: the kinds that are Zeff's own data, not knowledge). */
export function getTodoDisplayOff(): string[] {
  const v = getPref<string[] | null>(KEY, null);
  return Array.isArray(v) ? v.filter((x) => VALID.has(x)) : DEFAULT_OFF;
}

export function setTodoDisplayOff(off: string[]): void {
  setPref(KEY, off.filter((x) => VALID.has(x)));
}
