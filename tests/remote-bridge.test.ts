import assert from "node:assert/strict";
import { test } from "node:test";
import { tunnelArgs } from "../scripts/remote-bridge.mjs";

test("the tunnel: each port on the server's loopback under its own number, fails rather than half-forwards", () => {
  const a = tunnelArgs({ host: "1.2.3.4", user: "zeff-bridge", key: "k", ports: [9230, 10231] });
  assert.deepEqual(a.slice(-5), ["-R", "127.0.0.1:9230:127.0.0.1:9230", "-R", "127.0.0.1:10231:127.0.0.1:10231", "zeff-bridge@1.2.3.4"]);
  assert.ok(a.includes("ExitOnForwardFailure=yes"));
  assert.ok(a.includes("BatchMode=yes"));
});
