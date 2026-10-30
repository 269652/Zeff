import assert from "node:assert/strict";
import test from "node:test";
import { fencedJson, jsonIn, lastJson, mendJson } from "../src/lib/ai/json";

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

test("lastJson: the last ```json block, else the last object that parses, else null", () => {
  assert.deepEqual(lastJson('```json\n{"a": 1}\n```\nthen\n```json\n{"a": 2}\n```'), { a: 2 });
  assert.deepEqual(lastJson('```json\n{"a": 1}\n```\n```json\n{broken\n```'), { a: 1 });
  assert.deepEqual(lastJson('Done. {"outcome": "done", "x": {"y": 1}}'), { outcome: "done", x: { y: 1 } });
  assert.deepEqual(lastJson('```json\n{"t": "Er sagte „Hallo" und ging"}\n```'), { t: 'Er sagte „Hallo" und ging' });
  assert.equal(lastJson("no json here"), null);
});

test("fencedJson takes only a block that is accepted", () => {
  const text = '```json\n{"outcome": "done"}\n```\n```json\n{"other": 1}\n```';
  assert.deepEqual(fencedJson(text, (v) => typeof (v as { outcome?: unknown }).outcome === "string"), { outcome: "done" });
  assert.equal(fencedJson("```json\n{}\n```", () => false), undefined);
});
