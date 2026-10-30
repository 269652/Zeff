/** Reading the JSON a model answered with — shared by every backend that gets its answer as text. */

/** A CLI answered, but there was no JSON in what it said (not a timeout, not an abort, not a failed exit) — the one failure worth a second try. */
export class NoJsonError extends Error {}

/** The first JSON object in a text (an answer wrapped in prose or a ```json fence included). */
export function jsonIn(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in the answer");
  // A quote the model didn't escape („Ich kann jetzt" — a German quote closed with "), a raw
  // line break in a string: mended, else the first error stands.
  return parseMended(text.slice(start, end + 1));
}

/**
 * JSON as models get it wrong, mended: inside a string, a " that isn't followed by what may come
 * after a string (, } ] :) is part of the text — escaped; raw line breaks and tabs are escaped too.
 */
export function mendJson(json: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < json.length; i++) {
    const c = json[i];
    if (!inString) {
      out += c;
      if (c === '"') inString = true;
      continue;
    }
    if (c === "\\") {
      out += c + (json[i + 1] ?? "");
      i++;
      continue;
    }
    if (c === '"') {
      const next = json.slice(i + 1).match(/^\s*([\s\S])/)?.[1];
      if (next === undefined || [",", "}", "]", ":"].includes(next)) {
        out += c;
        inString = false;
      } else out += '\\"';
      continue;
    }
    out += c === "\n" ? "\\n" : c === "\r" ? "\\r" : c === "\t" ? "\\t" : c;
  }
  return out;
}

/** JSON.parse — and, when that fails, once more on the text mended (mendJson); the first error stands. */
function parseMended(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch (e) {
    try {
      return JSON.parse(mendJson(json));
    } catch {
      throw e;
    }
  }
}

/** The last ```json block of a text that parses (mended if need be) and `accept`s — undefined when none does. */
export function fencedJson(text: string, accept: (v: unknown) => boolean = () => true): unknown {
  const fences = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  for (const f of fences.reverse()) {
    try {
      const v = parseMended(f[1]);
      if (accept(v)) return v;
    } catch {
      // the next one
    }
  }
  return undefined;
}

/**
 * The JSON object at the end of a plain-text answer (Copilot's): the last ```json block, else the
 * last object that parses (one that only parses mended when no other does) — null when there's none.
 */
export function lastJson(text: string): unknown {
  const fenced = fencedJson(text);
  if (fenced !== undefined) return fenced;
  const t = text.slice(-60000);
  const end = t.lastIndexOf("}");
  for (const mend of [false, true])
    for (let i = t.lastIndexOf("{", end); i >= 0; i = t.lastIndexOf("{", i - 1)) {
      try {
        const json = t.slice(i, end + 1);
        return JSON.parse(mend ? mendJson(json) : json);
      } catch {
        // further back
      }
    }
  return null;
}
