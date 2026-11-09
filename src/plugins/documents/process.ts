/**
 * What happens to a dropped document, in the background: its text is read, the knowledge server is
 * asked to take it in (its Zeff source: the documents are pages there) and compile it, and its
 * abstract is fetched back once it did. Server only.
 *
 * Two lanes, so one slow file never holds up the rest: the fast one reads what needs no AI (text,
 * Office files, PDFs with text) one after the other; the slow one has what needs the Claude CLI
 * (pictures, scanned PDFs, 5 minutes at most each) or a transcriber. Reading can be restarted — the
 * run in flight is stopped (its processes ended), what was left "being read" by a server that has
 * gone is waiting again — and a single document can be skipped.
 */
import { withAccount, currentAccountId } from "@/db/accounts";
import { ABORTED, withAbort } from "@/lib/abort";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { extractText, NeedsSlowLane, UnsupportedError } from "./extract";
import { isPending } from "./gate";
import { documentPageId } from "./export";
import { documentFile, getDocument, readingDocuments, setAbstract, setExtracted, setStatus, uncompiledDocuments } from "./store";

type Current = { id: number; name: string; since: number; lane: "fast" | "slow" };
/** `held`: needs the AI to be read, but waits for your confirmation (gate.ts) — not taken until then. */
type Lanes = { gen: number; fast: boolean; slow: boolean; current: Map<number, Current>; ctl: AbortController | null; slowWait: Set<number>; skipped: Set<number>; held: Set<number> };

const flags = globalThis as { __zeffDocLanes?: Map<string, Lanes>; __zeffDocPoll?: Map<string, ReturnType<typeof setTimeout>> };
const polls = () => (flags.__zeffDocPoll ??= new Map());
const lanesOf = (account: string): Lanes => {
  const all = (flags.__zeffDocLanes ??= new Map());
  let l = all.get(account);
  if (!l) all.set(account, (l = { gen: 0, fast: false, slow: false, current: new Map(), ctl: null, slowWait: new Set(), skipped: new Set(), held: new Set() }));
  return l;
};

/** What was left "being read" by a server that has gone (nothing in this process works on it): waiting again. */
function recoverStale(l: Lanes): number {
  let n = 0;
  for (const d of readingDocuments()) {
    if (d.status === "extracting" && !l.current.has(d.id)) {
      setStatus(d.id, "queued");
      n++;
    }
  }
  return n;
}

const tooLong = (e: unknown) => /took longer than/i.test(errorMessage(e));

/** A document's reading ended in an error: what it says about the document. */
function failWith(id: number, name: string, e: unknown): void {
  if (e instanceof UnsupportedError) setStatus(id, "unsupported", e.message);
  else {
    console.error(`[documents] ${name}:`, errorMessage(e));
    setStatus(id, "failed", tooLong(e) ? t("It took too long — click “Read again”.") : errorMessage(e));
  }
}

/** The fast lane: the waiting documents that need no AI, one after the other; the others go to the slow lane. */
export async function processDocuments(): Promise<void> {
  const account = currentAccountId();
  const l = lanesOf(account);
  recoverStale(l);
  if (!l.fast) {
    l.fast = true;
    const gen = l.gen;
    try {
      const next = () => readingDocuments().find((d) => d.status === "queued" && !l.slowWait.has(d.id) && !l.held.has(d.id) && !l.current.has(d.id))?.id;
      for (let id = next(); id !== undefined && l.gen === gen; id = next()) {
        const doc = getDocument(id);
        const file = doc && documentFile(id);
        if (!doc || !file) {
          if (doc) setStatus(id, "failed", t("The stored file is missing."));
          continue;
        }
        l.current.set(id, { id, name: doc.name, since: Date.now(), lane: "fast" });
        setStatus(id, "extracting");
        try {
          const text = await extractText(file.path, doc.name, doc.kind, { lane: "fast" });
          if (l.gen === gen) setExtracted(id, text);
        } catch (e) {
          if (l.gen !== gen) return;
          if (e instanceof NeedsSlowLane) {
            // Waiting for your confirmation (a local folder set so): Claude reads it only once you confirm.
            if (isPending(id)) {
              l.held.add(id);
              setStatus(id, "queued", t("Waits for your confirmation — then the AI reads it."));
            } else {
              l.slowWait.add(id);
              setStatus(id, "queued");
            }
          } else failWith(id, doc.name, e);
        } finally {
          if (l.gen === gen) l.current.delete(id);
        }
      }
    } finally {
      if (l.gen === gen) l.fast = false;
    }
  }
  startSlowLane(account);
  await askKnowledge();
}

/** The slow lane (in the background): pictures, scans, recordings — one at a time, each with a time limit, a hang ends that one only. */
function startSlowLane(account: string): void {
  const l = lanesOf(account);
  if (l.slow || !l.slowWait.size) return;
  l.slow = true;
  const gen = l.gen;
  void withAccount(account, async () => {
    try {
      while (l.gen === gen) {
        const id = [...l.slowWait][0];
        if (id === undefined) break;
        l.slowWait.delete(id);
        const doc = getDocument(id);
        const file = doc && documentFile(id);
        if (!doc || !file || doc.status !== "queued") continue; // gone, or skipped / read in the meantime
        const ctl = new AbortController();
        l.ctl = ctl;
        l.current.set(id, { id, name: doc.name, since: Date.now(), lane: "slow" });
        setStatus(id, "extracting");
        try {
          const text = await withAbort(ctl, () => extractText(file.path, doc.name, doc.kind, { lane: "slow" }));
          if (l.gen === gen) setExtracted(id, text);
        } catch (e) {
          if (l.gen !== gen) return; // restarted: the restart has dealt with it
          if (l.skipped.delete(id)) setStatus(id, "failed", t("Skipped — click “Read again”."));
          else if (errorMessage(e) === ABORTED) setStatus(id, "failed", t("Stopped — click “Read again”."));
          else failWith(id, doc.name, e);
        } finally {
          if (l.gen === gen) {
            l.current.delete(id);
            l.ctl = null;
          }
        }
      }
    } finally {
      if (l.gen === gen) l.slow = false;
    }
    await askKnowledge();
  }).catch((e) => console.error("[documents]", errorMessage(e)));
}

/** Reading restarted: the run in flight is stopped (that document waits for a "Read again"), the rest is read afresh. */
export function restartReading(): void {
  const account = currentAccountId();
  const l = lanesOf(account);
  l.gen++;
  l.ctl?.abort();
  l.ctl = null;
  for (const c of l.current.values()) if (c.lane === "slow") setStatus(c.id, "failed", t("Stopped — click “Read again”."));
  l.current.clear();
  l.fast = false;
  l.slow = false;
  l.slowWait.clear();
  l.skipped.clear();
  recoverStale(l);
  startProcessing();
}

/** One document skipped: if it is being read, that stops; else it just won't be read (until "Read again"). */
export function skipDocument(id: number): void {
  const l = lanesOf(currentAccountId());
  const cur = l.current.get(id);
  l.slowWait.delete(id);
  if (cur?.lane === "slow") {
    l.skipped.add(id);
    l.ctl?.abort();
  } else if (!cur) setStatus(id, "failed", t("Skipped — click “Read again”."));
  // In the fast lane it ends in a moment by itself.
}

/** What is being read now, what waits — for the page. */
export type ReadingStatus = { current: { id: number; name: string; since: number; lane: "fast" | "slow" }[]; waiting: number; idle: boolean };
export function readingStatus(): ReadingStatus {
  const l = lanesOf(currentAccountId());
  const rows = readingDocuments();
  const current = [...l.current.values()];
  return { current, waiting: rows.filter((d) => d.status === "queued" && !l.current.has(d.id) && !l.held.has(d.id)).length, idle: !current.length && !l.fast && !l.slow };
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

/** Confirmed (gate.ts): those held back are read now, and compiled. */
export function releaseHeld(ids: number[]): void {
  const l = lanesOf(currentAccountId());
  for (const id of ids) l.held.delete(id);
  startProcessing();
}

/** A document just dropped: read it (in the background). */
export function startProcessing(): void {
  const account = currentAccountId();
  void withAccount(account, () => processDocuments()).catch((e) => console.error("[documents]", errorMessage(e)));
}
