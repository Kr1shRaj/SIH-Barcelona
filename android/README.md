# SafeAR Android Capacitor Project

This directory holds nothing but this file. The Capacitor Android project is
generated locally and is never committed — `.gitignore` keeps everything here
except this README out of git, so the tree stays clean and nobody has to merge a
Gradle build.

## Building the APK from a clean clone

Run these from the **project root**, not from this directory:

```bash
npm install
npx cap add android
npx cap sync android
```

`cap add android` creates the project — `app/`, the Gradle wrapper, and the
Cordova plugin bridge. It only needs to run once per clone. `cap sync android`
copies `frontend/` into the app and wires up plugins; run it again after every
frontend change.

`cap sync` cannot run before `cap add` — without the generated project it fails
with `gradlew file is missing in android`. Check the current state any time with:

```bash
npx cap doctor
```

Then build or open the project:

```bash
npx cap open android
```

That launches Android Studio. To build without it, use the generated wrapper from
this directory: `./gradlew assembleDebug` on macOS or Linux, `gradlew.bat
assembleDebug` on Windows. The APK lands in `app/build/outputs/apk/debug/`.

## Before you build

Two things are worth setting first, because both are baked into the APK at
`cap sync` time:

- **`frontend/config.js`** — the address of the backend the phone should call.
  An installed app has no backend of its own, and `localhost` on the phone is the
  phone. See "Phone demo, as an APK" in the root `README.md`.
- **`capacitor.config.json`** — already sets `server.cleartext` so the app may
  talk to a plain-HTTP backend on your LAN. This is a demo setting; a real
  deployment would use HTTPS and drop it.

## Regenerating

Deleting everything here except this README and re-running `cap add android` is a
supported, routine move. Nothing in the generated project is hand-edited, so
there is nothing to lose — which is exactly why it is not committed.
