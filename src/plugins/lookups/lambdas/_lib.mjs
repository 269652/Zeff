// What the lookup lambdas share (each has its own copy as lib.mjs): a JSON request that says what went wrong without the address
// (it can hold a key), and a few ways to shorten what a source says.

/**
 * @param {string} url
 * @param {string} who   the source's name, for the error
 * @param {Record<string, string>} [headers]
 */
export async function getJson(url, who, headers = {}) {
  let r;
  try {
    r = await fetch(url, { headers: { Accept: "application/json", ...headers } });
  } catch (e) {
    throw new Error(`${who}: ${/timeout|abort/i.test(String(e)) ? "no answer" : "not reachable"}`);
  }
  let data = null;
  try {
    data = await r.json();
  } catch {
    data = null;
  }
  if (!r.ok) throw new Error(`${who}: ${data?.status_message ?? (typeof data?.error === "object" ? data.error?.message : data?.error) ?? r.status}`);
  return data;
}

/** A text on one line, at most `max` characters. */
export const short = (s, max) => {
  const text = String(s ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/** "2021-09-16" → "2021". */
export const year = (date) => /^\d{4}/.exec(String(date ?? ""))?.[0] ?? "";

/** "de-DE" → "de"; anything else, English: it goes into addresses. */
export const language2 = (language) => /^[a-z]{2,3}(?=$|-)/.exec(String(language ?? ""))?.[0] ?? "en";

/** HTML as plain text (a summary, a description). */
export const plain = (html) =>
  String(html ?? "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
