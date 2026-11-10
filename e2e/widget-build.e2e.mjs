import assert from "node:assert/strict";
import test from "node:test";
import { editor, FAKE_AI, fakeAi, newPage, rx, waitSaved, withPage } from "./helpers.mjs";

test("widget block: / → Widget (AI-built), a sentence, Build — the AI's widget runs in the page (built through its route, the page still saves)", (t) =>
  withPage(t, async (page) => {
    if (!FAKE_AI) return t.skip("needs the fake AI");
    fakeAi({
      title: "Zähler",
      html: '<button id="b">+1</button> <span id="n">0</span><script>let n=0;b.onclick=()=>{n++;document.getElementById("n").textContent=n}</script>',
      libs: [],
      writes: [],
      ai: false,
      note: "Ein Zähler.",
    });
    const routes = [];
    page.on("request", (r) => r.method() === "POST" && routes.push(new URL(r.url()).pathname));
    await newPage(page);
    await editor(page).click();
    await page.keyboard.type("/widget");
    await page.getByRole("option", { name: rx("Widget (AI-built)", "Widget (von der KI gebaut)") }).first().click();
    await page.getByRole("textbox", { name: rx("What should this widget do?", "Was soll dieses Widget tun?") }).fill("Ein Zähler");
    await page.getByRole("button", { name: rx("Build", "Bauen"), exact: true }).click();
    const frame = page.frameLocator("main iframe").first();
    await frame.locator("#b").waitFor({ timeout: 90_000 });
    await frame.locator("#b").click();
    assert.equal(await frame.locator("#n").textContent(), "1", "the widget runs");
    assert.ok(routes.some((p) => p.endsWith("/api/workspace/widget-make")), "built through the route, not a Server Action");
    await waitSaved(page);
  }));
