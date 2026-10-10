// Running programs without a console window — and, on Windows, PowerShell (ps\*.ps1).
const { execFile } = require("node:child_process");
const path = require("node:path");

const PS_DIR = path.join(__dirname, "..", "ps");
const psArgs = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass"];

/** Run a program; resolves { code, stdout, stderr } (never rejects). */
const run = (file, args) =>
  new Promise((resolve) =>
    execFile(file, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout: String(stdout ?? ""), stderr: String(stderr ?? err?.message ?? "") }),
    ),
  );

/** Run ps\<name>.ps1 with arguments. */
const script = (name, args = []) => run("powershell.exe", [...psArgs, "-File", path.join(PS_DIR, name), ...args]);

/** Run a one-line command. */
const command = (cmd) => run("powershell.exe", [...psArgs, "-Command", cmd]);

const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;

module.exports = { run, script, command, quote, PS_DIR };
