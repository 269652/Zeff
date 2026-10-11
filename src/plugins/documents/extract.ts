/**
 * Reading a document's text — by its kind:
 *   text      read as it is (HTML, RTF stripped to text)
 *   office    docx / xlsx / pptx / odt / ods / odp — their XML read out of the zip (no library)
 *   pdf       the text in it (simple, text-based PDFs — read here); a scan or a complex one: the
 *             Claude CLI reads it (it needs Poppler's pdftoppm on this machine for that)
 *   image     the Claude CLI reads it: the text visible in it, then what it shows
 *   audio     a transcriber command you set (e.g. Whisper) — none set: not read
 * A file this can't read: an Unsupported error saying what would make it work. Server only.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { t } from "@/lib/i18n/server";
import { ensurePoppler } from "./poppler";
import { documentSettings } from "./settings";
import type { DocKind } from "./shared";

/** Not readable (yet): the reason, and what would help — not a failure to fix, a state to tell. */
export class UnsupportedError extends Error {}

const MAX_TEXT = 400000;

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß", euro: "€", ndash: "–", mdash: "—", hellip: "…" };
/** &amp; &#39; &#x27; … as characters. */
export const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e] ?? ENTITIES[e.toLowerCase()] ?? m;
  });

/** A buffer as text: UTF-16 with its mark, UTF-8, else Windows-1252. */
export function decodeText(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  if (buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf.subarray(2)).swap16().toString("utf16le");
  const body = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? buf.subarray(3) : buf;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return new TextDecoder("windows-1252").decode(body);
  }
}

/** HTML as text: scripts and styles out, blocks as lines, entities decoded. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|head|svg)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/table|\/ul|\/ol|\/section|\/article)[^>]*>/gi, "\n")
      .replace(/<\/t[dh]>/gi, "\t")
      .replace(/<[^>]+>/g, ""),
  );
}

/** RTF as text: groups that aren't text out, control words gone, \'hh and \uN read. */
export function rtfToText(rtf: string): string {
  return rtf
    .replace(/\{\\\*[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, "")
    .replace(/\{\\(fonttbl|colortbl|stylesheet|info|pict)[\s\S]*?\}\}/g, "")
    .replace(/\\'([0-9a-f]{2})/gi, (_, h: string) => Buffer.from(h, "hex").toString("latin1"))
    .replace(/\\u(-?\d+)\??/g, (_, n: string) => String.fromCharCode(Number(n) < 0 ? Number(n) + 65536 : Number(n)))
    .replace(/\\(par|line)\b ?/g, "\n")
    .replace(/\\tab\b ?/g, "\t")
    .replace(/\\[a-z]+-?\d* ?/gi, "")
    .replace(/[{}]/g, "");
}

const tidy = (s: string) =>
  s
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

function textFile(name: string, buf: Buffer): string {
  const raw = decodeText(buf);
  if (/\.(html?|xml)$/i.test(name)) return htmlToText(raw);
  if (/\.rtf$/i.test(name)) return rtfToText(raw);
  return raw;
}

// ---------------------------------------------------------------------------
// Office files: a zip of XML
// ---------------------------------------------------------------------------

/** The entries of a zip: name → reader (stored or deflated ones). */
export function readZip(buf: Buffer): Map<string, () => Buffer> {
  const out = new Map<string, () => Buffer>();
  // The end of central directory record.
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  for (let n = 0; n < count && p + 46 <= buf.length && buf.readUInt32LE(p) === 0x02014b50; n++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;
    out.set(name, () => {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + csize);
      if (method === 0) return data;
      if (method === 8) return zlib.inflateRawSync(data);
      throw new Error(`zip method ${method}`);
    });
  }
  return out;
}

const xml = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, ""));
const textOf = (e: Map<string, () => Buffer>, name: string) => e.get(name)?.().toString("utf8") ?? "";

function docxText(e: Map<string, () => Buffer>): string {
  const body = textOf(e, "word/document.xml");
  const heads = [...e.keys()].filter((k) => /^word\/(header|footer)\d*\.xml$/.test(k)).map((k) => paragraphs(textOf(e, k)));
  return [paragraphs(body), ...heads].filter((x) => x.trim()).join("\n\n");
}
function paragraphs(x: string): string {
  return xml(x.replace(/<w:tab\/>/g, "\t").replace(/<w:br\/>/g, "\n").replace(/<\/w:p>/g, "\n").replace(/<w:t[^>]*>/g, "\u0001").replace(/<\/w:t>/g, "\u0002")).replace(/\u0001|\u0002/g, "");
}

function xlsxText(e: Map<string, () => Buffer>): string {
  const shared = [...textOf(e, "xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join("")));
  const names = [...textOf(e, "xl/workbook.xml").matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => decodeEntities(m[1]));
  const sheets = [...e.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort((a, b) => parseInt(a.replace(/\D/g, "")) - parseInt(b.replace(/\D/g, "")));
  return sheets
    .map((k, i) => {
      const rows = [...textOf(e, k).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((r) =>
        [...r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)]
          .map((c) => {
            const type = /t="(\w+)"/.exec(c[1])?.[1];
            const inner = c[2] ?? "";
            if (type === "s") return shared[Number(/<v>(\d+)<\/v>/.exec(inner)?.[1])] ?? "";
            if (type === "inlineStr") return xml(inner);
            return decodeEntities(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "");
          })
          .join("\t")
          .replace(/\t+$/, ""),
      );
      return `## ${names[i] ?? `Sheet ${i + 1}`}\n${rows.filter(Boolean).join("\n")}`;
    })
    .join("\n\n");
}

function pptxText(e: Map<string, () => Buffer>): string {
  return [...e.keys()]
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    .sort((a, b) => parseInt(a.replace(/\D/g, "")) - parseInt(b.replace(/\D/g, "")))
    .map((k, i) => `## Slide ${i + 1}\n${xml(textOf(e, k).replace(/<\/a:p>/g, "\n"))}`)
    .join("\n\n");
}

function odfText(e: Map<string, () => Buffer>): string {
  return xml(textOf(e, "content.xml").replace(/<text:tab\/>/g, "\t").replace(/<\/(text:p|text:h|table:table-row)>/g, "\n").replace(/<\/table:table-cell>/g, "\t"));
}

function officeFile(name: string, buf: Buffer): string {
  const e = readZip(buf);
  if (/\.docx$/i.test(name)) return docxText(e);
  if (/\.xlsx$/i.test(name)) return xlsxText(e);
  if (/\.pptx$/i.test(name)) return pptxText(e);
  return odfText(e);
}

// ---------------------------------------------------------------------------
// PDF: the text in simple, text-based ones
// ---------------------------------------------------------------------------

/** A PDF string (literal or hex) as text. */
function pdfString(s: string): string {
  if (s.startsWith("<")) return Buffer.from(s.slice(1, -1).replace(/\s/g, "").padEnd(Math.ceil((s.length - 2) / 2) * 2, "0"), "hex").toString("latin1");
  return s
    .slice(1, -1)
    .replace(/\\([0-7]{1,3})/g, (_, o: string) => String.fromCharCode(parseInt(o, 8)))
    .replace(/\\(\r\n|\r|\n)/g, "")
    .replace(/\\([nrtbf()\\])/g, (_, c: string) => ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" })[c] ?? c);
}

/** The text of one content stream: the strings of its text operators, lines at the line operators. */
function contentText(c: string): string {
  const out: string[] = [];
  for (const bt of c.matchAll(/BT([\s\S]*?)ET/g)) {
    let line = "";
    for (const m of bt[1].matchAll(/\[((?:\\.|[^\]\\])*)\]\s*TJ|(\((?:\\.|[^)\\])*\)|<[0-9a-fA-F\s]*>)\s*(?:Tj|'|")|(T\*|Td|TD|Tm)\b/g)) {
      if (m[1] !== undefined) {
        for (const x of m[1].matchAll(/(\((?:\\.|[^)\\])*\)|<[0-9a-fA-F\s]*>)|(-?\d+(?:\.\d+)?)/g)) {
          if (x[1]) line += pdfString(x[1]);
          else if (Number(x[2]) < -250) line += " ";
        }
      } else if (m[2]) line += pdfString(m[2]);
      else if (m[3] && line && !line.endsWith("\n")) line += "\n";
    }
    out.push(line);
  }
  return out.join("\n");
}

/** How much of a text looks like words (letters, spaces) — a garbled extraction doesn't. */
function wordish(s: string): number {
  const t = s.replace(/\s+/g, " ").trim();
  if (!t) return 0;
  const good = t.match(/[\p{L}\p{N} .,;:!?()%€$@/-]/gu)?.length ?? 0;
  const words = t.match(/\p{L}{3,}/gu)?.length ?? 0;
  return words < 3 ? 0 : good / t.length;
}

export function pdfText(buf: Buffer): string {
  const raw = buf.toString("latin1");
  const parts: string[] = [];
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    const dict = raw.slice(Math.max(0, (m.index ?? 0) - 400), m.index ?? 0).split("obj").pop() ?? "";
    let data = Buffer.from(m[1], "latin1");
    if (/FlateDecode/.test(dict)) {
      try {
        data = zlib.inflateSync(data);
      } catch {
        continue;
      }
    } else if (/\/Filter/.test(dict)) continue;
    const s = data.toString("latin1");
    // Fonts' character maps and images aren't pages.
    if (!/\bBT\b/.test(s) || /beginbfchar|beginbfrange/.test(s)) continue;
    parts.push(contentText(s));
  }
  return tidy(parts.join("\n\n"));
}

// ---------------------------------------------------------------------------
// The Claude CLI: pictures, scanned PDFs
// ---------------------------------------------------------------------------

async function readWithClaude(file: string, name: string, extraPath?: string): Promise<string> {
  const { findClaudeCli, runClaude } = await import("@/plugins/claude-cli/cli");
  if (!findClaudeCli()) throw new UnsupportedError(t("The Claude CLI isn't installed — it reads pictures and scanned PDFs."));
  // A folder of its own for the one file: the AI may read there, nowhere else.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-doc-"));
  try {
    const copy = path.join(dir, `file${path.extname(name).toLowerCase()}`);
    fs.copyFileSync(file, copy);
    const r = await runClaude<{ text?: string }>(
      `Lies die Datei ${copy} mit dem Read-Werkzeug (ein PDF mit mehr als 20 Seiten in Abschnitten). Gib ihren gesamten Inhalt als Text zurück, in der Sprache des Dokuments, ohne etwas hinzuzufügen oder zu kürzen: bei einem Dokument seinen vollständigen Text (Tabellen als Markdown-Tabellen); bei einem Bild erst den darin sichtbaren Text (OCR), dann in zwei, drei Sätzen, was es zeigt. Kannst du die Datei nicht lesen, gib genau den Text „UNREADABLE: “ und den Grund zurück.`,
      { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      { readDir: dir, timeoutMs: 8 * 60000, maxBudgetUsd: 1, extraPath },
    );
    const text = (r.output?.text ?? "").trim();
    if (/^UNREADABLE:/i.test(text) || /pdftoppm|poppler/i.test(text)) {
      throw new UnsupportedError(/pdftoppm|poppler/i.test(text) ? t("A scanned or complex PDF: the Claude CLI needs Poppler's pdftoppm on this machine to read it (e.g. scoop install poppler).") : text.replace(/^UNREADABLE:\s*/i, ""));
    }
    return text;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Audio: your transcriber
// ---------------------------------------------------------------------------

/**
 * The transcriber you set (Documents → Settings), e.g. `whisper "{file}" --output_format txt --output_dir "{dir}"`:
 * run with {file} and {dir} filled in; its transcript is the .txt it writes into {dir} — else what it prints.
 */
function transcribe(file: string, name: string, command: string): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-audio-"));
  const cmd = command.replace(/\{file\}/g, file).replace(/\{dir\}/g, dir);
  return new Promise((resolve, reject) => {
    execFile(cmd, { shell: true, timeout: 60 * 60000, maxBuffer: 32_000_000, windowsHide: true, cwd: dir }, (err, stdout, stderr) => {
      try {
        const txt = fs.readdirSync(dir).find((f) => /\.(txt|srt|vtt)$/i.test(f));
        const text = txt ? decodeText(fs.readFileSync(path.join(dir, txt))) : stdout;
        if (err && !text.trim()) return reject(new Error(`${t("The transcriber failed")}: ${(stderr || err.message).trim().slice(0, 300)}`));
        resolve(text.replace(/^\d+\n\d\d:\d\d:\d\d[,.]\d+ --> .*\n/gm, "").trim());
      } catch (e) {
        reject(e);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
}

// ---------------------------------------------------------------------------

/** A document's text, by its kind. Throws UnsupportedError for what can't be read here (yet), any other error for a failure. */
export async function extractText(file: string, name: string, kind: DocKind): Promise<string> {
  let text = "";
  if (kind === "text") text = textFile(name, fs.readFileSync(file));
  else if (kind === "office") text = officeFile(name, fs.readFileSync(file));
  else if (kind === "pdf") {
    text = pdfText(fs.readFileSync(file));
    // Nothing sensible in it (a scan, fonts without a plain text mapping): the Claude CLI looks.
    if (text.length < 40 || wordish(text) < 0.8) {
      // The CLI's Read tool renders PDF pages with Poppler's pdftoppm: found, or installed now (if allowed).
      let dir: string;
      try {
        dir = await ensurePoppler();
      } catch (e) {
        throw new UnsupportedError(e instanceof Error ? e.message : String(e));
      }
      text = await readWithClaude(file, name, dir);
    }
  } else if (kind === "image") text = await readWithClaude(file, name);
  else if (kind === "audio") {
    const command = documentSettings().transcriber.trim();
    if (!command) throw new UnsupportedError(t("Audio needs a transcriber: set a command (e.g. Whisper) under Documents → Settings."));
    text = await transcribe(file, name, command);
  } else throw new UnsupportedError(t("This kind of file can't be read (text, Office files, PDFs, pictures and audio can)."));
  text = tidy(text).slice(0, MAX_TEXT);
  if (!text) throw new UnsupportedError(t("No text found in it."));
  return text;
}
