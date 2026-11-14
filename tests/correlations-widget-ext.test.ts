/** The built-in Correlations widget's tests (correlations-widget) against its port — see correlations-ext.test.ts. */
import test from "node:test";
import { skipWithoutRepo } from "./plugins-repo";

process.env.ZEFF_CORRELATIONS_EXT = "1";
const skip = skipWithoutRepo("correlations-ext");
if (skip) test("The Correlations widget as a plugin", { skip }, () => {});
// eslint-disable-next-line @typescript-eslint/no-require-imports
else require("./correlations-widget.test");
