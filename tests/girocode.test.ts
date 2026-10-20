import assert from "node:assert/strict";
import test from "node:test";
import { accountFor, amountIn, epcPayload, epcQrSvg, ibanValid, qrMatrix, recipientIn } from "@/lib/girocode";

const IBAN = "DE22 6609 0800 0007 7773 02";

test("girocode: the EPC payload (BCD, 002, UTF-8, SCT) line by line — IBAN without spaces, the amount in euros with a dot, the purpose as unstructured text", () => {
  assert.equal(
    epcPayload({ name: "Nathanael Dienstkonto", iban: IBAN, bic: "GENODE61BBB", amount: 11.52, purpose: "DR II 810/26" }),
    "BCD\n002\n1\nSCT\nGENODE61BBB\nNathanael Dienstkonto\nDE22660908000007777302\nEUR11.52\n\n\nDR II 810/26",
  );
  // Without BIC, amount and purpose: those lines empty, nothing after the last filled one.
  assert.equal(epcPayload({ name: "Nathanael Dienstkonto", iban: IBAN }), "BCD\n002\n1\nSCT\n\nNathanael Dienstkonto\nDE22660908000007777302");
  assert.equal(epcPayload({ name: "N", iban: IBAN, amount: 300 }), "BCD\n002\n1\nSCT\n\nN\nDE22660908000007777302\nEUR300.00");
  // The name clipped to 70, the purpose to 140; line breaks in them become spaces.
  const long = epcPayload({ name: "x".repeat(80), iban: IBAN, purpose: `a\nb ${"y".repeat(200)}` }).split("\n");
  assert.equal(long[5].length, 70);
  assert.equal(long[10].length, 140);
  assert.ok(long[10].startsWith("a b "));
});

test("girocode: what isn't valid is refused — a wrong check digit, a bad BIC, no name, an amount out of range", () => {
  assert.throws(() => epcPayload({ name: "N", iban: "DE23 6609 0800 0007 7773 02" }), /IBAN/);
  assert.throws(() => epcPayload({ name: "N", iban: IBAN, bic: "GENO" }), /BIC/);
  assert.throws(() => epcPayload({ name: "  ", iban: IBAN }), /name/);
  assert.throws(() => epcPayload({ name: "N", iban: IBAN, amount: 0 }), /amount/);
  assert.throws(() => epcPayload({ name: "N", iban: IBAN, amount: 1e10 }), /amount/);
  assert.equal(ibanValid(IBAN), true);
  assert.equal(ibanValid("DE23 6609 0800 0007 7773 02"), false);
});

test("girocode: German amounts — the first one in a text", () => {
  assert.equal(amountIn("Restforderung 11,52 € (Az. DR II 810/26) heute überweisen"), 11.52);
  assert.equal(amountIn("12 Raten à 300 €, erste am 20.10.2026"), 300);
  assert.equal(amountIn("Gesamtforderung 3.618,13 € laut Aufstellung, davon 300 € bezahlt"), 3618.13);
  assert.equal(amountIn("EUR 12,50 an die Kasse"), 12.5);
  assert.equal(amountIn("Betrag: € 1.000"), 1000);
  assert.equal(amountIn("11.52 Euro"), 11.52);
  assert.equal(amountIn("Verfahren DR II 810/26 am 20.10.2026"), null);
});

test("girocode: the recipient a text names (Empfänger …), and an account from a profile's details", () => {
  assert.equal(recipientIn("Dienstkonto für Zahlungen: Empfänger Nathanael Dienstkonto, IBAN DE22 6609 0800 0007 7773 02"), "Nathanael Dienstkonto");
  assert.equal(recipientIn("Kontoinhaberin: Ulla Nathanael; BIC GENODE61BBB"), "Ulla Nathanael");
  assert.equal(recipientIn("Bitte an Frau Nathanael zahlen"), null);
  const details = [
    { key: "iban", value: IBAN },
    { key: "bic", value: "GENODE61BBB" },
    { key: "bank", value: "BBBank Karlsruhe" },
  ];
  assert.deepEqual(accountFor("Ulla Nathanael", details, ["Dienstkonto: Empfänger Nathanael Dienstkonto, IBAN DE22 6609 0800 0007 7773 02"]), {
    name: "Nathanael Dienstkonto",
    iban: IBAN,
    bic: "GENODE61BBB",
    bank: "BBBank Karlsruhe",
  });
  assert.deepEqual(accountFor("Ulla Nathanael", details.slice(0, 1), []), { name: "Ulla Nathanael", iban: IBAN });
  assert.equal(accountFor("Ulla Nathanael", details.slice(1), []), null);
});

test("girocode: the QR code — byte mode, level M: the version by the length, finder and timing patterns, the format bits of level M", () => {
  const size = (m: boolean[][]) => m.length;
  assert.equal(size(qrMatrix("HELLO")), 21); // version 1
  const payload = epcPayload({ name: "Nathanael Dienstkonto", iban: IBAN, bic: "GENODE61BBB", amount: 11.52, purpose: "DR II 810/26" });
  // 94 bytes: version 6 at level M holds 106.
  assert.equal(new TextEncoder().encode(payload).length, 94);
  const m = qrMatrix(payload);
  assert.equal(size(m), 41);
  assert.ok(m.every((row) => row.length === 41));
  // The finder pattern's centre and ring, top left; the timing row between the finders alternates.
  for (const [x, y, dark] of [[3, 3, true], [1, 1, false], [0, 0, true], [7, 7, false]] as const) assert.equal(m[y][x], dark, `${x},${y}`);
  for (let x = 8; x < 41 - 8; x++) assert.equal(m[6][x], x % 2 === 0);
  // The format bits (level M = 00, a mask, BCH, xor 0x5412) read around the top-left finder.
  let bits = 0;
  for (let i = 0; i <= 5; i++) bits |= Number(m[i][8]) << i;
  bits |= Number(m[7][8]) << 6;
  bits |= Number(m[8][8]) << 7;
  bits |= Number(m[8][7]) << 8;
  for (let i = 9; i < 15; i++) bits |= Number(m[8][14 - i]) << i;
  const data = (bits ^ 0x5412) >> 10;
  assert.equal(data >> 3, 0, "level M");
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  assert.equal(((data << 10) | rem) ^ 0x5412, bits);
  // Up to 331 bytes fit (version 13); more is refused.
  assert.equal(size(qrMatrix("x".repeat(331))), 69);
  assert.throws(() => qrMatrix("x".repeat(332)), /long/);
});

test("girocode: the SVG — white with a quiet zone of four modules, one path of the dark ones", () => {
  const svg = epcQrSvg({ name: "Nathanael Dienstkonto", iban: IBAN, amount: 11.52, purpose: "DR II 810/26" });
  assert.match(svg, /^<svg [^>]*viewBox="0 0 45 45"/); // 37 modules (version 5) + 2 × 4
  assert.match(svg, /<rect width="45" height="45" fill="#fff"\/>/);
  assert.match(svg, /<path d="M4 4h7/); // the top-left finder's top row
});
