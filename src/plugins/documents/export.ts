/**
 * The documents as pages for the knowledge server (its "Zeff" source): one each, in the space
 * "Zeff · Documents" — their text read, with what they are. Unchanged ones aren't compiled again
 * (the version is a hash of the text). Server only.
 */
import { getDb, schema } from "@/db";
import type { KnowledgeDoc } from "@/plugins/knowledge/export";
import { docRef, sizeText } from "./shared";

/** A text's version: a 31-bit hash (FNV-1a) — the same as the other Zeff pages'. */
function version(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 1) || 1;
}

/** The knowledge page id of a document. */
export const documentPageId = (id: number) => `zeff:doc:${id}`;

export function documentDocs(zeffUrl: string): KnowledgeDoc[] {
  const { documents } = schema;
  return getDb()
    .select()
    .from(documents)
    .all()
    .filter((d) => d.status === "ready" && d.text.trim())
    .map((d) => {
      const body = `Dokument „${d.name}“ (${d.kind}, ${sizeText(d.size)}, abgelegt am ${d.createdAt.slice(0, 10)}):\n\n${d.text}`;
      return { id: documentPageId(d.id), space: "Zeff · Documents", title: d.name, url: `${zeffUrl.replace(/\/+$/, "")}/documents#${docRef(d.id)}`, version: version(`${d.name}\n${body}`), updatedAt: d.updatedAt, author: null, body };
    });
}
