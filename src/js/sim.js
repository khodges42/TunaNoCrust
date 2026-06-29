// sim.js
// The core game model. Keep DOM out of this file so formulas are easy to test
// and easy to replace when you want a better simulation.

import {
  ENGINE,
  FAILURE_MESSAGES,
  JOBS,
  PART_CATEGORIES,
  SUCCESS_MESSAGES,
  WARNING_MESSAGES,
} from "./data.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (a, b, t) => a + (b - a) * t;
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function formatMoney(value) {
  return currency.format(value);
}

export function findPart(categoryId, optionId) {
  const category = PART_CATEGORIES.find((candidate) => candidate.id === categoryId);
  if (!category) throw new Error(`Unknown part category: ${categoryId}`);

  const option = category.options.find((candidate) => candidate.id === optionId);
  if (!option) throw new Error(`Unknown option ${optionId} in ${categoryId}`);

  return option;
}

export function getSelectedParts(partState) {
  return Object.fromEntries(
    PART_CATEGORIES.map((category) => [category.id, findPart(category.id, partState[category.id])]),
  );
}

export function calculateSpend(partState) {
  return Object.values(getSelectedParts(partState)).reduce((total, part) => total + part.cost, 0);
}

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

function rounded(value, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mapTuneToAfr(tune) {
  // Intentionally fake/gamey. SR turbo WOT often wants rich-ish mixtures, but
  // do not treat these as real targets. This is a feeling generator.
  return clamp(11.5 + tune.fuelBias * 0.018, 10.4, 12.8);
}

function calculateHardware(parts, tune) {
  const fuelCapacity = Math.min(parts.injectors.whpCap, parts.pump.whpCap) / parts.fuel.demand;

  const airflowBonus =
    parts.exhaust.airflow +
    parts.cams.topEnd +
    (parts.ecu.mapResolution * 0.45) -
    parts.intercooler.pressureDrop * 2;

  const responseScore = clamp(
    58 +
      parts.turbo.response +
      parts.exhaust.response +
      parts.cams.response -
      parts.intercooler.spoolPenalty / 38 -
      Math.max(0, tune.boost - 18) * 0.9 -
      Math.max(0, tune.camBias) * 0.22 +
      Math.max(0, -tune.camBias) * 0.24 -
      (tune.boostRamp - 50) * 0.05,
    0,
    100,
  );

  const spoolRpm = clamp(
    parts.turbo.spoolRpm +
      parts.intercooler.spoolPenalty -
      parts.exhaust.response * 18 +
      Math.max(0, tune.camBias) * 7 -
      Math.max(0, -tune.camBias) * 5 -
      (tune.boostRamp - 50) * 5,
    2500,
    6200,
  );

  const boostCeiling = parts.turbo.boostCeiling;
  const boostOverspeed = Math.max(0, tune.boost - boostCeiling);
  const bottomBoostOver = Math.max(0, tune.boost - parts.bottomEnd.boostComfort);

  return {
    fuelCapacity,
    airflowBonus,
    responseScore,
    spoolRpm,
    boostCeiling,
    boostOverspeed,
    bottomBoostOver,
  };
}

export function generateMaps(tune) {
  const rpmBands = ["3k", "4.5k", "6k", "7.5k"];
  const loadBands = ["Cruise", "Spool", "Boost", "WOT"];
  const afrBase = mapTuneToAfr(tune);
  const timingBase = 12 + tune.timing * 0.18;

  const fuelCells = [];
  const timingCells = [];

  for (let row = 0; row < loadBands.length; row += 1) {
    for (let col = 0; col < rpmBands.length; col += 1) {
      const loadInfluence = row * -0.22;
      const rpmInfluence = col * -0.05;
      const camInfluence = tune.camBias > 0 && col >= 2 ? -0.08 : 0;
      const afr = rounded(afrBase + loadInfluence + rpmInfluence + camInfluence, 1);

      const timingLoadDrop = row * 2.2;
      const timingRpmRise = col * 0.8;
      const timing = rounded(timingBase - timingLoadDrop + timingRpmRise, 1);

      fuelCells.push({ rpm: rpmBands[col], load: loadBands[row], value: afr });
      timingCells.push({ rpm: rpmBands[col], load: loadBands[row], value: timing });
    }
  }

  return { rpmBands, loadBands, fuelCells, timingCells };
}

export function simulateDyno(state, options = {}) {
  const randomize = options.randomize ?? true;
  const job = JOBS.find((candidate) => candidate.id === state.jobId) ?? JOBS[0];
  const parts = getSelectedParts(state.parts);
  const tune = state.tune;
  const hardware = calculateHardware(parts, tune);

  const revLimit = clamp(tune.revLimit, 6800, ENGINE.hardRevLimit);
  const rpmPoints = [];
  for (let rpm = ENGINE.minRpm; rpm <= revLimit; rpm += 200) rpmPoints.push(rpm);

  const afr = mapTuneToAfr(tune);
  const leanAmount = clamp((afr - 11.8) * 12, 0, 20);
  const richAmount = clamp((11.2 - afr) * 8, 0, 16);

  const timingPower = 0.94 + tune.timing / 250;
  const fuelPower = parts.fuel.power * (1 + leanAmount * 0.004 - richAmount * 0.004);
  const airflowPower = 1 + hardware.airflowBonus / 160;
  const camTopEnd = parts.cams.topEnd / 100 + Math.max(0, tune.camBias) / 220;
  const camLowEnd = Math.max(0, -tune.camBias) / 260;
  const rampViolence = (tune.boostRamp - 50) / 50;
  const boostTarget = tune.boost;

  const curve = rpmPoints.map((rpm) => {
    const spoolSlope = lerp(520, 300, clamp(tune.boostRamp / 100, 0, 1));
    const boostFraction = sigmoid((rpm - hardware.spoolRpm) / spoolSlope);
    const boostSpike = Math.max(0, rampViolence) * 0.9 * Math.exp(-((rpm - hardware.spoolRpm - 450) ** 2) / 900000);
    const boost = clamp(boostTarget * boostFraction + boostSpike, 0, boostTarget + 1.8);

    const rpmNorm = (rpm - ENGINE.minRpm) / (revLimit - ENGINE.minRpm);
    const naturalTorqueShape = clamp(1.05 - Math.abs(rpmNorm - 0.38) * 0.62, 0.62, 1.05);
    const topEndHold = 1 - Math.max(0, rpmNorm - 0.72) * (0.32 - camTopEnd * 0.35);
    const lowEndBonus = 1 + camLowEnd * (1 - rpmNorm) * 0.7;

    const naTorque = 105 * naturalTorqueShape * lowEndBonus;
    const boostTorque = boost * 9.35 * parts.turbo.efficiency * airflowPower * fuelPower;
    const torque = Math.max(0, (naTorque + boostTorque) * timingPower * topEndHold);
    const whp = (torque * rpm) / 5252;

    return {
      rpm,
      boost: rounded(boost, 1),
      torque: rounded(torque, 1),
      whp: rounded(whp, 1),
      afr: rounded(afr + Math.sin(rpm / 900) * 0.06, 1),
    };
  });

  const peakHpPoint = curve.reduce((best, point) => (point.whp > best.whp ? point : best), curve[0]);
  const peakTqPoint = curve.reduce((best, point) => (point.torque > best.torque ? point : best), curve[0]);

  const fuelDuty = clamp((peakHpPoint.whp / hardware.fuelCapacity) * 100, 35, 165);
  const heat = clamp(
    18 +
      tune.boost * parts.turbo.heat * parts.fuel.heat * 1.9 +
      Math.max(0, hardware.boostOverspeed) * 6 +
      parts.exhaust.heat -
      parts.intercooler.cooling -
      richAmount * 0.8 +
      Math.max(0, rampViolence) * 4,
    0,
    100,
  );

  const knock = clamp(
    7 +
      tune.boost * 1.45 +
      (tune.timing - 42) * 0.72 +
      leanAmount * 1.6 +
      heat * 0.26 +
      Math.max(0, fuelDuty - 92) * 0.52 -
      parts.fuel.knockResist -
      parts.ecu.control * 0.85 -
      parts.ecu.safety * 0.5,
    0,
    100,
  );

  const turboRisk = clamp(
    hardware.boostOverspeed * 15 +
      (parts.turbo.chaos ?? 0) +
      Math.max(0, tune.boostRamp - 68) * 0.35 +
      heat * 0.12,
    0,
    100,
  );

  const stress = clamp(
    8 +
      Math.max(0, peakTqPoint.torque - parts.bottomEnd.torqueLimit) * 0.55 +
      hardware.bottomBoostOver * 5.5 +
      (revLimit - ENGINE.stockRevLimit) / 42 +
      Math.max(0, tune.boostRamp - 62) * 0.48 +
      parts.turbo.stress * Math.max(0, tune.boost - 16) * 0.75 -
      parts.bottomEnd.stressRelief,
    0,
    100,
  );

  const reliability = clamp(
    106 -
      stress * 0.38 -
      knock * 0.35 -
      heat * 0.18 -
      turboRisk * 0.18 -
      Math.max(0, fuelDuty - 88) * 0.28,
    0,
    100,
  );

  const riskBuckets = [
    { type: "fuel", value: Math.max(0, fuelDuty - 98) * 1.25, threshold: 16 },
    { type: "knock", value: knock, threshold: 64 },
    { type: "block", value: stress, threshold: 72 },
    { type: "turbo", value: turboRisk, threshold: 58 },
    { type: "heat", value: heat, threshold: 78 },
  ];

  const failureCandidate = riskBuckets
    .filter((bucket) => bucket.value > bucket.threshold)
    .sort((a, b) => b.value - a.value)[0];

  const failureChance = failureCandidate
    ? clamp((failureCandidate.value - failureCandidate.threshold) / 72, 0.05, 0.82)
    : 0;

  const failed = failureCandidate && randomize ? Math.random() < failureChance : false;
  const bustedType = failed ? failureCandidate.type : null;

  const pass =
    !failed &&
    peakHpPoint.whp >= job.hpMin &&
    peakHpPoint.whp <= job.hpMax &&
    hardware.responseScore >= job.responseTarget &&
    reliability >= job.reliabilityMin &&
    fuelDuty <= job.maxFuelDuty &&
    knock <= job.maxKnock;

  const warnings = [];
  if (peakHpPoint.whp < job.hpMin) warnings.push("Power goal missed");
  if (peakHpPoint.whp > job.hpMax) warnings.push("Overshot the brief");
  if (hardware.responseScore < job.responseTarget) warnings.push("Response too lazy");
  if (reliability < job.reliabilityMin) warnings.push("Reliability target missed");
  if (fuelDuty > job.maxFuelDuty) warnings.push("Fuel system near/over limit");
  if (knock > job.maxKnock) warnings.push("Knock risk too spicy");

  const verdict = failed
    ? "FAILED"
    : pass
      ? "PASSED"
      : warnings.length
        ? "NEEDS WORK"
        : "RECORDED";

  const flavor = failed
    ? pickRandom(FAILURE_MESSAGES[bustedType])
    : pass
      ? pickRandom(SUCCESS_MESSAGES)
      : pickRandom(WARNING_MESSAGES);

  const log = buildPullLog({
    job,
    parts,
    tune,
    hardware,
    peakHpPoint,
    peakTqPoint,
    fuelDuty,
    heat,
    knock,
    stress,
    turboRisk,
    reliability,
    failed,
    bustedType,
    warnings,
    verdict,
    flavor,
  });

  return {
    job,
    parts,
    tune,
    curve,
    peakHp: rounded(peakHpPoint.whp),
    peakHpRpm: peakHpPoint.rpm,
    peakTorque: rounded(peakTqPoint.torque),
    peakTorqueRpm: peakTqPoint.rpm,
    spoolRpm: rounded(hardware.spoolRpm),
    afr: rounded(afr, 1),
    fuelDuty: rounded(fuelDuty),
    heat: rounded(heat),
    knock: rounded(knock),
    stress: rounded(stress),
    turboRisk: rounded(turboRisk),
    reliability: rounded(reliability),
    response: rounded(hardware.responseScore),
    verdict,
    pass,
    failed,
    bustedType,
    warnings,
    flavor,
    log,
    failureChance: rounded(failureChance * 100),
  };
}

function buildPullLog(context) {
  const {
    job,
    parts,
    tune,
    hardware,
    peakHpPoint,
    peakTqPoint,
    fuelDuty,
    heat,
    knock,
    stress,
    turboRisk,
    reliability,
    failed,
    warnings,
    verdict,
    flavor,
  } = context;

  const log = [
    { level: "", text: `Loaded work order: ${job.name}. Target ${job.hpMin}-${job.hpMax} whp.` },
    { level: "", text: `${parts.turbo.name}, ${parts.fuel.name}, ${parts.ecu.name}. Boost target ${tune.boost} psi.` },
    { level: "", text: `Spool estimate: ${rounded(hardware.spoolRpm)} rpm. AFR target: ${mapTuneToAfr(tune).toFixed(1)}.` },
  ];

  if (tune.boost > hardware.boostCeiling) {
    log.push({ level: "warn", text: `Turbo is being pushed ${rounded(tune.boost - hardware.boostCeiling, 1)} psi past its happy place.` });
  }

  if (fuelDuty > 96) log.push({ level: "warn", text: `Fuel duty projected at ${rounded(fuelDuty)}%. The injectors are sweating.` });
  if (knock > 58) log.push({ level: "warn", text: `Knock risk is high. Timing map has teeth.` });
  if (heat > 76) log.push({ level: "warn", text: `Charge temps are climbing. Heat soak goblin detected.` });
  if (stress > 70) log.push({ level: "warn", text: `Bottom-end stress is spicy. Rods are looking at the exit.` });
  if (turboRisk > 58) log.push({ level: "warn", text: `Turbo speed risk elevated. Compressor map is now abstract art.` });

  log.push({
    level: failed ? "danger" : verdict === "PASSED" ? "ok" : "warn",
    text: `${verdict}: ${rounded(peakHpPoint.whp)} whp @ ${peakHpPoint.rpm} rpm, ${rounded(peakTqPoint.torque)} wtq @ ${peakTqPoint.rpm} rpm. ${flavor}`,
  });

  for (const warning of warnings.slice(0, 3)) {
    log.push({ level: "warn", text: `Customer brief issue: ${warning}.` });
  }

  log.push({ level: reliability >= 70 ? "ok" : reliability >= 40 ? "warn" : "danger", text: `Reliability estimate: ${rounded(reliability)}%.` });

  return log;
}

export function summarizeForEngineDiagram(result) {
  if (!result) {
    return {
      turbo: "ok",
      intercooler: "ok",
      fuel: "ok",
      ecu: "ok",
      cylinders: ["ok", "ok", "ok", "ok"],
      chips: [
        { label: "Awaiting pull", status: "ok" },
        { label: "No windows yet", status: "ok" },
      ],
    };
  }

  return {
    turbo: result.turboRisk > 70 || result.bustedType === "turbo" ? "danger" : result.turboRisk > 45 ? "warn" : "ok",
    intercooler: result.heat > 78 || result.bustedType === "heat" ? "danger" : result.heat > 55 ? "warn" : "ok",
    fuel: result.fuelDuty > 110 || result.bustedType === "fuel" ? "danger" : result.fuelDuty > 92 ? "warn" : "ok",
    ecu: result.knock > 74 || result.bustedType === "knock" ? "danger" : result.knock > 48 ? "warn" : "ok",
    cylinders: [1, 2, 3, 4].map((cyl) => {
      if (result.bustedType === "block" && cyl === 3) return "danger";
      if (result.bustedType === "knock" && (cyl === 2 || cyl === 3)) return "danger";
      if (result.stress > 75) return cyl === 3 ? "warn" : "ok";
      if (result.knock > 58) return cyl === 2 || cyl === 3 ? "warn" : "ok";
      return "ok";
    }),
    chips: [
      { label: `Fuel duty ${result.fuelDuty}%`, status: result.fuelDuty > 105 ? "danger" : result.fuelDuty > 90 ? "warn" : "ok" },
      { label: `Knock risk ${result.knock}%`, status: result.knock > 68 ? "danger" : result.knock > 45 ? "warn" : "ok" },
      { label: `Heat ${result.heat}%`, status: result.heat > 75 ? "danger" : result.heat > 55 ? "warn" : "ok" },
      { label: `Stress ${result.stress}%`, status: result.stress > 78 ? "danger" : result.stress > 58 ? "warn" : "ok" },
    ],
  };
}
