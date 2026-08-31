# SafeAR Android Capacitor Project

This directory contains the Capacitor wrapper for generating the installable Android APK.

## Build Steps
1. Build or prepare frontend static assets (`cd ../frontend`).
2. Run `npx cap sync android` to synchronize web assets and plugins.
3. Open project in Android Studio or run `npx cap build android` to generate the APK.
