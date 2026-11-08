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
  lastState = st;
  $("services").replaceChildren(...st.services.map(serviceCard));
  renderModes();
  const check = (ok, yes, no) => el("div", { className: "check" }, el("span", { className: ok ? "ok" : "no", textContent: ok ? "✓" : "!" }), el("span", { textContent: ok ? yes : no }));
  $("checks").replaceChildren(
    check(st.hosts, `hosts: ${st.host} → 127.0.0.1`, `no hosts entry — serving ${st.host}.localhost`),
    check(st.trusted, "certificate trusted", "certificate not trusted — the browser will warn"),
    el("div", { className: "check", textContent: `listening on ${st.httpsPorts.map((p) => `:${p}`).join(", ") || "—"}` }),
  );
  $("autostart").checked = st.autostart;
}

// ---------------------------------------------------------------------------------------------------------------------
// Where each part runs, and what Docker has
// ---------------------------------------------------------------------------------------------------------------------

let current = null; // { modes, services, notes } as saved
let picked = {}; // the switches as they stand in the window
let docker = { available: false, containers: [], error: "…" };
let lastState = null;

const NAMES = { stack: ["Zeff"], knowledge: ["Knowledge"], claude: ["AI tools"], copilot: ["AI tools"], codex: ["AI tools"] };

/** The status of what a switch is about, as the launcher and Docker say it now. */
function stateOf(id, mode) {
  const services = (lastState?.services ?? []).filter((s) => NAMES[id].some((n) => s.name === n || s.name.startsWith(`${n} ·`)));
  const ctrName = id === "stack" ? "zeff-stack" : id === "knowledge" ? "zeff-knowledge" : "zeff-claude";
  const ctr = docker.containers.find((c) => c.name === ctrName || (id === "knowledge" && c.name.startsWith("zeff-knowledge")));
  if (mode === "docker") {
    if (!docker.available) return { dot: "notBuilt", text: `Docker: ${docker.error ?? "not available"}` };
    if (ctr) return { dot: ctr.state === "running" ? "running" : "crashed", text: `in Docker (${ctr.name}) — ${ctr.status}` };
    const s = services[0];
    return { dot: s?.status ?? "stopped", text: s ? `in Docker — ${s.label}` : "in Docker — not started yet" };
  }
  const s = services[0];
  if (id === "claude" || id === "copilot" || id === "codex") return { dot: "stopped", text: "on this computer" };
  return { dot: s?.status ?? "stopped", text: s ? `on this computer — ${s.label}` : "on this computer" };
}

function renderModes() {
  if (!current) return;
  $("modes").replaceChildren(
    ...current.services.map((svc) => {
      const mode = picked[svc.id];
      const note = current.notes[svc.id];
      const st = stateOf(svc.id, mode);
      const choice = (value, text) => {
        const input = el("input", { type: "radio", name: `m-${svc.id}`, checked: mode === value, onchange: () => ((picked[svc.id] = value), renderModes()) });
        return el("label", { className: mode === value ? "on" : "" }, input, text);
      };
      return el(
        "div",
        { className: "mode" },
        el("span", { className: "label", textContent: svc.label }),
        el("div", { className: "switch" }, choice("host", "Host"), choice("docker", "Docker")),
        el("span", { className: "hint", textContent: note ?? svc.hint }),
        el("span", { className: "state" }, el("span", { className: `dot ${st.dot}` }), st.text),
      );
    }),
  );
  const changed = Object.keys(picked).some((id) => picked[id] !== current.modes[id]);
  $("applyModes").disabled = !changed;
  $("applyModes").textContent = changed ? "Apply and restart" : "Apply";
}

function renderDocker() {
  $("dockerState").textContent = docker.available ? `${docker.containers.filter((c) => c.state === "running").length} running · ${docker.containers.length} in all` : (docker.error ?? "");
  const list = $("containers");
  if (!docker.available) return list.replaceChildren(el("div", { className: "empty", textContent: docker.error ?? "Docker is not available." }));
  if (!docker.containers.length) return list.replaceChildren(el("div", { className: "empty", textContent: "No containers." }));
  list.replaceChildren(
    ...docker.containers.map((c) =>
      el(
        "div",
        { className: "ctr" },
        el("span", { className: `dot ${c.state === "running" ? "running" : c.state === "exited" ? "stopped" : "crashed"}` }),
        el("span", {}, el("b", { textContent: c.name }), ...(c.zeff ? [el("span", { className: "badge", textContent: c.service ?? "zeff" })] : [])),
        el("span", { textContent: c.status }),
        el("span", { className: "sub2", textContent: [c.image, c.ports].filter(Boolean).join(" · ") }),
      ),
    ),
  );
}

const loadDocker = () => window.zeff.docker().then((d) => ((docker = d), renderDocker(), renderModes()));
const loadModes = () =>
  window.zeff.modes().then((m) => {
    const fresh = !current;
    current = m;
    if (fresh) picked = { ...m.modes };
    renderModes();
  });

$("applyModes").onclick = () => {
  $("applyModes").disabled = true;
  $("modesNote").textContent = "Restarting the launcher …";
  window.zeff.setModes(picked);
};
$("dockerRefresh").onclick = loadDocker;
// While the window is open and shown: Docker is asked every few seconds (one bounded `docker ps`).
setInterval(() => document.visibilityState === "visible" && loadDocker(), 5000);

// The tabs: Status (the services) and Docker (where each part runs, the containers); the chosen one is kept while the window lives.
function showTab(name) {
  for (const t of document.querySelectorAll(".tab")) t.classList.toggle("on", t.dataset.tab === name);
  for (const id of ["status", "docker", "phone"]) $(`tab-${id}`).hidden = id !== name;
  if (name === "phone") loadPhone();
  try {
    sessionStorage.setItem("tab", name);
  } catch {}
}
for (const t of document.querySelectorAll(".tab")) t.onclick = () => showTab(t.dataset.tab);
try {
  const kept = sessionStorage.getItem("tab");
  showTab(kept === "docker" || kept === "phone" ? kept : "status");
} catch {}
// ---------------------------------------------------------------------------------------------------------------------
// The phone companion: pair a phone (its QR code), the paired ones, unpair
// ---------------------------------------------------------------------------------------------------------------------

const ago = (iso) => {
  if (!iso) return "never";
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return min < 1 ? "just now" : min < 60 ? `${min} min ago` : min < 1440 ? `${Math.round(min / 60)} h ago` : new Date(iso).toLocaleDateString();
};

function renderPhone(st) {
  if (!st.enabled) {
    $("pair").disabled = true;
    $("phoneNote").textContent = st.error ? `The phone companion couldn't start: ${st.error}` : "The phone companion is switched off (zeff-launcher.json: companion).";
    return $("devices").replaceChildren();
  }
  $("pair").disabled = false;
  // Windows Firewall: false → our rule is missing (null: no Windows Firewall, or it couldn't be read).
  $("firewall").hidden = st.firewall !== false;
  $("fwPort").textContent = String(st.port);
  const list = st.devices.map((d) =>
    el(
      "div",
      { className: "ctr" },
      el("span", { className: `dot ${d.connected ? "running" : "stopped"}` }),
      el("span", {}, el("b", { textContent: d.name })),
      el("button", { textContent: "Unpair", onclick: () => window.zeff.companionUnpair(d.id).then(renderPhone) }),
      el("span", { className: "sub2", textContent: d.connected ? "connected" : `last seen ${ago(d.lastSeen)}` }),
    ),
  );
  const where = st.addresses.length ? `Phones find this computer at ${st.addresses.join(", ")} (UDP ${st.port}).` : "No network found — connect this computer to your Wi-Fi.";
  $("devices").replaceChildren(...(list.length ? list : [el("div", { className: "empty", textContent: "No phone paired yet." })]), el("div", { className: "note", textContent: where }));
}

const loadPhone = () => window.zeff.companion().then(renderPhone);
$("fwAllow").onclick = async () => {
  $("fwAllow").disabled = true;
  const r = await window.zeff.companionFirewall();
  $("fwAllow").disabled = false;
  if (r.result === "failed") $("phoneNote").textContent = "The firewall rule couldn't be added — see the launcher's log.";
  renderPhone(r.state);
};
$("pair").onclick = async () => {
  const name = `Phone ${new Date().toLocaleDateString()}`;
  const r = await window.zeff.companionPair(name);
  const svg = new DOMParser().parseFromString(r.svg, "image/svg+xml").documentElement;
  $("qr").replaceChildren(svg);
  $("pairing").hidden = false;
  loadPhone();
};
$("pairDone").onclick = () => {
  $("pairing").hidden = true;
  $("qr").replaceChildren();
};
window.zeff.onCompanion?.(renderPhone);

$("setup").onclick = () => act("setup");
$("autostart").onchange = () => act("autostart");
$("data").onclick = () => act("data");
$("plugins").onclick = () => act("plugins");
$("quit").onclick = () => act("quit");
window.zeff.onState(render);
window.zeff.state().then(render);
loadModes();
loadDocker();
