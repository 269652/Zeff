import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

/**
 * A widget's app parts in a real browser (Chrome, headless — skipped when it isn't installed): ZeffKit.form reads the
 * database's fields over the bridge, asks for what is required, sends the row with zeff.db.add; ZeffKit.table shows the rows
 * and reads again on "changed"; a refused call rejects with the page's message. The page here plays Zeff: it answers the
 * calls (the frame is the top window, so it talks to itself).
 */
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => fs.existsSync(p));

test("a form that fills a database and the table under it — over the bridge", { skip: !CHROME && "no Chrome" }, async () => {
  const { chromium } = await import("playwright-core");
  const { buildSrcdoc } = await import("@/lib/widgets/sandbox");
  const { libBundle } = await import("@/lib/widgets/libs");
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    const page = await browser.newPage();
    // (As text: a function's source from tsx would call its own helpers, which the page doesn't have.)
    await page.addInitScript(`
      window.calls = [];
      window.rows = [{ id: 1, title: "Ada", values: { Email: "ada@example.com", Topic: ["Billing"], Urgent: false } }];
      var reply = function (id, ok, value) { window.postMessage(ok ? { zeffHost: 1, type: "reply", id: id, ok: true, value: value } : { zeffHost: 1, type: "reply", id: id, ok: false, error: value }, "*"); };
      window.addEventListener("message", function (e) {
        var m = e.data;
        if (!m || m.zeffWidget !== 1 || m.type !== "call") return;
        window.calls.push({ method: m.method, args: m.args });
        if (m.method === "db.schema")
          return reply(m.id, true, { id: 12, title: "Requests", titleName: "Name", fields: [{ name: "Email", type: "email" }, { name: "Topic", type: "multi_select", options: ["Billing", "Bug"] }, { name: "Urgent", type: "checkbox" }, { name: "Status", type: "status", options: ["New", "Done"] }, { name: "Score", type: "formula", computed: true }] });
        if (m.method === "db.rows") return reply(m.id, true, { db: 12, title: "Requests", titleName: "Name", total: window.rows.length, rows: window.rows });
        if (m.method === "db.add") {
          if (m.args.db !== 12) return reply(m.id, false, "Not allowed: this widget may not write there");
          var v = m.args.values;
          window.rows = window.rows.concat([{ id: window.rows.length + 1, title: String(v.Name), values: v }]);
          reply(m.id, true, { id: window.rows.length });
          window.postMessage({ zeffHost: 1, type: "event", name: "changed" }, "*");
          return;
        }
        reply(m.id, false, "unknown");
      });
    `);
    const html = `<div id="f"></div><div id="t"></div><p id="out"></p>
<script>
  ZeffKit.form("#f", { db: 12, fields: [{ name: "Name", required: true }, { name: "Email", width: "half" }, "Topic", "Urgent"], values: { Status: "New" }, submit: "Senden" });
  ZeffKit.table("#t", { db: 12, columns: ["Name", "Email", "Topic"] });
  zeff.db.add(99, { Name: "x" }).catch(function (e) { document.getElementById("out").textContent = e.message; });
</script>`;
    const doc = buildSrcdoc(html, { inline: libBundle([]), lang: "de", context: { databases: [{ id: 12, title: "Requests" }] } });
    await page.route("http://kit.test/", (r) => r.fulfill({ contentType: "text/html", body: doc }));
    await page.goto("http://kit.test/");
    await page.locator("#out", { hasText: "Not allowed" }).waitFor();
    assert.equal(await page.evaluate(() => (window as unknown as { zeff: { context: { databases: { id: number }[] } } }).zeff.context.databases[0].id), 12, "zeff.context");
    // The table: the row there is.
    await page.locator("#t td", { hasText: "ada@example.com" }).waitFor();
    // The form: Name required, the computed field and the unasked Status left out.
    const labels = await page.locator("#f .zk-field > span, #f .zk-chip").allInnerTexts();
    assert.deepEqual(labels.map((l) => l.trim()), ["Name *", "Email", "Topic", "Billing", "Bug", "Urgent"]);
    await page.getByRole("button", { name: "Senden" }).click();
    await page.locator("#f .zk-msg", { hasText: "Bitte ausfüllen" }).waitFor();
    await page.locator("#f input.zk-in").first().fill("Grace");
    await page.locator("#f input[type=email]").fill("grace@example.com");
    await page.locator("#f label.zk-chip", { hasText: "Bug" }).click();
    await page.locator("#f label.zk-chip", { hasText: "Urgent" }).click();
    await page.getByRole("button", { name: "Senden" }).click();
    await page.locator("#f .zk-msg", { hasText: "Gespeichert" }).waitFor();
    const add = await page.evaluate(() => (window as unknown as { calls: { method: string; args: Record<string, unknown> }[] }).calls.find((c) => c.method === "db.add" && c.args.db === 12));
    assert.deepEqual(add?.args.values, { Name: "Grace", Email: "grace@example.com", Topic: ["Bug"], Urgent: true, Status: "New" });
    assert.equal(await page.locator("#f input.zk-in").first().inputValue(), "", "emptied for the next one");
    // "changed": the table read again and shows the new row.
    await page.locator("#t td", { hasText: "grace@example.com" }).waitFor();
  } finally {
    await browser.close();
  }
});
