// The service container's one process: it answers on :9335 so the launcher can see the container is up. Claude itself runs in
// `docker exec` calls (scripts/claude-docker.mjs).
require("node:net")
  .createServer((s) => s.end("zeff-claude ok\n"))
  .listen(Number(process.env.HEALTH_PORT) || 9335, "0.0.0.0");
