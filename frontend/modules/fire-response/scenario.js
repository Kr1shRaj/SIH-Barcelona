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

// fuels a worker may fight. a pressurised methane jet is isolated and walked away from
export const FIGHTABLE_FUELS = Object.freeze(["conveyor_coal", "diesel_hydraulic", "electrical_switchgear"]);

// local copy of the gate keys in seed.js FIRE_GATE_ANSWER_KEYS, for offline feedback only.
// a key with "by" picks its case from the scenario; a key without one is the rule itself
export const GATE_ANSWER_KEYS = Object.freeze({
  fire_g2_media: {
    by: "fuel",
    cases: {
      conveyor_coal: { expected: ["water", "abc_powder"], severity: { co2: "procedural" } },
      diesel_hydraulic: { expected: ["foam", "abc_powder"], severity: { water: "fatal" } },
      electrical_switchgear: { expected: ["co2", "abc_powder"], severity: { water: "fatal", foam: "fatal" } },
      pressurized_methane: {
        expected: ["isolate_supply_then_evacuate"],
        severity: { abc_powder: "fatal", co2: "fatal", water: "fatal", foam: "fatal" }
      }
    }
  },
  fire_g3_stance: {
    expected: "approach_upwind_2_3m",
    severity: { approach_downwind: "fatal", under_1m: "critical", over_4m: "procedural" }
  },
  fire_g5_post: {
    expected: "back_away_facing_fire",
    severity: { turn_and_walk_away: "critical", poke_debris: "procedural" }
  }
});

// the rule a key gives for this scenario, same lookup the server grader does
export function gateRule(key, scenario) {
  return key.by ? key.cases[scenario[key.by]] : key;
}

// null when the pick is right, else how bad it is. an unrated pick is a procedural slip
export function gateSeverity(key, scenario, choice) {
  const rule = gateRule(key, scenario);
  if ([].concat(rule.expected).includes(choice)) return null;
  return rule.severity[choice] || "procedural";
}

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
