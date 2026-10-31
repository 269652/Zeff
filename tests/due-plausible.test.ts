import assert from "node:assert/strict";
import test from "node:test";

test("a date field's value is saved only once it is whole: not the year half typed (0002-, 0020-, 0202-)", async () => {
  const { plausibleDate } = await import("../src/lib/todos/due-shared");
  for (const v of ["0002-11-15", "0020-11-15", "0202-11-15", "2026-11", "", "15.11.2026", "9999-01-01"]) assert.equal(plausibleDate(v), false, v);
  for (const v of ["2026-11-15", "1999-01-31", "2200-12-31"]) assert.equal(plausibleDate(v), true, v);
});
