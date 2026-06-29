import { defaultParts, defaultTune, JOBS } from "../js/data.js";
import { simulateDyno } from "../js/sim.js";

for (const job of JOBS) {
  const result = simulateDyno({ jobId: job.id, parts: defaultParts(), tune: defaultTune() }, { randomize: false });
  if (!Number.isFinite(result.peakHp) || !result.curve.length) {
    throw new Error(`Bad result for ${job.id}`);
  }
}

console.log("Smoke test passed.");
