// Completion panel tests: the four states a finished attempt can be in, and the
// rule that "passed" is never dressed up as "certified".

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { renderCompletionPanel } from "../js/certificate-panel.js";
import {
  requestCertificateForAttempt,
  resolveCertificateState,
  flushPendingCertificates,
  getPendingCertificates,
  getCertificateByAttemptId,
  clearPendingCertificates,
  clearCertificates
} from "../js/certificates.js";
import { registerLocale, setLocale, clearLocales } from "../js/i18n.js";
import fs from "node:fs";

// read the real locale files rather than importing them, so this stays parseable
// by the project eslint and the tests exercise the shipped translations
function loadLocaleFile(code) {
  return JSON.parse(fs.readFileSync(new URL(`../locales/${code}.json`, import.meta.url), "utf8"));
}
const enLocale = loadLocaleFile("en");
const hiLocale = loadLocaleFile("hi");
const satLocale = loadLocaleFile("sat");

// mock local storage
if (typeof globalThis.localStorage === "undefined") {
  let store = {};
  globalThis.localStorage = {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key, val) => { store[key] = String(val); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; }
  };
}

// minimal DOM: enough for createElement/appendChild/textContent trees
function makeElement(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    id: "",
    src: "",
    alt: "",
    style: { cssText: "" },
    children: [],
    _text: "",
    _listeners: {},
    set textContent(v) { this._text = String(v); this.children = []; },
    get textContent() {
      if (this.children.length === 0) return this._text;
      return this._text + this.children.map((c) => c.textContent).join(" ");
    },
    set innerHTML(v) { this._text = ""; this.children = []; if (v) this._text = String(v); },
    get innerHTML() { return this.textContent; },
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    click() { (this._listeners.click || []).forEach((fn) => fn()); },
    scrollIntoView() { this._scrolled = true; }
  };
  return node;
}

const registry = {};
globalThis.document = {
  createElement: (tag) => makeElement(tag),
  getElementById: (id) => registry[id] || null
};

// walk the rendered tree collecting every node
function flatten(node, out = []) {
  out.push(node);
  node.children.forEach((c) => flatten(c, out));
  return out;
}
function findById(root, id) {
  return flatten(root).find((n) => n.id === id) || null;
}
function textOf(root) {
  return flatten(root).map((n) => n._text).filter(Boolean).join(" ");
}

const ATTEMPT = "a3f1c9e2-5b47-4d18-9e6a-2c8b7f0d4e51";
const THEME = { passColor: "#00e676", failColor: "#ff6a00", exitColor: "#ff6a00", exitTextColor: "#fff" };

function passedAttempt(overrides) {
  return Object.assign({ attemptId: ATTEMPT, passed: true, percentage: 91.67, moduleId: "fire-response" }, overrides || {});
}
function failedAttempt() {
  return { attemptId: ATTEMPT, passed: false, percentage: 42, moduleId: "fire-response" };
}

function issueBody() {
  return {
    certId: "SAFEAR-97FA4417AE0E48E4",
    status: "issued",
    payload: { v: 1, k: "V5WoSvuQCY48", c: "SAFEAR-97FA4417AE0E48E4", w: "WRK-0001", m: "fire-response", s: 9167, i: 1788436800, e: null },
    qr: "eyJjIjoiWCJ9.SignatureBytes",
    qrImage: "data:image/png;base64,AAAAQRIMAGE",
    algo: "Ed25519",
    keyId: "V5WoSvuQCY48"
  };
}

async function withFetch(responder, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => responder();
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}
function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function render(evaluated, onExit) {
  const overlay = makeElement("div");
  const state = renderCompletionPanel(overlay, {
    evaluated,
    theme: THEME,
    exitLabel: "✖ Exit Module",
    onExit: onExit || (() => {})
  });
  return { overlay, state };
}

describe("Certificate completion panel", () => {
  beforeEach(() => {
    clearPendingCertificates();
    clearCertificates();
    clearLocales();
    registerLocale("en", enLocale);
    setLocale("en");
  });

  describe("passed, but not certified", () => {
    it("1. shows passed and the aggregate score", () => {
      const { overlay, state } = render(passedAttempt());

      assert.strictEqual(state, "passed");
      const text = textOf(overlay);
      assert.match(text, /Training Passed/);
      assert.match(text, /91\.67%/);
    });

    it("2. never calls a passed attempt certified", () => {
      const { overlay } = render(passedAttempt());
      const text = textOf(overlay);

      assert.ok(!/Certificate Issued/.test(text), "passed is not certified");
      assert.strictEqual(findById(overlay, "cert-qr-image"), null, "no QR before issuance");
      assert.strictEqual(findById(overlay, "btn-view-certificate"), null);
    });

    it("3. passed uses its own copy, not the pending copy", () => {
      const { overlay } = render(passedAttempt());
      const text = textOf(overlay);

      // the two states look similar but promise different things. pending means the
      // certificate was asked for, passed means it was not yet. sharing one string
      // would tell a worker their certificate is on its way before anyone asked.
      assert.match(text, /Preparing your certificate/);
      assert.ok(!/once you are back online/.test(text), "passed must not borrow the pending copy");
    });

    it("4. still offers exit", () => {
      const { overlay } = render(passedAttempt());
      assert.ok(findById(overlay, "btn-module-exit"));
    });
  });

  describe("failed", () => {
    it("5. shows the failure and the score", () => {
      const { overlay, state } = render(failedAttempt());

      assert.strictEqual(state, "failed");
      const text = textOf(overlay);
      assert.match(text, /Not Passed/);
      assert.match(text, /42%/);
    });

    it("6. shows no certificate controls at all", () => {
      const { overlay } = render(failedAttempt());

      assert.strictEqual(findById(overlay, "cert-qr-image"), null);
      assert.strictEqual(findById(overlay, "btn-view-certificate"), null);
      assert.ok(!/Certificate Issued/.test(textOf(overlay)));
      assert.ok(!/Certificate pending/.test(textOf(overlay)));
    });

    it("7. a failed attempt is never queued for a certificate", () => {
      const result = requestCertificateForAttempt(failedAttempt());

      assert.strictEqual(result.queued, 0);
      assert.strictEqual(result.reason, "not_passed_locally");
      assert.strictEqual(getPendingCertificates().length, 0);
    });

    it("8. exit still works on a failed run", () => {
      let exited = false;
      const { overlay } = render(failedAttempt(), () => { exited = true; });
      findById(overlay, "btn-module-exit").click();

      assert.strictEqual(exited, true);
    });
  });

  describe("certificate pending", () => {
    it("9. shows the pending message once requested", () => {
      requestCertificateForAttempt(passedAttempt());
      const { overlay, state } = render(passedAttempt());

      assert.strictEqual(state, "pending");
      const text = textOf(overlay);
      assert.match(text, /Certificate pending/);
      assert.match(text, /once you are back online/);
    });

    it("10. pending shows no QR and no view button", () => {
      requestCertificateForAttempt(passedAttempt());
      const { overlay } = render(passedAttempt());

      assert.strictEqual(findById(overlay, "cert-qr-image"), null);
      assert.strictEqual(findById(overlay, "btn-view-certificate"), null);
    });

    it("11. stays pending when the network is down", async () => {
      requestCertificateForAttempt(passedAttempt());
      await withFetch(() => { throw new Error("offline"); }, () => flushPendingCertificates());

      assert.strictEqual(resolveCertificateState(ATTEMPT, passedAttempt()).state, "pending");
      assert.match(textOf(render(passedAttempt()).overlay), /Certificate pending/);
    });
  });

  describe("certificate issued", () => {
    beforeEach(async () => {
      requestCertificateForAttempt(passedAttempt());
      await withFetch(() => jsonResponse(201, issueBody()), () => flushPendingCertificates());
    });

    it("12. shows the issued state with the certificate id", () => {
      const { overlay, state } = render(passedAttempt());

      assert.strictEqual(state, "issued");
      const text = textOf(overlay);
      assert.match(text, /Certificate Issued/);
      assert.match(text, /SAFEAR-97FA4417AE0E48E4/);
    });

    it("13. renders the QR image from stored qrImage", () => {
      const { overlay } = render(passedAttempt());
      const img = findById(overlay, "cert-qr-image");

      assert.ok(img, "the QR image must be rendered");
      assert.strictEqual(img.tagName, "IMG");
      assert.match(img.src, /^data:image\/png;base64,/);
      assert.ok(img.alt, "the image needs alt text");
    });

    it("14. shows the scan instruction", () => {
      assert.match(textOf(render(passedAttempt()).overlay), /Show this code to your supervisor/);
    });

    it("15. offers a view certificate button", () => {
      const { overlay } = render(passedAttempt());
      assert.ok(findById(overlay, "btn-view-certificate"));
    });

    it("16. renders offline with no network at all", () => {
      // the stored certificate is enough, nothing is fetched to display it
      const original = globalThis.fetch;
      globalThis.fetch = () => { throw new Error("network must not be touched"); };
      try {
        const { overlay, state } = render(passedAttempt());
        assert.strictEqual(state, "issued");
        assert.ok(findById(overlay, "cert-qr-image"));
      } finally {
        globalThis.fetch = original;
      }
    });

    it("17. the stored certificate keeps both qr and qrImage", () => {
      const cert = getCertificateByAttemptId(ATTEMPT);
      assert.strictEqual(cert.qr, issueBody().qr, "qr is the signed credential");
      assert.strictEqual(cert.qrImage, issueBody().qrImage, "qrImage is the picture of it");
    });
  });

  describe("aggregate result drives the headline", () => {
    it("18. a passing aggregate reads as passed whatever the last checkpoint did", () => {
      // gas-leak can fail PPE and still pass overall, so the last checkpoint is
      // not the module result
      const { state, overlay } = render(passedAttempt({ percentage: 89 }));
      assert.strictEqual(state, "passed");
      assert.match(textOf(overlay), /Training Passed/);
    });

    it("19. a failing aggregate reads as failed", () => {
      const { state } = render({ attemptId: ATTEMPT, passed: false, percentage: 66.5 });
      assert.strictEqual(state, "failed");
    });

    it("20. the score shown is the aggregate percentage", () => {
      assert.match(textOf(render(passedAttempt({ percentage: 66.67 })).overlay), /66\.67%/);
    });

    it("21. a missing percentage does not break the panel", () => {
      assert.doesNotThrow(() => render({ attemptId: ATTEMPT, passed: true }));
    });
  });

  describe("all three locales", () => {
    const locales = [
      ["en", enLocale, /Certificate Issued/, /Not Passed/],
      ["hi", hiLocale, /प्रमाणपत्र जारी हुआ/, /उत्तीर्ण नहीं/],
      ["sat", satLocale, /ᱥᱟᱨᱴᱤᱯᱷᱤᱠᱮᱴ ᱮᱢ ᱮᱱᱟ/, /ᱵᱟᱭ ᱯᱟᱥ ᱮᱱᱟ/]
    ];

    locales.forEach(([code, dict, issuedRe, failedRe]) => {
      it(`21. ${code}: issued and failed states are translated`, async () => {
        clearLocales();
        registerLocale(code, dict);
        setLocale(code);

        requestCertificateForAttempt(passedAttempt());
        await withFetch(() => jsonResponse(201, issueBody()), () => flushPendingCertificates());

        assert.match(textOf(render(passedAttempt()).overlay), issuedRe, `${code} issued text`);

        clearCertificates();
        clearPendingCertificates();
        assert.match(textOf(render(failedAttempt()).overlay), failedRe, `${code} failed text`);
      });
    });

    it("22. every cert key exists in all three locales", () => {
      const keys = Object.keys(enLocale.cert).sort();
      assert.deepStrictEqual(Object.keys(hiLocale.cert).sort(), keys);
      assert.deepStrictEqual(Object.keys(satLocale.cert).sort(), keys);
      assert.ok(keys.includes("pending") && keys.includes("issued") && keys.includes("scan_hint"));
    });
  });

  describe("state resolution", () => {
    it("23. resolves the four states from local storage alone", async () => {
      assert.strictEqual(resolveCertificateState(ATTEMPT, failedAttempt()).state, "failed");
      assert.strictEqual(resolveCertificateState(ATTEMPT, passedAttempt()).state, "passed");

      requestCertificateForAttempt(passedAttempt());
      assert.strictEqual(resolveCertificateState(ATTEMPT, passedAttempt()).state, "pending");

      await withFetch(() => jsonResponse(201, issueBody()), () => flushPendingCertificates());
      assert.strictEqual(resolveCertificateState(ATTEMPT, passedAttempt()).state, "issued");
    });

    it("24. a 422 from the server drops the pending item back to passed", async () => {
      requestCertificateForAttempt(passedAttempt());
      await withFetch(
        () => jsonResponse(422, { error: { code: "attempt_not_passed", message: "did not pass" } }),
        () => flushPendingCertificates()
      );

      // the server is the authority: it refused, so there is no certificate and
      // no pending work left asking for one
      assert.strictEqual(getPendingCertificates().length, 0);
      assert.strictEqual(resolveCertificateState(ATTEMPT, passedAttempt()).state, "passed");
    });

    it("25. requesting twice for one attempt queues once", () => {
      requestCertificateForAttempt(passedAttempt());
      const second = requestCertificateForAttempt(passedAttempt());

      assert.strictEqual(second.queued, 0);
      assert.strictEqual(second.reason, "already_pending");
      assert.strictEqual(getPendingCertificates().length, 1);
    });
  });
});
