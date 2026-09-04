// Completion panel shared by every training module.
//
// Both modules had an identical _showComplete, which is how they drifted apart in
// the first place. The certificate states are the same everywhere, so the markup
// lives here once and each module passes in its own overlay id and colours.
//
// This file only draws. Every decision about what state an attempt is in comes from
// certificates.js, so there is exactly one place that knows the rules.

import { resolveCertificateState } from "./certificates.js";
import { t } from "./i18n.js";

// icons carry the meaning alongside the words. NFR2 says the UI cannot lean on text
// alone, because many target workers read little.
const STATE_ICON = {
  passed: "✅",
  failed: "⚠",
  pending: "⏳",
  issued: "🎓"
};

function _el(tag, style, text) {
  const node = document.createElement(tag);
  if (style) node.style.cssText = style;
  if (text !== undefined) node.textContent = text;
  return node;
}

// big pass or fail headline, driven by the aggregate result rather than by whatever
// the final checkpoint happened to do
function _renderHeadline(state, theme) {
  const passed = state !== "failed";
  const row = _el(
    "div",
    `font-size:1.2rem;font-weight:bold;display:flex;align-items:center;gap:0.5rem;color:${passed ? theme.passColor : theme.failColor}`
  );
  row.appendChild(_el("span", "font-size:1.4rem", STATE_ICON[state] || STATE_ICON.passed));
  row.appendChild(
    _el("span", "", passed
      ? t("cert.passed", {}, "Training Passed!")
      : t("cert.not_passed", {}, "Not Passed"))
  );
  return row;
}

// the aggregate score the server will also see, shown as a percentage
function _renderScore(percentage) {
  if (typeof percentage !== "number" || Number.isNaN(percentage)) return null;
  const row = _el("div", "margin:0.4rem 0;font-size:1rem");
  row.appendChild(_el("span", "opacity:0.85", `${t("cert.score", {}, "Your Score")}: `));
  row.appendChild(_el("strong", "font-size:1.1rem", `${percentage}%`));
  return row;
}

// passed, but nobody has said certified yet. its own wording, because borrowing the
// pending copy would promise a certificate the server has not granted.
function _renderPassedOnly() {
  return _el("div", "margin:0.4rem 0;font-size:0.9rem;opacity:0.85",
    t("cert.preparing", {}, "Training passed. Preparing your certificate…"));
}

// passed and the certificate has been asked for, but not granted yet
function _renderPending(theme) {
  const box = _el("div", `margin:0.6rem 0;padding:0.6rem 0.8rem;border-radius:8px;border:1px dashed ${theme.failColor};display:flex;align-items:center;gap:0.5rem`);
  box.appendChild(_el("span", "font-size:1.2rem", STATE_ICON.pending));
  const text = _el("div");
  text.appendChild(_el("div", "font-weight:bold;font-size:0.95rem", t("cert.pending", {}, "Certificate pending")));
  text.appendChild(_el("div", "font-size:0.85rem;opacity:0.85",
    t("cert.pending_desc", {}, "Your certificate will appear once you are back online")));
  box.appendChild(text);
  return box;
}

// the certificate itself: id, the scannable code, and how to use it
function _renderIssued(certificate, theme) {
  const box = _el("div", `margin:0.6rem 0;padding:0.7rem;border-radius:10px;border:1px solid ${theme.passColor};background:rgba(0,0,0,0.35)`);

  const heading = _el("div", `font-weight:bold;font-size:0.95rem;color:${theme.passColor};display:flex;align-items:center;gap:0.4rem`);
  heading.appendChild(_el("span", "", STATE_ICON.issued));
  heading.appendChild(_el("span", "", t("cert.issued", {}, "Certificate Issued")));
  box.appendChild(heading);

  const idRow = _el("div", "margin:0.35rem 0;font-size:0.8rem;opacity:0.9");
  idRow.appendChild(_el("span", "", `${t("cert.cert_id", {}, "Certificate ID")}: `));
  // textContent, never innerHTML, for anything that came off the wire
  idRow.appendChild(_el("code", "font-size:0.8rem;letter-spacing:0.5px", certificate.certId));
  box.appendChild(idRow);

  // the picture of the credential. stored locally, so it still draws with no signal.
  if (certificate.qrImage) {
    const frame = _el("div", "background:#fff;padding:8px;border-radius:8px;display:inline-block;margin:0.3rem 0");
    const img = document.createElement("img");
    img.id = "cert-qr-image";
    img.src = certificate.qrImage;
    img.alt = t("cert.qr_ready", {}, "Certificate QR Code Ready");
    img.style.cssText = "display:block;width:180px;height:180px;image-rendering:pixelated";
    frame.appendChild(img);
    box.appendChild(frame);
  }

  box.appendChild(_el("div", "font-size:0.82rem;opacity:0.85;margin-top:0.2rem",
    t("cert.scan_hint", {}, "Show this code to your supervisor")));

  return box;
}

// failed runs get told plainly, and get no certificate controls at all
function _renderFailed() {
  return _el("div", "margin:0.4rem 0;font-size:0.9rem;opacity:0.9",
    t("cert.not_passed_desc", {}, "You did not reach the pass mark. You can try again."));
}

// draw the whole completion panel for one finished attempt.
// theme carries the module colours, overlayId the container, onExit the cleanup.
function renderCompletionPanel(overlay, options) {
  if (!overlay) return null;

  const evaluated = options.evaluated || {};
  const theme = options.theme || { passColor: "#00e676", failColor: "#ff6a00" };
  const resolved = resolveCertificateState(evaluated.attemptId, evaluated);

  overlay.innerHTML = "";
  overlay.appendChild(_renderHeadline(resolved.state, theme));

  const score = _renderScore(evaluated.percentage);
  if (score) overlay.appendChild(score);

  if (resolved.state === "failed") {
    overlay.appendChild(_renderFailed());
  } else if (resolved.state === "issued") {
    overlay.appendChild(_renderIssued(resolved.certificate, theme));
  } else if (resolved.state === "pending") {
    overlay.appendChild(_renderPending(theme));
  } else {
    // passed, certificate not requested or not yet pending. never call this certified.
    overlay.appendChild(_renderPassedOnly());
  }

  const actions = _el("div", "display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.8rem");

  // a worker can pull the certificate back up without redoing the module
  if (resolved.state === "issued") {
    const btnView = _el("button", `padding:0.7rem 1.1rem;background:${theme.passColor};color:#000;border:none;border-radius:8px;font-size:0.95rem;cursor:pointer;font-weight:bold`,
      `${STATE_ICON.issued} ${t("cert.view", {}, "View Certificate")}`);
    btnView.id = "btn-view-certificate";
    btnView.addEventListener("click", () => {
      const img = document.getElementById("cert-qr-image");
      if (img && typeof img.scrollIntoView === "function") {
        img.scrollIntoView({ block: "center" });
      }
    });
    actions.appendChild(btnView);
  }

  const btnExit = _el("button", `padding:0.7rem 1.1rem;background:${theme.exitColor || theme.failColor};color:${theme.exitTextColor || "#fff"};border:none;border-radius:8px;font-size:0.95rem;cursor:pointer;font-weight:bold`,
    options.exitLabel || "✖ Exit Module");
  btnExit.id = "btn-module-exit";
  btnExit.addEventListener("click", () => {
    if (typeof options.onExit === "function") options.onExit();
  });
  actions.appendChild(btnExit);

  overlay.appendChild(actions);
  return resolved.state;
}

export { renderCompletionPanel, STATE_ICON };
