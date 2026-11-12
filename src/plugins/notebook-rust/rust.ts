/**
 * Rust cells without a REPL: what a cell holds is split into its items (fn, struct, enum, impl, trait, use, const, static, mod,
 * type, macro_rules! …) and the statements of its body. Items stay for the cells after it (once the cell compiled); the
 * statements run once, in a `fn main`, and a last expression without ";" is printed with {:?}. So `let` variables do not live on
 * from one cell to the next in this mode — functions, types and imports do (a persistent REPL, evcxr, keeps variables too).
 * Pure: no files, no processes.
 */

import { RUST_PRELUDE } from "./prelude";

export type RustCell = { items: string[]; body: string[]; tail: string | null };

const ITEM = /^(?:#!?\[[^\]]*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?(?:(?:async|unsafe|const|extern(?:\s+"[^"]*")?)\s+)*(fn|struct|enum|impl|trait|use|static|mod|type|union|macro_rules!|extern\s+crate)\b/;
const CONST_ITEM = /^(?:pub(?:\([^)]*\))?\s+)?const\s+(?!fn\b|unsafe\b|async\b)/;

/** The top-level chunks of Rust source: a chunk ends at a ";" at depth 0, or at the "}" that closes a depth-0 block (when nothing continues it). */
export function rustChunks(src: string): string[] {
  const chunks: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  const n = src.length;
  const push = (end: number) => {
    const c = src.slice(start, end).trim();
    if (c) chunks.push(c);
    start = end;
  };
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && d === "*") {
      let nest = 1;
      i += 2;
      while (i < n && nest) {
        if (src[i] === "/" && src[i + 1] === "*") (nest++, (i += 2));
        else if (src[i] === "*" && src[i + 1] === "/") (nest--, (i += 2));
        else i++;
      }
      continue;
    }
    // raw string r#"…"#
    if ((c === "r" || (c === "b" && d === "r")) && /^(b?r)(#*)"/.test(src.slice(i, i + 12))) {
      const m = /^(b?r)(#*)"/.exec(src.slice(i, i + 12))!;
      const close = `"${m[2]}`;
      const at = src.indexOf(close, i + m[0].length);
      i = at < 0 ? n : at + close.length;
      continue;
    }
    if (c === '"') {
      i++;
      while (i < n && src[i] !== '"') i += src[i] === "\\" ? 2 : 1;
      i++;
      continue;
    }
    if (c === "'") {
      // a char literal ('a', '\n', '\u{..}') — not a lifetime ('a without a closing quote right after)
      const m = /^'(?:\\u\{[0-9a-fA-F_]+\}|\\x[0-9a-fA-F]{2}|\\.|[^\\'])'/.exec(src.slice(i, i + 14));
      i += m ? m[0].length : 1;
      continue;
    }
    if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") {
      depth = Math.max(0, depth - 1);
      if (depth === 0 && c === "}") {
        // A block that closes the chunk — unless an `else`, `.method`, `?`, `;` … goes on.
        const rest = src.slice(i + 1).trimStart();
        if (!/^(else\b|\.|\?|;|\)|,|as\b)/.test(rest)) {
          push(i + 1);
          i++;
          continue;
        }
      }
    } else if (c === ";" && depth === 0) {
      push(i + 1);
    }
    i++;
  }
  push(n);
  return chunks;
}

const isItem = (chunk: string): boolean => ITEM.test(chunk) || CONST_ITEM.test(chunk);

/** A cell split into its items and its body; a last body chunk without ";" (not a block statement) is the tail to print. */
export function splitRust(src: string): RustCell {
  const items: string[] = [];
  const body: string[] = [];
  for (const chunk of rustChunks(src)) (isItem(chunk) ? items : body).push(chunk);
  let tail: string | null = null;
  const last = body[body.length - 1];
  if (last !== undefined && !last.endsWith(";") && !last.endsWith("}") && !/^(let|return|break|continue)\b/.test(last)) tail = body.pop()!;
  return { items, body, tail };
}

/** The program of a cell: the prelude (input(), the output as JSON), the items of the cells before (`earlier`), its own, and `main` with its statements. */
export function rustProgram(cell: RustCell, earlier: string[]): { source: string; bodyLine: number } {
  const head = mergeItems(earlier, cell.items).join("\n");
  const pre = `#![allow(unused)]\n${RUST_PRELUDE}\n${head}\nfn main() {\n`;
  // A last expression without ";" is the cell's value: shown, and handed on as its output.
  const tail = cell.tail === null ? "" : `\n    zeff_return!({ ${cell.tail} });`;
  return { source: `${pre}${cell.body.join("\n")}${tail}\n}\n`, bodyLine: pre.split("\n").length };
}

/** rustc's messages with the lines of the program turned into the lines of the cell's body ("--> cell_3.rs:12:5" → "--> line 3, column 5"; the code excerpts' numbers too). */
export function rustErrors(stderr: string, bodyLine: number): string[] {
  const mapped = (n: number) => n - bodyLine + 1;
  return stderr
    .replace(/\r/g, "")
    .split("\n")
    .map((l) =>
      l
        .replace(/(-->\s*)\S+\.rs:(\d+):(\d+)/, (_m, a: string, ln: string, col: string) => `${a}line ${Math.max(1, mapped(Number(ln)))}, column ${col}`)
        .replace(/^(\s*)(\d+)(\s+\|)/, (m, sp: string, ln: string, bar: string) => (mapped(Number(ln)) >= 1 ? `${sp}${mapped(Number(ln))}${bar}` : m)),
    )
    .filter((l, i, all) => l.trim() || (i > 0 && all[i - 1].trim()));
}

/** What makes an item "the same" as an earlier one when a cell is run again: its kind and name (`fn main2`), or its whole text (impl, use). */
export function itemKey(item: string): string {
  const s = item.replace(/^(?:#!?\[[^\]]*\]\s*)*/, "").trim();
  const m = /^(?:pub(?:\([^)]*\))?\s+)?(?:(?:async|unsafe|const|extern(?:\s+"[^"]*")?)\s+)*(fn|struct|enum|trait|static|const|type|mod|union)\s+(?:mut\s+)?([A-Za-z_]\w*)/.exec(s);
  if (m) return `${m[1] === "const" ? "const" : m[1]}:${m[2]}`;
  const mac = /^macro_rules!\s*([A-Za-z_]\w*)/.exec(s);
  return mac ? `macro:${mac[1]}` : `text:${s}`;
}

/** The items of the cells before and of this one: a later definition of the same name replaces the earlier. */
export function mergeItems(earlier: string[], next: string[]): string[] {
  const keys = new Set(next.map(itemKey));
  return [...earlier.filter((e) => !keys.has(itemKey(e))), ...next.filter((n, i, all) => all.findIndex((x) => itemKey(x) === itemKey(n)) === i)];
}
