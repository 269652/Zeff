import type { LibraryBlock } from "./block-library";

/**
 * More ready-made widgets for the block library (block-library.ts) and the editor's "/" menu: small tools in plain HTML and
 * JavaScript — no libraries, no network. What they keep (a date, ticks) goes into the widget's own state (zeff.state), so on a
 * page they remember it. Client-safe.
 */

const STYLE = `<style>
*{box-sizing:border-box}
input,select,textarea,button{font:inherit;padding:6px 10px;border:1px solid #d4d4d8;border-radius:8px;background:transparent;color:inherit}
button{cursor:pointer;background:#f4f4f5;color:#18181b}
button.p{background:#6366f1;border-color:#6366f1;color:#fff}
.r{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0}
.big{font-size:34px;font-variant-numeric:tabular-nums}
.m{color:#71717a;font-size:13px}
</style>`;

const stopwatch = `${STYLE}
<div class="big" id="t">00:00.0</div>
<div class="r"><button class="p" id="go">Start</button><button id="lap">Lap</button><button id="rs">Reset</button></div>
<ol id="laps" class="m"></ol>
<script>
  let start = 0, acc = 0, timer = null, n = 0;
  const t = document.getElementById("t"), go = document.getElementById("go"), laps = document.getElementById("laps");
  const fmt = (ms) => { const s = ms / 1000; return String(Math.floor(s / 60)).padStart(2, "0") + ":" + (s % 60).toFixed(1).padStart(4, "0"); };
  const now = () => acc + (timer ? Date.now() - start : 0);
  const tick = () => { t.textContent = fmt(now()); };
  go.onclick = () => {
    if (timer) { acc = now(); clearInterval(timer); timer = null; go.textContent = "Start"; }
    else { start = Date.now(); timer = setInterval(tick, 100); go.textContent = "Stop"; }
  };
  document.getElementById("lap").onclick = () => { const li = document.createElement("li"); li.textContent = fmt(now()); laps.prepend(li); n++; };
  document.getElementById("rs").onclick = () => { clearInterval(timer); timer = null; acc = 0; laps.innerHTML = ""; go.textContent = "Start"; tick(); };
</script>`;

const countdown = `${STYLE}
<div class="r"><label class="m">Until <input id="d" type="date"></label></div>
<div class="big" id="o">—</div>
<div class="m" id="s"></div>
<script>
  const d = document.getElementById("d");
  const draw = () => {
    if (!d.value) { document.getElementById("o").textContent = "Pick a date"; document.getElementById("s").textContent = ""; return; }
    const days = Math.ceil((new Date(d.value + "T00:00:00") - new Date()) / 86400000);
    document.getElementById("o").textContent = days > 0 ? days + " days" : days === 0 ? "Today" : Math.abs(days) + " days ago";
    document.getElementById("s").textContent = days > 0 ? "≈ " + (days / 7).toFixed(1) + " weeks" : "";
  };
  d.onchange = () => { draw(); zeff.state.set({ d: d.value }); };
  zeff.state.get().then((s) => { if (s && s.d) d.value = s.d; draw(); }, draw);
</script>`;

const dice = `${STYLE}
<div class="r" id="b"></div>
<div class="big" id="o">🎲</div>
<div class="m" id="h"></div>
<script>
  const hist = [];
  for (const n of [4, 6, 8, 10, 12, 20, 100]) {
    const b = document.createElement("button");
    b.textContent = "d" + n;
    b.onclick = () => { const v = 1 + Math.floor(crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296 * n); hist.unshift("d" + n + ": " + v); document.getElementById("o").textContent = v; document.getElementById("h").textContent = hist.slice(0, 8).join("  ·  "); };
    document.getElementById("b").appendChild(b);
  }
</script>`;

const counter = `${STYLE}
<textarea id="t" rows="5" style="width:100%" placeholder="Type or paste a text …"></textarea>
<div class="r m" id="o"></div>
<script>
  const t = document.getElementById("t");
  const draw = () => {
    const x = t.value, words = (x.trim().match(/\\S+/g) || []).length;
    const sentences = (x.match(/[.!?]+(\\s|$)/g) || []).length;
    document.getElementById("o").innerHTML = "<b>" + words + "</b> words · <b>" + x.length + "</b> characters · <b>" + x.replace(/\\s/g, "").length + "</b> without spaces · <b>" + sentences + "</b> sentences · ≈ <b>" + Math.max(1, Math.round(words / 200)) + "</b> min read";
  };
  t.oninput = draw; draw();
</script>`;

const splitBill = `${STYLE}
<div class="r"><label class="m">Bill <input id="a" type="number" value="80" style="width:100px"></label><label class="m">Tip % <input id="p" type="number" value="10" style="width:70px"></label><label class="m">People <input id="n" type="number" value="4" min="1" style="width:70px"></label></div>
<div class="big" id="o"></div>
<div class="m" id="s"></div>
<script>
  const v = (id) => Number(document.getElementById(id).value) || 0;
  const draw = () => {
    const total = v("a") * (1 + v("p") / 100), each = total / Math.max(1, v("n"));
    document.getElementById("o").textContent = each.toFixed(2) + " each";
    document.getElementById("s").textContent = "Total " + total.toFixed(2) + " (tip " + (total - v("a")).toFixed(2) + ")";
  };
  for (const id of ["a", "p", "n"]) document.getElementById(id).oninput = draw;
  draw();
</script>`;

const loan = `${STYLE}
<div class="r"><label class="m">Amount <input id="a" type="number" value="20000" style="width:110px"></label><label class="m">Interest % <input id="r" type="number" value="4" step="0.1" style="width:80px"></label><label class="m">Years <input id="y" type="number" value="10" style="width:70px"></label></div>
<div class="big" id="o"></div>
<div class="m" id="s"></div>
<script>
  const v = (id) => Number(document.getElementById(id).value) || 0;
  const draw = () => {
    const m = v("r") / 1200, n = Math.max(1, v("y") * 12), a = v("a");
    const pay = m === 0 ? a / n : a * m / (1 - Math.pow(1 + m, -n));
    document.getElementById("o").textContent = pay.toFixed(2) + " / month";
    document.getElementById("s").textContent = "Total " + (pay * n).toFixed(0) + " · interest " + (pay * n - a).toFixed(0);
  };
  for (const id of ["a", "r", "y"]) document.getElementById(id).oninput = draw;
  draw();
</script>`;

const dateDiff = `${STYLE}
<div class="r"><input id="a" type="date"> → <input id="b" type="date"></div>
<div class="big" id="o">—</div>
<div class="m" id="s"></div>
<script>
  const a = document.getElementById("a"), b = document.getElementById("b");
  const t = new Date().toISOString().slice(0, 10);
  a.value = t; b.value = t;
  const draw = () => {
    const days = Math.round((new Date(b.value) - new Date(a.value)) / 86400000);
    document.getElementById("o").textContent = isNaN(days) ? "—" : Math.abs(days) + " days";
    document.getElementById("s").textContent = isNaN(days) ? "" : "≈ " + (Math.abs(days) / 7).toFixed(1) + " weeks · " + (Math.abs(days) / 30.4375).toFixed(1) + " months";
  };
  a.onchange = draw; b.onchange = draw; draw();
</script>`;

const password = `${STYLE}
<div class="r"><input id="o" readonly style="flex:1;min-width:200px;font-family:monospace"><button class="p" id="g">New</button><button id="c">Copy</button></div>
<div class="r m"><label>Length <input id="n" type="number" value="20" min="6" max="64" style="width:70px"></label><label><input type="checkbox" id="s" checked> symbols</label></div>
<script>
  const o = document.getElementById("o");
  const make = () => {
    const set = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789" + (document.getElementById("s").checked ? "!@#$%^&*-_=+?" : "");
    const n = Math.min(64, Math.max(6, Number(document.getElementById("n").value) || 20));
    const r = crypto.getRandomValues(new Uint32Array(n));
    o.value = [...r].map((x) => set[x % set.length]).join("");
  };
  document.getElementById("g").onclick = make;
  document.getElementById("c").onclick = () => { o.select(); try { document.execCommand("copy"); } catch (e) {} };
  make();
</script>`;

const colors = `${STYLE}
<div class="r"><input id="c" type="color" value="#6366f1" style="width:70px;height:48px;padding:2px"><div id="o" class="m"></div></div>
<div class="r" id="p"></div>
<script>
  const c = document.getElementById("c");
  const hsl = (h) => { const r = parseInt(h.slice(1, 3), 16) / 255, g = parseInt(h.slice(3, 5), 16) / 255, b = parseInt(h.slice(5, 7), 16) / 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let H = 0, S = 0; const L = (mx + mn) / 2; if (mx !== mn) { const d = mx - mn; S = L > .5 ? d / (2 - mx - mn) : d / (mx + mn); H = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; H *= 60; } return [Math.round(H), Math.round(S * 100), Math.round(L * 100)]; };
  const draw = () => {
    const h = c.value, [H, S, L] = hsl(h);
    document.getElementById("o").innerHTML = "<b>" + h + "</b><br>rgb(" + parseInt(h.slice(1, 3), 16) + ", " + parseInt(h.slice(3, 5), 16) + ", " + parseInt(h.slice(5, 7), 16) + ")<br>hsl(" + H + ", " + S + "%, " + L + "%)";
    document.getElementById("p").innerHTML = [90, 75, 60, 45, 30, 15].map((l) => '<div title="hsl(' + H + "," + S + "%," + l + '%)" style="width:48px;height:48px;border-radius:8px;background:hsl(' + H + "," + S + "%," + l + '%)"></div>').join("");
  };
  c.oninput = draw; draw();
</script>`;

const habits = `${STYLE}
<div class="r"><input id="n" placeholder="New habit …" style="flex:1"><button class="p" id="add">Add</button></div>
<div id="o"></div>
<script>
  let data = { habits: [] };
  const days = [...Array(7)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - 6 + i); return d.toISOString().slice(0, 10); });
  const save = () => zeff.state.set(data);
  const draw = () => {
    const o = document.getElementById("o");
    o.innerHTML = '<div class="r m" style="margin-left:140px">' + days.map((d) => '<span style="width:34px;text-align:center">' + new Date(d + "T12:00").toLocaleDateString(undefined, { weekday: "short" }) + "</span>").join("") + "</div>";
    data.habits.forEach((h, i) => {
      const row = document.createElement("div");
      row.className = "r";
      row.innerHTML = '<span style="width:132px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + h.name.replace(/</g, "&lt;") + "</span>" + days.map((d) => '<span style="width:34px;text-align:center"><input type="checkbox" data-i="' + i + '" data-d="' + d + '"' + (h.done.includes(d) ? " checked" : "") + "></span>").join("") + '<span class="m">🔥 ' + streak(h) + "</span>";
      o.appendChild(row);
    });
    o.querySelectorAll("input[type=checkbox]").forEach((c) => c.onchange = () => { const h = data.habits[c.dataset.i]; h.done = c.checked ? [...new Set([...h.done, c.dataset.d])] : h.done.filter((x) => x !== c.dataset.d); save(); draw(); });
  };
  const streak = (h) => { let n = 0; for (let i = 6; i >= 0; i--) { if (h.done.includes(days[i])) n++; else if (i !== 6) break; } return n; };
  document.getElementById("add").onclick = () => { const v = document.getElementById("n").value.trim(); if (!v) return; data.habits.push({ name: v, done: [] }); document.getElementById("n").value = ""; save(); draw(); };
  zeff.state.get().then((s) => { if (s && Array.isArray(s.habits)) data = s; draw(); }, draw);
</script>`;

const picker = `${STYLE}
<textarea id="t" rows="4" style="width:100%" placeholder="One name per line"></textarea>
<div class="r"><button class="p" id="go">Pick one</button><button id="sh">Shuffle all</button></div>
<div class="big" id="o">—</div>
<script>
  const lines = () => document.getElementById("t").value.split("\\n").map((x) => x.trim()).filter(Boolean);
  const rnd = (n) => Math.floor(crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296 * n);
  document.getElementById("go").onclick = () => { const l = lines(); document.getElementById("o").textContent = l.length ? l[rnd(l.length)] : "—"; };
  document.getElementById("sh").onclick = () => { const l = lines(); for (let i = l.length - 1; i > 0; i--) { const j = rnd(i + 1); [l[i], l[j]] = [l[j], l[i]]; } document.getElementById("o").innerHTML = l.map((x, i) => (i + 1) + ". " + x.replace(/</g, "&lt;")).join("<br>") || "—"; document.getElementById("o").style.fontSize = "18px"; };
</script>`;

const plotter = `${STYLE}
<div class="r"><label class="m">y = <input id="f" value="sin(x) * x / 2" style="width:240px"></label><label class="m">from <input id="a" type="number" value="-10" style="width:70px"></label><label class="m">to <input id="b" type="number" value="10" style="width:70px"></label></div>
<canvas id="c" width="560" height="280" style="width:100%;max-width:560px;border:1px solid #d4d4d8;border-radius:8px"></canvas>
<div class="m" id="e"></div>
<script>
  const c = document.getElementById("c"), g = c.getContext("2d");
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  const draw = () => {
    const a = Number(document.getElementById("a").value), b = Number(document.getElementById("b").value);
    const src = document.getElementById("f").value.replace(/\\^/g, "**");
    const err = document.getElementById("e"); err.textContent = "";
    if (!(b > a) || !/^[0-9x+\\-*/().,\\sa-z*]+$/i.test(src)) { err.textContent = "Check the range and the formula."; return; }
    let fn;
    try { fn = Function("x", "with(Math){ return (" + src + "); }"); fn(0); } catch (e) { err.textContent = "I can't read this formula."; return; }
    const W = c.width, H = c.height, pts = [];
    for (let i = 0; i <= W; i++) { const x = a + (b - a) * i / W; let y; try { y = fn(x); } catch (e) { y = NaN; } pts.push([x, y]); }
    const ys = pts.map((p) => p[1]).filter(Number.isFinite);
    let lo = Math.min(...ys), hi = Math.max(...ys);
    if (!ys.length) { err.textContent = "Nothing to draw here."; return; }
    if (lo === hi) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    g.clearRect(0, 0, W, H);
    g.strokeStyle = dark ? "#52525b" : "#d4d4d8"; g.lineWidth = 1;
    const x0 = (0 - a) / (b - a) * W, y0 = H - (0 - lo) / (hi - lo) * H;
    if (x0 >= 0 && x0 <= W) { g.beginPath(); g.moveTo(x0, 0); g.lineTo(x0, H); g.stroke(); }
    if (y0 >= 0 && y0 <= H) { g.beginPath(); g.moveTo(0, y0); g.lineTo(W, y0); g.stroke(); }
    g.strokeStyle = "#6366f1"; g.lineWidth = 2; g.beginPath();
    let pen = false;
    for (const [x, y] of pts) {
      if (!Number.isFinite(y)) { pen = false; continue; }
      const px = (x - a) / (b - a) * W, py = H - (y - lo) / (hi - lo) * H;
      if (pen) g.lineTo(px, py); else g.moveTo(px, py);
      pen = true;
    }
    g.stroke();
  };
  for (const id of ["f", "a", "b"]) document.getElementById(id).oninput = draw;
  draw();
</script>`;

const bmi = `${STYLE}
<div class="r"><label class="m">Weight (kg) <input id="w" type="number" value="70" style="width:90px"></label><label class="m">Height (cm) <input id="h" type="number" value="175" style="width:90px"></label></div>
<div class="big" id="o"></div>
<div class="m" id="s"></div>
<script>
  const v = (id) => Number(document.getElementById(id).value) || 0;
  const draw = () => {
    const m = v("h") / 100, b = m ? v("w") / (m * m) : 0;
    document.getElementById("o").textContent = b ? b.toFixed(1) : "—";
    document.getElementById("s").textContent = !b ? "" : b < 18.5 ? "Underweight" : b < 25 ? "Normal range" : b < 30 ? "Overweight" : "Obese";
  };
  document.getElementById("w").oninput = draw; document.getElementById("h").oninput = draw; draw();
</script>`;

const w = (name: string, title: string, icon: string, description: string, html: string, height: number): LibraryBlock => ({
  category: "widgets",
  name,
  title,
  icon,
  description,
  params: [],
  template: "",
  widget: { html, libs: [], writes: [], ai: false, flows: [], height },
  example: `<use block="${name}"/>`,
});

export const WIDGET_PRESETS: LibraryBlock[] = [
  w("lib.stopwatch", "Stopwatch", "⏲️", "Start, stop, lap and reset (a widget).", stopwatch, 220),
  w("lib.countdown", "Countdown to a date", "📆", "Days until a day you pick — remembered on a page (a widget).", countdown, 150),
  w("lib.dice", "Dice", "🎲", "Roll a d4 … d100 with a short history (a widget).", dice, 170),
  w("lib.word-counter", "Word counter", "🔤", "Words, characters, sentences and reading time of a text (a widget).", counter, 230),
  w("lib.split-bill", "Split the bill", "🧾", "Bill, tip and people — what everyone pays (a widget).", splitBill, 150),
  w("lib.loan", "Loan calculator", "🏦", "The monthly rate of a loan, the total and the interest (a widget).", loan, 150),
  w("lib.date-diff", "Days between dates", "🗓️", "Days, weeks and months between two dates (a widget).", dateDiff, 150),
  w("lib.password", "Password generator", "🔐", "A strong random password, copied with a click (a widget).", password, 150),
  w("lib.colors", "Colour picker", "🎨", "A colour as hex, rgb and hsl, with a lightness palette (a widget).", colors, 190),
  w("lib.habits", "Habit tracker", "✅", "Tick habits for the last seven days with streaks — remembered on a page (a widget).", habits, 280),
  w("lib.random-pick", "Random pick & shuffle", "🎯", "Draw a name from a list or shuffle them all (a widget).", picker, 260),
  w("lib.plotter", "Function plotter", "📈", "Draws y = f(x) for any formula, e.g. sin(x) * x / 2 (a widget).", plotter, 380),
  w("lib.bmi", "BMI", "⚖️", "Body mass index from weight and height (a widget).", bmi, 140),
];
