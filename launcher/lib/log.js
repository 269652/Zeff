// The launcher's own log (data/logs/launcher.log), echoed to stdout.
const fs = require("node:fs");

let file = null;

/** Keep one previous generation (`<name>.old`) once a log grows past `max` bytes. */
function rotate(path, max) {
  try {
    if (fs.statSync(path).size > max) fs.renameSync(path, `${path}.old`);
  } catch {}
}

function init(path) {
  rotate(path, 2 * 1024 * 1024);
  file = path;
}

function log(...parts) {
  const line = `${new Date().toISOString().slice(0, 19)}Z ${parts.join(" ")}\n`;
  process.stdout.write(line);
  if (file) {
    try {
      fs.appendFileSync(file, line);
    } catch {}
  }
}

module.exports = { init, log, rotate };
