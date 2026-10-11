import crypto from "node:crypto";
import zlib from "node:zlib";
import { t } from "@/lib/i18n/server";

/**
 * ZIP archives, with or without a password — encrypted as WinZip AES-256 (AE-2: PBKDF2-SHA1 keys,
 * AES-256 in CTR mode with a little-endian counter, an HMAC-SHA1 code per file), which 7-Zip,
 * WinZip and libarchive open. No ZIP64: entries and archive under 4 GB.
 */

export type ZipEntry = { name: string; data: Buffer; modified?: Date };

const AES_STRENGTH = 3; // 256 bit
const KEY_LEN = 32;
const SALT_LEN = 16;
const AUTH_LEN = 10;

/** The keys from a password and a salt: for encrypting, for the code, and two bytes to check the password with. */
function keys(password: string, salt: Buffer) {
  const k = crypto.pbkdf2Sync(Buffer.from(password, "utf8"), salt, 1000, 2 * KEY_LEN + 2, "sha1");
  return { enc: k.subarray(0, KEY_LEN), auth: k.subarray(KEY_LEN, 2 * KEY_LEN), verify: k.subarray(2 * KEY_LEN) };
}

/** AES-256-CTR as WinZip does it: the counter little-endian, starting at 1 (the same both ways). */
function ctr(key: Buffer, data: Buffer): Buffer {
  const blocks = Math.ceil(data.length / 16);
  const counters = Buffer.alloc(blocks * 16);
  // (Its low 32 bits are plenty: under 4 GB there are fewer blocks than that.)
  for (let i = 0; i < blocks; i++) counters.writeUInt32LE(i + 1, i * 16);
  const ecb = crypto.createCipheriv("aes-256-ecb", key, null);
  ecb.setAutoPadding(false);
  const stream = Buffer.concat([ecb.update(counters), ecb.final()]);
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ stream[i];
  return out;
}

/** MS-DOS time and date (local time, as ZIP tools show it). */
function dos(d: Date) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** A ZIP of these files — encrypted (AES-256) when there's a password. */
export function createZip(entries: ZipEntry[], password?: string): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name.replace(/\\/g, "/"), "utf8");
    const deflated = zlib.deflateRawSync(e.data, { level: 9 });
    const { time, date } = dos(e.modified ?? new Date());
    const encrypted = !!password;
    let body = deflated;
    let extra = Buffer.alloc(0);
    if (encrypted) {
      const salt = crypto.randomBytes(SALT_LEN);
      const k = keys(password!, salt);
      const cipher = ctr(k.enc, deflated);
      const auth = crypto.createHmac("sha1", k.auth).update(cipher).digest().subarray(0, AUTH_LEN);
      body = Buffer.concat([salt, k.verify, cipher, auth]);
      // The AES extra field: AE-2, vendor "AE", 256 bit, the real method (deflate).
      extra = Buffer.alloc(11);
      extra.writeUInt16LE(0x9901, 0);
      extra.writeUInt16LE(7, 2);
      extra.writeUInt16LE(2, 4);
      extra.write("AE", 6, "latin1");
      extra.writeUInt8(AES_STRENGTH, 8);
      extra.writeUInt16LE(8, 9);
    }
    const flags = (encrypted ? 0x0001 : 0) | 0x0800; // encrypted; names in UTF-8
    const method = encrypted ? 99 : 8;
    const crc = encrypted ? 0 : zlib.crc32(e.data); // AE-2: no CRC (the HMAC checks it)
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(encrypted ? 51 : 20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(extra.length, 28);
    parts.push(local, name, extra, body);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(encrypted ? 51 : 20, 4);
    cd.writeUInt16LE(encrypted ? 51 : 20, 6);
    cd.writeUInt16LE(flags, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc >>> 0, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(e.data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt16LE(extra.length, 30);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name, extra);
    offset += local.length + name.length + extra.length + body.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, end]);
}

export class ZipPasswordError extends Error {}

/** The files in a ZIP (deflated or stored; AES-encrypted ones with the password) — checked (CRC or HMAC). */
export function readZip(zip: Buffer, password?: string): ZipEntry[] {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(t("Not a ZIP file (no central directory found)."));
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const out: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error(t("Damaged ZIP central directory."));
    const flags = zip.readUInt16LE(p + 8);
    let method = zip.readUInt16LE(p + 10);
    const crc = zip.readUInt32LE(p + 16);
    const size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const at = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString(flags & 0x0800 ? "utf8" : "latin1");
    const extra = zip.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);
    p += 46 + nameLen + extraLen + commentLen;
    const start = at + 30 + zip.readUInt16LE(at + 26) + zip.readUInt16LE(at + 28);
    let body = zip.subarray(start, start + size);
    let aesVersion = 0;
    if (method === 99) {
      for (let e = 0; e + 4 <= extra.length; ) {
        const id = extra.readUInt16LE(e);
        const len = extra.readUInt16LE(e + 2);
        if (id === 0x9901) {
          aesVersion = extra.readUInt16LE(e + 4);
          if (extra.readUInt8(e + 8) !== AES_STRENGTH) throw new Error(t("{name}: only AES-256 is supported.", { name }));
          method = extra.readUInt16LE(e + 9);
        }
        e += 4 + len;
      }
      if (!aesVersion) throw new Error(t("{name}: unknown encryption.", { name }));
      if (!password) throw new ZipPasswordError(t("The backup is encrypted — enter the password."));
      const salt = body.subarray(0, SALT_LEN);
      const k = keys(password, salt);
      if (!body.subarray(SALT_LEN, SALT_LEN + 2).equals(k.verify)) throw new ZipPasswordError(t("Wrong password."));
      const cipher = body.subarray(SALT_LEN + 2, body.length - AUTH_LEN);
      const auth = crypto.createHmac("sha1", k.auth).update(cipher).digest().subarray(0, AUTH_LEN);
      if (!auth.equals(body.subarray(body.length - AUTH_LEN))) throw new Error(t("{name}: checksum doesn't match — file damaged.", { name }));
      body = ctr(k.enc, cipher);
    } else if (flags & 0x0001) throw new Error(t("{name}: this encryption isn't supported.", { name }));
    const data = method === 8 ? zlib.inflateRawSync(body) : method === 0 ? Buffer.from(body) : null;
    if (!data) throw new Error(t("{name}: compression {method} isn't supported.", { name, method }));
    if (aesVersion !== 2 && (zlib.crc32(data) >>> 0) !== crc) throw new Error(t("{name}: CRC doesn't match — file damaged.", { name }));
    out.push({ name, data });
  }
  return out;
}
