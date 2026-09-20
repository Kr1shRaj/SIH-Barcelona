import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DASHBOARD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The admin dashboard is the only page in this repo that reads the real ledger —
// attempts, scores, certificates — and it reads it over an authenticated call to
// the backend. It is also the page that quietly lost its entry point once: the root
// index.html became a redirect to the worker training portal, which left
// js/dashboard.js with no html to run on, so the only dashboard anybody could
// actually open was the portal's local demo state.
//
// These tests exist so that cannot happen again without a test saying so.
describe("the admin dashboard has a page to run on", () => {
  const read = (rel) => fs.readFileSync(path.join(DASHBOARD, rel), "utf8");

  it("some page loads the backend-connected dashboard client", () => {
    const pages = fs.readdirSync(DASHBOARD)
      .filter((name) => name.endsWith(".html"))
      .filter((name) => read(name).includes("js/dashboard.js"));

    assert.ok(pages.length > 0, "js/dashboard.js must be mounted by a page, or no admin can see the ledger");
  });

  it("admin.html mounts it the way the client expects", () => {
    const html = read("admin.html");

    // loadComplianceMetrics() defaults to this container and boots itself
    assert.match(html, /id="dashboard-app"/);
    assert.match(html, /<script src="\.\/js\/dashboard\.js" type="module">/);
    assert.match(html, /<link rel="stylesheet" href="\.\/css\/dashboard\.css">/);
  });

  it("no admin credential is written into any dashboard page", () => {
    fs.readdirSync(DASHBOARD)
      .filter((name) => name.endsWith(".html"))
      .forEach((name) => {
        const html = read(name);
        assert.ok(!html.includes("x-admin-key"), `${name} must not carry the admin header`);
        assert.ok(!/ADMIN_API_KEY/.test(html), `${name} must not name the admin key`);
      });
  });

  it("the worker portal is a separate thing, and does not pretend to be the ledger", () => {
    // index.html sends people to the training portal, which keeps its own state in
    // localStorage. that is fine — it is a training portal, not a compliance report —
    // but it must not be the only dashboard, which is what the test above guards.
    const index = read("index.html");
    assert.match(index, /\/mobile\//, "the root still sends people to the portal");

    const portalState = read("mobile/js/state.js");
    assert.ok(portalState.includes("localStorage"), "the portal is local-only today");
    assert.ok(!portalState.includes("/api/"), "and it does not read the backend ledger");
  });
});
