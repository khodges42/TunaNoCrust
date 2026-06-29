# TunaNoCrust Tuning Simulator

A dependency-free static HTML/CSS/JS prototype for an SR20DET-inspired dyno tuning game jam.

## Run it

Open `index.html` in a browser.

Because this uses ES modules, some browsers may block `file://` module loading. If that happens, run a tiny local server from this folder:

```bash
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

## Project structure

```text
index.html          Main static page
styles.css          Visual style/layout
js/data.js          Jobs, parts, tune controls, flavor text
js/sim.js           Core simulation formulas and scoring
js/dynoView.js      Canvas dyno graph renderer
js/ui.js            DOM binding and state rendering
js/app.js           Entry point
```

## Where to tweak first

Most balancing should start in `js/data.js`:

- Add jobs in `JOBS`
- Add parts in `PART_CATEGORIES`
- Change slider ranges in `TUNE_CONTROLS`
- Add failure/success sayings in `FAILURE_MESSAGES`, `SUCCESS_MESSAGES`, and `WARNING_MESSAGES`

Formula behavior lives in `js/sim.js`, especially:

- `calculateHardware()` for how parts shape response/spool/limits
- `simulateDyno()` for power curve, risk, and pass/fail logic
- `generateMaps()` for the fake fuel/timing table UI

## Design intent

This is not a real tuning guide. It is deliberately fake-but-believable. The goal is to make the player feel like a tuner making tradeoffs:

- boost vs heat
- timing vs knock
- lean/crisp vs rich/safe
- top-end vs response
- cheap parts vs chaos
- forged internals as permission to be stupid

## Suggested next additions

- Customer reputation and cash rewards
- Part unlocks by shop level
- Better animated engine diagram states
- Editable map cells instead of derived fake maps
- More failure event art/sound
- A seeded daily challenge
