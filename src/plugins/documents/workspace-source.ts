import { createHash } from "node:crypto";
import { t } from "@/lib/i18n/server";
import { documentOrigins } from "@/lib/mail/attachments-store";
import type { Row } from "@/plugins/workspace/model";
import type { WorkspaceSource } from "@/plugins/workspace/source-point";
import { markSeen, markUnread, unreadIds } from "./seen";
import { listDocuments, readableDocuments } from "./store";

/**
 * The documents as a source of the Workspace's pipelines - one record per document (what was dropped in, what mail attachments
 * brought, what the audio transcriber read), with what is known of it: its kind and state, where it came from, its abstract (the
 * knowledge server's) and its text. "Unread" is the field an inbox is made of: a document is unread until you open its file, tick
 * the box off in a row or mark it. A two-way view for that box: ticking it in the database says "seen" to the document store.
 */

const F = { kind: "dockind", status: "docstatus", added: "docadded", size: "docsize", unread: "docunread", compiled: "doccompiled", from: "docfrom", concepts: "docconcepts" };
const REF = /^doc:(\d+)$/;
const SRC = "srcref";
const EDITED = "srcedited";

const stamp = (parts: unknown[]) => createHash("sha1").update(JSON.stringify(parts)).digest("hex").slice(0, 12);

export function documentRecords() {
  const docs = listDocuments();
  const unread = unreadIds();
  const origins = documentOrigins(docs.map((d) => d.id));
  const bodies = new Map(readableDocuments().map((d) => [d.id, d.text]));
  return docs.map((d) => {
    const o = origins[d.id];
    const from = o ? `${o.from}${o.subject ? ` — ${o.subject}` : ""}`.trim() : "";
    return {
      ref: `doc:${d.id}`,
      title: d.name,
      fields: {} as Record<string, string>,
      text: [d.abstract ? `## ${t("Abstract")}\n${d.abstract}` : "", d.concepts.length ? `${t("Concepts")}: ${d.concepts.join(", ")}` : "", (bodies.get(d.id) ?? "").slice(0, 6000)].filter(Boolean).join("\n\n"),
      url: `/api/documents/${d.id}/file?open=1`,
      // What the row remembers: another stamp means the document changed since (an edit of the row is then not applied).
      updatedAt: stamp([d.status, d.compiled, d.name, unread.has(d.id)]),
      dataType: "documents" as const,
      typed: [
        { id: F.kind, name: "Kind", type: "text" as const, value: d.kind },
        { id: F.status, name: "Status", type: "text" as const, value: d.status },
        { id: F.added, name: "Added", type: "date" as const, value: d.createdAt.slice(0, 16) },
        { id: F.size, name: "Size (KB)", type: "number" as const, value: Math.max(1, Math.round(d.size / 1024)) },
        { id: F.unread, name: "Unread", type: "checkbox" as const, value: unread.has(d.id) || null },
        { id: F.compiled, name: "Compiled", type: "checkbox" as const, value: d.compiled || null },
        { id: F.from, name: "From", type: "text" as const, value: from },
        { id: F.concepts, name: "Concepts", type: "text" as const, value: d.concepts.join(", ") },
      ],
    };
  });
}

/** The unread box ticked off (or on) in a row is the document seen (unread). */
export function pullDocuments(_dbId: number, rows: Row[]): void {
  const unread = unreadIds();
  const docs = new Map(listDocuments().map((d) => [d.id, d]));
  const seen: number[] = [];
  const again: number[] = [];
  for (const row of rows) {
    const m = REF.exec(String(row.cells[SRC] ?? ""));
    const d = m ? docs.get(Number(m[1])) : null;
    if (!m || !d) continue;
    // The document changed (opened, compiled …) since the row was read: the row follows, its box is not applied.
    if (String(row.cells[EDITED] ?? "") !== stamp([d.status, d.compiled, d.name, unread.has(d.id)])) continue;
    const wantUnread = row.cells[F.unread] === true;
    if (wantUnread && !unread.has(d.id)) again.push(d.id);
    if (!wantUnread && unread.has(d.id)) seen.push(d.id);
  }
  if (seen.length) markSeen(seen);
  if (again.length) markUnread(again);
}

export const DOCUMENTS_SOURCE: WorkspaceSource = {
  id: "documents",
  get label() {
    return t("Documents");
  },
  icon: "📄",
  dataType: "documents",
  get hint() {
    return t("The documents you dropped in or mail attachments brought — with their abstract, where they came from and whether you have seen them (Unread).");
  },
  count: () => listDocuments().length,
  read: documentRecords,
  pull: pullDocuments,
};
