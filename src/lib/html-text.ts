/** HTML from text. No imports: client modules may use it too. */

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** A text safe in HTML — as an element's content or an attribute's value. Null → "". */
export const escapeHtml = (s: unknown): string => String(s ?? "").replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
