import assert from "node:assert/strict";
import test from "node:test";
import { collectKeys } from "../src/lib/i18n/collect";
import { bundleOf, translate } from "../src/lib/i18n/shared";

/** A text in a language: its bundle's, else English; {placeholders} filled in either. */
test("texts are translated, English when a bundle lacks them, placeholders filled", () => {
  assert.equal(translate("en", "{n} entries", { n: 3 }), "3 entries");
  // A key no bundle has: the English text itself.
  assert.equal(translate("de", "A text nobody translated {x}", { x: 1 }), "A text nobody translated 1");
  // A placeholder without a value stays visible (not "undefined").
  assert.equal(translate("es", "{n} days ago"), bundleOf("es")["{n} days ago"] || "{n} days ago");
});

/** Every text in the code has its German and Spanish — a new one without them fails here (npm run i18n -- --write, then translate). */
test("every UI text is in the German and the Spanish bundle", () => {
  const keys = [...collectKeys().keys()];
  assert.ok(keys.length > 0, "no t(\"…\") texts found");
  for (const lang of ["de", "es"] as const) {
    const b = bundleOf(lang);
    const missing = keys.filter((k) => !b[k]);
    assert.deepEqual(missing.slice(0, 20), [], `${lang}: ${missing.length} text(s) without a translation`);
    // A translation keeps the placeholders of its English text.
    for (const k of keys) {
      const want = [...k.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      const got = [...(b[k] ?? "").matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      assert.deepEqual(got, want, `${lang}: "${k}" → "${b[k]}" loses or adds a placeholder`);
    }
  }
});
