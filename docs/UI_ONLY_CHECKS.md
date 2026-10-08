# Short UI-only screen checks

## Scope and commands

`npm run test:browser` now selects only `playwright.ui-only.config.ts`: 6 scenarios per engine (Chromium and WebKit), 2 workers, no retries. The screen-check body targets about one minute; the 90-second watchdog is a failure bound, not evidence that the target has been achieved. Dependency setup, engine startup, ordinary unit/type checks, build, and human screenshot review are measured separately.

- `npm ci`: dependency setup
- `npm test`: all 202 ordinary unit cases, including the short P8 pool contract. Only the three exact long simulation integrations are opt-in.
- `npm run test:long-session`: the original three long P8 simulation cases (3 frame rates/full mission, 10-minute world load and five retries), on explicit request
- `npm run test:ui:types`: fixture, browser spec and UI-only config type check
- `npm run build`: unchanged production type check/build
- `npm run test:browser:discovery`: nonzero discovery in both required UI engines
- `npm run test:browser`: the new UI-only screenshot and interaction pass
- `npm run test:browser:legacy`: opt-in original browser acceptance. This includes gameplay/GPU acceptance and is not part of the default UI check.

The original browser and unit spec files remain byte-for-byte unchanged. The selector verifies the exact three long names occur once in the intended file, fails closed if they change, and selects every other tests/*.test.ts case; it does not exclude an entire file. Normal reports mark those long cases NOT RUN, not passed. The legacy config excludes only the new UI-only spec.

## Real UI, directly displayed

The UI-only Vite config uses the real `index.html`, substituting only its bootstrap entry. The entry imports the production CSS, `createUIController`, settings and rules dialogs. `src/ui-view.ts` contains production DOM presentation shared by the game and specimen. `src/hud-overlay.ts` contains the existing product Canvas2D overlay (sight, reload arc, markers, HP/distance, offscreen arrow and radar), also shared by the game and specimen.

The specimen supplies static display data. It does not import `main`, `simulation`, `WorldRenderer` or audio. It never advances a physics/combat tick or waits for a player, enemy defeat, reserve replacement or mission completion. Initial roster/world construction only supplies typed static display poses. Product callbacks are bound through the actual controller; terminal failure stays disabled when returning Home.

The dedicated entry is guarded by DEV and `mode === 'ui-only'`, and is not imported by the production build. Product HTML/CSS and controller behavior are not re-created in a mock page. The 3D scene itself is not rendered. 3D appearance/performance, actual play, audio quality, real device touch, and scoring/physics correctness are outside this browser pass.

For a permitted local browser, launch `node node_modules/vite/bin/vite.js --config vite.ui-only.config.ts --mode ui-only` on `127.0.0.1:4176`. Home is `/`. Direct display URLs use a local hash, such as `/#screen=playing&mode=normal` and `/#screen=result&mode=normal&outcome=defeat`. These are local fixtures, not published product routes.

## Coverage

| Screen | Direct display and checks |
| --- | --- |
| Home | Heading, forces, Easy/Normal selection, start/settings/rules, horizontal fit |
| Game HUD | Easy/Normal, clock/force text, control visibility, header layout |
| Canvas2D UI | Product sight, reload arc, enemy HP/distance, friendly/ship markers, offscreen arrow, radar; item-specific pixel regions and screenshots |
| Pause | Buttons, focus loop, rules/settings return, explicit resume and Home |
| Settings | Touch and keyboard, Normal 3/Easy 1 targets, 9 keys, save/reload, Cancel/Close/Escape, focus return |
| Result | Success/failure display, score and 6 breakdown rows, retry, Home, settings return |
| Other | Loading status; fire/ice, altitude warning and control-handoff display samples; Home/Pause/Result error text and disabled actions; storage failure/session-only action |

Responsive captures cover 320×568, 568×320 and 1280×720. Error/status and navigation scenarios use 393×648. Full text zoom/200% enlargement, every possible result reason, and every runtime recovery sequence are not claimed as tested.

Each scenario records screenshots. Page errors, console errors and unhandled promise rejections fail the test and are attached as JSON. The report, screenshots and retained failure traces are uploaded with `if: always()` on the proposed workflow. Existing exact-asset loopback request restrictions remain in force; the only additional allowed physical file is the explicit UI fixture entry.

## Current verification boundary

The local candidate targets main `2d5b163298615845e7872d6694988d34d0ab1cfd` on 2026-10-08. PR #10 was merged during preparation. Its head `302b7b6ba4cd7e0cc01269467e5d64d3b9eda1b1` and this main commit have the identical tree `8120c9534b5dc3e25dcf040cecc45d5e3743f810`. This is a separate, unpublished follow-on candidate; the merged PR is not reused. Collection/type/build are distinct from running a real browser. This execution environment blocks browser startup with AF_UNIX `EPERM` and blocks the cloud Chrome loopback page with `ERR_BLOCKED_BY_CLIENT`. No screenshot or measured one-minute pass is available here. Do not present discovery, type/build or unit results as a real-browser pass.

The current upstream workflow already uses the version-matched official Playwright container. The earlier HTTPS/APT-mirror v5 proposal is preserved separately and is not combined with this candidate: installing browsers/OS dependencies via APT again would duplicate work.
