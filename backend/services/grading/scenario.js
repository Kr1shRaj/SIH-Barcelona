// fire scenario rolled from attemptId. the phone rolls the same one from
// frontend/modules/fire-response/scenario.js — both must stay byte for byte in step,
// backend/tests/golden_fire_contract.test.js checks they do.

const FUELS = Object.freeze(["conveyor_coal", "diesel_hydraulic", "electrical_switchgear", "pressurized_methane"]);

// at or above this % CH4 the worker withdraws, no firefighting. team ruling, DGMS basis.
const METHANE_WITHDRAWAL_PCT = 1.25;

// share of runs that roll a gassy heading
const HIGH_METHANE_SHARE = 0.4;

// mulberry32, same prng the vfx use, tiny and seedable
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// same attempt id, same fire. no id, no scenario — never a made up default
function scenarioFor(attemptId) {
  if (typeof attemptId !== "string" || !/^[0-9a-f]{8}-/i.test(attemptId)) {
    throw new Error("scenarioFor needs a uuid attemptId");
  }
  const rand = mulberry32(Number.parseInt(attemptId.slice(0, 8), 16));
  const methaneLevel = rand() < HIGH_METHANE_SHARE ? "high" : "low";
  const reading = methaneLevel === "high"
    ? Number((1.3 + rand() * 1.5).toFixed(2))
    : Number((0.2 + rand() * 0.7).toFixed(2));
  const fuel = FUELS[Math.floor(rand() * FUELS.length)];
  const airflow = rand() < 0.5 ? "intake_left" : "intake_right";
  return { methaneLevel, reading, fuel, airflow };
}

// does a definition row with this applies_when (parsed json or null) count for this scenario.
// a field holds one value or a list of the values it applies to
function appliesToScenario(appliesWhen, scenario) {
  if (!appliesWhen) return true;
  return Object.keys(appliesWhen).every((field) => {
    const want = appliesWhen[field];
    return Array.isArray(want) ? want.includes(scenario[field]) : scenario[field] === want;
  });
}

module.exports = {
  scenarioFor,
  appliesToScenario,
  mulberry32,
  FUELS,
  METHANE_WITHDRAWAL_PCT,
  HIGH_METHANE_SHARE
};
