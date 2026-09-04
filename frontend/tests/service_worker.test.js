// Offline is not a feature of this app, it is the point of it. A worker underground
// has no signal, so anything the app needs at runtime has to already be on the phone.
//
// These tests read sw.js and index.html as text rather than importing them. sw.js is
// a service worker: it touches `self` at the top level and exports nothing, so there
// is nothing to import. Parsing the source is what lets the asset list be checked
// without bending the worker into a module for the tests' benefit.

import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const FRONTEND = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SW_SOURCE = fs.readFileSync(path.join(FRONTEND, "sw.js"), "utf8");
const INDEX_HTML = fs.readFileSync(path.join(FRONTEND, "index.html"), "utf8");
const APP_SOURCE = fs.readFileSync(path.join(FRONTEND, "js", "app.js"), "utf8");

// the scene string renderArShell builds for tier 2, where the ar.js data paths live
function readTier2SceneMarkup(source) {
  const start = source.indexOf("<a-scene embedded arjs=");
  assert.ok(start !== -1, "app.js must still build a tier 2 a-scene with an arjs attribute");
  const end = source.indexOf("</a-scene>", start);
  assert.ok(end !== -1, "the tier 2 a-scene must be closed");
  return source.slice(start, end);
}

const TIER2_SCENE = readTier2SceneMarkup(APP_SOURCE);

// pull the CACHE_NAME string literal out of the worker source
function readCacheName(source) {
  const match = source.match(/const\s+CACHE_NAME\s*=\s*"([^"]+)"/);
  assert.ok(match, "sw.js must declare CACHE_NAME as a plain string literal");
  return match[1];
}

// pull the STATIC_ASSETS array out of the worker source, comments stripped
function readStaticAssets(source) {
  const start = source.indexOf("const STATIC_ASSETS = [");
  assert.ok(start !== -1, "sw.js must declare STATIC_ASSETS");
  const end = source.indexOf("];", start);
  assert.ok(end !== -1, "STATIC_ASSETS must be a closed array literal");

  const body = source
    .slice(source.indexOf("[", start) + 1, end)
    .replace(/\/\/[^\n]*/g, "");

  return body
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const quoted = entry.match(/^"([^"]*)"$/);
      assert.ok(quoted, `STATIC_ASSETS entry is not a plain quoted string: ${entry}`);
      return quoted[1];
    });
}

// every src/href index.html asks the browser for
function readIndexHtmlAssets(html) {
  const refs = [];
  for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) refs.push(m[1]);
  for (const m of html.matchAll(/<link[^>]+href="([^"]+)"/g)) refs.push(m[1]);
  return refs;
}

// walk static and dynamic imports out from the entry points, the way the browser will
function buildImportGraph(entryPoints) {
  const seen = new Set();
  const missing = [];

  function walk(rel) {
    if (seen.has(rel)) return;
    seen.add(rel);

    let source;
    try {
      source = fs.readFileSync(path.join(FRONTEND, rel), "utf8");
    } catch {
      missing.push(rel);
      return;
    }

    const dir = path.dirname(rel);
    const follow = (spec) => {
      if (spec.startsWith("node:")) return;
      walk(path.normalize(path.join(dir, spec)).split(path.sep).join("/"));
    };

    for (const m of source.matchAll(/^\s*import\s+(?:[^;]*?\sfrom\s+)?"([^"]+)"/gm)) follow(m[1]);
    for (const m of source.matchAll(/import\(\s*"([^"]+)"\s*\)/g)) follow(m[1]);
  }

  entryPoints.forEach(walk);
  return { files: [...seen], missing };
}

const CACHE_NAME = readCacheName(SW_SOURCE);
const STATIC_ASSETS = readStaticAssets(SW_SOURCE);

// "./js/api.js" and "js/api.js" are the same file to us
const precached = new Set(STATIC_ASSETS.map((asset) => asset.replace(/^\.\//, "")));

// the app boots from index.html, and the two training modules arrive by dynamic import
const ENTRY_POINTS = [
  "js/app.js",
  "modules/fire-response/fire-response.js",
  "modules/gas-leak/gas-leak.js"
];

describe("index.html asks for nothing it cannot get offline", () => {
  it("1. loads no script or stylesheet from a remote origin", () => {
    const remote = readIndexHtmlAssets(INDEX_HTML).filter((ref) => /^(https?:)?\/\//i.test(ref));
    assert.deepStrictEqual(
      remote,
      [],
      `index.html still pulls from the network: ${remote.join(", ")}`
    );
  });

  it("2. loads the ar runtime from the vendored copies", () => {
    const scripts = [...INDEX_HTML.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(scripts.includes("./vendor/aframe.min.js"), "a-frame must come from ./vendor");
    assert.ok(scripts.includes("./vendor/aframe-ar.js"), "ar.js must come from ./vendor");
  });

  it("3. keeps a-frame ahead of ar.js, which needs the AFRAME global", () => {
    const aframe = INDEX_HTML.indexOf("./vendor/aframe.min.js");
    const arjs = INDEX_HTML.indexOf("./vendor/aframe-ar.js");
    assert.ok(aframe !== -1 && arjs !== -1, "both vendored scripts must be present");
    assert.ok(aframe < arjs, "aframe.min.js must be loaded before aframe-ar.js");
  });

  it("4. precaches every asset index.html references, except config.js", () => {
    const notCached = readIndexHtmlAssets(INDEX_HTML)
      .map((ref) => ref.replace(/^\.\//, ""))
      // config.js carries this install's backend address and is deliberately live
      .filter((ref) => ref !== "config.js")
      .filter((ref) => !precached.has(ref));

    assert.deepStrictEqual(
      notCached,
      [],
      `index.html assets missing from STATIC_ASSETS: ${notCached.join(", ")}`
    );
  });
});

describe("the certificate and webxr code is on the phone", () => {
  // the five that were missing. named one by one so a failure says which.
  const REQUIRED = [
    "js/api.js",
    "js/certificates.js",
    "js/certificate-panel.js",
    "ar/webxr_render.js",
    "modules/fire-response/webxr_fire_module.js"
  ];

  REQUIRED.forEach((asset, index) => {
    it(`${5 + index}. precaches ${asset}`, () => {
      assert.ok(precached.has(asset), `${asset} is not in STATIC_ASSETS`);
    });
  });

  it("10. precaches both vendored ar libraries", () => {
    assert.ok(precached.has("vendor/aframe.min.js"), "aframe.min.js is not precached");
    assert.ok(precached.has("vendor/aframe-ar.js"), "aframe-ar.js is not precached");
  });
});

describe("marker tracking reads its data off the phone", () => {
  // AR.js does not stop at the library. On startup it fetches a camera calibration
  // and one pattern file per marker, and its own defaults point at
  // ar-js-org.github.io. Vendoring the library and not these three leaves tier 2 —
  // the tier most target phones land on — dead the moment there is no signal.
  const AR_DATA = [
    "vendor/arjs-data/camera_para.dat",
    "vendor/arjs-data/pattern-hiro.patt",
    "vendor/arjs-data/pattern-kanji.patt"
  ];

  AR_DATA.forEach((asset, index) => {
    it(`${11 + index}. ships ${asset.split("/").pop()} and precaches it`, () => {
      const onDisk = path.join(FRONTEND, asset);
      assert.ok(fs.existsSync(onDisk), `${asset} is missing from the repo`);
      assert.ok(fs.statSync(onDisk).size > 0, `${asset} is empty`);
      assert.ok(precached.has(asset), `${asset} is not in STATIC_ASSETS`);
    });
  });

  it("14. points the scene at the local camera calibration", () => {
    assert.match(
      TIER2_SCENE,
      /cameraParametersUrl:\s*\.\/vendor\/arjs-data\/camera_para\.dat/,
      "the arjs scene must set cameraParametersUrl to the vendored file"
    );
  });

  it("15. points both markers at the local pattern files", () => {
    assert.match(TIER2_SCENE, /url="\.\/vendor\/arjs-data\/pattern-hiro\.patt"/, "hiro marker must use the local pattern");
    assert.match(TIER2_SCENE, /url="\.\/vendor\/arjs-data\/pattern-kanji\.patt"/, "kanji marker must use the local pattern");
    assert.match(TIER2_SCENE, /type="pattern"/, "markers must declare type=pattern to use a url");
  });

  it("16. uses no preset=, which would silently restore the remote fetch", () => {
    // preset="hiro" resolves to ARjs.baseURL + the pattern path, straight to github.io
    assert.doesNotMatch(
      TIER2_SCENE,
      /preset=/,
      'a marker preset= is back: AR.js would fetch that pattern from ar-js-org.github.io'
    );
  });

  it("17. leaves no ar.js runtime-data url anywhere in app.js", () => {
    // a comment may name the host; a fetchable url may not
    assert.doesNotMatch(
      APP_SOURCE,
      /(https?:)?\/\/ar-js-org\.github\.io/,
      "app.js must not carry a fetchable ar-js-org.github.io url"
    );

    // every mention of the calibration file has to be the vendored one
    const calibrationRefs = [...APP_SOURCE.matchAll(/\S*camera_para\.dat/g)].map((m) => m[0]);
    assert.ok(calibrationRefs.length > 0, "app.js should reference the calibration file");
    calibrationRefs.forEach((ref) => {
      assert.ok(
        ref.endsWith("./vendor/arjs-data/camera_para.dat"),
        `camera_para.dat referenced by a non-vendored path: ${ref}`
      );
    });
  });
});

describe("the whole import graph survives going offline", () => {
  it("18. reaches every module the entry points import, with none missing from disk", () => {
    const { files, missing } = buildImportGraph(ENTRY_POINTS);
    assert.deepStrictEqual(missing, [], `import path points at a file that does not exist: ${missing.join(", ")}`);
    assert.ok(files.length >= 19, `expected the graph to reach at least 19 files, got ${files.length}`);
  });

  it("19. precaches every file in that graph", () => {
    // this is the durable version of the named checks above: add an import
    // tomorrow and forget the worker, and this test names the file for you.
    const { files } = buildImportGraph(ENTRY_POINTS);
    const notCached = files.filter((file) => !precached.has(file)).sort();
    assert.deepStrictEqual(
      notCached,
      [],
      `reachable modules missing from STATIC_ASSETS: ${notCached.join(", ")}`
    );
  });

  it("20. precaches nothing that is not on disk", () => {
    const broken = STATIC_ASSETS
      // "./" is the navigation root, it maps to index.html rather than a file
      .filter((asset) => asset !== "./")
      .filter((asset) => !fs.existsSync(path.join(FRONTEND, asset)))
      .sort();

    assert.deepStrictEqual(broken, [], `STATIC_ASSETS names files that do not exist: ${broken.join(", ")}`);
  });
});

describe("runtime backend traffic stays out of the cache", () => {
  it("21. never precaches config.js, which holds this install's backend address", () => {
    const configEntries = STATIC_ASSETS.filter((asset) => asset.endsWith("config.js"));
    assert.deepStrictEqual(configEntries, [], "config.js must stay live, a cached one pins a dead backend");
  });

  it("22. never precaches an api path", () => {
    const apiEntries = STATIC_ASSETS.filter((asset) => asset.includes("/api/"));
    assert.deepStrictEqual(apiEntries, [], "api responses are not static assets");
  });

  it("23. precaches only same-origin relative paths", () => {
    const absolute = STATIC_ASSETS.filter((asset) => /^(https?:)?\/\//i.test(asset));
    assert.deepStrictEqual(absolute, [], `STATIC_ASSETS must stay relative: ${absolute.join(", ")}`);
  });

  it("24. still bypasses the worker for api routes, non-GET and config.js", () => {
    assert.match(SW_SOURCE, /url\.pathname\.startsWith\("\/api\/"\)/, "the /api/ bypass is gone");
    assert.match(SW_SOURCE, /req\.method !== "GET"/, "the non-GET bypass is gone");
    assert.match(SW_SOURCE, /url\.pathname\.endsWith\("\/config\.js"\)/, "the config.js bypass is gone");
  });
});

describe("the cache version tracks the asset list", () => {
  // An installed phone keeps serving the old cache until CACHE_NAME changes, so a
  // new asset with an unchanged name reaches nobody. This fingerprint is the tripwire:
  // edit STATIC_ASSETS and this fails until the version is bumped and the hash updated.
  const ASSET_GRAPH_FINGERPRINT = "f566b908481ed653";
  const EXPECTED_CACHE_NAME = "safear-offline-v3";

  function fingerprint(assets) {
    return crypto.createHash("sha256").update([...assets].sort().join("\n")).digest("hex").slice(0, 16);
  }

  it("25. is on the version that ships the vendored ar runtime and its data", () => {
    assert.strictEqual(CACHE_NAME, EXPECTED_CACHE_NAME);
  });

  it("26. fails when the asset list moves without the version moving with it", () => {
    assert.strictEqual(
      fingerprint(STATIC_ASSETS),
      ASSET_GRAPH_FINGERPRINT,
      "STATIC_ASSETS changed. Bump CACHE_NAME in sw.js, then put the new fingerprint " +
        "printed above into ASSET_GRAPH_FINGERPRINT so installed phones pick the new list up."
    );
  });

  it("27. names the cache in the shape the activate handler prunes on", () => {
    assert.match(CACHE_NAME, /^safear-offline-v\d+$/);
    assert.match(SW_SOURCE, /key !== CACHE_NAME/, "activate must still delete caches that are not the current one");
  });
});
