import assert from "node:assert/strict";
import test from "node:test";
import { parseHours } from "../src/lib/format";

test("parseHours accepts comma, dot and h:mm", () => {
  assert.equal(parseHours("1,5"), 1.5);
  assert.equal(parseHours("1.5"), 1.5);
  assert.equal(parseHours(" 2 "), 2);
  assert.equal(parseHours(".25"), 0.25);
  assert.equal(parseHours("1:30"), 1.5);
  assert.equal(parseHours("0:20"), 0.33);
});

test("parseHours rejects junk", () => {
  for (const s of ["", " ", "abc", "1.2.3", "1:75", "-1", "1,5h"]) assert.equal(parseHours(s), null, s);
});
