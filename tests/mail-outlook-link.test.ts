import assert from "node:assert/strict";
import test from "node:test";
import { outlookLink } from "../src/lib/mail/shared";

test("an Outlook mail links to its conversation in Outlook on the web; chats and Gmail don't", () => {
  assert.equal(outlookLink({ convId: "AAQkAD/x+y=", folder: "Posteingang" }), "https://outlook.office.com/mail/inbox/id/AAQkAD%2Fx%2By%3D");
  assert.equal(outlookLink({ convId: "wa:123", folder: "WhatsApp" }), null);
  assert.equal(outlookLink({ convId: "sg:abc", folder: "Signal" }), null);
  assert.equal(outlookLink({ convId: "gmail:18c", folder: "Inbox" }), null);
  assert.equal(outlookLink({ convId: "", folder: "Posteingang" }), null);
});
