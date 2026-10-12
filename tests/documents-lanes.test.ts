import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { ROOT, setupTempData } from "./helpers";

// Reading documents in two lanes: a hung Claude run holds up nothing else, can be restarted or
// skipped, and what a gone server left "being read" is picked up again. Fake Claude CLI that answers late.
setupTempData();
process.env.CLAUDE_CLI = path.join(ROOT, "tests", "fake-claude-json.mjs");

const until = async (fn: () => boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
};

async function setup() {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("documents", true);
  setInstalled("claude-cli", true);
  const { addDocument, getDocument } = await import("@/plugins/documents/store");
  const process_ = await import("@/plugins/documents/process");
  return { addDocument, getDocument, ...process_ };
}

test("reading lanes: a hung picture doesn't hold up a text; restart stops it; a skipped one is let go", async () => {
  const { addDocument, getDocument, startProcessing, readingStatus, restartReading, skipDocument } = await setup();
  process.env.FAKE_CLAUDE_DELAY_MS = "60000"; // the picture's reading hangs
  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ text: "Text im Bild" });
  const pic = addDocument("foto.png", Buffer.from("not really a picture"), "image/png").doc;
  const text = addDocument("notiz.txt", Buffer.from("Eine Notiz über den Mietvertrag."), "text/plain").doc;
  startProcessing();
  // The text is read though the picture hangs.
  await until(() => getDocument(text.id)?.status === "ready");
  await until(() => readingStatus().current.some((c) => c.id === pic.id && c.lane === "slow"));
  assert.equal(getDocument(pic.id)?.status, "extracting");
  assert.deepEqual([readingStatus().idle, readingStatus().waiting], [false, 0]);

  // Restart: the run in flight is stopped — that document waits for "Read again" —, nothing is left being read.
  restartReading();
  assert.equal(getDocument(pic.id)?.status, "failed");
  assert.match(getDocument(pic.id)!.error, /Stopped/);
  await until(() => readingStatus().idle);

  // Read again with a quick answer: done.
  process.env.FAKE_CLAUDE_DELAY_MS = "0";
  const { setStatus } = await import("@/plugins/documents/store");
  setStatus(pic.id, "queued");
  startProcessing();
  await until(() => getDocument(pic.id)?.status === "ready");
  const { readableDocuments } = await import("@/plugins/documents/store");
  assert.equal(readableDocuments().find((d) => d.id === pic.id)?.text, "Text im Bild");

  // Skipping one that is being read ends that run only.
  process.env.FAKE_CLAUDE_DELAY_MS = "60000";
  const pic2 = addDocument("foto2.png", Buffer.from("another picture"), "image/png").doc;
  startProcessing();
  await until(() => readingStatus().current.some((c) => c.id === pic2.id));
  skipDocument(pic2.id);
  await until(() => getDocument(pic2.id)?.status === "failed");
  assert.match(getDocument(pic2.id)!.error, /Skipped/);
  await until(() => readingStatus().idle);
});

test("reading: what a gone server left 'being read' is waiting again and read", async () => {
  const { addDocument, getDocument, processDocuments } = await setup();
  process.env.FAKE_CLAUDE_DELAY_MS = "0";
  const { setStatus } = await import("@/plugins/documents/store");
  const doc = addDocument("alt.txt", Buffer.from("Ein Text, den ein früherer Server angefangen hatte."), "text/plain").doc;
  setStatus(doc.id, "extracting"); // nothing in this process works on it
  await processDocuments();
  assert.equal(getDocument(doc.id)?.status, "ready");
});
