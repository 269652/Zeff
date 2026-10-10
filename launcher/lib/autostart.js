// "Start at log in" — the launcher with --background (a second launcher just exits: single instance).
//
//   Windows  a per-user scheduled task (no admin) at log on AND on unlock / console connect — with
//            Fast Startup a shutdown is a resume, where no log on happens and a Run key or Startup
//            shortcut never fires
//   macOS    a LaunchAgent (~/Library/LaunchAgents/de.zeff.launcher.plist)
//   Linux    an XDG autostart entry (~/.config/autostart/zeff.desktop)
//
// On Linux the launcher also puts itself in the applications menu (ensureMenuEntry).
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ps = require("./ps");

const PLATFORM = process.platform;
const TASK = "Zeff Launcher";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const quoteArg = (a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);

const launchAgent = () => path.join(os.homedir(), "Library", "LaunchAgents", "de.zeff.launcher.plist");
const xdg = (dir, file) => path.join(process.env[`XDG_${dir}_HOME`] || path.join(os.homedir(), dir === "CONFIG" ? ".config" : path.join(".local", "share")), ...file);
const autostartEntry = () => xdg("CONFIG", ["autostart", "zeff.desktop"]);
const menuEntry = () => xdg("DATA", ["applications", "zeff.desktop"]);

/** A .desktop file's Exec= value. */
const desktopExec = (exe, args) => [exe, ...args].map((a) => (/[\s"'\\$`]/.test(a) ? `"${a.replace(/(["\\$`])/g, "\\$1")}"` : a)).join(" ");
const desktopFile = ({ exe, args, icon, extra = [] }) =>
  ["[Desktop Entry]", "Type=Application", "Name=Zeff", "Comment=Runs Zeff and its knowledge server", `Exec=${desktopExec(exe, args)}`, `Icon=${icon}`, "Terminal=false", "Categories=Office;", ...extra, ""].join("\n");

async function enabled() {
  if (PLATFORM === "win32") return (await ps.run("schtasks.exe", ["/Query", "/TN", TASK])).code === 0;
  return fs.existsSync(PLATFORM === "darwin" ? launchAgent() : autostartEntry());
}

async function disable() {
  if (PLATFORM === "win32") return (await ps.run("schtasks.exe", ["/Delete", "/TN", TASK, "/F"])).code === 0;
  fs.rmSync(PLATFORM === "darwin" ? launchAgent() : autostartEntry(), { force: true });
  return true;
}

/** exe + args: what to run (Zeff.exe --background, or electron <app> --background in a checkout). */
async function enable({ exe, args, stateDir, icon }) {
  if (PLATFORM === "darwin") {
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>de.zeff.launcher</string>
  <key>ProgramArguments</key>
  <array>${[exe, ...args].map((a) => `<string>${esc(a)}</string>`).join("")}</array>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Interactive</string>
</dict>
</plist>
`;
    fs.mkdirSync(path.dirname(launchAgent()), { recursive: true });
    fs.writeFileSync(launchAgent(), plist);
    return true;
  }
  if (PLATFORM !== "win32") {
    fs.mkdirSync(path.dirname(autostartEntry()), { recursive: true });
    fs.writeFileSync(autostartEntry(), desktopFile({ exe, args, icon, extra: ["X-GNOME-Autostart-enabled=true"] }));
    return true;
  }
  const user = esc(`${process.env.USERDOMAIN ?? ""}\\${process.env.USERNAME ?? ""}`);
  const session = (change) =>
    `<SessionStateChangeTrigger><Enabled>true</Enabled><StateChange>${change}</StateChange><UserId>${user}</UserId></SessionStateChangeTrigger>`;
  const xml = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Zeff: runs the Zeff and knowledge servers and https://zeff (log on and unlock).</Description></RegistrationInfo>
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled><UserId>${user}</UserId></LogonTrigger>
    ${session("SessionUnlock")}
    ${session("ConsoleConnect")}
  </Triggers>
  <Principals><Principal id="Author"><UserId>${user}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author"><Exec><Command>${esc(exe)}</Command><Arguments>${esc(args.map(quoteArg).join(" "))}</Arguments><WorkingDirectory>${esc(path.dirname(exe))}</WorkingDirectory></Exec></Actions>
</Task>
`;
  // schtasks wants the XML as UTF-16 with a BOM.
  const file = path.join(stateDir, "autostart-task.xml");
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, "utf16le")]));
  const r = await ps.run("schtasks.exe", ["/Create", "/TN", TASK, "/XML", file, "/F"]);
  fs.rmSync(file, { force: true });
  return r.code === 0;
}

/** Linux: Zeff in the applications menu, pointing at this launcher (rewritten when it moved). */
function ensureMenuEntry({ exe, args, icon }) {
  if (PLATFORM !== "linux") return;
  const want = desktopFile({ exe, args, icon, extra: ["StartupWMClass=Zeff"] });
  const file = menuEntry();
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === want) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, want);
  // The autostart entry follows a moved launcher too.
  if (fs.existsSync(autostartEntry())) fs.writeFileSync(autostartEntry(), desktopFile({ exe, args: [...args, "--background"], icon, extra: ["X-GNOME-Autostart-enabled=true"] }));
}

module.exports = { enabled, enable, disable, ensureMenuEntry };
