import assert from "node:assert/strict";
import test from "node:test";
import { jsonIn, mendJson } from "../src/lib/ai/json";

test("jsonIn reads a JSON object out of prose and code fences", () => {
  assert.deepEqual(jsonIn('Here you go:\n```json\n{"a": 1, "b": [2]}\n```\nDone.'), { a: 1, b: [2] });
  assert.deepEqual(jsonIn('{"plain": true}'), { plain: true });
});

test("jsonIn mends a German quote closed with a straight one and raw line breaks", () => {
  assert.deepEqual(jsonIn('{"t": "Er sagte „Ich kann jetzt" und ging"}'), { t: 'Er sagte „Ich kann jetzt" und ging' });
  assert.deepEqual(jsonIn('{"t": "zwei\nZeilen"}'), { t: "zwei\nZeilen" });
});

test("jsonIn fails clearly when there is no object", () => {
  assert.throws(() => jsonIn("sorry, no"), /no JSON object/);
});

test("mendJson leaves valid JSON alone", () => {
  const ok = '{"a":"x \\" y","b":1}';
  assert.equal(mendJson(ok), ok);
});
