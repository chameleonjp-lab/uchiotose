# P8 visual comparison record

Status: capture harness prepared; final candidate comparison pending the last renderer/browser run. No P8 visual acceptance is claimed yet.

## Locked references

`p8-reference-locks.json` records the exact commits and trees. Kaisen is the visual, aircraft, camera, and flight baseline. FightFlight is only the shared-control comparison source. Both repositories are checked out in sibling directories at their planned detached commits and have clean worktrees. The application repositories are not changed by this comparison.

## Capture conditions

Use the same Chromium build, Linux environment, DPR 1, viewport, selected mode, control input, saved settings, scroll position, focus, and sound state for each reference and the candidate. Capture unmasked screenshots. Any exclusions must name a specific Uchiotose-only difference and leave the surrounding UI visible for review. The prepared capture runner is `browser-tests/p8-visual-capture.mjs`; each PNG has a same-name JSON file with app state, browser errors, focus, scroll, visible DOM bounds, and computed CSS.

Each screenshot JSON and the ten-minute session JSON records the candidate commit/tree and SHA-256 of tracked `src/` contents at the start and end. The source URL’s own commit/tree/hash is recorded too; reference runs require the fixed Kaisen commit `3d751051dc6212482a129e8da596ddd349b2f9f5`. A capture run writes `run-provenance.json` and fails if any of these fingerprints change during the run.

Capture one image for every row below at each viewport: **393×648**, **568×320**, and **1280×720**. Use `reference/<viewport>/<screen>.png` and `candidate/<viewport>/<screen>.png` paths so the 24 pairs remain unambiguous.

| Screen | Mode/state | Capture procedure |
| --- | --- | --- |
| Home | Easy selected | Load fresh page, wait for readiness, set sound off |
| Normal HUD | Normal | Start from Home, wait for stable HUD, sound off |
| Easy HUD | Easy | Start from Home, wait for stable HUD, sound off |
| Pause | Normal | Open pause from a stable Normal HUD |
| Touch settings | Touch editor | Open settings, select touch controls, show the initial preview |
| PC key settings | Keyboard editor | Open settings, select keyboard controls, show the key map |
| Rules | Rules and controls | Open rules from Home with scroll at the top and focus on the close/back control |
| Result | Completed mission | Kaisen reference: ordinary ArrowDown sea-impact defeat. Uchiotose: explicit `createSimulation` + pure `stepSimulation` result fixture injected only through its development test API. The screenshot JSON labels the fixture; it is not normal gameplay evidence. |

The runner also writes isolated `aircraft-camera-easy.png` and `aircraft-camera-normal.png` images at every viewport. These use the fixed Kaisen `AircraftFactory` and `AircraftBatchFactory`, an identical pose `(0, 220, 240)`, identity attitude, 110 m/s, 220 m altitude, the production neutral scene lighting and tone mapping, the mode-specific production camera helper, FOV 64°, and the corresponding reticle. Their JSON records camera position/quaternion and reticle coordinates/radius. This isolates silhouette, framing, and sight alignment; it does not replace the actual in-game flight screenshots or prove mobile GPU behavior.

The current renderer work applies a 0.75 pixel-ratio multiplier only when it detects a software renderer, as a R20 drawing-quality adjustment. If the final candidate retains it, actual-flight screenshots must remain unmasked and the per-screen renderer diagnostics must record the reduced drawing-buffer scale. Review CSS geometry at the CSS viewport size; review the isolated model/camera images at pixel ratio 1 to compare the fixed model and camera independent of that performance adjustment.

## Review record

For each pair, inspect the screenshot alongside DOM bounds and computed CSS values. Record text wrapping, clipping, overlap, safe-area placement, scroll position, focus, and preview/button size alignment. Separate antialiasing variation from layout or asset differences; do not use a pixel-difference threshold as the acceptance decision.

| Viewport | Home | Normal HUD | Easy HUD | Pause | Touch settings | PC settings | Rules | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 393×648 | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| 568×320 | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| 1280×720 | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |

P8 browser/performance runner: `browser-tests/p8-long-browser-session.mjs`. It uses a live no-input Easy mission with sound enabled by a DOM click, records the natural result tick separately from the remaining ten-minute Result dwell, and samples pools, renderer allocations, audio source/voice counts, DOM listeners/nodes, frame intervals, and JavaScript heap once per minute. The separate Node test fixture holds the full world active for 36,000 logical ticks by disabling weapons in the test fixture; it is not a ten-minute gameplay or GPU claim.

Physical iPhone Safari and mobile GPU performance remain unverified unless measured on a physical device and recorded in the final P8 report. Desktop mobile emulation, WebKit, and SwiftShader are not physical-device results.
