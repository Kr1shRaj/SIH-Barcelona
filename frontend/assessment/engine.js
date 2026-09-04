// api base comes from api.js so this file never decides where the backend lives
import { resolveApiBase } from "../js/api.js";

// safe constants for assessment contract v1.0 and offline sync
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDENTIFIER = /^[a-z][a-z0-9_-]{1,63}$/;
const CHECKPOINT_TYPES = ["aim", "proximity", "select"];
const MAX_CONTEXT_BYTES = 4096;
const MAX_DURATION_MS = 4 * 60 * 60 * 1000;
const QUEUE_STORAGE_KEY = "safear_attempt_sync_queue";
const WORKER_STORAGE_KEY = "safear_worker_id";
const DEVICE_STORAGE_KEY = "safear_device_id";
const MANIFEST_STORAGE_KEY = "safear_module_manifests";
const REJECTION_STORAGE_KEY = "safear_attempt_sync_rejections";
const CANONICAL_DEMO_WORKER_ID = "WRK-0001";
const MAX_BATCH_ATTEMPTS = 50;

// accepted and duplicate are both settled: the server holds the record either way,
// so the local copy can go. rejected is NOT settled and must stay queued, or the
// worker run is destroyed with no record on either side.
const SETTLED_SYNC_STATUSES = ["accepted", "duplicate"];

// default deterministic manifests used offline when server unavailable
const DEFAULT_LOCAL_MANIFESTS = [
  {
    moduleId: "fire-response",
    title: "Fire & Explosion Response",
    version: 1,
    passThreshold: 0.7,
    recertMonths: null,
    requiredCheckpoints: [
      { checkpointId: "fire_exit_identification", type: "proximity", weight: 1, required: true, critical: false },
      { checkpointId: "fire_extinguisher_aim", type: "aim", weight: 1, required: true, critical: false },
      { checkpointId: "fire_evacuation_sequence", type: "select", weight: 1, required: true, critical: false }
    ]
  },
  {
    moduleId: "gas-leak",
    title: "Gas Leak & Confined Space Protocol",
    version: 1,
    passThreshold: 0.7,
    recertMonths: null,
    requiredCheckpoints: [
      { checkpointId: "gas_hazard_zone_recognition", type: "proximity", weight: 1, required: true, critical: false },
      { checkpointId: "gas_ppe_selection", type: "select", weight: 1, required: true, critical: false },
      { checkpointId: "gas_buddy_procedure", type: "select", weight: 1, required: true, critical: false }
    ]
  }
];

let _activeSession = null;
let _boundListener = null;

// generate standard uuid v4 string safely
function _generateUUIDv4() {
  const gCrypto = typeof globalThis !== "undefined" && globalThis.crypto ? globalThis.crypto : (typeof window !== "undefined" ? window.crypto : null);
  if (gCrypto && typeof gCrypto.randomUUID === "function") {
    return gCrypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// check if iso timestamp string is real utc timestamp with milliseconds
function _isValidIsoTimestamp(str) {
  if (typeof str !== "string") return false;
  const parsed = new Date(str);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === str;
}

// sanitize context and strip correct answer key
function _sanitizeContext(ctx) {
  if (!ctx || typeof ctx !== "object" || Array.isArray(ctx)) {
    return {};
  }
  const clean = { ...ctx };
  delete clean.correct;
  const serialized = JSON.stringify(clean);
  if (serialized.length > MAX_CONTEXT_BYTES) {
    throw new Error(`context must serialize to ${MAX_CONTEXT_BYTES} bytes or less`);
  }
  return clean;
}

// get local storage handle safely across browser and test envs
function _getStorage() {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  if (typeof globalThis !== "undefined" && globalThis.localStorage) {
    return globalThis.localStorage;
  }
  return null;
}

// evaluate score and check if attempt pass threshold
function evaluateAssessment(attemptRecord, passThreshold) {
  if (!attemptRecord || typeof attemptRecord !== "object" || Array.isArray(attemptRecord)) {
    throw new Error("attemptRecord must be an object");
  }

  const contractVersion = attemptRecord.contractVersion || "1.0";
  if (contractVersion !== "1.0") {
    throw new Error(`unsupported contractVersion ${contractVersion}`);
  }

  const { attemptId, workerId, moduleId, moduleVersion, engineVersion, deviceId, arTier, locale, startedAt, completedAt } = attemptRecord;

  if (typeof attemptId !== "string" || !UUID_V4.test(attemptId)) {
    throw new Error("attemptId must be a UUID v4");
  }

  if (typeof workerId !== "string" || workerId.length < 1 || workerId.length > 64) {
    throw new Error("workerId must be a string between 1 and 64 characters");
  }

  if (typeof moduleId !== "string" || !IDENTIFIER.test(moduleId)) {
    throw new Error("moduleId must be a lowercase identifier of 2 to 64 chars");
  }

  if (typeof moduleVersion !== "number" || !Number.isInteger(moduleVersion) || moduleVersion <= 0) {
    throw new Error("moduleVersion must be a positive integer");
  }

  const resolvedEngineVersion = engineVersion || "1.0.0";
  if (typeof resolvedEngineVersion !== "string" || resolvedEngineVersion.length < 1 || resolvedEngineVersion.length > 32) {
    throw new Error("engineVersion must be a string between 1 and 32 characters");
  }

  if (typeof deviceId !== "string" || deviceId.length < 1 || deviceId.length > 64) {
    throw new Error("deviceId must be a string between 1 and 64 characters");
  }

  if (arTier !== 1 && arTier !== 2) {
    throw new Error("arTier must be 1 or 2");
  }

  if (typeof locale !== "string" || locale.length < 2 || locale.length > 8) {
    throw new Error("locale must be a string between 2 and 8 characters");
  }

  if (!_isValidIsoTimestamp(startedAt)) {
    throw new Error("startedAt must be a valid ISO 8601 UTC timestamp with milliseconds");
  }

  if (!_isValidIsoTimestamp(completedAt)) {
    throw new Error("completedAt must be a valid ISO 8601 UTC timestamp with milliseconds");
  }

  const startedMs = Date.parse(startedAt);
  const completedMs = Date.parse(completedAt);

  if (completedMs < startedMs) {
    throw new Error("completedAt must not be earlier than startedAt");
  }

  let durationMs = attemptRecord.durationMs;
  if (durationMs === undefined || durationMs === null) {
    durationMs = completedMs - startedMs;
  }

  if (typeof durationMs !== "number" || !Number.isInteger(durationMs) || durationMs < 0 || durationMs > MAX_DURATION_MS) {
    throw new Error(`durationMs must be an integer between 0 and ${MAX_DURATION_MS}`);
  }

  if (attemptRecord.status !== undefined && attemptRecord.status !== "completed") {
    throw new Error('status must be "completed"');
  }

  const rawCheckpoints = attemptRecord.checkpoints;
  if (!Array.isArray(rawCheckpoints) || rawCheckpoints.length === 0) {
    throw new Error("checkpoints must be a non-empty array");
  }

  const threshold = typeof passThreshold === "number" ? passThreshold : attemptRecord.passThresholdUsed;
  if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error("passThreshold must be a number between 0 and 1");
  }

  const seenCheckpoints = new Set();
  const sanitizedCheckpoints = [];
  let totalScore = 0;
  let maxScore = 0;

  for (let i = 0; i < rawCheckpoints.length; i += 1) {
    const cp = rawCheckpoints[i];
    if (!cp || typeof cp !== "object" || Array.isArray(cp)) {
      throw new Error(`checkpoint at index ${i} must be an object`);
    }

    if (typeof cp.checkpointId !== "string" || !IDENTIFIER.test(cp.checkpointId)) {
      throw new Error(`checkpoint at index ${i} has invalid checkpointId`);
    }

    if (seenCheckpoints.has(cp.checkpointId)) {
      throw new Error(`duplicate checkpoint "${cp.checkpointId}" — the engine must keep one entry per checkpoint`);
    }
    seenCheckpoints.add(cp.checkpointId);

    if (!CHECKPOINT_TYPES.includes(cp.type)) {
      throw new Error(`checkpoint "${cp.checkpointId}" has invalid type "${cp.type}"`);
    }

    if (typeof cp.passed !== "boolean") {
      throw new Error(`checkpoint "${cp.checkpointId}" passed must be a boolean`);
    }

    if (typeof cp.score !== "number" || !Number.isFinite(cp.score) || cp.score < 0 || cp.score > 1) {
      throw new Error(`checkpoint "${cp.checkpointId}" score must be between 0 and 1`);
    }

    if (typeof cp.weight !== "number" || !Number.isFinite(cp.weight) || cp.weight <= 0) {
      throw new Error(`checkpoint "${cp.checkpointId}" weight must be a positive number`);
    }

    if (!_isValidIsoTimestamp(cp.timestamp)) {
      throw new Error(`checkpoint "${cp.checkpointId}" timestamp must be a valid ISO 8601 UTC timestamp`);
    }

    const cpMs = Date.parse(cp.timestamp);
    if (cpMs < startedMs || cpMs > completedMs) {
      throw new Error(`checkpoint "${cp.checkpointId}" timestamp outside attempt window`);
    }

    const cleanContext = _sanitizeContext(cp.context);

    sanitizedCheckpoints.push({
      checkpointId: cp.checkpointId,
      type: cp.type,
      passed: cp.passed,
      score: cp.score,
      weight: cp.weight,
      timestamp: cp.timestamp,
      context: cleanContext
    });

    totalScore += cp.score * cp.weight;
    maxScore += cp.weight;
  }

  totalScore = Math.round(totalScore * 100) / 100;
  maxScore = Math.round(maxScore * 100) / 100;

  if (maxScore <= 0) {
    throw new Error("maxScore must be positive");
  }

  const rawPercentage = (totalScore / maxScore) * 100;
  const percentage = Math.round(rawPercentage * 100) / 100;
  const passThresholdUsed = Math.round(threshold * 100) / 100;
  const passed = percentage >= Math.round(passThresholdUsed * 10000) / 100;

  return {
    contractVersion,
    attemptId,
    workerId,
    moduleId,
    moduleVersion,
    engineVersion: resolvedEngineVersion,
    deviceId,
    arTier,
    locale,
    startedAt,
    completedAt,
    durationMs,
    status: "completed",
    checkpoints: sanitizedCheckpoints,
    totalScore,
    maxScore,
    percentage,
    passThresholdUsed,
    passed
  };
}

// read local storage offline sync queue
function getQueuedAttempts() {
  const storage = _getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    return [];
  }
}

// resolve effective worker id from query param, local storage, or canonical demo fallback
function getEffectiveWorkerId() {
  if (typeof window !== "undefined" && window.location && typeof window.location.search === "string") {
    try {
      const URLParamsCtor = window.URLSearchParams || (typeof globalThis !== "undefined" ? globalThis.URLSearchParams : null);
      if (URLParamsCtor) {
        const params = new URLParamsCtor(window.location.search);
        const queryWorker = params.get("workerId") || params.get("worker");
        if (queryWorker && typeof queryWorker === "string" && queryWorker.trim().length > 0 && queryWorker.length <= 64) {
          const clean = queryWorker.trim();
          setWorkerId(clean);
          return clean;
        }
      }
    } catch (_err) {
      // url params parsing failed
    }
  }

  const storage = _getStorage();
  if (storage) {
    try {
      const stored = storage.getItem(WORKER_STORAGE_KEY);
      if (stored && typeof stored === "string" && stored.trim().length > 0 && stored.length <= 64) {
        return stored.trim();
      }
    } catch (_err) {
      // storage read failed
    }
  }

  return CANONICAL_DEMO_WORKER_ID;
}

// set active worker id explicitly in local storage
function setWorkerId(id) {
  if (!id || typeof id !== "string" || id.trim().length === 0 || id.length > 64) {
    throw new Error("workerId must be a string between 1 and 64 characters");
  }
  const clean = id.trim();
  const storage = _getStorage();
  if (storage) {
    storage.setItem(WORKER_STORAGE_KEY, clean);
  }
  return clean;
}

// resolve or create stable device id for phone
function getDeviceId() {
  const storage = _getStorage();
  if (storage) {
    try {
      const stored = storage.getItem(DEVICE_STORAGE_KEY);
      if (stored && typeof stored === "string" && stored.trim().length > 0 && stored.length <= 64) {
        return stored.trim();
      }
      const newId = `dev-${_generateUUIDv4().substring(0, 8)}`;
      storage.setItem(DEVICE_STORAGE_KEY, newId);
      return newId;
    } catch (_err) {
      // fallback
    }
  }
  return "dev-local";
}

// validate structure of module manifest array
function validateModuleManifests(data) {
  if (!Array.isArray(data) || data.length === 0) {
    return false;
  }
  return data.every((m) => {
    if (!m || typeof m !== "object" || typeof m.moduleId !== "string" || !IDENTIFIER.test(m.moduleId)) {
      return false;
    }
    if (typeof m.title !== "string" || m.title.length === 0 || m.title.length > 200) {
      return false;
    }
    if (typeof m.version !== "number" || !Number.isInteger(m.version) || m.version <= 0) {
      return false;
    }
    if (typeof m.passThreshold !== "number" || Number.isNaN(m.passThreshold) || m.passThreshold < 0 || m.passThreshold > 1) {
      return false;
    }
    if (!Array.isArray(m.requiredCheckpoints) || m.requiredCheckpoints.length === 0) {
      return false;
    }
    return m.requiredCheckpoints.every((cp) => {
      return cp && typeof cp === "object" &&
        typeof cp.checkpointId === "string" && IDENTIFIER.test(cp.checkpointId) &&
        CHECKPOINT_TYPES.includes(cp.type) &&
        typeof cp.weight === "number" && cp.weight > 0;
    });
  });
}

// read cached manifest from local storage or fallback to local definitions synchronously
function getCachedOrLocalManifest(moduleId) {
  const storage = _getStorage();
  if (storage) {
    try {
      const raw = storage.getItem(MANIFEST_STORAGE_KEY);
      if (raw) {
        const cached = JSON.parse(raw);
        if (validateModuleManifests(cached)) {
          const found = cached.find((m) => m.moduleId === moduleId);
          if (found) return found;
        }
      }
    } catch (_err) {
      // cached json parse failed
    }
  }
  return DEFAULT_LOCAL_MANIFESTS.find((m) => m.moduleId === moduleId) || null;
}

// fetch manifests from backend, update cache, fall back gracefully offline
async function fetchModuleManifests({ baseUrl = resolveApiBase(), timeoutMs = 5000 } = {}) {
  const storage = _getStorage();

  const fetchHandle = (typeof window !== "undefined" && window.fetch)
    ? window.fetch
    : (typeof globalThis !== "undefined" && globalThis.fetch ? globalThis.fetch : null);

  if (fetchHandle) {
    try {
      const AbortCtrl = (typeof window !== "undefined" && window.AbortController) || (typeof globalThis !== "undefined" ? globalThis.AbortController : null);
      const setTimer = (typeof window !== "undefined" && window.setTimeout) || (typeof globalThis !== "undefined" ? globalThis.setTimeout : null);
      const clearTimer = (typeof window !== "undefined" && window.clearTimeout) || (typeof globalThis !== "undefined" ? globalThis.clearTimeout : null);

      const controller = AbortCtrl ? new AbortCtrl() : null;
      const timer = (controller && setTimer) ? setTimer(() => controller.abort(), timeoutMs) : null;
      const res = await fetchHandle(`${baseUrl}/api/modules`, {
        signal: controller ? controller.signal : undefined
      });
      if (timer && clearTimer) clearTimer(timer);

      if (res.ok) {
        const data = await res.json();
        if (validateModuleManifests(data)) {
          if (storage) {
            storage.setItem(MANIFEST_STORAGE_KEY, JSON.stringify(data));
          }
          return data;
        }
      }
    } catch (_err) {
      // offline or backend unreachable, proceed to cache/local fallback
    }
  }

  // try cache
  if (storage) {
    try {
      const raw = storage.getItem(MANIFEST_STORAGE_KEY);
      if (raw) {
        const cached = JSON.parse(raw);
        if (validateModuleManifests(cached)) {
          return cached;
        }
      }
    } catch (_err) {
      // cached json parse failed
    }
  }

  return DEFAULT_LOCAL_MANIFESTS;
}

// get single module manifest by id
async function getModuleManifest(moduleId, options = {}) {
  const manifests = await fetchModuleManifests(options);
  const found = manifests.find((m) => m.moduleId === moduleId);
  if (found) return found;
  return DEFAULT_LOCAL_MANIFESTS.find((m) => m.moduleId === moduleId) || null;
}

// read the rejection log, empty when nothing has ever been turned down
function getSyncRejections() {
  const storage = _getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(REJECTION_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    return [];
  }
}

// wipe the rejection log
function clearSyncRejections() {
  const storage = _getStorage();
  if (storage) {
    storage.removeItem(REJECTION_STORAGE_KEY);
  }
}

// keep why the server turned an attempt down, in its OWN key.
// it must never ride on the queued attempt itself: the backend validates attempts
// with a strict schema, so one extra field would fail the whole next batch.
function _recordSyncRejections(rejections) {
  if (!Array.isArray(rejections) || rejections.length === 0) return getSyncRejections();
  const storage = _getStorage();
  const log = getSyncRejections();
  const byId = new Map(log.map((entry) => [entry.attemptId, entry]));
  rejections.forEach((entry) => byId.set(entry.attemptId, entry));
  const merged = Array.from(byId.values());
  if (storage) {
    storage.setItem(REJECTION_STORAGE_KEY, JSON.stringify(merged));
  }
  return merged;
}

// split the server per-attempt verdicts into settled ids and rejections.
// returns null when the server sent no results array, which the contract says
// it always does on 200 and 422.
function _partitionSyncResults(resData) {
  if (!resData || !Array.isArray(resData.results)) return null;

  const settledIds = [];
  const rejections = [];

  resData.results.forEach((result) => {
    if (!result || typeof result.attemptId !== "string") return;
    if (SETTLED_SYNC_STATUSES.indexOf(result.status) !== -1) {
      settledIds.push(result.attemptId);
    } else if (result.status === "rejected") {
      rejections.push({
        attemptId: result.attemptId,
        reason: result.reason || "rejected",
        message: result.message || "",
        at: new Date().toISOString()
      });
    }
  });

  return { settledIds, rejections };
}

// remove confirmed synced attempt ids from queue
function removeSyncedAttempts(syncedAttemptIds) {
  if (!Array.isArray(syncedAttemptIds) || syncedAttemptIds.length === 0) {
    return getQueuedAttempts();
  }
  const idSet = new Set(syncedAttemptIds);
  const current = getQueuedAttempts();
  const filtered = current.filter((attempt) => !idSet.has(attempt.attemptId));
  const storage = _getStorage();
  if (storage) {
    storage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(filtered));
  }
  return filtered;
}

// push queued attempts to backend /api/sync
async function syncQueuedAttempts({ baseUrl = resolveApiBase(), deviceId, workerId, batchSize = MAX_BATCH_ATTEMPTS } = {}) {
  const queue = getQueuedAttempts();
  if (queue.length === 0) {
    return { success: true, synced: 0, remaining: 0 };
  }

  const effectiveWorkerId = workerId || getEffectiveWorkerId();
  const effectiveDeviceId = deviceId || getDeviceId();
  const limit = Math.min(queue.length, Math.min(batchSize, MAX_BATCH_ATTEMPTS));
  const batch = queue.slice(0, limit);

  // ensure every attempt in batch carries the validated workerId
  const normalizedBatch = batch.map((att) => {
    if (!att.workerId || att.workerId === "WRK-DEFAULT") {
      return { ...att, workerId: effectiveWorkerId };
    }
    return att;
  });

  const envelope = {
    batchId: _generateUUIDv4(),
    deviceId: effectiveDeviceId,
    workerId: effectiveWorkerId,
    sentAt: new Date().toISOString(),
    attempts: normalizedBatch
  };

  const fetchHandle = (typeof window !== "undefined" && window.fetch)
    ? window.fetch
    : (typeof globalThis !== "undefined" && globalThis.fetch ? globalThis.fetch : null);

  if (!fetchHandle) {
    return { success: false, reason: "no_fetch", remaining: queue.length };
  }

  try {
    const res = await fetchHandle(`${baseUrl}/api/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(envelope)
    });

    let resData = null;
    try {
      resData = await res.json();
    } catch (_err) {
      resData = null;
    }

    // trust what the server said happened, never what we happened to send
    const partition = _partitionSyncResults(resData);

    if (res.ok) {
      // no results array means we cannot tell which attempts landed. assuming they
      // all did is exactly the data loss this guards against, so keep everything.
      if (!partition) {
        return {
          success: false,
          status: res.status,
          reason: "malformed_response",
          error: resData,
          remaining: queue.length
        };
      }

      const remainingQueue = removeSyncedAttempts(partition.settledIds);
      _recordSyncRejections(partition.rejections);

      return {
        // a mixed batch is not a full success, even though http said 200
        success: partition.rejections.length === 0,
        status: res.status,
        synced: partition.settledIds.length,
        rejected: partition.rejections.length,
        rejections: partition.rejections,
        remaining: remainingQueue.length,
        data: resData
      };
    }

    // backend rejected batch (4xx validation error or 5xx server error)
    // NEVER remove attempts from queue on rejection.
    // a 422 still carries per attempt reasons, so keep them for later.
    if (partition) {
      _recordSyncRejections(partition.rejections);
    }

    return {
      success: false,
      status: res.status,
      reason: res.status >= 500 ? "server_error" : "validation_error",
      rejections: partition ? partition.rejections : [],
      error: resData,
      remaining: queue.length
    };
  } catch (err) {
    // network failure / offline: retain all attempts in queue
    return {
      success: false,
      reason: "network_offline",
      error: err.message,
      remaining: queue.length
    };
  }
}

// clear local storage offline sync queue
function clearAttemptQueue() {
  const storage = _getStorage();
  if (storage) {
    storage.removeItem(QUEUE_STORAGE_KEY);
  }
}

// save attempt to local storage queue for offline sync
function queueAttemptForSync(attemptRecord) {
  if (!attemptRecord || typeof attemptRecord !== "object" || Array.isArray(attemptRecord)) {
    throw new Error("attemptRecord must be an object");
  }

  if (typeof attemptRecord.attemptId !== "string" || !UUID_V4.test(attemptRecord.attemptId)) {
    throw new Error("attemptRecord must have a valid UUID v4 attemptId");
  }

  const queue = getQueuedAttempts();
  queue.push(attemptRecord);

  const storage = _getStorage();
  if (storage) {
    storage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
  }

  return queue;
}

// start active assessment session to collect checkpoints
function startAssessmentSession({
  workerId,
  moduleId,
  moduleVersion = 1,
  engineVersion = "1.0.0",
  deviceId,
  arTier = 2,
  locale = "hi",
  passThreshold,
  weights,
  startedAt = new Date().toISOString(),
  attemptId = _generateUUIDv4()
} = {}) {
  if (!moduleId || typeof moduleId !== "string") {
    throw new Error("moduleId is required to start assessment session");
  }

  const effectiveWorkerId = workerId || getEffectiveWorkerId();
  const effectiveDeviceId = deviceId || getDeviceId();
  const manifest = getCachedOrLocalManifest(moduleId);

  const resolvedPassThreshold = (typeof passThreshold === "number" && !Number.isNaN(passThreshold))
    ? passThreshold
    : (manifest && typeof manifest.passThreshold === "number" ? manifest.passThreshold : 0.7);

  const resolvedWeights = weights ? { ...weights } : {};
  if (manifest && (!weights || Object.keys(weights).length === 0)) {
    manifest.requiredCheckpoints.forEach((cp) => {
      if (resolvedWeights[cp.checkpointId] === undefined) {
        resolvedWeights[cp.checkpointId] = cp.weight;
      }
    });
  }

  _activeSession = {
    attemptId,
    workerId: effectiveWorkerId,
    moduleId,
    moduleVersion: manifest && manifest.version ? manifest.version : moduleVersion,
    engineVersion,
    deviceId: effectiveDeviceId,
    arTier,
    locale,
    passThreshold: resolvedPassThreshold,
    weights: resolvedWeights,
    startedAt,
    checkpoints: new Map()
  };

  return { ..._activeSession, checkpoints: [] };
}

// get snapshot of currently active assessment session
function getActiveSession() {
  if (!_activeSession) return null;
  return {
    ..._activeSession,
    checkpoints: Array.from(_activeSession.checkpoints.values())
  };
}

// record checkpoint result into active assessment session
function recordCheckpointResult(detail) {
  if (!_activeSession) {
    return null;
  }

  if (!detail || typeof detail !== "object" || !detail.checkpointId || !detail.type) {
    throw new Error("invalid checkpoint detail payload");
  }

  // prevent duplicate checkpoint registration breaking contract
  if (_activeSession.checkpoints.has(detail.checkpointId)) {
    return _activeSession.checkpoints.get(detail.checkpointId);
  }

  let score = 0;
  if (typeof detail.score === "number" && Number.isFinite(detail.score) && detail.score >= 0 && detail.score <= 1) {
    score = detail.score;
  } else if (detail.context && typeof detail.context.accuracy === "number") {
    score = detail.context.accuracy;
  } else if (detail.context && typeof detail.context.score === "number") {
    score = detail.context.score;
  } else {
    score = detail.passed ? 1 : 0;
  }

  const weight = (_activeSession.weights && _activeSession.weights[detail.checkpointId]) || detail.weight || 1;
  const timestamp = detail.timestamp || new Date().toISOString();

  const record = {
    checkpointId: detail.checkpointId,
    type: detail.type,
    passed: Boolean(detail.passed),
    score,
    weight,
    timestamp,
    context: detail.context || {}
  };

  _activeSession.checkpoints.set(detail.checkpointId, record);
  return record;
}

// finish session, evaluate assessment result, queue for offline sync
function finishAssessmentSession(options = {}) {
  if (!_activeSession) {
    throw new Error("no active assessment session to finish");
  }

  const session = _activeSession;
  const completedAt = options.completedAt || new Date().toISOString();
  const checkpointsList = Array.from(session.checkpoints.values());

  const attemptRecord = {
    contractVersion: "1.0",
    attemptId: session.attemptId,
    workerId: session.workerId,
    moduleId: session.moduleId,
    moduleVersion: session.moduleVersion,
    engineVersion: session.engineVersion,
    deviceId: session.deviceId,
    arTier: session.arTier,
    locale: session.locale,
    startedAt: session.startedAt,
    completedAt,
    checkpoints: checkpointsList,
    passThresholdUsed: session.passThreshold
  };

  const evaluated = evaluateAssessment(attemptRecord, session.passThreshold);
  queueAttemptForSync(evaluated);

  // attempt background sync if online, never blocking module finish
  syncQueuedAttempts().catch(() => {});

  _activeSession = null;
  return evaluated;
}

// abort active assessment session without saving
function abortAssessmentSession() {
  _activeSession = null;
}

// wire event listener to record checkpoints from window events
function bindAssessmentSessionListeners(targetWindow) {
  const win = targetWindow || (typeof window !== "undefined" ? window : null);
  if (!win || typeof win.addEventListener !== "function") return;

  if (_boundListener) {
    win.removeEventListener("safear:checkpoint", _boundListener);
  }

  _boundListener = (ev) => {
    if (ev && ev.detail) {
      recordCheckpointResult(ev.detail);
    }
  };

  win.addEventListener("safear:checkpoint", _boundListener);
}

// remove assessment event listener
function unbindAssessmentSessionListeners(targetWindow) {
  const win = targetWindow || (typeof window !== "undefined" ? window : null);
  if (win && _boundListener && typeof win.removeEventListener === "function") {
    win.removeEventListener("safear:checkpoint", _boundListener);
    _boundListener = null;
  }
}

export {
  evaluateAssessment,
  queueAttemptForSync,
  getQueuedAttempts,
  clearAttemptQueue,
  removeSyncedAttempts,
  getSyncRejections,
  clearSyncRejections,
  syncQueuedAttempts,
  startAssessmentSession,
  getActiveSession,
  recordCheckpointResult,
  finishAssessmentSession,
  abortAssessmentSession,
  bindAssessmentSessionListeners,
  unbindAssessmentSessionListeners,
  getEffectiveWorkerId,
  setWorkerId,
  getDeviceId,
  fetchModuleManifests,
  getModuleManifest,
  validateModuleManifests,
  getCachedOrLocalManifest,
  CANONICAL_DEMO_WORKER_ID,
  DEFAULT_LOCAL_MANIFESTS,
  QUEUE_STORAGE_KEY,
  REJECTION_STORAGE_KEY,
  WORKER_STORAGE_KEY,
  MANIFEST_STORAGE_KEY
};

