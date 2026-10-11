/**
 * What happens to a dropped document, in the background: its text is read (one at a time), the
 * knowledge server is asked to take it in (its Zeff source: the documents are pages there) and
 * compile it, and its abstract is fetched back once it did. Server only.
 */
import { withAccount, currentAccountId } from "@/db/accounts";
import { errorMessage } from "@/lib/errors";
import { isInstalled } from "@/plugins/state";
import { extractText, UnsupportedError } from "./extract";
import { documentPageId } from "./export";
import { documentFile, getDocument, queuedDocuments, setAbstract, setExtracted, setStatus, uncompiledDocuments } from "./store";

const flags = globalThis as { __zeffDocWork?: Set<string>; __zeffDocPoll?: Map<string, ReturnType<typeof setTimeout>> };
const working = () => (flags.__zeffDocWork ??= new Set());
const polls = () => (flags.__zeffDocPoll ??= new Map());

/** The documents waiting are read, one after the other; then the knowledge server is asked. */
export async function processDocuments(): Promise<void> {
  const account = currentAccountId();
  if (working().has(account)) return;
  working().add(account);
  try {
    for (let id = queuedDocuments()[0]; id !== undefined; id = queuedDocuments()[0]) {
      const doc = getDocument(id);
      const file = doc && documentFile(id);
      if (!doc || !file) {
        if (doc) setStatus(id, "failed", "The stored file is missing.");
        continue;
      }
      setStatus(id, "extracting");
      try {
        setExtracted(id, await extractText(file.path, doc.name, doc.kind));
      } catch (e) {
        if (e instanceof UnsupportedError) setStatus(id, "unsupported", e.message);
        else {
          console.error(`[documents] ${doc.name}:`, errorMessage(e));
          setStatus(id, "failed", errorMessage(e));
        }
      }
    }
  } finally {
    working().delete(account);
  }
  await askKnowledge();
}

/** The knowledge server takes in what's new (its Zeff source) and compiles it — then the abstracts are polled for. */
async function askKnowledge(): Promise<void> {
  if (!isInstalled("knowledge") || !uncompiledDocuments().length) return;
  try {
    await (await import("@/plugins/knowledge/client")).knowledgeSync();
  } catch {
    return; // the knowledge server isn't answering: the abstracts come when it has compiled (a page load looks)
  }
  pollAbstracts();
}

/**
 * Looks for the abstracts of the documents the knowledge server hasn't compiled yet, every 20 s for
 * up to 15 minutes — in the account this was started for.
 */
export function pollAbstracts(): void {
  const account = currentAccountId();
  if (polls().has(account)) return;
  let left = 45;
  const tick = async () => {
    polls().delete(account);
    try {
      await withAccount(account, async () => {
        await pullAbstracts();
        if (uncompiledDocuments().length && --left > 0) polls().set(account, setTimeout(() => void tick(), 20000));
      });
    } catch {
      // next time
    }
  };
  polls().set(account, setTimeout(() => void tick(), 20000));
  polls().get(account)?.unref();
}

/** The abstracts of the compiled documents, from the knowledge server — kept with the document. How many. */
export async function pullAbstracts(): Promise<number> {
  if (!isInstalled("knowledge")) return 0;
  const ids = uncompiledDocuments();
  if (!ids.length) return 0;
  try {
    const pages = await (await import("@/plugins/knowledge/client")).knowledgePages(ids.map(documentPageId));
    let n = 0;
    for (const p of pages) {
      const id = Number(p.id.replace("zeff:doc:", ""));
      if (p.compiled && p.summary.trim() && Number.isInteger(id)) {
        setAbstract(id, p.summary, p.concepts);
        n++;
      }
    }
    return n;
  } catch {
    return 0;
  }
}

/** A document just dropped: read it (in the background). */
export function startProcessing(): void {
  const account = currentAccountId();
  void withAccount(account, () => processDocuments()).catch((e) => console.error("[documents]", errorMessage(e)));
}
