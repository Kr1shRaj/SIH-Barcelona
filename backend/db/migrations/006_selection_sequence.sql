-- v5 -> v6. Scenario graded fail-to-learn gates.
--
-- Adds checkpoint_definition.answer_key and .applies_when, and lets both
-- checkpoint_definition and checkpoint_result hold the new 'selection_sequence'
-- observation kind.
--
-- SQLite cannot alter a CHECK constraint, so those two tables are rebuilt:
-- new table, copy every row column by column, drop the old one, rename. No row
-- is changed or lost. The two new columns start NULL, which means "not scenario
-- graded" and "applies to every scenario" — exactly today's behaviour.
-- Nothing references either table by foreign key, so the drop is safe with
-- foreign_keys on, and the whole file runs inside one transaction (db/index.js).
--
-- New fire gate rules arrive the usual way: re-run the seed after migrating.

CREATE TABLE checkpoint_definition_v6 (
  module_id     TEXT NOT NULL REFERENCES module(module_id),
  checkpoint_id TEXT NOT NULL,
  checkpoint_type TEXT NOT NULL CHECK (checkpoint_type IN ('aim', 'proximity', 'select')),
  observation_kind TEXT NOT NULL CHECK (observation_kind IN
    ('selection_single', 'selection_multi', 'spatial_alignment', 'aim_dwell', 'selection_sequence')),

  -- NULL = lives on every tier. a number pins it to one tier and the manifest
  -- check rejects an attempt that claims the other one.
  applies_to_tier INTEGER CHECK (applies_to_tier IS NULL OR applies_to_tier IN (1, 2)),

  -- json. string for selection_single, array for selection_multi, NULL otherwise.
  expected_value   TEXT,
  -- json array of every option the shipped ui can produce. anything else is a 422.
  allowed_values   TEXT,
  -- json array, selection_multi only
  forbidden_values TEXT,
  -- json array of tracking sources allowed to certify
  allowed_tracking_sources TEXT,

  -- selection_sequence only. json {"by": scenario field, "cases": {value: {"expected", "severity"}}}.
  -- answer depend on the scenario the server roll from attemptId, so it cannot be one expected_value.
  answer_key       TEXT,
  -- json {scenario field: value}. NULL = every scenario. a row that does not apply
  -- to this attempt's scenario is not required and must not be sent.
  applies_when     TEXT,

  -- spatial_alignment. NULL max_angular_error_rad means nobody has measured this
  -- on a real device yet, so the grader scores it zero instead of guessing.
  anchor_id             TEXT,
  max_angular_error_rad REAL,

  -- aim_dwell
  max_distance_m     REAL,
  pass_threshold     REAL,
  min_sweep_coverage REAL,

  -- optional plausibility gates for both spatial kinds. NULL = gate not applied.
  min_dwell_ms    INTEGER,
  min_frame_count INTEGER,

  -- 0 = rule not configured yet. scores zero, blocks certification, never passes.
  gradeable     INTEGER NOT NULL DEFAULT 1 CHECK (gradeable IN (0, 1)),

  weight        REAL NOT NULL DEFAULT 1 CHECK (weight > 0),
  required      INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0, 1)),
  -- 0 = aggregate scoring only. flipping to 1 fails the whole module on this checkpoint.
  -- stays 0 until the team rules on which checkpoints are safety critical.
  critical      INTEGER NOT NULL DEFAULT 0 CHECK (critical IN (0, 1)),
  created_at    TEXT NOT NULL,
  PRIMARY KEY (module_id, checkpoint_id)
);

INSERT INTO checkpoint_definition_v6 (module_id, checkpoint_id, checkpoint_type, observation_kind, applies_to_tier, expected_value, allowed_values, forbidden_values, allowed_tracking_sources, anchor_id, max_angular_error_rad, max_distance_m, pass_threshold, min_sweep_coverage, min_dwell_ms, min_frame_count, gradeable, weight, required, critical, created_at)
  SELECT module_id, checkpoint_id, checkpoint_type, observation_kind, applies_to_tier, expected_value, allowed_values, forbidden_values, allowed_tracking_sources, anchor_id, max_angular_error_rad, max_distance_m, pass_threshold, min_sweep_coverage, min_dwell_ms, min_frame_count, gradeable, weight, required, critical, created_at FROM checkpoint_definition;

DROP TABLE checkpoint_definition;
ALTER TABLE checkpoint_definition_v6 RENAME TO checkpoint_definition;
CREATE INDEX IF NOT EXISTS idx_ckdef_module ON checkpoint_definition (module_id);

CREATE TABLE checkpoint_result_v6 (
  attempt_id      TEXT NOT NULL REFERENCES attempt(attempt_id) ON DELETE CASCADE,
  checkpoint_id   TEXT NOT NULL,
  checkpoint_type TEXT NOT NULL CHECK (checkpoint_type IN ('aim', 'proximity', 'select')),
  observation_kind TEXT NOT NULL CHECK (observation_kind IN
    ('selection_single', 'selection_multi', 'spatial_alignment', 'aim_dwell', 'selection_sequence')),
  -- raw observation exactly as it arrived. evidence, never proof, never an answer key.
  observation_json TEXT NOT NULL,

  -- graded on this server from checkpoint_definition, 0..1
  server_score    REAL NOT NULL CHECK (server_score BETWEEN 0 AND 1),
  server_passed   INTEGER NOT NULL CHECK (server_passed IN (0, 1)),
  -- why the grader landed there, e.g. no_aim_sample, threshold_unconfigured
  grade_reason    TEXT,
  -- taken from checkpoint_definition, never from the payload
  weight          REAL NOT NULL CHECK (weight > 0),
  -- v2 carries no per checkpoint client verdict, so this stays NULL for now
  client_claimed_passed INTEGER CHECK (client_claimed_passed IS NULL OR client_claimed_passed IN (0, 1)),
  client_ts       TEXT NOT NULL,
  PRIMARY KEY (attempt_id, checkpoint_id)
);

INSERT INTO checkpoint_result_v6 (attempt_id, checkpoint_id, checkpoint_type, observation_kind, observation_json, server_score, server_passed, grade_reason, weight, client_claimed_passed, client_ts)
  SELECT attempt_id, checkpoint_id, checkpoint_type, observation_kind, observation_json, server_score, server_passed, grade_reason, weight, client_claimed_passed, client_ts FROM checkpoint_result;

DROP TABLE checkpoint_result;
ALTER TABLE checkpoint_result_v6 RENAME TO checkpoint_result;
CREATE INDEX IF NOT EXISTS idx_ckresult_checkpoint ON checkpoint_result (checkpoint_id);
