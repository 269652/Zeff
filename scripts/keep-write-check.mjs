// Google Keep schreiben (beta), end to end against a REAL Google Keep: the Keep driver's keep_write
// on one test note titled "Zeff-Test HH:MM:SS (wird gleich gelöscht)" — create (a list with a tick,
// colour, pin, optionally a label), update (title, ticks, an added item, colour, unpin, label off),
// trash — then keep_notes checks no test note is left. Prints only the test note's own fields.
//
//   node scripts/keep-write-check.mjs [--cdp http://127.0.0.1:9231] [--label <an existing label>]
//   node scripts/keep-write-check.mjs --cleanup     only trash leftover "Zeff-Test …" notes
//
// --cdp: the automation Chrome of the account whose Keep is used (Privat: 9231). --label: an
// existing label (a new one would stay in Keep's label list). KEEP_DEBUG=1 traces each step,
// KEEP_SHOTS=<folder> adds a picture of the editor after each.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const cdp = arg("--cdp") ?? "http://127.0.0.1:9231";
const label = arg("--label") ?? null;
const TEST = /^Zeff-Test \d\d:\d\d:\d\d \(wird gleich gelöscht\)/;

const driver = spawn(process.execPath, [path.join(ROOT, "src/plugins/keep/driver.mjs")], { env: { ...process.env, KEEP_CDP_ENDPOINT: cdp }, stdio: ["pipe", "pipe", "inherit"] });
let buf = "";
let next = 1;
const waiting = new Map();
driver.stdout.on("data", (d) => {
  buf += d;
  for (const line of buf.split("\n").slice(0, -1)) {
    const m = JSON.parse(line);
    waiting.get(m.id)?.(m.result);
  }
  buf = buf.slice(buf.lastIndexOf("\n") + 1);
});
const call = (name, args) =>
  new Promise((resolve) => {
    const id = ++next;
    waiting.set(id, (r) => resolve(r?.content?.[0]?.text ?? ""));
    driver.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }) + "\n");
  });
driver.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
const json = (t) => (t.startsWith("{") ? JSON.parse(t) : { error: t });

/** The test notes Keep has — by their title only. */
async function leftovers() {
  const r = json(await call("keep_notes", {}));
  if (r.error) throw new Error(r.error);
  return r.notes.filter((n) => TEST.test(n.title));
}

async function cleanup() {
  for (const n of await leftovers()) {
    const r = json(await call("keep_write", { op: "trash", id: n.id, kind: n.kind, current: n }));
    console.log("trashed", JSON.stringify(n.title), r.confirmed ? "(confirmed)" : `NOT confirmed ${r.error ?? ""}`);
  }
}

const show = (step, t) => {
  const j = json(t);
  if (j.error) {
    console.log(step, "ERROR:", j.error);
    return null;
  }
  const n = j.note;
  console.log(step, JSON.stringify({ confirmed: j.confirmed, ...(n ? { kind: n.kind, title: n.title, text: n.text, color: n.color, pinned: n.pinned, archived: n.archived, labels: n.labels } : {}) }));
  return n;
};

let failed = false;
try {
  if (process.argv.includes("--cleanup")) await cleanup();
  else {
    const title = `Zeff-Test ${new Date().toTimeString().slice(0, 8)} (wird gleich gelöscht)`;
    const created = show("CREATE", await call("keep_write", { op: "create", title, list: true, text: "- [ ] Eins\n- [x] Zwei\n- [ ] Drei", color: "yellow", pinned: true, labels: label ? [label] : [] }));
    const expect = (ok, what) => ok || ((failed = true), console.log("  ✗", what));
    if (created) {
      expect(created.color === "yellow" && created.pinned && (!label || created.labels.includes(label)), "create: colour / pin / label");
      const updated = show("UPDATE", await call("keep_write", { op: "update", id: created.id, kind: "list", title: `${title} – geändert`, list: true, text: "- [x] Eins\n- [x] Zwei\n- [ ] Drei\n- [ ] Vier", color: "green", pinned: false, labels: [] }));
      if (updated) expect(updated.color === "green" && !updated.pinned && !updated.labels.length && /\[ \] Vier/.test(updated.text) && /\[x\] Eins/.test(updated.text), "update: colour / unpin / label off / items");
      else failed = true;
      const trashed = json(await call("keep_write", { op: "trash", id: created.id, kind: "list" }));
      console.log("TRASH ", JSON.stringify(trashed));
      expect(trashed.confirmed, "trash confirmed");
    } else failed = true;
    const left = await leftovers();
    console.log("test notes left in Keep:", left.length, left.length ? "— run with --cleanup" : "");
    if (left.length) failed = true;
  }
} finally {
  driver.kill();
}
process.exit(failed ? 1 : 0);
