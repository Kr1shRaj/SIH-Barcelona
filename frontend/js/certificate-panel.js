// Completion panel shared by every training module.
//
// Both modules had an identical _showComplete, which is how they drifted apart in
// the first place. The certificate states are the same everywhere, so the markup
// lives here once and each module passes in its own overlay id.
//
// This file only draws. Every decision about what state an attempt is in comes from
// certificates.js, so there is exactly one place that knows the rules, and every
// number shown here is the server's — the panel never computes a score, never
// decides pass or fail, and never infers a certificate state.
//
// The look is the `cert-*` and `hud-*` classes in css/style.css rather than the
// inline style strings this file used to carry. Those strings had their own bright
// green, their own orange and a dashed border for the pending state; none of them
// were in the palette, and none of them followed the theme.

import { resolveCertificateState } from "./certificates.js";
import { t } from "./i18n.js";

// The status each state reads as. Text, not emoji: emoji render differently on
// every android version and carry no meaning to a screen reader. The state is also
// spelled out in words next to it.
const STATE_ICON = {
  passed: "✓",
  failed: "!",
  pending: "…",
  issued: "✓"
};

function _el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// PASS or NOT PASSED, driven by the aggregate result rather than by whatever the
// final checkpoint happened to do
function _renderHeadline(state) {
  const passed = state !== "failed";
  const row = _el("div", `cert-outcome ${passed ? "cert-outcome--pass" : "cert-outcome--fail"}`);
  row.appendChild(_el("span", "cert-outcome__mark", passed ? STATE_ICON.passed : STATE_ICON.failed));
  row.appendChild(_el("span", "cert-outcome__label", passed
    ? t("cert.passed", {}, "Training Passed")
    : t("cert.not_passed", {}, "Not Passed")));
  return row;
}

// The aggregate score the server also holds, shown as the largest thing on the
// panel because it is the thing a worker and a supervisor both look for first.
function _renderScore(percentage) {
  if (typeof percentage !== "number" || Number.isNaN(percentage)) return null;
  const block = _el("div", "cert-score");
  block.appendChild(_el("span", "cert-score__label", t("cert.score", {}, "Your Score")));
  block.appendChild(_el("span", "cert-score__value", `${percentage}%`));
  return block;
}

// passed, but nobody has said certified yet. its own wording, because borrowing the
// pending copy would promise a certificate the server has not granted.
function _renderPassedOnly() {
  const row = _el("div", "cert-state cert-state--waiting");
  row.appendChild(_el("p", "cert-state__text",
    t("cert.preparing", {}, "Training passed. Preparing your certificate…")));
  return row;
}

// passed and the certificate has been asked for, but not granted yet. this used to
// be a dashed box, which read as unfinished UI rather than as a real state.
function _renderPending() {
  const row = _el("div", "cert-state cert-state--pending");
  row.appendChild(_el("span", "hud-badge", `${STATE_ICON.pending} ${t("cert.pending", {}, "Certificate pending")}`));
  row.appendChild(_el("p", "cert-state__text",
    t("cert.pending_desc", {}, "Your certificate will appear once you are back online")));
  return row;
}

// The certificate itself: who it is for, what it is for, and the scannable proof.
// The QR sits on its own white plate with nothing behind it, because the one job
// it has is to be readable by a supervisor's phone in bad light.
function _renderIssued(certificate) {
  const box = _el("div", "cert-card");

  const head = _el("div", "cert-card__head");
  head.appendChild(_el("span", "cert-card__brand", "SafeAR"));
  head.appendChild(_el("span", "cert-card__kind", t("cert.issued", {}, "Certificate Issued")));
  box.appendChild(head);

  // the credential's id, in a monospace row so it can be read out digit by digit.
  // textContent, never innerHTML, for anything that came off the wire.
  const idRow = _el("div", "cert-card__row");
  idRow.appendChild(_el("span", "cert-card__row-label", t("cert.cert_id", {}, "Certificate ID")));
  idRow.appendChild(_el("code", "cert-card__id", certificate.certId));
  box.appendChild(idRow);

  // the picture of the credential. stored locally, so it still draws with no signal.
  if (certificate.qrImage) {
    const frame = _el("div", "cert-qr");
    const img = document.createElement("img");
    img.id = "cert-qr-image";
    img.className = "cert-qr__img";
    img.src = certificate.qrImage;
    img.alt = t("cert.qr_ready", {}, "Certificate QR Code Ready");
    frame.appendChild(img);
    box.appendChild(frame);
  }

  box.appendChild(_el("p", "cert-card__hint", t("cert.scan_hint", {}, "Show this code to your supervisor")));
  return box;
}

// failed runs get told plainly, and get no certificate controls at all
function _renderFailed() {
  const row = _el("div", "cert-state cert-state--failed");
  row.appendChild(_el("p", "cert-state__text",
    t("cert.not_passed_desc", {}, "You did not reach the pass mark. You can try again.")));
  return row;
}

// draw the whole completion panel for one finished attempt.
// theme still carries each module's own colours for callers that pass them; the
// panel itself no longer paints with them.
function renderCompletionPanel(overlay, options) {
  if (!overlay) return null;

  const evaluated = options.evaluated || {};
  const resolved = resolveCertificateState(evaluated.attemptId, evaluated);

  overlay.innerHTML = "";

  // No new locale keys are introduced here. The certificate namespace is fully
  // translated in all three locales including Santali, and inventing Ol Chiki for
  // a decorative label is not something this pass is allowed to do — so the panel
  // says what it already knows how to say, in every language.
  const panel = _el("div", "cert-panel");
  panel.appendChild(_renderHeadline(resolved.state));

  const score = _renderScore(evaluated.percentage);
  if (score) panel.appendChild(score);

  if (resolved.state === "failed") {
    panel.appendChild(_renderFailed());
  } else if (resolved.state === "issued") {
    panel.appendChild(_renderIssued(resolved.certificate));
  } else if (resolved.state === "pending") {
    panel.appendChild(_renderPending());
  } else {
    // passed, certificate not requested or not yet pending. never call this certified.
    panel.appendChild(_renderPassedOnly());
  }

  const actions = _el("div", "cert-actions");

  // a worker can pull the certificate back up without redoing the module
  if (resolved.state === "issued") {
    const btnView = _el("button", "hud-btn", t("cert.view", {}, "View Certificate"));
    btnView.id = "btn-view-certificate";
    btnView.type = "button";
    btnView.addEventListener("click", () => {
      const img = document.getElementById("cert-qr-image");
      if (img && typeof img.scrollIntoView === "function") {
        img.scrollIntoView({ block: "center" });
      }
    });
    actions.appendChild(btnView);
  }

  const btnExit = _el("button", "hud-btn hud-btn--quiet", options.exitLabel || "Exit Module");
  btnExit.id = "btn-module-exit";
  btnExit.type = "button";
  btnExit.addEventListener("click", () => {
    if (typeof options.onExit === "function") options.onExit();
  });
  actions.appendChild(btnExit);

  panel.appendChild(actions);
  overlay.appendChild(panel);
  return resolved.state;
}

export { renderCompletionPanel, STATE_ICON };
