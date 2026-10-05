# P8 visual comparison record

Status: captured and independently reviewed. The final candidate is `da017ad25fce53e4ee06920053cfdb99aeae6970` (`a3e9a18e1a00d5188a9b95805ce20bf5888f8529`). Reference and candidate each have 24 screen captures across 3 viewports, plus 6 isolated aircraft/camera captures. All PNG/JSON pairs are under `p8-reference/` and `p8-candidate/`.

## Locked references

`p8-reference-locks.json` records the exact commits and trees. Kaisen is the visual, aircraft, camera, and flight baseline. FightFlight is only the shared-control comparison source. Both repositories are checked out in sibling directories at their planned detached commits and have clean worktrees. The application repositories are not changed by this comparison.

## Capture conditions

Use the same Chromium build, Linux environment, DPR 1, viewport, selected mode, control input, saved settings, scroll position, focus, and sound state for each reference and the candidate. Capture unmasked screenshots. Any exclusions must name a specific Uchiotose-only difference and leave the surrounding UI visible for review. The prepared capture runner is `browser-tests/p8-visual-capture.mjs`; each PNG has a same-name JSON file with app state, browser errors, focus, scroll, visible DOM bounds, and computed CSS.

Each screenshot JSON and the ten-minute session JSON records the candidate commit/tree and SHA-256 of tracked `src/` contents at the start and end. The source URL’s own commit/tree/hash is recorded too; reference runs require the fixed Kaisen commit `3d751051dc6212482a129e8da596ddd349b2f9f5`. A capture run writes `run-provenance.json` and fails if any of these fingerprints change during the run.

The reference capture was completed in several viewport/screen-filtered runs, including a final 1280×720 Pause capture to align focus. `p8-reference/run-provenance.json` therefore describes the latest partial run, not the full set; the same-name JSON beside each PNG is the record of the specific screenshot’s source and conditions. Candidate coverage is represented by its full `run-provenance.json`.

Each reference PNG JSON keeps the candidate commit/tree/source hash that existed when that reference screenshot was taken. The locked Kaisen source commit/tree/hash is unchanged. Reference metadata is not rewritten to claim a later candidate version was present during an earlier capture.

Capture one image for every row below at each viewport: **393×648**, **568×320**, and **1280×720**. Use `reference/<viewport>/<screen>.png` and `candidate/<viewport>/<screen>.png` paths so the 24 pairs remain unambiguous.

| Screen | Mode/state | Capture procedure |
| --- | --- | --- |
| Home | Easy selected | Load fresh page, wait for readiness, set sound off |
| Normal HUD | Normal | Start from Home, wait for stable HUD, sound off |
| Easy HUD | Easy | Start from Home, wait for stable HUD, sound off |
| Pause | Normal | Open pause from a stable Normal HUD |
| Touch settings | Normal touch editor | Select Normal and Fire, open touch controls, and scroll the initial preview into view |
| PC key settings | Keyboard editor | Open settings, select keyboard controls, show the key map |
| Rules | Rules and controls | Open rules from Home with scroll at the top and focus on the close/back control |
| Result | Completed mission | Kaisen reference: ordinary ArrowDown sea-impact defeat. Uchiotose: explicit `createSimulation` + pure `stepSimulation` result fixture injected only through its development test API. The screenshot JSON labels the fixture; it is not normal gameplay evidence. |

The runner also writes isolated `aircraft-camera-easy.png` and `aircraft-camera-normal.png` images at every viewport. These use the fixed Kaisen `AircraftFactory` and `AircraftBatchFactory`, an identical pose `(0, 220, 240)`, identity attitude, 110 m/s, 220 m altitude, the production neutral scene lighting and tone mapping, the mode-specific production camera helper, FOV 64°, and the corresponding reticle. Their JSON records camera position/quaternion and reticle coordinates/radius. All six reference/candidate PNG pairs have matching SHA-256 hashes. This isolates silhouette, framing, and sight alignment; it does not replace the actual in-game flight screenshots or prove mobile GPU behavior.

The final candidate applies a 0.75 pixel-ratio multiplier when it detects a software renderer. Candidate flight screenshots remain unmasked; their per-screen diagnostics report SwiftShader and pixelRatio `0.75`. Kaisen reference diagnostics report pixelRatio `1`. Review CSS geometry at the CSS viewport size; the isolated aircraft/camera images use pixelRatio `1` on both sides.

## Review record

For each pair, inspect the screenshot alongside DOM bounds and computed CSS values. Record text wrapping, clipping, overlap, safe-area placement, scroll position, focus, and preview/button size alignment. Separate antialiasing variation from layout or asset differences; do not use a pixel-difference threshold as the acceptance decision.

| Viewport | Home | Normal HUD | Easy HUD | Pause | Touch settings | PC settings | Rules | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 393×648 | Reviewed | Reviewed | Reviewed | Reviewed | Reviewed | Reviewed | Reviewed | Reviewed |
| 568×320 | Reviewed | Reviewed | Reviewed | Reviewed | Reviewed | Reviewed | Reviewed | Reviewed |
| 1280×720 | Reviewed | Reviewed | Reviewed | Reviewed | Reviewed | Reviewed | Reviewed | Reviewed |

Review found no browser errors or horizontal overflow. The 393×648 HUD time text rect is `(58.89, 16, 61.23, 25)` and the aircraft tally text rect is `(29.55, 70, 58.53, 22)`, with a clear vertical gap. The Normal warning also stays clear of the aim dot with at least a 6px gap in the max-width-480px browser assertion (393×648), in both Normal and Easy. All screenshots use Home focus on `body`; the final 1280×720 Pause pair focuses Resume on both sides. Touch settings use Normal + Fire and expose their initial preview. The candidate Normal preview shows its four requested controls; Kaisen also includes Bomb and Torpedo controls. That control-count difference follows the release scope (Normal 4 / Easy 1).

The reference Result is an ordinary ArrowDown sea-impact defeat. The candidate Result uses an explicitly labeled DEV-only pure-simulation victory fixture to show the result layout; it is not gameplay evidence. The outcomes and score text should not be compared as if they came from the same mission.

P8 browser/performance runner: `browser-tests/p8-long-browser-session.mjs`; full record: `p8-browser-session.json`. It uses ordinary touch input to enable sound and start a no-input Easy product mission, and samples pools, renderer allocations, audio voices/sources, DOM nodes/listeners, frame intervals, and heaps once per minute. This Chromium 149 SwiftShader touch-emulation session ran for **600.041 seconds**. It recorded natural Victory at tick **30,624** / **510.4 simulated seconds**, observed at about **514.209 wall seconds** with one-second polling, then remained on Result for about **85.832 seconds**. Result losses were player 5, wing 7, ships 4; 6 ships and 8 aircraft were active at victory. Browser errors were 0. The final total score was not persisted. The 100 `scoreEntries` observation is the enemy score-ledger key count, not the final score; `p8-logical-stress.json` is a separate deterministic simulation fixture and its score is not this mission’s score. Result-screen score immutability has separate browser-fixture coverage.

Across the live samples, frame-interval p95 was **16.8ms**, maximum **50ms**. The software renderer consistently reported 50 geometries, 4 textures, 8 planes, 24 warriors, 10 ships, and 5 warrior draw batches. The observed renderer queue’s last completed fence wait ranged from about **48.7–133.7ms**; this is reported separately from frame intervals. Projectile capacities were 2,048 aircraft, 256 magic, and 64 anti-air; all three pool-block counters remained zero, with maxima of 96, 197, and 6 projectiles respectively. Page JS heap stayed at 29.4MB; CDP heap samples ranged about 17.8–44.7MB. The element-level listener scan stayed at 130 listeners; CDP’s broader listener counter ranged 147–273 and dropped back after its 180s peak. DOM nodes ranged 602–883. These are desktop software-renderer measurements, not mobile-device speed guarantees. The separate Node test fixture holds the full world active for 36,000 logical ticks by disabling weapons in the fixture; it is not a ten-minute gameplay or GPU claim.

Physical iPhone Safari and mobile GPU performance remain unverified unless measured on a physical device and recorded in the final P8 report. Desktop mobile emulation, WebKit, and SwiftShader are not physical-device results.
