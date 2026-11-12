/** Key combinations of a view's buttons and <on keys=…> handlers. Client-safe. */
/** Whether a key press is the combination written as keys="mod+s" (mod = Ctrl or ⌘; ctrl, alt, shift, meta; esc, enter, space, a letter or sign). */
export function keysMatch(spec: string, e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): boolean {
  const parts = spec.toLowerCase().split("+").map((x) => x.trim()).filter(Boolean);
  const key = parts.pop();
  if (!key) return false;
  const want = { mod: parts.includes("mod"), ctrl: parts.includes("ctrl"), alt: parts.includes("alt"), shift: parts.includes("shift"), meta: parts.includes("meta") };
  const pressed = e.key.toLowerCase();
  const name = pressed === "escape" ? "esc" : pressed === " " ? "space" : pressed;
  if (name !== key) return false;
  return (want.mod ? e.ctrlKey || e.metaKey : !want.ctrl && !want.meta ? !e.ctrlKey && !e.metaKey : true) && (!want.ctrl || e.ctrlKey) && (!want.meta || e.metaKey) && e.altKey === want.alt && (e.shiftKey === want.shift || key.length > 1 || !/[a-z0-9]/.test(key));
}
