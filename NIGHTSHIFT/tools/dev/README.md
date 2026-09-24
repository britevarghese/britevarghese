# Dev tools

All tools assume the NIGHTSHIFT server is running from the same checkout (`node server.js --port N`).
Headless Chromium uses software rendering (SwiftShader): FPS numbers are NOT representative, visuals are.

| Tool | Purpose |
|---|---|
| `node tools/dev/scenes.mjs --port N --out DIR --prefix before [--only a,b] [--quality medium]` | Standard screenshot scenes (night/day/rain/aerial/car close-ups/garage) + draw-call report |
| `node tools/dev/physics-metrics.mjs [--json f]` | Objective driving-feel metrics per car (no browser) |
| `node tools/dev/smoke.mjs --port N [--seconds 180]` | Free roam + race + pursuit with rendering off; fails on any JS error |

Physics metric meanings: `t100` 0-100 km/h s; `brake100m` stopping distance; `stepXX` = half-steer at XX km/h
(`response90` s to 90% steady yaw rate, `overshootPct`, `latG`, `slip` body slip angle rad, `speedKept` km/h after 4 s);
`turnRadius` m at 25 km/h full lock; `slalomMaxSlip`/`liftOffMaxSlip` stability; `drift` handbrake-entry metrics;
`powerSlideMaxSlip` full throttle + 0.7 steer from 50 km/h.
