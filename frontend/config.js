// Where this install should look for the SafeAR backend.
//
// Leave it empty and the app works out where to go on its own: the dev server on
// port 5173 finds the backend on 3000, and a backend that serves this page itself
// is simply the same origin.
//
// Set it only when neither of those is true — the case that matters is an Android
// build, where the app is served from inside the apk and there is no backend on the
// phone. Capacitor copies this file into the apk, so whatever is here at
// `npx cap sync android` is what the installed app will use:
//
//   window.SAFEAR_API_BASE = "http://192.168.1.50:3000";
//
// Use your own machine's LAN address, and do not commit it — the next person's
// network is not yours. In a desktop browser you can skip this file entirely and
// pass ?api=http://host:3000 once instead; that choice is remembered afterwards.
//
// This is an address, not a secret. Nothing here is a credential, and no key,
// token or password belongs in this file.

window.SAFEAR_API_BASE = "";
