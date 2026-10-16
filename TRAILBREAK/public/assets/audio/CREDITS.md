# Sound credits

Engine recordings from [Freesound](https://freesound.org), used under their licences. Each engine bank is cut
into single firings (tools/sounds/build_grains.py) that the game plays back at its own engine's revs
(src/audio/engine-worklet.js); recordings from another engine fill the top of the rev range where the bank's
own stop, filtered to match it.

- Bank `v6` (Honda / Acura 3.2 V6 (J32: a 60-degree even-firing V6 like the Pentastar), a microphone just above the exhaust):
  - "Sports Car Idling - Exhaust" by EvanBoyerman, https://freesound.org/s/754777/ (CC BY 4.0, https://creativecommons.org/licenses/by/4.0/)
  - "Sports Car Accelerating/Speeding Up Medium - Exhaust" by EvanBoyerman, https://freesound.org/s/754776/ (CC BY 4.0, https://creativecommons.org/licenses/by/4.0/)
  - "Sports Car Accelerating/Speeding Up Fast - Exhaust" by EvanBoyerman, https://freesound.org/s/754775/ (CC BY 4.0, https://creativecommons.org/licenses/by/4.0/)
- Bank `d4` (Toyota Hilux 4x4 turbo-diesel four (the closest free recording to the Thar's mHawk 2.2): idle and revs):
  - "4WD Engine & Rev.wav" by Alex_hears_things, https://freesound.org/s/379914/ (CC0 1.0, https://creativecommons.org/publicdomain/zero/1.0/)
  - "vw diesel engine.mp3" by Evilmikie, https://freesound.org/s/448217/ (CC0 1.0, https://creativecommons.org/publicdomain/zero/1.0/) (the top of the revs)
- Bank `d4t` (VW 1.9 TDI turbo-diesel four (a Defender's 2.5 TD is its bigger, slower cousin): idle, revs and holds):
  - "vw diesel engine.mp3" by Evilmikie, https://freesound.org/s/448217/ (CC0 1.0, https://creativecommons.org/publicdomain/zero/1.0/)
- Bank `i6` (Jaguar E-type 4.2 XK straight six (the size of a Jeep or Land Cruiser 4.2 six), engine side: idle and a rev):
  - "E-type Jaguar, car engine, rev, idle ,mono.wav" by Dan_AudioFile, https://freesound.org/s/614700/ (CC BY 4.0, https://creativecommons.org/licenses/by/4.0/)
  - "Sports Car Accelerating/Speeding Up Fast - Exhaust" by EvanBoyerman, https://freesound.org/s/754775/ (CC BY 4.0, https://creativecommons.org/licenses/by/4.0/) (the top of the revs)
- Bank `i4` (Suzuki Jimny four: idle and gentle revs):
  - "Car being turned on, revved and off( Suzuki Jimny).wav" by 221316, https://freesound.org/s/655653/ (CC BY 4.0, https://creativecommons.org/licenses/by/4.0/)
  - "Sports Car Accelerating/Speeding Up Fast - Exhaust" by EvanBoyerman, https://freesound.org/s/754775/ (CC BY 4.0, https://creativecommons.org/licenses/by/4.0/) (the top of the revs)
  - "Sports Car Accelerating/Speeding Up Medium - Exhaust" by EvanBoyerman, https://freesound.org/s/754776/ (CC BY 4.0, https://creativecommons.org/licenses/by/4.0/) (the top of the revs)
- Bank `v8` (1978 Cadillac Eldorado 425 V8 at the exhaust: fast idle):
  - "1978 Cadillac Eldorado Biarritz - Engine Start, Exhaust Idle, Revving and Shutdown" by inspire153, https://freesound.org/s/873856/ (CC0 1.0, https://creativecommons.org/publicdomain/zero/1.0/)
  - "Sports Car Accelerating/Speeding Up Fast - Exhaust" by EvanBoyerman, https://freesound.org/s/754775/ (CC BY 4.0, https://creativecommons.org/licenses/by/4.0/) (the top of the revs)
  - "Sports Car Accelerating/Speeding Up Medium - Exhaust" by EvanBoyerman, https://freesound.org/s/754776/ (CC BY 4.0, https://creativecommons.org/licenses/by/4.0/) (the top of the revs)
- Bank `v8m` (A cammed V8 (wikusv's 'Idle and Rev'): the lope at idle):
  - "Idle and Rev - Engine.wav" by wikusv, https://freesound.org/s/232272/ (CC BY 4.0, https://creativecommons.org/licenses/by/4.0/)
  - "Sports Car Accelerating/Speeding Up Fast - Exhaust" by EvanBoyerman, https://freesound.org/s/754775/ (CC BY 4.0, https://creativecommons.org/licenses/by/4.0/) (the top of the revs)
- Bank `d8` (Ford F-350 turbo-diesel V8: idle):
  - "Diesel Start-Idle-Revs MZ000004.wav" by DAVESTALKER, https://freesound.org/s/443319/ (CC0 1.0, https://creativecommons.org/publicdomain/zero/1.0/)
  - "vw diesel engine.mp3" by Evilmikie, https://freesound.org/s/448217/ (CC0 1.0, https://creativecommons.org/publicdomain/zero/1.0/) (the top of the revs)
- Bank `d6` (Ram 5.9 Cummins straight-six turbo-diesel: idle):
  - "Ram 5.9 cummins-startup-idle.m4a" by Therancher01, https://freesound.org/s/610771/ (CC0 1.0, https://creativecommons.org/publicdomain/zero/1.0/)
  - "vw diesel engine.mp3" by Evilmikie, https://freesound.org/s/448217/ (CC0 1.0, https://creativecommons.org/publicdomain/zero/1.0/) (the top of the revs)

Fallback engine loops (browsers without AudioWorklet), cut at six rpm points for NIGHTSHIFT and reused here:
- `v8_muscle`: "Idle and Rev - Engine.wav" by wikusv, https://freesound.org/s/232272/ (CC BY 4.0, https://creativecommons.org/licenses/by/4.0/), trimmed.
- `i6_bmw`: "BMWM3_01.wav" by ikbenraar, https://freesound.org/s/415276/ (CC BY 4.0, https://creativecommons.org/licenses/by/4.0/), trimmed.

All other sounds (the starter, turbo, gear whine, tyres, gravel, mud, water, wind, knocks, the winch, birds) are
synthesised in the browser.
