// pure server-side scoring for multi-worker unguided fire drill
// no express, no routes, no db imports

// par times in seconds for each team action in unguided drill
// NOT MEASURED YET: par times set from preliminary trial estimates, awaiting field timing data
const PAR_TIME_SEC = Object.freeze({
  alarm: 10,
  extinguisher_operator: 25,
  backup_coordinator: 15
});

// maximum multiplier before speed score reaches zero
// NOT MEASURED YET: 3x par multiplier based on standard training drill tolerance
const MAX_PAR_MULTIPLIER = 3;

// base point distributions
// NOT MEASURED YET: 60/25/15 weighting aligns with Mines Act procedural compliance priority
const WEIGHTS = Object.freeze({
  completionMax: 60,
  speedMax: 25,
  errorPenaltyPerRejection: 5,
  teamErrorSharedFraction: 0.4,
  // NOT MEASURED YET: 70/30 individual/team blend based on peer collaboration assessment standards
  individualBlendWeight: 0.7,
  teamBlendWeight: 0.3,
  passThreshold: 80
});

const ACTION_FOR_ROLE = Object.freeze({
  alarm: "alarm_pulled",
  extinguisher_operator: "fire_extinguished",
  backup_coordinator: "evac_checked"
});

const ROLE_FOR_ACTION = Object.freeze({
  alarm_pulled: "alarm",
  fire_extinguished: "extinguisher_operator",
  evac_checked: "backup_coordinator"
});

const EXPECTED_ORDER = Object.freeze([
  "alarm_pulled",
  "fire_extinguished",
  "evac_checked"
]);

// compute speed points for elapsed seconds against par seconds
function calcSpeedPoints(elapsedSec, parSec, maxPoints) {
  if (typeof elapsedSec !== "number" || elapsedSec < 0) return 0;
  if (elapsedSec <= parSec) return maxPoints;
  const maxSec = parSec * MAX_PAR_MULTIPLIER;
  if (elapsedSec >= maxSec) return 0;
  const ratio = (maxSec - elapsedSec) / (maxSec - parSec);
  return maxPoints * Math.max(0, Math.min(1, ratio));
}

// score unguided drill timeline into team and individual scores
function scoreTeamDrill(timeline, roles) {
  const events = Array.isArray(timeline) ? timeline : [];
  const assignedRoles = Array.isArray(roles) && roles.length > 0
    ? roles
    : ["alarm", "extinguisher_operator", "backup_coordinator"];

  const acceptedActions = {};
  const roleErrors = { alarm: 0, extinguisher_operator: 0, backup_coordinator: 0 };
  let totalErrors = 0;

  for (const ev of events) {
    if (!ev || typeof ev !== "object") continue;
    if (ev.accepted) {
      if (!acceptedActions[ev.action]) {
        acceptedActions[ev.action] = {
          role: ev.role,
          tMs: typeof ev.tMs === "number" ? Math.max(0, ev.tMs) : 0
        };
      }
    } else {
      totalErrors += 1;
      const r = ev.role;
      if (roleErrors[r] !== undefined) {
        roleErrors[r] += 1;
      }
    }
  }

  // 1. Completion Score (max 60): verify sequence order
  let sequenceCorrectCount = 0;
  let lastAcceptedTime = -1;
  const ptsPerAction = WEIGHTS.completionMax / EXPECTED_ORDER.length;

  for (const action of EXPECTED_ORDER) {
    const act = acceptedActions[action];
    if (act && act.tMs >= lastAcceptedTime) {
      sequenceCorrectCount += 1;
      lastAcceptedTime = act.tMs;
    } else {
      break;
    }
  }
  const completionScore = sequenceCorrectCount * ptsPerAction;

  // 2. Speed Score (max 25): evaluate each step against par
  const actionTimesSec = {};
  let totalSpeedPoints = 0;
  const speedPtsPerAction = WEIGHTS.speedMax / EXPECTED_ORDER.length;

  let prevTimeMs = 0;
  for (const action of EXPECTED_ORDER) {
    const act = acceptedActions[action];
    const role = ROLE_FOR_ACTION[action];
    const parSec = PAR_TIME_SEC[role] || 15;

    if (act) {
      const elapsedSec = Math.max(0, (act.tMs - prevTimeMs) / 1000);
      actionTimesSec[action] = Math.round(elapsedSec * 10) / 10;
      totalSpeedPoints += calcSpeedPoints(elapsedSec, parSec, speedPtsPerAction);
      prevTimeMs = act.tMs;
    } else {
      actionTimesSec[action] = null;
    }
  }

  // 3. Error Penalties
  const totalErrorPenalty = totalErrors * WEIGHTS.errorPenaltyPerRejection;
  const teamErrorPenalty = totalErrorPenalty * WEIGHTS.teamErrorSharedFraction;

  // 4. Raw Team Score
  const rawTeamScore = Math.max(0, completionScore + totalSpeedPoints - teamErrorPenalty);
  const teamScore = Math.min(100, Math.round(rawTeamScore));

  // 5. Per-Role Scores
  const perRole = {};
  for (const r of assignedRoles) {
    const ownAction = ACTION_FOR_ROLE[r];
    const act = acceptedActions[ownAction];
    const ownErrors = roleErrors[r] || 0;
    const ownErrorPenalty = ownErrors * WEIGHTS.errorPenaltyPerRejection;

    const ownCompletion = act ? WEIGHTS.completionMax : 0;
    const ownTimeSec = actionTimesSec[ownAction];
    const ownParSec = PAR_TIME_SEC[r] || 15;
    const ownSpeed = ownTimeSec !== null
      ? calcSpeedPoints(ownTimeSec, ownParSec, WEIGHTS.speedMax)
      : 0;

    const rawIndivScore = Math.max(0, ownCompletion + ownSpeed - ownErrorPenalty);
    const blended = (rawIndivScore * WEIGHTS.individualBlendWeight) + (teamScore * WEIGHTS.teamBlendWeight);
    perRole[r] = Math.min(100, Math.round(blended));
  }

  const passed = teamScore >= WEIGHTS.passThreshold;

  return {
    teamScore,
    passed,
    perRole,
    breakdown: {
      completionScore: Math.round(completionScore),
      speedScore: Math.round(totalSpeedPoints * 10) / 10,
      errorPenalty: Math.round(teamErrorPenalty * 10) / 10,
      errorCount: totalErrors,
      roleErrors,
      actionTimesSec
    }
  };
}

module.exports = {
  scoreTeamDrill,
  calcSpeedPoints,
  PAR_TIME_SEC,
  WEIGHTS,
  EXPECTED_ORDER
};
