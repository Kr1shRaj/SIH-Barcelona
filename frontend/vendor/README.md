# Vendored AR libraries

A-Frame and AR.js live here as files, not CDN links. A mine has no signal, so a
script tag pointing at the internet means no AR underground. These two are the
whole AR runtime — without them the app cannot render a single scene offline.

They are also in `sw.js` `STATIC_ASSETS`, so the service worker precaches them on
install. `frontend/tests/service_worker.test.js` fails if that stops being true.

## What is here

| File | Library | Version | Bytes | SHA-256 |
| --- | --- | --- | --- | --- |
| `aframe.min.js` | A-Frame | 1.3.0 (Date 2022-02-04, Commit #cc3516ce) | 1987036 | `2e9a8890e0f3bf6ca9c6e7f22b632fe4c6e23463de5b0f0f69bf9c36b98409fe` |
| `aframe-ar.js` | AR.js | 3.4.5 | 1664876 | `4a9c506811e5b1708eda62435a3c26e061c481500bdf8de0e79bce1936e50274` |
| `arjs-data/camera_para.dat` | AR.js (ARToolkit calibration) | 3.4.5 | 176 | `dc0487240de94aafab0f6106c6d9faf79b70f22de0faf3281d341e33edd777ed` |
| `arjs-data/pattern-hiro.patt` | AR.js (Hiro marker) | 3.4.5 | 12291 | `2129e1c922db64f5a6c66d0d698b493a7ac4a68ce8e2aced99edf4a61d3b74d3` |
| `arjs-data/pattern-kanji.patt` | AR.js (Kanji marker) | 3.4.5 | 12291 | `e50e4ba7b89cab2cd8d4a24a0be2926fc1c078bae9537c5c8a53815de2283fae` |

Load order matters: `aframe.min.js` first. AR.js attaches to the `AFRAME` global
and does nothing useful if it runs first.

## Why `arjs-data/` exists

The library file is not the whole dependency. When marker tracking starts, AR.js
fetches its camera calibration and one pattern file per marker, and by default it
takes them off `ar-js-org.github.io` — three live network calls at the exact
moment a worker underground has no network. Vendoring the code but not this data
leaves Tier 2 broken offline, which is the tier most target phones land on.

`frontend/js/app.js` therefore points the scene at the local copies instead of
letting AR.js reach for its defaults:

```
arjs="... cameraParametersUrl: ./vendor/arjs-data/camera_para.dat;"
<a-marker type="pattern" url="./vendor/arjs-data/pattern-hiro.patt">
```

`type="pattern" url="..."` resolves to the same marker parameters AR.js builds for
`preset="hiro"` — same `type`, same `markersAreaEnabled: false` — with the pattern
read from disk. Going back to `preset=` would silently restore the remote fetch.

## Where they came from

```
aframe.min.js                 https://aframe.io/releases/1.3.0/aframe.min.js
aframe-ar.js                  https://cdn.jsdelivr.net/gh/AR-js-org/AR.js@3.4.5/aframe/build/aframe-ar.js
arjs-data/camera_para.dat     https://ar-js-org.github.io/AR.js/data/data/camera_para.dat
arjs-data/pattern-hiro.patt   https://ar-js-org.github.io/AR.js/three.js/examples/marker-training/examples/pattern-files/pattern-hiro.patt
arjs-data/pattern-kanji.patt  https://ar-js-org.github.io/AR.js/three.js/examples/marker-training/examples/pattern-files/pattern-kanji.patt
```

The three `arjs-data` URLs are the exact ones AR.js 3.4.5 builds from its own
`ARjs.baseURL` at runtime, so these files are what the app was already using —
now read from disk instead of fetched.

`aframe-ar.js` used to be fetched from `raw.githack.com` at the same repo tag and
path. That host is a development proxy with no uptime promise and it answered
`403 Forbidden` while this was being vendored, which is the reason the file is
now committed instead of fetched. The jsdelivr URL above serves the same tag of
the same GitHub repository.

## Checking or re-fetching

```bash
sha256sum frontend/vendor/aframe.min.js frontend/vendor/aframe-ar.js frontend/vendor/arjs-data/*
```

The two hashes must match the table. To move to a new version: download it, put
the new hash and version in the table, add the file to `STATIC_ASSETS` in
`frontend/sw.js`, and bump `CACHE_NAME` so installed phones fetch it. The test
suite will tell you if you forget the last step.
