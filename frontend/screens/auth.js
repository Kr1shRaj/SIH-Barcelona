// Sign in, activate, and offline re-entry.
//
// Three states of one screen rather than three screens, because they are the
// same moment in a worker's day: "let me in". The shell, the mark and the
// controls are identical; only the fields and the verb change.
//
//   login     worker id + PIN, against the server
//   activate  worker id + one-time code + a new PIN, against the server
//   offline   PIN only, against this device's own verifier, no network
//
// Everything here is presentation and orchestration. The decisions — is this
// code valid, is this PIN right, does this session still exist — belong to the
// server, and the one decision this file makes alone (does the local verifier
// match) is made by js/session.js.

import { t } from "../js/i18n.js";
import { apiPost } from "../js/api.js";
import { createLogger } from "../js/logger.js";
import {
  rememberSession, verifyOfflinePin, canReenterOffline, getIdentity,
  offlineVerificationAvailable, clearSession
} from "../js/session.js";
import { renderAppBarControls, bindAppBar } from "./appbar.js";

// The bar decides for itself whether to offer sign out, by asking whether the
// device knows a worker. On THIS screen it always knows one — that is the whole
// point of the offline prompt — and offering to sign out of a screen you are not
// signed in to is nonsense, so the control is switched off explicitly.

const logger = createLogger("Auth");

const BRAND_LOGO = "./assets/brand/safear-logo.png";

const MODES = ["login", "activate", "offline"];

function _esc(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// What a worker is told when something goes wrong. Each maps to a code the
// server actually sends; nothing here guesses, and nothing reveals whether a
// worker id exists — "worker ID or PIN is not correct" covers both halves on
// purpose.
function messageForError(error) {
  const code = error && error.code ? error.code : "network_error";
  const fallbacks = {
    invalid_credentials: "Worker ID or PIN is not correct.",
    activation_failed: "That activation code is not valid for this worker ID.",
    too_many_attempts: "Too many attempts. Wait a moment and try again.",
    pin_too_short: "Your PIN must be at least 6 digits.",
    pin_too_common: "That PIN is too easy to guess. Choose another.",
    pin_too_simple: "That PIN is too simple. Choose another.",
    pin_digits_only: "A PIN is digits only.",
    pin_required: "Choose a PIN.",
    validation_failed: "Check the details and try again.",
    network_error: "Cannot reach the training server. Check the connection.",
    timeout: "The server did not answer. Try again."
  };
  return t(`auth.error_${code}`, {}, fallbacks[code] || fallbacks.network_error);
}

function _field({ id, label, type = "text", inputMode, autocomplete, hint }) {
  return `
    <label class="auth-field">
      <span class="auth-field__label">${_esc(label)}</span>
      <input class="input auth-field__input" id="${_esc(id)}" name="${_esc(id)}" type="${_esc(type)}"
        ${inputMode ? `inputmode="${_esc(inputMode)}"` : ""}
        ${autocomplete ? `autocomplete="${_esc(autocomplete)}"` : ""}
        autocapitalize="characters" spellcheck="false" />
      ${hint ? `<span class="auth-field__hint">${_esc(hint)}</span>` : ""}
    </label>
  `;
}

// one screen, three shapes
function renderAuthHtml(mode = "login", { identity = null, message = "" } = {}) {
  const active = MODES.indexOf(mode) === -1 ? "login" : mode;

  const title = active === "activate"
    ? t("auth.activate_title", {}, "Set up your account")
    : active === "offline"
      ? t("auth.offline_title", {}, "Welcome back")
      : t("auth.login_title", {}, "Sign in");

  const lede = active === "activate"
    ? t("auth.activate_lede", {}, "Enter the code your supervisor gave you, then choose a PIN.")
    : active === "offline"
      ? t("auth.offline_lede", {}, "You are offline. Enter your PIN to continue training.")
      : t("auth.login_lede", {}, "Enter your worker ID and PIN to continue your training.");

  let fields = "";
  if (active === "login") {
    fields =
      _field({ id: "auth-worker", label: t("auth.worker_id", {}, "Worker ID"), autocomplete: "username" }) +
      _field({ id: "auth-pin", label: t("auth.pin", {}, "PIN"), type: "password", inputMode: "numeric", autocomplete: "current-password" });
  } else if (active === "activate") {
    fields =
      _field({ id: "auth-worker", label: t("auth.worker_id", {}, "Worker ID"), autocomplete: "username" }) +
      _field({ id: "auth-code", label: t("auth.code", {}, "Activation code"), hint: "SAFEAR-XXXX-XXXX-XXXX" }) +
      _field({ id: "auth-pin", label: t("auth.new_pin", {}, "Choose a PIN"), type: "password", inputMode: "numeric", autocomplete: "new-password", hint: t("auth.pin_rule", {}, "At least 6 digits") }) +
      _field({ id: "auth-pin2", label: t("auth.confirm_pin", {}, "Confirm PIN"), type: "password", inputMode: "numeric", autocomplete: "new-password" });
  } else {
    fields = _field({ id: "auth-pin", label: t("auth.pin", {}, "PIN"), type: "password", inputMode: "numeric", autocomplete: "current-password" });
  }

  const submitLabel = active === "activate"
    ? t("auth.activate_action", {}, "Activate and continue")
    : t("auth.login_action", {}, "Sign in");

  // the other way in, from wherever we are
  const alternate = active === "activate"
    ? `<button type="button" class="auth-link" data-action="auth-mode" data-mode="login">${_esc(t("auth.have_account", {}, "I already have a PIN"))}</button>`
    : active === "login"
      ? `<button type="button" class="auth-link" data-action="auth-mode" data-mode="activate">${_esc(t("auth.no_account", {}, "First time? Set up your account"))}</button>`
      : `<button type="button" class="auth-link" data-action="auth-mode" data-mode="login">${_esc(t("auth.use_worker_id", {}, "Sign in with worker ID instead"))}</button>`;

  const who = active === "offline" && identity && identity.name
    ? `<p class="auth-who">${_esc(identity.name)} <span class="cell-id">${_esc(identity.workerId)}</span></p>`
    : "";

  return `
    <section class="auth-screen" aria-labelledby="auth-title">
      <div class="auth-controls">${renderAppBarControls(undefined, undefined, false)}</div>

      <div class="auth-card">
        <span class="auth-brand"><img class="auth-logo" src="${_esc(BRAND_LOGO)}" alt="SafeAR" width="471" height="112" /></span>
        <h1 class="auth-title" id="auth-title">${_esc(title)}</h1>
        <p class="auth-lede">${_esc(lede)}</p>
        ${who}

        <form class="auth-form" id="auth-form" autocomplete="off" novalidate>
          ${fields}
          <p class="auth-message" id="auth-message" role="alert" aria-live="polite"${message ? "" : " hidden"}>${_esc(message)}</p>
          <button type="submit" class="eq-btn eq-btn--primary eq-btn--wide" id="auth-submit">${_esc(submitLabel)}</button>
        </form>

        <div class="auth-alt">${alternate}</div>
      </div>
    </section>
  `;
}

// Mount the screen. `onAuthenticated` is handed the identity once the worker is
// in, by whichever of the three routes got them there.
function mountAuthScreen({ container, mode = "login", onAuthenticated, fetchOptions = {} } = {}) {
  if (typeof document === "undefined" || !container) return null;

  let current = mode;

  // a device that has been signed in before, and can check a PIN without a
  // network, opens on the offline prompt rather than asking for a worker id again
  if (current === "login" && canReenterOffline()) {
    current = "offline";
  }

  const paint = (message = "") => {
    container.innerHTML = renderAuthHtml(current, { identity: getIdentity(), message });
  };
  paint();

  const appBar = bindAppBar(container, { onLocaleChange: () => paint() });

  const showMessage = (text) => {
    const node = container.querySelector("#auth-message");
    if (!node) return;
    node.textContent = text;
    node.hidden = !text;
  };

  const setBusy = (busy) => {
    const button = container.querySelector("#auth-submit");
    if (button) {
      button.disabled = busy;
      button.textContent = busy
        ? t("auth.working", {}, "Working…")
        : (current === "activate"
          ? t("auth.activate_action", {}, "Activate and continue")
          : t("auth.login_action", {}, "Sign in"));
    }
  };

  const value = (id) => {
    const node = container.querySelector(`#${id}`);
    return node && typeof node.value === "string" ? node.value.trim() : "";
  };

  const succeed = async (session, pin) => {
    await rememberSession(session, pin);
    logger.info({ event: "auth_success", mode: current, workerId: session.workerId }, "Trainee signed in");
    if (typeof onAuthenticated === "function") onAuthenticated(session);
  };

  const onSubmit = async (event) => {
    // nothing on this screen may ever reach the network as a form navigation:
    // every field on it is a credential
    if (event && typeof event.preventDefault === "function") event.preventDefault();
    showMessage("");

    const pin = value("auth-pin");

    if (current === "offline") {
      const result = await verifyOfflinePin(pin);
      if (result.ok) {
        // no server session here: the device is vouching for the worker until it
        // can reach the server again, and sync will ask for a real one then
        if (typeof onAuthenticated === "function") {
          onAuthenticated({ workerId: result.workerId, name: result.name, offline: true });
        }
        return;
      }
      // its own string: this prompt has no worker ID field, so the message the
      // online screen uses would be naming something that is not on screen
      showMessage(result.reason === "locked"
        ? t("auth.offline_locked", {}, "Too many attempts. Sign in online to continue.")
        : t("auth.wrong_pin", {}, "That PIN is not correct."));
      return;
    }

    const workerId = value("auth-worker");
    if (!workerId || !pin) {
      showMessage(t("auth.fill_all", {}, "Fill in every field."));
      return;
    }

    if (current === "activate" && pin !== value("auth-pin2")) {
      showMessage(t("auth.pin_mismatch", {}, "The two PINs do not match."));
      return;
    }

    setBusy(true);
    const path = current === "activate" ? "/api/auth/activate" : "/api/auth/login";
    const body = current === "activate"
      ? { workerId, code: value("auth-code"), pin }
      : { workerId, pin };

    // authToken: null keeps any stale token off a sign-in request
    const response = await apiPost(path, body, Object.assign({ authToken: null }, fetchOptions));
    setBusy(false);

    if (response.ok && response.data && response.data.token) {
      await succeed(response.data, pin);
      return;
    }

    logger.warn({ event: "auth_failed", mode: current, status: response.status }, "Sign in refused");
    showMessage(messageForError(response.error));
  };

  const onClick = (event) => {
    const raw = event && event.target;
    if (!raw || typeof raw.closest !== "function") return;
    const trigger = raw.closest('[data-action="auth-mode"]');
    if (!trigger) return;
    current = trigger.getAttribute("data-mode") || "login";
    paint();
  };

  // BOTH LISTENERS LIVE ON THE CONTAINER, NOT ON THE FORM.
  //
  // paint() replaces the container's markup, so anything bound to the form node
  // itself dies the first time the worker switches mode or changes language. A
  // form with no submit handler does what a form does: a native GET — which put
  // the PIN and the activation code in the address bar, in history, and in the
  // server's access log. Delegating means the handler survives every repaint.
  container.addEventListener("submit", onSubmit);
  container.addEventListener("click", onClick);

  return {
    repaint: paint,
    mode: () => current,
    destroy: () => {
      container.removeEventListener("submit", onSubmit);
      container.removeEventListener("click", onClick);
      if (appBar) appBar.destroy();
    }
  };
}

// the control that ends a session. clearing the token never clears the queue.
function signOut({ forgetDevice = false } = {}) {
  // tell the server, but do not wait on it: a worker in a tunnel still expects
  // the button to work, and the token is useless on this device either way
  apiPost("/api/auth/logout", {}).catch(() => {});
  clearSession({ forgetDevice });
}

export {
  MODES,
  BRAND_LOGO,
  renderAuthHtml,
  mountAuthScreen,
  messageForError,
  signOut,
  offlineVerificationAvailable
};
