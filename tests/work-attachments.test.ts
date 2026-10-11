import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** Pictures and documents pasted into a session: kept, only named back by their ref, handed to the CLI by path. */
test("attachments: kept in the work folder, refs can't leave it", async () => {
  const { attachmentsNote, attachmentsPrompt, resolveAttachments, safeName, saveAttachment } = await import("@/lib/work/attachments");
  const a = saveAttachment("..\..\Bild vom Bildschirm (1).png", Buffer.from("png"));
  assert.equal(a.name, "Bild vom Bildschirm (1).png", "no path from the browser");
  const [one] = resolveAttachments([a.ref]);
  assert.equal(fs.readFileSync(one.path, "utf8"), "png");
  assert.ok(attachmentsPrompt([one]).includes(one.path));
  assert.equal(attachmentsNote([one]), "\n📎 Bild vom Bildschirm (1).png");

  for (const bad of ["../x", "abcdefabcdef/../../zeff.db", "abcdefabcdef/..", "abcdefabcdef/nicht-da.png", "C:/Windows/win.ini", 5]) assert.throws(() => resolveAttachments([bad]), /Anhang/);
  assert.throws(() => saveAttachment("leer.txt", Buffer.alloc(0)), /leer/);
  assert.throws(() => saveAttachment("gross.bin", Buffer.alloc(21 * 1024 * 1024)), /zu groß/);
  assert.equal(safeName(".."), "datei");
  assert.deepEqual(resolveAttachments(undefined), []);
});
