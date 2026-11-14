/**
 * Correlations as an external plugin (zeff-plugins/plugins/correlations-ext: the built-in's pure core bundled into lambdas, the kernel's
 * daily series): the built-in's tool tests (correlations-mcp) run against the port — the built-in off. The widget's are in
 * correlations-widget-ext.test.ts (each in a database of its own). Skipped where the zeff-plugins repository isn't beside Zeff.
 */
import test from "node:test";
import { skipWithoutRepo } from "./plugins-repo";

process.env.ZEFF_CORRELATIONS_EXT = "1";
const skip = skipWithoutRepo("correlations-ext");
if (skip) test("Correlations as a plugin", { skip }, () => {});
// eslint-disable-next-line @typescript-eslint/no-require-imports
else require("./correlations-mcp.test");
