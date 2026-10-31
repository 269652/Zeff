import assert from "node:assert/strict";
import test from "node:test";
import { notificationOf } from "../src/lib/todos/notification-mails";

test("a mail announcing a GitLab or Jira comment names the original", () => {
  const gl = notificationOf({
    subject: "Christopher Lorenz (@chrlorenz1)",
    preview: "Re: PROJ-454: Kategoriebäume migrieren (!175) Christopher Lorenz commented on a discussion on a.php: https://git.example.com/g/p/-/merge_requests/175#note_466019 Oder wird d",
  });
  assert.deepEqual(gl, { gitlab: "note:466019" });
  assert.deepEqual(notificationOf({ subject: "[JIRA] (PROJ-1) x", preview: "See https://jira.example.com/browse/PROJ-1?focusedCommentId=123456&page=x#comment-123456" }), { jira: "123456" });
  assert.deepEqual(notificationOf({ subject: "Lunch", preview: "see https://example.com/menu" }), {});
  // A link to the merge request itself isn't a comment.
  assert.deepEqual(notificationOf({ subject: "MR", preview: "https://git.example.com/g/p/-/merge_requests/175" }), {});
});
