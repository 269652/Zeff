/**
 * The GiroCode (EPC QR code, EPC069-12): a SEPA transfer a banking app reads off a QR code — the
 * payload (BCD, version 002, UTF-8, SCT, BIC, recipient, IBAN, amount, the purpose as free text)
 * and the QR code itself (byte mode, error correction M), drawn as SVG. Also what a text says about
 * a payment: an IBAN (check digits right), a German amount, the recipient it names. Pure: server and client.
 */

// ---------------------------------------------------------------------------
// What a text says
// ---------------------------------------------------------------------------

/** ISO 13616: the letters as numbers, the country and check digits moved to the end, mod 97 is 1. */
export function ibanValid(iban: string): boolean {
  const s = iban.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const digits = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const ch of digits) rest = (rest * 10 + Number(ch)) % 97;
  return rest === 1;
}

/** An IBAN as it is written (with or without spaces). */
export const IBAN_RE = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g;
/** A BIC with "BIC" before it. */
export const BIC_RE = /\bBIC:?\s*([A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/;

/** The IBANs in a text, with their check digits right. */
export const ibansIn = (text: string): string[] => [...text.matchAll(IBAN_RE)].map((m) => m[0]).filter(ibanValid);

/** The BIC a text names ("BIC BYLADEM1001"), if any. */
export const bicIn = (text: string): string | null => BIC_RE.exec(text)?.[1] ?? null;

const compact = (iban: string) => iban.replace(/\s+/g, "").toUpperCase();

/** Whether two IBANs are the same account (spaces and case aside). */
export const sameIban = (a: string, b: string) => compact(a) === compact(b);

const NUMBER = String.raw`(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[,.]\d{1,2})?)`;
const AMOUNT_AFTER = new RegExp(String.raw`(?<![\d.,])${NUMBER}\s*(?:€|EUR\b|Euro\b)`, "g");
const AMOUNT_BEFORE = new RegExp(String.raw`(?:€|\bEUR)\s*${NUMBER}(?![\d.,]\d)`, "g");

/** "3.618,13" → 3618.13, "11,52" → 11.52, "1.000" → 1000, "11.52" → 11.52. */
function parseAmount(s: string): number {
  if (s.includes(",")) return Number(s.replace(/\./g, "").replace(",", "."));
  if (/^\d{1,3}(?:\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, ""));
  return Number(s);
}

/** The first amount in euros a text names ("11,52 €", "300 €", "3.618,13 €", "EUR 12,50"), or null. */
export function amountIn(text: string): number | null {
  const found = [...text.matchAll(AMOUNT_AFTER), ...text.matchAll(AMOUNT_BEFORE)].sort((a, b) => a.index - b.index)[0];
  if (!found) return null;
  const n = parseAmount(found[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const RECIPIENT = /(?<![\p{L}])(?:Zahlungsempfänger|Empfänger|Kontoinhaber)(?:in)?:?\s+([^,;\n]+?)(?=\s*(?:[,;\n(]|\.(?:\s|$)|\s(?:IBAN|BIC)\b|$))/u;

/** The recipient a text names ("Empfänger Wagner Dienstkonto, IBAN …"), or null. */
export function recipientIn(text: string): string | null {
  const v = RECIPIENT.exec(text)?.[1]?.trim();
  return v && !/\d/.test(v) ? v.slice(0, 70) : null;
}

export type Account = { name: string; iban: string; bic?: string; bank?: string };

/**
 * The bank account a profile's details make up — the first IBAN, its BIC and bank — paid to the recipient
 * what was said about them names (the text with that IBAN first), else to them. Null without an IBAN.
 */
export function accountFor(name: string, details: { key: string; value: string }[], texts: string[]): Account | null {
  const iban = details.find((d) => d.key === "iban" && ibanValid(d.value))?.value;
  if (!iban) return null;
  const bic = details.find((d) => d.key === "bic")?.value;
  const bank = details.find((d) => d.key === "bank")?.value;
  const withIban = texts.filter((t) => ibansIn(t).some((x) => sameIban(x, iban)));
  const recipient = [...withIban, ...texts].map(recipientIn).find((r) => r);
  return { name: recipient ?? name, iban, ...(bic ? { bic } : {}), ...(bank ? { bank } : {}) };
}

// ---------------------------------------------------------------------------
// The payload
// ---------------------------------------------------------------------------

export type EpcInput = { name: string; iban: string; bic?: string | null; amount?: number | null; purpose?: string | null };

const line = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max).trim();

/**
 * The EPC QR payload: BCD, 002, 1 (UTF-8), SCT, BIC, name (70), IBAN, "EUR12.34", purpose code (empty),
 * structured reference (empty), the purpose as text (140) — nothing after the last filled line.
 * Throws on what a bank wouldn't take: an IBAN with wrong check digits, a malformed BIC, no name, an amount out of range.
 */
export function epcPayload(p: EpcInput): string {
  const name = line(p.name ?? "", 70);
  if (!name) throw new Error("A GiroCode needs the recipient's name.");
  if (!ibanValid(p.iban ?? "")) throw new Error("Not a valid IBAN.");
  const bic = (p.bic ?? "").replace(/\s+/g, "").toUpperCase();
  if (bic && !/^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/.test(bic)) throw new Error("Not a valid BIC.");
  let amount = "";
  if (p.amount != null) {
    if (!(p.amount >= 0.01 && p.amount <= 999999999.99)) throw new Error("The amount must be between 0.01 and 999999999.99 EUR.");
    amount = `EUR${p.amount.toFixed(2)}`;
  }
  const out = ["BCD", "002", "1", "SCT", bic, name, compact(p.iban), amount, "", "", line(p.purpose ?? "", 140)].join("\n").replace(/\n+$/, "");
  if (new TextEncoder().encode(out).length > 331) throw new Error("Too long for a GiroCode.");
  return out;
}

// ---------------------------------------------------------------------------
// The QR code (after Nayuki's QR Code generator: byte mode, error correction M only)
// ---------------------------------------------------------------------------

// Per version (1–13: a GiroCode's 331 bytes at most), at level M: error correction codewords per block, and the number of blocks.
const ECC_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22];
const BLOCKS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9];

/** The modules that carry data and error correction (all but the function patterns). */
function rawModules(v: number): number {
  let n = (16 * v + 128) * v + 64;
  if (v >= 2) {
    const align = Math.floor(v / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (v >= 7) n -= 36;
  }
  return n;
}
const dataCodewords = (v: number) => Math.floor(rawModules(v) / 8) - ECC_M[v] * BLOCKS_M[v];

/** Multiplication in GF(2^8) modulo x^8 + x^4 + x^3 + x^2 + 1. */
function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number): number[] {
  const r = new Array<number>(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = gfMul(r[j], root);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    root = gfMul(root, 2);
  }
  return r;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const r = divisor.map(() => 0);
  for (const b of data) {
    const f = b ^ (r.shift() as number);
    r.push(0);
    divisor.forEach((c, i) => (r[i] ^= gfMul(c, f)));
  }
  return r;
}

/** The codewords of a text: byte mode, padded, split into blocks with their error correction, interleaved. */
function codewords(bytes: Uint8Array, v: number): number[] {
  const bits: number[] = [];
  const put = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  put(4, 4);
  put(bytes.length, v < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const capacity = dataCodewords(v) * 8;
  put(0, Math.min(4, capacity - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  const blocks = BLOCKS_M[v];
  const ecc = ECC_M[v];
  const raw = Math.floor(rawModules(v) / 8);
  const short = blocks - (raw % blocks);
  const shortLen = Math.floor(raw / blocks);
  const divisor = rsDivisor(ecc);
  const all: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const dat = data.slice(k, k + shortLen - ecc + (i < short ? 0 : 1));
    k += dat.length;
    const rem = rsRemainder(dat, divisor);
    if (i < short) dat.push(0);
    all.push([...dat, ...rem]);
  }
  const out: number[] = [];
  for (let i = 0; i < all[0].length; i++) for (let j = 0; j < all.length; j++) if (i !== shortLen - ecc || j >= short) out.push(all[j][i]);
  return out;
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** How badly a mask reads (ISO 18004 rules: runs, blocks, finder-like patterns, the balance of dark and light) — lower is better. */
function penalty(m: boolean[][]): number {
  const n = m.length;
  let score = 0;
  const lines = [...m, ...m.map((_, x) => m.map((row) => row[x]))];
  const finder = [true, false, true, true, true, false, true];
  for (const l of lines) {
    for (let i = 0, run = 1; i < n; i++, run++) {
      if (i === n - 1 || l[i + 1] !== l[i]) {
        if (run >= 5) score += run - 2;
        run = 0;
      }
    }
    for (let i = 0; i + 7 <= n; i++) {
      if (!finder.every((d, j) => l[i + j] === d)) continue;
      const light = (a: number) => l.slice(a, a + 4).every((d) => !d);
      if ((i >= 4 && light(i - 4)) || (i + 11 <= n && light(i + 7))) score += 40;
    }
  }
  for (let y = 0; y + 1 < n; y++) for (let x = 0; x + 1 < n; x++) if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3;
  const dark = m.reduce((a, row) => a + row.filter(Boolean).length, 0);
  score += (Math.ceil(Math.abs(dark * 20 - n * n * 10) / (n * n)) - 1) * 10;
  return score;
}

/** A text as a QR code (byte mode, UTF-8, error correction M, the smallest version it fits — 13 at most): its modules, row by row, true for dark. */
export function qrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  let v = 1;
  while (v <= 13 && 4 + (v < 10 ? 8 : 16) + bytes.length * 8 > dataCodewords(v) * 8) v++;
  if (v > 13) throw new Error("Too long for a QR code (331 bytes at most)."); // a GiroCode's limit: version 13
  const size = v * 4 + 17;
  const m = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => {
    m[y][x] = dark;
    fixed[y][x] = true;
  };

  // Timing, finders (with their separators), alignment patterns.
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        if (cx + dx >= 0 && cx + dx < size && cy + dy >= 0 && cy + dy < size) set(cx + dx, cy + dy, d !== 2 && d !== 4);
      }
    }
  }
  const align: number[] = [];
  if (v > 1) {
    const count = Math.floor(v / 7) + 2;
    const step = Math.ceil((v * 4 + 4) / (count * 2 - 2)) * 2;
    align.push(6);
    for (let pos = size - 7; align.length < count; pos -= step) align.splice(1, 0, pos);
  }
  const last = align.length - 1;
  align.forEach((ax, i) =>
    align.forEach((ay, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }),
  );

  // The format bits (level M, the mask) beside the finders; the version from 7 on.
  const format = (mask: number) => {
    const data = mask; // level M: 00
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((bits >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  format(0);
  if (v >= 7) {
    let rem = v;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (v << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) !== 0;
      set(size - 11 + (i % 3), Math.floor(i / 3), dark);
      set(Math.floor(i / 3), size - 11 + (i % 3), dark);
    }
  }

  // The codewords in the zigzag, two columns at a time from the bottom right.
  const words = codewords(bytes, v);
  let k = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (!fixed[y][x] && k < words.length * 8) {
          m[y][x] = ((words[k >>> 3] >>> (7 - (k & 7))) & 1) !== 0;
          k++;
        }
      }
    }
  }

  // The mask that reads best.
  const masked = (mask: number) => {
    format(mask);
    return m.map((row, y) => row.map((d, x) => (!fixed[y][x] && MASKS[mask](x, y) ? !d : d)));
  };
  let best = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const s = penalty(masked(mask));
    if (s < bestScore) [best, bestScore] = [mask, s];
  }
  return masked(best);
}

/** The dark modules as one SVG path (runs along a row as one rectangle), shifted by the quiet zone. */
export function qrPath(m: boolean[][], quiet = 4): string {
  let d = "";
  m.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue;
      let len = 1;
      while (row[x + len]) len++;
      d += `M${x + quiet} ${y + quiet}h${len}v1h-${len}z`;
      x += len - 1;
    }
  });
  return d;
}

/** The GiroCode of a payment as an SVG (black on white, a quiet zone of four modules). Throws like epcPayload. */
export function epcQrSvg(p: EpcInput): string {
  const m = qrMatrix(epcPayload(p));
  const n = m.length + 8;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${qrPath(m)}" fill="#000"/></svg>`;
}
