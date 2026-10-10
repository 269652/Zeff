import { confluenceConfig, confluencePages, folderPages, PARSER_VERSION, type RawPage } from "./confluence";
import { db, endRun, getSettings, startRun } from "./db";
import { kInstalled } from "./plugins";
import { zeffPages } from "./zeff";

/**
 * Reading pages in: each one stored (as text) and cut into chunks along its headings for the
 * full-text search. A page whose version didn't change is left as it is; one gone from its space
 * is removed. Compiling (Copilot) comes after, for the new and changed ones.
 */

const CHUNK = 900;
/** Less than this (a heading and a line): goes with the next section. */
const MIN = 160;

/**
 * A page's text in chunks: by heading sections — one too short to stand alone joins the next —,
 * long ones cut at line ends (a table row stays whole), the last line of one repeated in the next.
 * Each knows its heading.
 */
export function chunk(body: string): { heading: string; text: string }[] {
  const sections: { heading: string; lines: string[] }[] = [{ heading: "", lines: [] }];
  for (const line of body.split("\n")) {
    const h = /^#{1,6}\s+(.+)$/.exec(line);
    const cur = sections[sections.length - 1];
    if (h && cur.lines.join("\n").trim().length >= MIN) sections.push({ heading: h[1].trim(), lines: [line] });
    else {
      if (h) cur.heading = cur.heading ? `${cur.heading} › ${h[1].trim()}` : h[1].trim();
      cur.lines.push(line);
    }
  }
  const out: { heading: string; text: string }[] = [];
  for (const s of sections) {
    let buf: string[] = [];
    let size = 0;
    const flush = () => {
      const t = buf.join("\n").trim();
      if (t) out.push({ heading: s.heading, text: t });
      buf = buf.length ? [buf[buf.length - 1]] : [];
      size = buf[0]?.length ?? 0;
    };
    for (const line of s.lines) {
      // A line longer than a chunk: cut itself.
      for (let i = 0; i < Math.max(line.length, 1); i += CHUNK) {
        const part = line.slice(i, i + CHUNK);
        if (size + part.length > CHUNK && size > 0) flush();
        buf.push(part);
        size += part.length + 1;
      }
    }
    if (buf.join("").trim() && (out.length === 0 || out[out.length - 1].text !== buf.join("\n").trim())) {
      const t = buf.join("\n").trim();
      if (t) out.push({ heading: s.heading, text: t });
    }
  }
  return out;
}

/** A page stored (new or changed): its text, its chunks in the search; compiled again later. */
export function storePage(p: RawPage): void {
  const d = db();
  d.transaction(() => {
    const before = d.prepare("select concepts, body from pages where id = ?").get(p.id) as { concepts: string; body: string } | undefined;
    d.prepare(
      `insert into pages (id, space, title, url, version, updated_at, author, body, fetched_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(id) do update set space = excluded.space, title = excluded.title, url = excluded.url, version = excluded.version,
         updated_at = excluded.updated_at, author = excluded.author, body = excluded.body, fetched_at = excluded.fetched_at`,
    ).run(p.id, p.space, p.title, p.url, p.version, p.updatedAt, p.author, p.body, new Date().toISOString());
    // Its text changed (a new version, or read better): compiled again.
    if (before && before.body !== p.body) d.prepare("update pages set compiled_version = null where id = ?").run(p.id);
    d.prepare("delete from chunks_fts where page_id = ?").run(p.id);
    d.prepare("delete from chunks where page_id = ?").run(p.id);
    const ins = d.prepare("insert into chunks (page_id, idx, heading, text) values (?, ?, ?, ?)");
    const fts = d.prepare("insert into chunks_fts (title, heading, text, concepts, chunk_id, page_id) values (?, ?, ?, ?, ?, ?)");
    chunk(p.body || p.title).forEach((c, i) => {
      const id = Number(ins.run(p.id, i, c.heading, c.text).lastInsertRowid);
      fts.run(p.title, c.heading, c.text, before?.concepts ?? "", id, p.id);
    });
  })();
}

/** A page gone (deleted in Confluence, out of the spaces read). */
export function removePage(id: string): void {
  const d = db();
  d.transaction(() => {
    d.prepare("delete from chunks_fts where page_id = ?").run(id);
    d.prepare("delete from pages where id = ?").run(id);
  })();
}

const state = globalThis as unknown as { __knowledgeSync?: Promise<SyncResult> | null; __knowledgeSyncStop?: boolean };
export type SyncResult = { ok: boolean; message: string; read: number; changed: number; removed: number };
export const syncRunning = () => !!state.__knowledgeSync;
/** Stop reading: what's read so far stays; nothing is removed (the list wasn't read to the end). */
export function stopSync(): boolean {
  if (!state.__knowledgeSync) return false;
  state.__knowledgeSyncStop = true;
  return true;
}

/** Read the sources (Confluence, Zeff, Google Keep, the import folder): new and changed pages stored, gone ones removed. One at a time. */
export function syncPages(): Promise<SyncResult> {
  if (state.__knowledgeSync) return state.__knowledgeSync;
  const run = (async (): Promise<SyncResult> => {
    const runId = startRun("sync");
    const s = getSettings();
    const d = db();
    // Pages read with an older way of turning them into text: all read again.
    const parsed = (d.prepare("select value from settings where key = 'parserVersion'").get() as { value: string } | undefined)?.value;
    const reread = parsed !== String(PARSER_VERSION);
    const known = reread ? new Map<string, number>() : new Map((d.prepare("select id, version from pages").all() as { id: string; version: number }[]).map((r) => [r.id, r.version]));
    const before = new Set((d.prepare("select id from pages").all() as { id: string }[]).map((r) => r.id));
    const seen = new Set<string>();
    let read = 0;
    let changed = 0;
    try {
      const sources: string[] = [];
      if (kInstalled("confluence") && confluenceConfig()) {
        sources.push("Confluence");
        const spaces = s.spaces.split(/[\s,;]+/).filter(Boolean);
        for await (const p of confluencePages(spaces, s.maxPages, known)) {
          if (state.__knowledgeSyncStop) throw new Error("Angehalten.");
          read++;
          seen.add(p.id);
          if ("unchanged" in p) continue;
          storePage(p);
          changed++;
        }
      }
      if (kInstalled("zeff")) {
        const z = await zeffPages();
        sources.push(`Zeff${z.account ? ` (${z.account})` : ""}`);
        for (const p of z.pages) {
          if (state.__knowledgeSyncStop) throw new Error("Angehalten.");
          read++;
          seen.add(p.id);
          if (known.get(p.id) === p.version) continue;
          storePage(p);
          changed++;
        }
      }
      // Google Keep on its own (with the Zeff source, Keep's notes come along already).
      if (kInstalled("google-keep") && !kInstalled("zeff")) {
        const k = await zeffPages("keep");
        sources.push(`Google Keep${k.account ? ` (${k.account})` : ""}`);
        for (const p of k.pages) {
          if (state.__knowledgeSyncStop) throw new Error("Angehalten.");
          read++;
          seen.add(p.id);
          if (known.get(p.id) === p.version) continue;
          storePage(p);
          changed++;
        }
      }
      if (kInstalled("import-folder") && s.importDir.trim()) {
        sources.push(s.importDir.trim());
        for (const p of folderPages(s.importDir.trim())) {
          read++;
          seen.add(p.id);
          if (known.get(p.id) === p.version) continue;
          storePage(p);
          changed++;
        }
      }
      if (!sources.length) throw new Error("Keine Quelle: das Confluence-Plugin (mit CONFLUENCE_URL + Token in Zeffs .env), das Zeff-Plugin, das Google-Keep-Plugin oder das Import-Ordner-Plugin (mit einem Ordner).");
      // Gone from where they came from (read completely): removed. Your own knowledge (own.ts, "own:…") comes from no source — it stays.
      const gone = [...before].filter((id) => !seen.has(id) && !id.startsWith("own:"));
      d.prepare("insert into settings (key, value) values ('parserVersion', ?) on conflict(key) do update set value = excluded.value").run(String(PARSER_VERSION));
      gone.forEach(removePage);
      const message = `${read} Seiten gelesen (${sources.join(", ")}), ${changed} neu oder geändert, ${gone.length} entfernt.`;
      endRun(runId, true, message);
      return { ok: true, message, read, changed, removed: gone.length };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      endRun(runId, false, `${message} (bis dahin ${read} gelesen, ${changed} gespeichert)`);
      return { ok: false, message, read, changed, removed: 0 };
    }
  })().finally(() => {
    state.__knowledgeSync = null;
    state.__knowledgeSyncStop = false;
  });
  state.__knowledgeSync = run;
  return run;
}
