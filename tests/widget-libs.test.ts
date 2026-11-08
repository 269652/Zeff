import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { libFile, contentTypeOf } from "@/lib/widgets/libs";
import { WIDGET_LIBS } from "@/lib/widgets/sandbox";

test("every file a widget library names is served (and exists)", () => {
  for (const [name, lib] of Object.entries(WIDGET_LIBS)) {
    for (const f of [...(lib.js ?? []), ...(lib.css ?? [])]) {
      const file = libFile(f);
      assert.ok(file, `${name}: ${f} maps to a file`);
      assert.ok(fs.existsSync(file!), `${f} → ${file} exists`);
    }
  }
});

test("katex's fonts (its CSS loads them relatively) are served too", () => {
  const css = fs.readFileSync(libFile("katex/katex.min.css")!, "utf8");
  const font = /url\((fonts\/[^)]+\.woff2)\)/.exec(css)?.[1];
  assert.ok(font);
  assert.ok(fs.existsSync(libFile(`katex/${font}`)!));
});

test("nothing outside the libraries' folders: no traversal, no other package, no unknown library", () => {
  for (const bad of ["katex/../../package.json", "../next/package.json", "katex/..%2F..%2Fpackage.json", "unknown/x.js", "katex", "", "three/../../three/package.json", "katex/fonts/../../../react/index.js"]) {
    assert.equal(libFile(bad), null, bad);
  }
});

test("content types", () => {
  assert.equal(contentTypeOf("a.js"), "text/javascript; charset=utf-8");
  assert.equal(contentTypeOf("a.css"), "text/css; charset=utf-8");
  assert.equal(contentTypeOf("a.woff2"), "font/woff2");
  assert.equal(contentTypeOf("a.exe"), null);
});
