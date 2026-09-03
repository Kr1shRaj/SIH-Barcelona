// turn checkpoint_definition rows into the camelCase shape the engine consumes
function _toWireCheckpoint(row) {
  return {
    checkpointId: row.checkpoint_id,
    type: row.checkpoint_type,
    weight: row.weight,
    required: row.required === 1,
    critical: row.critical === 1
  };
}

// one module row, or undefined when this server has never heard of it
function getModule(db, moduleId) {
  return db.prepare("SELECT * FROM module WHERE module_id = ?").get(moduleId);
}

// manifest rows for one module, snake_case exactly as sqlite hands them back.
// checkAgainstManifest and the scorer both want them in this raw shape.
function getCheckpointDefinitions(db, moduleId) {
  return db
    .prepare("SELECT * FROM checkpoint_definition WHERE module_id = ? ORDER BY checkpoint_id")
    .all(moduleId);
}

// everything GET /api/modules serves, so the engine can score offline
function listModuleManifests(db) {
  const modules = db.prepare("SELECT * FROM module ORDER BY module_id").all();

  return modules.map((moduleRow) => ({
    moduleId: moduleRow.module_id,
    title: moduleRow.title,
    version: moduleRow.version,
    passThreshold: moduleRow.pass_threshold,
    recertMonths: moduleRow.recert_months,
    requiredCheckpoints: getCheckpointDefinitions(db, moduleRow.module_id).map(_toWireCheckpoint)
  }));
}

module.exports = {
  getModule,
  getCheckpointDefinitions,
  listModuleManifests
};
