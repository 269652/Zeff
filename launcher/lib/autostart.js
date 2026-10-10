// "Start with Windows": a per-user scheduled task (no admin) that runs Zeff.exe --background at
// log on AND on unlock / console connect — with Windows Fast Startup a shutdown is a resume,
// where no log on happens and a Run key or Startup shortcut never fires. A second launcher just
// exits (single instance), so the extra triggers are harmless.
const fs = require("node:fs");
const path = require("node:path");
const ps = require("./ps");

const TASK = "Zeff Launcher";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const quoteArg = (a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);

const enabled = async () => (await ps.run("schtasks.exe", ["/Query", "/TN", TASK])).code === 0;

const disable = async () => (await ps.run("schtasks.exe", ["/Delete", "/TN", TASK, "/F"])).code === 0;

/** exe + args: what to run (Zeff.exe --background, or electron.exe <app> --background in a checkout). */
async function enable({ exe, args, stateDir }) {
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

module.exports = { enabled, enable, disable };
