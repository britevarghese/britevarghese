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
| `node tools/dev/townlife.mjs --port N [--at x,z\|all] [--minutes 3] [--detail 1]` | Kerala street life round the player's stopped car in a town (all: the six towns): traffic stuck and what's in front of it, overlaps, off the road, crashes, people in the road |
| `node tools/dev/chase.mjs --port N [--at x,z\|all] [--heat 2] [--seconds 120] [--stop 1]` | A police chase through a town's traffic, the player's car AI-driven away (or standing): units' arrival, hits, stuck, traffic knocked, roadblocks, busted/escaped |
| `node tools/dev/onfoot.mjs --port N [--at x,z\|all] [--seconds 120]` | On foot round a town in random directions: steps through walls or houses, standing inside them, feet under or over the ground, where it gets stuck |
| `node tools/dev/roadscan.mjs --port N [--at x,z\|all] [--radius 700]` | Every lane and junction turn round a town: the surface a wheel touches every 0.5 m, kinks and steps over 6/12/20 cm and the worst |
| `node tools/dev/klshots.mjs --port N [--at x,z\|all] [--looks day,evening,night,rain] [--out DIR]` | Kerala screenshots from the chase camera on a town's street at different times and weather |
| `node tools/dev/missions.mjs --port N [--only id,id] [--limit 600] [--trace 1]` | The 12 Kerala story missions from their givers, the driving stood in for (put on the lane by each place, into the car to steal, driven behind the car you tail, a ram's hits counted, a race won late): pass/fail and why, each step's time, how the mission's AI car drove (off the road, longest stop, resets; --trace: why it stood or went slow) |
| `node tools/dev/ride.mjs --port N --at x,z [--minutes 4] [--seed 1] [--car id]` | An AI drives the player's car along random routes (no traffic): airborne, hard landings, jolts, hits, sudden stops, leaving the road, resets |

Scenes can script driving with `sim([[steps, {throttle, brake, steer, handbrake, nitro}], ...])` (fixed 60 Hz steps with
rendering disabled, since headless GL is far too slow for real time) — see `drift_night`, `drift_day`, `speed_night`,
`traffic_day`. Pass `--simlog 1` to print the car state after each phase.

Physics metric meanings: `t100` 0-100 km/h s; `brake100m` stopping distance; `stepXX` = half-steer at XX km/h
(`response90` s to 90% steady yaw rate, `overshootPct`, `latG`, `slip` body slip angle rad, `speedKept` km/h after 4 s);
`turnRadius` m at 25 km/h full lock; `slalomMaxSlip`/`liftOffMaxSlip` stability; `drift` handbrake-entry metrics;
`powerSlideMaxSlip` full throttle + 0.7 steer from 50 km/h.
