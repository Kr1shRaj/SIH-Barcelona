const express = require("express");
const { getComplianceMetrics } = require("../services/dashboard");

// build routes for admin compliance dashboard metrics
function createDashboardRouter({ db }) {
  if (!db) {
    throw new Error("createDashboardRouter requires a database instance");
  }

  const router = express.Router();

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
