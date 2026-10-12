/**
 * Writes docs/plugins/zeff-plugin.schema.json — the JSON Schema of the plugin manifest, generated from the
 * code that validates it (src/lib/ext/manifest.ts), so editors can complete and check a zeff-plugin.json.
 * tests/ext.test.ts fails when the file is out of date: run `npm run plugin:schema` after changing the manifest.
 */
import fs from "node:fs";
import path from "node:path";
import { manifestJsonSchema } from "../src/lib/ext/schema";

const file = path.join(process.cwd(), "docs", "plugins", "zeff-plugin.schema.json");
fs.writeFileSync(file, manifestJsonSchema());
console.log(`wrote ${path.relative(process.cwd(), file)}`);
