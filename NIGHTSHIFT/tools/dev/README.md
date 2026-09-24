# Dev tools

All tools assume the NIGHTSHIFT server is running from the same checkout (`node server.js --port N`).
Headless Chromium uses software rendering (SwiftShader): FPS numbers are NOT representative, visuals are.

| Tool | Purpose |
|---|---|
| `node tools/dev/scenes.mjs --port N --out DIR --prefix before [--only a,b] [--quality medium]` | Standard screenshot scenes (night/day/rain/aerial/car close-ups/garage) + draw-call report |
| `node tools/dev/physics-metrics.mjs [--json f]` | Objective driving-feel metrics per car (no browser) |
| `node tools/dev/smoke.mjs --port N [--seconds 180]` | Free roam + race + pursuit with rendering off; fails on any JS error |
| `node tools/dev/break-test.mjs --port N [--time day] [--out DIR]` | Breakaway props: hits a lamp post and sidewalk clutter, reports speed kept / debris / light off |
| `node tools/dev/hitch-test.mjs --port N [--quality ultra]` | Scripted 50 s drive at fixed 60 Hz (render off); average step and the slowest steps with their dominant subsystem |

Scenes can script driving with `sim([[steps, {throttle, brake, steer, handbrake, nitro}], ...])` (fixed 60 Hz steps with
rendering disabled, since headless GL is far too slow for real time) — see `drift_night`, `drift_day`, `speed_night`,
`traffic_day`. Pass `--simlog 1` to print the car state after each phase.

Physics metric meanings: `t100` 0-100 km/h s; `brake100m` stopping distance; `stepXX` = half-steer at XX km/h
(`response90` s to 90% steady yaw rate, `overshootPct`, `latG`, `slip` body slip angle rad, `speedKept` km/h after 4 s);
`turnRadius` m at 25 km/h full lock; `slalomMaxSlip`/`liftOffMaxSlip` stability; `drift` handbrake-entry metrics;
`powerSlideMaxSlip` full throttle + 0.7 steer from 50 km/h.
