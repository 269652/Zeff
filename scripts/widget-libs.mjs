#!/usr/bin/env node
/**
 * The widget libraries that are put together rather than shipped as one browser file (lib/widgets/libs.ts BUILT): three.js with
 * its add-ons as one window.THREE, the physics engines, the world map. Built with esbuild into node_modules/.cache/zeff-widget-libs
 * (made again when a library's version changes). Run by libs.ts the first time one is asked for, or by hand:
 *
 *   node scripts/widget-libs.mjs [--force]
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = path.resolve(import.meta.dirname, "..");
const NM = path.join(ROOT, "node_modules");
export const OUT = path.join(NM, ".cache", "zeff-widget-libs");
const require = createRequire(path.join(ROOT, "package.json"));
const version = (p) => JSON.parse(fs.readFileSync(path.join(NM, p, "package.json"), "utf8")).version;

const THREE_ADDONS = {
  OrbitControls: "controls/OrbitControls",
  TrackballControls: "controls/TrackballControls",
  MarchingCubes: "objects/MarchingCubes",
  SimplexNoise: "math/SimplexNoise",
  ImprovedNoise: "math/ImprovedNoise",
  Lut: "math/Lut",
  ConvexGeometry: "geometries/ConvexGeometry",
  ParametricGeometry: "geometries/ParametricGeometry",
  TextGeometry: "geometries/TextGeometry",
  RoundedBoxGeometry: "geometries/RoundedBoxGeometry",
  FontLoader: "loaders/FontLoader",
  CSS2DRenderer: "renderers/CSS2DRenderer",
  CSS2DObject: "renderers/CSS2DRenderer",
  EffectComposer: "postprocessing/EffectComposer",
  RenderPass: "postprocessing/RenderPass",
  UnrealBloomPass: "postprocessing/UnrealBloomPass",
  OutputPass: "postprocessing/OutputPass",
};

/** Each built library: its entry (what it puts on window) and the packages whose versions it depends on. */
export const BUILDS = {
  three: {
    deps: ["three"],
    entry: () => {
      const imports = Object.entries(THREE_ADDONS).map(([name, file]) => `import { ${name} } from "three/examples/jsm/${file}.js";`);
      const font = ["helvetiker_regular.typeface.json", "droid/droid_sans_regular.typeface.json"].map((f) => path.join(NM, "three", "examples", "fonts", f)).find((f) => fs.existsSync(f));
      return [
        'import * as T from "three";',
        'import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";',
        ...imports,
        `const THREE = Object.assign({}, T, { ${Object.keys(THREE_ADDONS).join(", ")}, BufferGeometryUtils, mergeGeometries: BufferGeometryUtils.mergeGeometries });`,
        font ? `THREE.defaultFont = new FontLoader().parse(${fs.readFileSync(font, "utf8")});` : "",
        "window.THREE = THREE;",
      ].join("\n");
    },
  },
  physics: {
    deps: ["cannon-es", "matter-js"],
    entry: () => 'import * as CANNON from "cannon-es"; import Matter from "matter-js"; window.CANNON = CANNON; window.Matter = Matter;',
  },
  geo: {
    deps: ["topojson-client", "world-atlas"],
    entry: () =>
      `import * as topojson from "topojson-client"; window.topojson = topojson; window.ZeffWorld = { countries: ${fs.readFileSync(path.join(NM, "world-atlas", "countries-110m.json"), "utf8")}, land: ${fs.readFileSync(path.join(NM, "world-atlas", "land-110m.json"), "utf8")} };`,
  },
};

export const builtFile = (name) => path.join(OUT, `${name}.js`);
const stampOf = (name) => BUILDS[name].deps.map((d) => `${d}@${version(d)}`).join(",");

/** Builds what is missing or out of date (all with force). */
export async function buildWidgetLibs(names = Object.keys(BUILDS), force = false) {
  const esbuild = require("esbuild");
  fs.mkdirSync(OUT, { recursive: true });
  for (const name of names) {
    const file = builtFile(name);
    const stamp = `/* zeff-widget-lib ${name} ${stampOf(name)} */\n`;
    if (!force && fs.existsSync(file) && fs.readFileSync(file, "utf8").startsWith(stamp)) continue;
    const r = await esbuild.build({
      stdin: { contents: BUILDS[name].entry(), resolveDir: ROOT, loader: "js" },
      bundle: true,
      format: "iife",
      platform: "browser",
      target: "es2020",
      minify: true,
      write: false,
      legalComments: "none",
      define: { "process.env.NODE_ENV": '"production"' },
      logLevel: "silent",
    });
    fs.writeFileSync(file, stamp + r.outputFiles[0].text);
    console.log(`built ${name} (${Math.round(r.outputFiles[0].text.length / 1024)} KB)`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const force = process.argv.includes("--force");
  const names = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  await buildWidgetLibs(names.length ? names : undefined, force);
}
