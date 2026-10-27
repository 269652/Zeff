import assert from "node:assert/strict";
import test from "node:test";

// A GitLab comment on the code says where it is — file and line(s) — first in its text, for the agent answering it (mr_comments).
test("a note's place: file and line, a range, a removed line; none for a note on the MR or an image", async () => {
  const { notePlace } = await import("@/lib/gitlab/api");
  assert.equal(notePlace({ position_type: "text", new_path: "src/Teaser.php", old_path: "src/Teaser.php", new_line: 42, old_line: null }), "src/Teaser.php:42");
  assert.equal(notePlace({ position_type: "text", new_path: "a.scss", new_line: 44, line_range: { start: { new_line: 40 }, end: { new_line: 44 } } }), "a.scss:40-44");
  assert.equal(notePlace({ position_type: "text", new_path: "old.ts", old_path: "old.ts", new_line: null, old_line: 17 }), "old.ts:17 (removed line)");
  assert.equal(notePlace(null), "");
  assert.equal(notePlace({ position_type: "image", new_path: "x.png", new_line: 1 }), "");
});
