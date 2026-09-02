// manifest fetch wiring is follow up task, caller supplies weight and threshold
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDENTIFIER = /^[a-z][a-z0-9_-]{1,63}$/;
const CHECKPOINT_TYPES = ["aim", "proximity", "select"];
const MAX_CONTEXT_BYTES = 4096;
const MAX_DURATION_MS = 4 * 60 * 60 * 1000;
const QUEUE_STORAGE_KEY = "safear_attempt_sync_queue";

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

export {
  evaluateAssessment,
  queueAttemptForSync,
  getQueuedAttempts,
  clearAttemptQueue
};
