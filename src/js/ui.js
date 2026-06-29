// ui.js
// DOM wiring and presentation. Sim formulas stay in sim.js; designer data stays
// in data.js. This file should mostly translate state <-> screen.

import {
  defaultParts,
  defaultTune,
  JOBS,
  PART_CATEGORIES,
  TUNE_CONTROLS,
} from "./data.js";
import {
  calculateSpend,
  findPart,
  formatMoney,
  generateMaps,
  getSelectedParts,
  simulateDyno,
  summarizeForEngineDiagram,
} from "./sim.js";
import { drawDyno, drawEmptyDyno } from "./dynoView.js";

const STORAGE_KEY = "tunanocrust-prototype-state-v1";

const els = {};
let state = loadState();
let lastResult = null;
let isPulling = false;

export function initUi() {
  cacheElements();
  renderJobOptions();
  renderPartsControls();
  renderTuneControls();
  bindEvents();
  renderAll();
  drawEmptyDyno(els.dynoCanvas);
}

function cacheElements() {
  Object.assign(els, {
    jobSelect: document.querySelector("#jobSelect"),
    jobCard: document.querySelector("#jobCard"),
    partsList: document.querySelector("#partsList"),
    tuneControls: document.querySelector("#tuneControls"),
    fuelMap: document.querySelector("#fuelMap"),
    timingMap: document.querySelector("#timingMap"),
    dynoCanvas: document.querySelector("#dynoCanvas"),
    dynoBtn: document.querySelector("#dynoBtn"),
    resetBtn: document.querySelector("#resetBtn"),
    budgetReadout: document.querySelector("#budgetReadout"),
    spentReadout: document.querySelector("#spentReadout"),
    resultReadout: document.querySelector("#resultReadout"),
    liveRpm: document.querySelector("#liveRpm"),
    liveBoost: document.querySelector("#liveBoost"),
    liveAfr: document.querySelector("#liveAfr"),
    liveKnock: document.querySelector("#liveKnock"),
    metricsGrid: document.querySelector("#metricsGrid"),
    pullLog: document.querySelector("#pullLog"),
    engineDiagram: document.querySelector("#engineDiagram"),
    engineStatus: document.querySelector("#engineStatus"),
  });
}

function bindEvents() {
  els.jobSelect.addEventListener("change", () => {
    state.jobId = els.jobSelect.value;
    lastResult = null;
    saveState();
    renderAll();
  });

  els.resetBtn.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    state = createDefaultState();
    lastResult = null;
    drawEmptyDyno(els.dynoCanvas);
    renderAll();
  });

  els.dynoBtn.addEventListener("click", async () => {
    if (isPulling) return;
    await runPull();
  });

  window.addEventListener("resize", () => {
    if (lastResult) drawDyno(els.dynoCanvas, lastResult.curve, 1, { title: lastResult.verdict });
    else drawEmptyDyno(els.dynoCanvas);
  });
}

function renderJobOptions() {
  els.jobSelect.innerHTML = JOBS.map((job) => `<option value="${job.id}">${job.name}</option>`).join("");
}

function renderPartsControls() {
  els.partsList.innerHTML = PART_CATEGORIES.map((category) => {
    const options = category.options
      .map((option) => `<option value="${option.id}">${option.name} — ${formatMoney(option.cost)}</option>`)
      .join("");

    return `
      <div class="part-control" data-category="${category.id}">
        <div class="part-header">
          <label for="part-${category.id}">${category.label}</label>
          <span class="part-option-meta" data-part-meta="${category.id}"></span>
        </div>
        <select class="part-select" id="part-${category.id}" data-part-select="${category.id}">
          ${options}
        </select>
        <p class="part-desc" data-part-desc="${category.id}"></p>
      </div>
    `;
  }).join("");

  els.partsList.querySelectorAll("[data-part-select]").forEach((select) => {
    select.addEventListener("change", () => {
      state.parts[select.dataset.partSelect] = select.value;
      lastResult = null;
      saveState();
      renderAll();
    });
  });
}

function renderTuneControls() {
  els.tuneControls.innerHTML = TUNE_CONTROLS.map((control) => `
    <div class="slider-card">
      <div class="slider-top">
        <label for="tune-${control.id}">${control.label}</label>
        <span class="slider-readout" id="readout-${control.id}"></span>
      </div>
      <input
        id="tune-${control.id}"
        type="range"
        min="${control.min}"
        max="${control.max}"
        step="${control.step}"
        data-tune-control="${control.id}"
      />
      <p class="slider-help">${control.help}</p>
    </div>
  `).join("");

  els.tuneControls.querySelectorAll("[data-tune-control]").forEach((input) => {
    input.addEventListener("input", () => {
      state.tune[input.dataset.tuneControl] = Number(input.value);
      lastResult = null;
      saveState();
      renderAll({ skipInputs: true });
    });
  });
}

function renderAll(options = {}) {
  const job = JOBS.find((candidate) => candidate.id === state.jobId) ?? JOBS[0];
  const spend = calculateSpend(state.parts);
  const overBudget = spend > job.budget;

  if (!options.skipInputs) {
    els.jobSelect.value = state.jobId;
    for (const category of PART_CATEGORIES) {
      const select = document.querySelector(`[data-part-select="${category.id}"]`);
      select.value = state.parts[category.id];
    }
    for (const control of TUNE_CONTROLS) {
      const input = document.querySelector(`[data-tune-control="${control.id}"]`);
      input.value = state.tune[control.id];
    }
  }

  els.budgetReadout.textContent = formatMoney(job.budget);
  els.spentReadout.textContent = formatMoney(spend);
  els.spentReadout.classList.toggle("over-budget", overBudget);
  els.resultReadout.textContent = overBudget ? "Over budget" : lastResult?.verdict ?? "Ready";
  els.resultReadout.classList.toggle("over-budget", overBudget || lastResult?.failed);

  renderJobCard(job);
  renderPartDescriptions();
  renderTuneReadouts();
  renderMaps();
  renderMetrics(lastResult);
  renderEngine(lastResult);

  els.dynoBtn.disabled = isPulling || overBudget;
}

function renderJobCard(job) {
  els.jobCard.innerHTML = `
    <p>${job.description}</p>
    <div class="job-targets">
      <div class="job-target"><span>Budget</span><strong>${formatMoney(job.budget)}</strong></div>
      <div class="job-target"><span>Power</span><strong>${job.hpMin}-${job.hpMax} whp</strong></div>
      <div class="job-target"><span>Response</span><strong>${job.responseTarget}%+</strong></div>
      <div class="job-target"><span>Reliability</span><strong>${job.reliabilityMin}%+</strong></div>
    </div>
  `;
}

function renderPartDescriptions() {
  const selected = getSelectedParts(state.parts);
  for (const category of PART_CATEGORIES) {
    const part = selected[category.id];
    document.querySelector(`[data-part-meta="${category.id}"]`).textContent = formatMoney(part.cost);
    document.querySelector(`[data-part-desc="${category.id}"]`).textContent = part.desc;
  }
}

function renderTuneReadouts() {
  for (const control of TUNE_CONTROLS) {
    const value = state.tune[control.id];
    const label = control.formatter ? control.formatter(value) : `${value}${control.unit ? ` ${control.unit}` : ""}`;
    document.querySelector(`#readout-${control.id}`).textContent = label;
  }
}

function renderMaps() {
  const maps = generateMaps(state.tune);
  els.fuelMap.innerHTML = renderMapCells(maps.fuelCells, "afr");
  els.timingMap.innerHTML = renderMapCells(maps.timingCells, "timing");
}

function renderMapCells(cells, type) {
  return cells.map((cell) => {
    let className = "cool";
    if (type === "afr" && cell.value > 12.1) className = "hot";
    else if (type === "afr" && cell.value > 11.7) className = "warm";
    else if (type === "timing" && cell.value > 25) className = "hot";
    else if (type === "timing" && cell.value > 20) className = "warm";

    return `<div class="map-cell ${className}" title="${cell.load} / ${cell.rpm}">${cell.value}</div>`;
  }).join("");
}

async function runPull() {
  isPulling = true;
  els.dynoBtn.disabled = true;
  els.engineDiagram.classList.add("pulling");
  clearLog();

  const result = simulateDyno(state, { randomize: true });
  lastResult = result;
  renderEngine(result);
  appendLog({ level: "", text: "Dyno fan on. Straps tight. Laptop battery emotionally unstable." });
  await sleep(350);
  appendLog({ level: "", text: "3... 2... 1... rolling into throttle." });
  await animatePull(result);

  for (const line of result.log) appendLog(line);

  if (result.failed) {
    document.body.animate(
      [
        { transform: "translateX(0)" },
        { transform: "translateX(-6px)" },
        { transform: "translateX(6px)" },
        { transform: "translateX(0)" },
      ],
      { duration: 220, iterations: 2 },
    );
  }

  isPulling = false;
  els.engineDiagram.classList.remove("pulling");
  renderAll();
}

function animatePull(result) {
  return new Promise((resolve) => {
    const duration = result.failed ? 1700 : 2200;
    const start = performance.now();

    function frame(now) {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - progress) ** 2;
      const index = Math.min(result.curve.length - 1, Math.floor(eased * (result.curve.length - 1)));
      const point = result.curve[index];

      drawDyno(els.dynoCanvas, result.curve, eased, { title: result.failed && progress > 0.82 ? "BAM" : "Live pull" });
      els.liveRpm.textContent = String(point.rpm);
      els.liveBoost.textContent = `${point.boost.toFixed(1)} psi`;
      els.liveAfr.textContent = point.afr.toFixed(1);
      els.liveKnock.textContent = String(Math.round((result.knock / 100) * eased * 12));

      if (progress < 1) requestAnimationFrame(frame);
      else {
        drawDyno(els.dynoCanvas, result.curve, 1, { title: result.verdict });
        resolve();
      }
    }

    requestAnimationFrame(frame);
  });
}

function renderMetrics(result) {
  const metrics = result
    ? [
        { label: "Peak WHP", value: `${result.peakHp}`, status: result.failed ? "danger" : result.pass ? "ok" : "warn" },
        { label: "Peak WTQ", value: `${result.peakTorque}`, status: result.stress > 75 ? "danger" : "ok" },
        { label: "Spool", value: `${result.spoolRpm} rpm`, status: result.response < 45 ? "warn" : "ok" },
        { label: "Response", value: `${result.response}%`, status: result.response < result.job.responseTarget ? "warn" : "ok" },
        { label: "Fuel Duty", value: `${result.fuelDuty}%`, status: result.fuelDuty > 105 ? "danger" : result.fuelDuty > 92 ? "warn" : "ok" },
        { label: "Knock Risk", value: `${result.knock}%`, status: result.knock > 68 ? "danger" : result.knock > 45 ? "warn" : "ok" },
        { label: "Heat", value: `${result.heat}%`, status: result.heat > 75 ? "danger" : result.heat > 55 ? "warn" : "ok" },
        { label: "Reliability", value: `${result.reliability}%`, status: result.reliability > 70 ? "ok" : result.reliability > 40 ? "warn" : "danger" },
      ]
    : [
        { label: "Peak WHP", value: "--", status: "" },
        { label: "Peak WTQ", value: "--", status: "" },
        { label: "Spool", value: "--", status: "" },
        { label: "Response", value: "--", status: "" },
        { label: "Fuel Duty", value: "--", status: "" },
        { label: "Knock Risk", value: "--", status: "" },
        { label: "Heat", value: "--", status: "" },
        { label: "Reliability", value: "--", status: "" },
      ];

  els.metricsGrid.innerHTML = metrics.map((metric) => `
    <div class="metric ${metric.status}">
      <span>${metric.label}</span>
      <strong>${metric.value}</strong>
    </div>
  `).join("");
}

function renderEngine(result) {
  const summary = summarizeForEngineDiagram(result);
  setSvgStatus("diagTurbo", summary.turbo);
  setSvgStatus("diagIntercooler", summary.intercooler);
  setSvgStatus("diagFuel", summary.fuel);
  setSvgStatus("diagEcu", summary.ecu);
  summary.cylinders.forEach((status, index) => setSvgStatus(`diagCyl${index + 1}`, status));

  els.engineStatus.innerHTML = summary.chips.map((chip) => `
    <div class="engine-chip ${chip.status}">${chip.label}</div>
  `).join("");
}

function setSvgStatus(id, status) {
  const el = document.querySelector(`#${id}`);
  el.classList.remove("ok", "warn", "danger");
  el.classList.add(status);
}

function clearLog() {
  els.pullLog.innerHTML = "";
}

function appendLog(line) {
  const li = document.createElement("li");
  li.className = line.level ?? "";
  li.textContent = line.text;
  els.pullLog.prepend(li);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createDefaultState() {
  return {
    jobId: JOBS[0].id,
    parts: defaultParts(),
    tune: defaultTune(),
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState() {
  const fallback = createDefaultState();
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return fallback;

  try {
    const parsed = JSON.parse(saved);
    // Merge with defaults so adding a new part/control later doesn't break old saves.
    return {
      jobId: parsed.jobId && JOBS.some((job) => job.id === parsed.jobId) ? parsed.jobId : fallback.jobId,
      parts: { ...fallback.parts, ...parsed.parts },
      tune: { ...fallback.tune, ...parsed.tune },
    };
  } catch {
    return fallback;
  }
}
