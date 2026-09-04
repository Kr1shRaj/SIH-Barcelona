const express = require("express");
const { getComplianceMetrics } = require("../services/dashboard");
const { requireAdminKey } = require("../middleware/admin-auth");

// build routes for admin compliance dashboard metrics
function createDashboardRouter({ db, config }) {
  if (!db) {
    throw new Error("createDashboardRouter requires a database instance");
  }
  // refuse to build an unguarded router at all, rather than mount one that looks
  // protected and is not
  if (!config) {
    throw new Error("createDashboardRouter requires config for admin authentication");
  }

  const router = express.Router();

  // every path under /api/dashboard carries named workers, their mine and
  // contractor, their scores and their certificates. none of it is public.
  router.use(requireAdminKey(config));

  // consolidated compliance summary & worker roster
  router.get("/compliance", (req, res, next) => {
    try {
      const metrics = getComplianceMetrics(db);
      res.json(metrics);
    } catch (err) {
      next(err);
    }
  });

  // root route aliases to /compliance
  router.get("/", (req, res, next) => {
    try {
      const metrics = getComplianceMetrics(db);
      res.json(metrics);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createDashboardRouter };
