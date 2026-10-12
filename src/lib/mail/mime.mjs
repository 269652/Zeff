/**
 * The attachments of a raw mail (RFC 822 / MIME) — what Gmail hands over as "the original message"
 * (view=att&attid=0), without opening the mail in the web app (so nothing is marked read). Plain
 * JavaScript with no dependencies: the Gmail driver (src/plugins/gmail/driver.mjs) runs standalone,
 * and the tests import it too.
 */

const EXT_TYPES = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  xml: "application/xml",
  html: "text/html",
  htm: "text/html",
  rtf: "application/rtf",
  ics: "text/calendar",
  eml: "message/rfc822",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
  zip: "application/zip",
};

/** A file type from a name's extension ("" when unknown). */
export const mimeOfName = (name) => EXT_TYPES[(/\.([a-z0-9]+)$/i.exec(String(name))?.[1] ?? "").toLowerCase()] ?? "";

/** An extension for a type, for parts that came without a name. */
const extOfMime = (mime) => Object.entries(EXT_TYPES).find(([, m]) => m === mime)?.[0] ?? (/^image\/(\w+)/.exec(mime)?.[1] ?? "bin").replace("jpeg", "jpg");

/** =?UTF-8?B?...?= and =?UTF-8?Q?...?= words (RFC 2047) decoded. */
export function decodeWords(text) {
  return String(text).replace(/=\?([^?\s]+)\?([bq])\?([^?]*)\?=(\s+(?==\?))?/gi, (_, cs, enc, body) => {
    try {
      const bytes = /^b$/i.test(enc) ? Buffer.from(body, "base64") : qpBytes(body.replace(/_/g, " "));
      return new TextDecoder(/^(utf-?8|us-ascii)$/i.test(cs) ? "utf-8" : cs).decode(bytes);
    } catch {
      return body;
    }
  });
}

/** Quoted-printable text as bytes. */
function qpBytes(text) {
  const s = String(text).replace(/=\r?\n/g, "");
  const out = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "=" && /^[0-9a-f]{2}$/i.test(s.slice(i + 1, i + 3))) {
      out.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(s.charCodeAt(i) & 0xff);
  }
  return Buffer.from(out);
}

/** A header's value split into its main value and parameters ("attachment; filename=x" → { value, params }), RFC 2231 continuations and encodings joined. */
export function parseParams(header) {
  const text = String(header ?? "");
  const parts = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\" && quoted) {
      cur += text[++i] ?? "";
      continue;
    }
    if (c === '"') quoted = !quoted;
    else if (c === ";" && !quoted) {
      parts.push(cur);
      cur = "";
    } else cur += c;
  }
  parts.push(cur);
  const value = (parts.shift() ?? "").trim().toLowerCase();
  const raw = new Map();
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq < 0) continue;
    raw.set(p.slice(0, eq).trim().toLowerCase(), p.slice(eq + 1).trim().replace(/^"|"$/g, ""));
  }
  const params = {};
  const names = new Set([...raw.keys()].map((k) => k.replace(/\*\d*\*?$/, "")));
  for (const name of names) {
    const pieces = [];
    let charset = "";
    for (const [k, v] of raw) {
      const m = /^([^*]+)(?:\*(\d+))?(\*)?$/.exec(k);
      if (!m || m[1] !== name) continue;
      const enc = !!m[3];
      let val = v;
      if (enc) {
        const mm = /^([^']*)'[^']*'(.*)$/.exec(val);
        if (mm) {
          charset = charset || mm[1];
          val = mm[2];
        }
        val = decodeEncoded(val, charset);
      }
      pieces.push({ n: m[2] === undefined ? 0 : Number(m[2]), v: val });
    }
    params[name] = decodeWords(pieces.sort((a, b) => a.n - b.n).map((p) => p.v).join(""));
  }
  return { value, params };
}

function decodeEncoded(val, charset) {
  try {
    const bytes = Buffer.from(val.replace(/%([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))), "latin1");
    return new TextDecoder(!charset || /^(utf-?8|us-ascii)$/i.test(charset) ? "utf-8" : charset).decode(bytes);
  } catch {
    return val;
  }
}

/** The headers of a part (unfolded, names lower-cased) and where its body starts. */
function splitPart(raw) {
  const m = /\r?\n\r?\n/.exec(raw);
  const head = m ? raw.slice(0, m.index) : raw;
  const body = m ? raw.slice(m.index + m[0].length) : "";
  const headers = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] ??= line.slice(i + 1).trim();
  }
  return { headers, body };
}

function decodeBody(body, encoding) {
  const e = String(encoding ?? "").trim().toLowerCase();
  if (e === "base64") return Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ""), "base64");
  if (e === "quoted-printable") return qpBytes(body);
  return Buffer.from(body, "latin1");
}

/**
 * Every attachment of a raw mail: `{ id, name, mime, size, inline, data }`, in order (`id` is the
 * position, 1-based). Message bodies (text/plain, text/html without a name) are not attachments;
 * an image with a Content-ID is an `inline` one (a signature's logo, a pasted picture).
 */
export function mimeAttachments(input) {
  const raw = Buffer.isBuffer(input) ? input.toString("latin1") : String(input);
  const out = [];
  const walk = (text, depth) => {
    const { headers, body } = splitPart(text);
    const ct = parseParams(headers["content-type"] ?? "text/plain");
    if (ct.value.startsWith("multipart/") && ct.params.boundary && depth < 12) {
      const marker = `--${ct.params.boundary}`;
      const segments = body.split(new RegExp(`(?:^|\\r?\\n)${marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=--|[ \\t]*\\r?\\n|[ \\t]*$)`));
      // The first segment is the preamble; the one after the closing "--" the epilogue.
      for (const seg of segments.slice(1)) {
        if (seg.startsWith("--")) break;
        walk(seg.replace(/^[ \t]*\r?\n/, ""), depth + 1);
      }
      return;
    }
    const dispo = parseParams(headers["content-disposition"] ?? "");
    const name = (dispo.params.filename || ct.params.name || "").trim();
    const isBody = (ct.value === "text/plain" || ct.value === "text/html") && !name && dispo.value !== "attachment";
    if (isBody) return;
    const contentId = (headers["content-id"] ?? "").trim();
    if (!name && dispo.value !== "attachment" && !(contentId && ct.value.startsWith("image/"))) return;
    // A forwarded mail kept whole (message/rfc822) has headers of its own: its raw text is the file.
    const data = ct.value === "message/rfc822" && !/base64|quoted-printable/i.test(headers["content-transfer-encoding"] ?? "") ? Buffer.from(body, "latin1") : decodeBody(body, headers["content-transfer-encoding"]);
    const n = out.length + 1;
    const mime = ct.value === "application/octet-stream" && name ? mimeOfName(name) || ct.value : ct.value || mimeOfName(name);
    out.push({
      id: String(n),
      name: name || `attachment-${n}.${extOfMime(ct.value)}`,
      mime,
      size: data.length,
      inline: dispo.value === "inline" || (!!contentId && dispo.value !== "attachment"),
      data,
    });
  };
  walk(raw, 0);
  return out;
}
