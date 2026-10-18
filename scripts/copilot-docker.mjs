#!/usr/bin/env node
/**
 * Copilot CLI in the container (see scripts/claude-docker.mjs): Zeff runs this file in place of the CLI (COPILOT_CLI=<this file>);
 * it forwards the call into the service container with `docker exec -i`. `--up`, `--down`, `--status`, `--build`, `--kill <run>` are
 * the same as claude-docker.mjs's — the container is one.
 */
import { main } from "./claude-docker.mjs";

main("copilot").catch((e) => {
  process.stderr.write(`[copilot-docker] ${e?.message ?? e}
`);
  process.exit(1);
});
