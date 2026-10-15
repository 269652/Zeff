import assert from "node:assert/strict";
import test from "node:test";
import { gmailLink, isInboxFolder, isMine, ME_SENDER, sourceLink } from "../src/lib/mail/shared";

test("isMine recognises the stored me-marker, as a message or a bare name", () => {
  assert.equal(ME_SENDER, "Ich");
  assert.equal(isMine({ fromName: "Ich" }), true);
  assert.equal(isMine("Ich"), true);
  assert.equal(isMine({ fromName: "Anna" }), false);
  assert.equal(isMine({ fromName: null }), false);
  assert.equal(isMine(undefined), false);
});

test("the inbox folder test takes Outlook's German and English names", () => {
  assert.equal(isInboxFolder("Posteingang"), true);
  assert.equal(isInboxFolder("Inbox"), true);
  assert.equal(isInboxFolder("Notifications"), false);
});

test("a Gmail thread links to Gmail on the web, by the account's address when the folder has it", () => {
  assert.equal(gmailLink({ convId: "gmail:18c0ff", folder: "Gmail" }), "https://mail.google.com/mail/u/0/#all/18c0ff");
  assert.equal(gmailLink({ convId: "gmail:18c0ff", folder: "Gmail · me@x.com" }), "https://mail.google.com/mail/u/me%40x.com/#all/18c0ff");
  assert.equal(gmailLink({ convId: "wa:1", folder: "WhatsApp" }), null);
  assert.equal(gmailLink({ convId: "AAQk", folder: "Posteingang" }), null);
  assert.equal(sourceLink({ convId: "gmail:18c", folder: "Gmail" })?.label, "Open in Gmail");
  assert.equal(sourceLink({ convId: "AAQk", folder: "Posteingang" })?.label, "Open in Outlook");
  assert.equal(sourceLink({ convId: "sg:1", folder: "Signal" }), null);
});
