import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

const mod = import("../scripts/cdp-endpoint.mjs");

const BRIDGED = { ZEFF_CDP_BASE: "http://host.docker.internal", ZEFF_BRIDGE_TOKEN: "tok".repeat(10) };

test("on the host: the debug port is 127.0.0.1's; in a container: the bridge's, port + offset, behind the token", async () => {
  const { cdpEndpoint, bridgeEnv } = await mod;
  assert.equal(bridgeEnv({}), null);
  assert.equal(cdpEndpoint(9222, {}), "http://127.0.0.1:9222");
  assert.equal(cdpEndpoint(9222, BRIDGED), `http://host.docker.internal:10222/${BRIDGED.ZEFF_BRIDGE_TOKEN}`);
  assert.equal(cdpEndpoint(9231, { ...BRIDGED, ZEFF_CDP_OFFSET: "2000" }), `http://host.docker.internal:11231/${BRIDGED.ZEFF_BRIDGE_TOKEN}`);
  assert.equal(bridgeEnv({ ZEFF_CDP_BASE: "http://x" }), null, "a base without the token is no bridge");
});

test("which debug port an endpoint through the bridge stands for", async () => {
  const { bridgedPort, cdpEndpoint } = await mod;
  assert.equal(bridgedPort(cdpEndpoint(9231, BRIDGED), BRIDGED), 9231);
  assert.equal(bridgedPort(`${cdpEndpoint(9222, BRIDGED)}/`, BRIDGED), 9222);
  assert.equal(bridgedPort("http://127.0.0.1:9222", BRIDGED), null, "not the bridge");
  assert.equal(bridgedPort(`http://other:10222/${BRIDGED.ZEFF_BRIDGE_TOKEN}`, BRIDGED), null, "another host");
  assert.equal(bridgedPort(cdpEndpoint(9222, BRIDGED), {}), null, "no bridge here");
  assert.equal(bridgedPort("nonsense", BRIDGED), null);
});

test("starting the browser through the bridge: the port and the pages are asked for, the bridge's no is passed on", async () => {
  const { bridgeLaunch } = await mod;
  const asked: { url: string; body: string }[] = [];
  let answer: { code: number; body: unknown } = { code: 200, body: { ok: true } };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      asked.push({ url: req.url ?? "", body });
      res.writeHead(answer.code, { "content-type": "application/json" });
      res.end(JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const env = { ZEFF_CDP_BASE: "http://127.0.0.1", ZEFF_BRIDGE_TOKEN: "abc".repeat(10), ZEFF_BRIDGE_CONTROL_PORT: String((server.address() as AddressInfo).port) };
  try {
    await bridgeLaunch(9231, ["https://chrono.example/"], env);
    assert.equal(asked[0].url, `/${env.ZEFF_BRIDGE_TOKEN}/launch`);
    assert.deepEqual(JSON.parse(asked[0].body), { port: 9231, urls: ["https://chrono.example/"] });
    answer = { code: 500, body: { ok: false, error: "No browser found" } };
    await assert.rejects(bridgeLaunch(9222, [], env), /No browser found/);
    await assert.rejects(bridgeLaunch(9222, [], {}), /No bridge/);
  } finally {
    server.close();
    server.closeAllConnections();
  }
  await assert.rejects(bridgeLaunch(9222, [], { ...env, ZEFF_BRIDGE_CONTROL_PORT: "1" }), /bridge .*doesn't answer|npm run docker:bridge/);
});
