import assert from "node:assert/strict";
import test from "node:test";
import { sourceToasts } from "../src/lib/sync/source-toasts";

const t = (s: string, v: Record<string, string | number> = {}) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));
const a = (key: string, title: string, step = key) => ({ key, title, body: "why", step });

/**
 * Sources that aren't well are told once per incident — as ONE notice when several come at once (three red toasts stacked
 * took half a phone's screen), naming them, with the details a click away; a single one as before, with "Sync now".
 */
test("one source: its own notice with Sync now", () => {
  const out = sourceToasts([a("mail", "Mail: silent")], t);
  assert.equal(out.length, 1);
  assert.equal(out[0].text, "Mail: silent — why");
  assert.deepEqual(out[0].action, { kind: "sync", step: "mail" });
});

test("several at once: one notice naming them, details a click away", () => {
  const out = sourceToasts([a("mail", "Mail: silent"), a("whatsapp", "WhatsApp: failing"), a("signal", "Signal: failing")], t);
  assert.equal(out.length, 1);
  assert.equal(out[0].text, "3 sources need attention: Mail: silent, WhatsApp: failing, Signal: failing");
  assert.deepEqual(out[0].action, { kind: "details" });
});

test("none: no notice", () => {
  assert.deepEqual(sourceToasts([], t), []);
});
