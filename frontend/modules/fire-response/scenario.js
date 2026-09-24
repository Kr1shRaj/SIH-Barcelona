// fire scenario rolled from attemptId. the server rolls the same one in
// backend/services/grading/scenario.js — both must stay byte for byte in step,
// backend/tests/golden_fire_contract.test.js checks they do.

export const FUELS = Object.freeze(["conveyor_coal", "diesel_hydraulic", "electrical_switchgear", "pressurized_methane"]);

// at or above this % CH4 the worker withdraws, no firefighting. team ruling, DGMS basis.
export const METHANE_WITHDRAWAL_PCT = 1.25;

// share of runs that roll a gassy heading
export const HIGH_METHANE_SHARE = 0.4;

// local copy of the decision key so the phone can teach offline. the server holds
// the real one in seed.js and regrades every try — this copy never certifies.
export const DECISION_ANSWER_KEY = Object.freeze({
  by: "methaneLevel",
  cases: {
    high: { expected: "evacuate", severity: { extinguish: "fatal", wait: "fatal" } },
    low: { expected: "extinguish", severity: { evacuate: "procedural", wait: "procedural" } }
  }
});

// mulberry32, same prng the vfx use, tiny and seedable
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// same attempt id, same fire. no id, no scenario — never a made up default
export function scenarioFor(attemptId) {
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
