import { ENTRY_CONTEXT_PREFIX } from "@/lib/contexts-shared";
import { int, str } from "@/app/action-helpers";

// ---------------------------------------------------------------------------
// Context (colleagues' messages, Teams messages, Jira comments behind entries)
// ---------------------------------------------------------------------------

/**
 * A context form's fields: kind, headline, author, date, ticket, message and its links
 * (link-url-i / link-label-i) — each name with `p` in front (the entry form's "Add context").
 */
export function contextInputOf(fd: FormData, p = ""): import("@/lib/contexts-shared").ContextInput {
  const links = Array.from({ length: int(fd, `${p}linkCount`) ?? 0 }, (_, i) => ({
    url: str(fd, `${p}link-url-${i}`) ?? "",
    label: str(fd, `${p}link-label-${i}`) ?? null,
  }));
  const body = fd.get(`${p}body`);
  return {
    kind: (str(fd, `${p}kind`) ?? "note") as import("@/lib/contexts-shared").ContextKind,
    title: str(fd, `${p}title`) ?? null,
    author: str(fd, `${p}author`) ?? null,
    body: typeof body === "string" ? body : "",
    links,
    date: str(fd, `${p}date`) ?? null,
    ticket: str(fd, `${p}ticket`) ?? null,
  };
}

/** The files a context form uploads (the browser posts an empty one when none was picked). */
export function contextFilesOf(fd: FormData, p = ""): File[] {
  return fd.getAll(`${p}files`).filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f && f.size > 0);
}

/** Pictures pasted into the message: each with the token its ![image](paste:token) reference uses. */
export function contextPastedOf(fd: FormData, p = ""): { token: string; file: File }[] {
  return Array.from({ length: int(fd, `${p}pastedCount`) ?? 0 }, (_, i) => ({ token: str(fd, `${p}pasted-token-${i}`) ?? "", file: fd.get(`${p}pasted-file-${i}`) }))
    .filter((x): x is { token: string; file: File } => !!x.token && typeof x.file === "object" && x.file !== null && "arrayBuffer" in x.file);
}

/** The entry form's "+ Add context" (ctx- fields), when something was written there — else null. */
export function entryContextOf(fd: FormData) {
  if (!fd.has(`${ENTRY_CONTEXT_PREFIX}linkCount`)) return null;
  const input = contextInputOf(fd, ENTRY_CONTEXT_PREFIX);
  const files = contextFilesOf(fd, ENTRY_CONTEXT_PREFIX);
  const pasted = contextPastedOf(fd, ENTRY_CONTEXT_PREFIX);
  const written = input.body.trim() || input.title || input.links.some((l) => l.url.trim()) || files.length || pasted.length;
  return written ? { input, files, pasted } : null;
}
