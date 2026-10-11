// The status window: one card per server, the https setup, autostart.
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids);
  return node;
};

const act = (action, name) => window.zeff.do(action, name).then(render);

function serviceCard(s) {
  const busy = ["starting", "running", "crashed"].includes(s.status);
  const button = (text, action, enabled = true) => el("button", { textContent: text, disabled: !enabled, onclick: () => act(action, s.name) });
  const meta = [`127.0.0.1:${s.port}`, s.pid ? `pid ${s.pid}` : null, s.restarts ? `${s.restarts} restart${s.restarts > 1 ? "s" : ""}` : null]
    .filter(Boolean)
    .join(" · ");
  return el(
    "div",
    { className: "card" },
    el("div", { className: "row" }, el("span", { className: `dot ${s.status}` }), el("span", { className: "name", textContent: s.name }), el("span", { textContent: s.label })),
    el("div", { className: "meta", textContent: meta }),
    el(
      "div",
      { className: "actions" },
      button("Open", "open", s.status === "running" || s.status === "external"),
      button("Start", "start", s.status === "stopped" || s.status === "notBuilt"),
      button("Stop", "stop", busy),
      button("Restart", "restart", busy),
      button("Log", "log"),
    ),
  );
}

function render(st) {
  const url = $("url");
  url.textContent = st.url;
  url.onclick = () => act("open", "Zeff");
  $("services").replaceChildren(...st.services.map(serviceCard));
  const check = (ok, yes, no) => el("div", { className: "check" }, el("span", { className: ok ? "ok" : "no", textContent: ok ? "✓" : "!" }), el("span", { textContent: ok ? yes : no }));
  $("checks").replaceChildren(
    check(st.hosts, `hosts: ${st.host} → 127.0.0.1`, `no hosts entry — serving ${st.host}.localhost`),
    check(st.trusted, "certificate trusted", "certificate not trusted — the browser will warn"),
    el("div", { className: "check", textContent: `listening on ${st.httpsPorts.map((p) => `:${p}`).join(", ") || "—"}` }),
  );
  $("autostart").checked = st.autostart;
}

$("setup").onclick = () => act("setup");
$("autostart").onchange = () => act("autostart");
$("data").onclick = () => act("data");
$("plugins").onclick = () => act("plugins");
$("quit").onclick = () => act("quit");
window.zeff.onState(render);
window.zeff.state().then(render);
