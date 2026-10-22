/**
 * The navigation of the documents app — the entries of its sidebar (the inbox, all documents, the last seven days, from mail, what is
 * being read, and the types): their ids, counts and which documents each holds. The view draws them in its sidebar, or the Workspace
 * draws them under the database in its tree — the same entries either way. Pure: no server, no browser.
 */
export type NavEntry = { id: string; label: string; icon: string; n: number; /** A heading the entry sits under ("Type"). */ group?: string };
export type DocFacts = { unread: boolean; kind: string; status: string; added: string; from: string };

export const DOC_KINDS_NAV: Record<string, { label: string; icon: string }> = {
  pdf: { label: "PDF", icon: "📕" },
  office: { label: "Office", icon: "📘" },
  text: { label: "Text", icon: "📄" },
  image: { label: "Images", icon: "🖼️" },
  audio: { label: "Audio", icon: "🎧" },
  other: { label: "Other", icon: "📎" },
};

/** Whether a document belongs to an entry. */
export function inScope(d: DocFacts, scope: string, now = Date.now()): boolean {
  if (scope === "inbox") return d.unread;
  if (scope === "all") return true;
  if (scope === "week") return Date.parse(d.added) >= now - 7 * 864e5;
  if (scope === "mail") return !!d.from;
  // Being read: waiting or reading now — not a failed or unreadable one (those stay what they are).
  if (scope === "processing") return d.status === "queued" || d.status === "extracting";
  if (scope.startsWith("kind:")) return d.kind === scope.slice(5);
  return false;
}

/** The facts of a document row (its cells). */
export function factsOf(cells: Record<string, unknown>): DocFacts {
  return { unread: cells.docunread === true, kind: String(cells.dockind ?? "other"), status: String(cells.docstatus ?? ""), added: String(cells.docadded ?? ""), from: String(cells.docfrom ?? "") };
}

/** The entries with their counts; `t` names them. "Being read" and the types show only while something is in them. */
export function docNav(docs: DocFacts[], t: (s: string) => string, now = Date.now()): NavEntry[] {
  const n = (s: string) => docs.filter((d) => inScope(d, s, now)).length;
  const out: NavEntry[] = [
    { id: "inbox", label: t("Inbox"), icon: "📥", n: n("inbox") },
    { id: "all", label: t("All documents"), icon: "🗂️", n: n("all") },
    { id: "week", label: t("Last 7 days"), icon: "🕑", n: n("week") },
    { id: "mail", label: t("From mail"), icon: "✉️", n: n("mail") },
  ];
  if (n("processing")) out.push({ id: "processing", label: t("Being read"), icon: "⏳", n: n("processing") });
  for (const [k, v] of Object.entries(DOC_KINDS_NAV)) {
    const c = n(`kind:${k}`);
    if (c) out.push({ id: `kind:${k}`, label: t(v.label), icon: v.icon, n: c, group: t("Type") });
  }
  return out;
}
