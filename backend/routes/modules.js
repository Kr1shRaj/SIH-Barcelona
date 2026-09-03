const express = require("express");
const { listModuleManifests } = require("../services/modules");

// build routes for module metadata and pass thresholds
function createModulesRouter({ db }) {
  const router = express.Router();

  // the engine pulls this once while online and caches it to score offline
  router.get("/", (req, res, next) => {
    try {
      res.json(listModuleManifests(db));
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createModulesRouter };
