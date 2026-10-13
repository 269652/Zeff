/** Reading the JSON a model answered with — shared by every backend that gets its answer as text. */

/** The first JSON object in a text (an answer wrapped in prose or a ```json fence included). */
export function jsonIn(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in the answer");
  const json = text.slice(start, end + 1);
  try {
    return JSON.parse(json);
  } catch (e) {
    // A quote the model didn't escape („Ich kann jetzt" — a German quote closed with "), a raw
    // line break in a string: mended, else the first error stands.
    try {
      return JSON.parse(mendJson(json));
    } catch {
      throw e;
    }
  }
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
