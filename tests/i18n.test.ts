import assert from "node:assert/strict";
import test, { before } from "node:test";
import { collectKeys } from "../src/lib/i18n/collect";
import { rich } from "../src/lib/i18n/rich";
import { bundleOf, translate } from "../src/lib/i18n/shared";
import { skipWithoutRepo, loadRepoLanguages } from "./plugins-repo";

// (German and Spanish are language packs in zeff-plugins: read from there)
before(async () => void (await loadRepoLanguages()));

/** A text in a language: its bundle's, else English; {placeholders} filled in either. */
test("texts are translated, English when a bundle lacks them, placeholders filled", () => {
  assert.equal(translate("en", "{n} entries", { n: 3 }), "3 entries");
  // A key no bundle has: the English text itself.
  assert.equal(translate("de", "A text nobody translated {x}", { x: 1 }), "A text nobody translated 1");
  // A placeholder without a value stays visible (not "undefined").
  assert.equal(translate("es", "{n} days ago"), bundleOf("es")["{n} days ago"] || "{n} days ago");
});

/** A sentence with a link inside: the tag rendered where the language puts it; a tag without a renderer, plain. */
test("rich() puts markup where the translation has its tag", () => {
  const parts = rich("Die <link>Arbeitszeiten</link>-Seite, <b>fett</b>.", { link: (s) => `[${s}]` }) as unknown[];
  const flat = parts.map((p) => (typeof p === "string" ? p : (p as { props: { children: string } }).props.children)).join("");
  assert.equal(flat, "Die [Arbeitszeiten]-Seite, fett.");
});

/** Every text in the code has its German and Spanish — a new one without them fails here (npm run i18n -- --write, then translate). */
test("every UI text is in the German and the Spanish pack", { skip: skipWithoutRepo("lang-de") }, () => {
  const keys = [...collectKeys().keys()];
  assert.ok(keys.length > 0, "no t(\"…\") texts found");
  for (const lang of ["de", "es"] as const) {
    const b = bundleOf(lang);
    const missing = keys.filter((k) => !b[k]);
    assert.deepEqual(missing.slice(0, 20), [], `${lang}: ${missing.length} text(s) without a translation`);
    // A translation keeps the placeholders and the <tags> (rich()) of its English text.
    const marks = (s: string) => [...s.matchAll(/\{(\w+)\}|<(\w+)>.*?<\/\2>/g)].map((m) => m[1] ?? `<${m[2]}>`).sort();
    for (const k of keys) assert.deepEqual(marks(b[k] ?? ""), marks(k), `${lang}: "${k}" → "${b[k]}" loses or adds a placeholder or tag`);
  }
});
