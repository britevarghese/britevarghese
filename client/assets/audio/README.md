# Sound effects

Every sound here is a real recording released as **CC0 1.0** (public domain dedication) or a US Government work
(public domain), cut and processed for the game. Each file holds one *set*: several takes back to back with 100 ms of
silence between them; `sounds.json` lists, per set, the file and every take's `[start s, duration s, hit s]` (`hit` =
offset of the main transient, used to land reload / bolt foley exactly on the animation marks). `client/js/audio/Audio.js`
loads the sets in the background (own weapons first), slices the takes and plays a random one with a little pitch
variation; until a set has loaded, the old synthesized sound plays instead.

Gunshots and the mechanical foley are 32 kHz mono 16-bit WAV (sample-accurate attacks); footsteps, impacts, brass,
explosions and handling noise are 44.1 kHz mono MP3 (VBR ~100 kbit/s). Total ≈ 5.3 MB.

## Gunshots — "The Free Firearm Sound Library" (CC0)

[OpenGameArt: The Free Firearm Sound Library](https://opengameart.org/content/the-free-firearm-sound-library),
"Prepared SFX Library", recorded at 96 kHz / 24 bit with two stereo pairs per gun: *near* (left / right of the shooter)
and *mid* (forward / back, further out). The two channels of a pair are separate microphones (inter-channel correlation
≈ 0), so each channel is used as its own take instead of being folded to mono.

| Set | Source recording | Used for |
|---|---|---|
| `ar_near` (4) | AR-15 5.56 mm, near pair (`D_32P`), 2 shots × 2 mics | own AR-15 Carbine, soldiers < 25 m |
| `ar_far` (4) | AR-15, mid pair (`D_24P`) — keeps the range's slap-back | AR-15 Carbine further away |
| `sniper_near` (5) | Mosin-Nagant 7.62x54R (the M-38's cartridge), near (`M_21P`) | own M-38 Bolt Rifle, < 25 m |
| `sniper_far` (4) | Mosin-Nagant, mid (`M_26P`) | M-38 further away |
| `pistol_near` (4) | Walther PPQ 9x19 mm, near (`X_39P`) | own P-17 Service Pistol, < 25 m |
| `pistol_far` (4) | Walther PPQ, mid (`X_31P`) | P-17 further away |
| `m2` (4) | Springfield 1917 + Tikka T3 .30-06, near (`B_24P`, `W_29P`) — slowed to 0.82 (deeper, longer), the < 200 Hz band of the shot slowed again to 0.7 and mixed in as body, light saturation, +3 dB low shelf, −3 dB above 7 kHz | jeep .50 cal M2 |
| `mg762` (4) | AK-47 7.62x39 near (`C_28P`) — slowed to 0.93, +2.5 dB at 180 Hz | tank coaxial 7.62 mm MG |
| `c30` (4) | Charles Daly / Winchester Model 12 12-gauge near (`H_21P`, `K_22P`) — slowed to 0.7, saturated, +3 dB at 300 Hz, a 75→38 Hz sine thump for the body, low-passed at 7.5 kHz | helicopter 30 mm cannon |

Processing: onset found on the 96 kHz file, cut from 4 ms before it (1.2–2.4 s with the natural tail), 25 Hz high-pass
(32 Hz after the vehicle processing), polyphase resampling to 32 kHz (with the tape-style slow-down where noted),
squared fade over the last 35 %. Takes in a set are matched on punch (RMS of the first 150 ms), the set peak is −1 dBFS;
the per-weapon gains in `Audio.js` put the measured punches where they belong (9 mm < 5.56 < 7.62x54R < .50 / 30 mm).
The .50 cal was compared against a real M2 recording ([Telskuf_IRAQ_Gun.aif](https://freesound.org/people/ikbenraar/sounds/339976/),
ikbenraar, CC0 — too distant and reverberant to cut single shots from) for spectral balance.

## Foley, footsteps, impacts, explosions

Freesound previews (CC0 licence checked on each page) and OpenGameArt packs (CC0):

| Used for | Recording | Author | Licence |
|---|---|---|---|
| AR mag out / mag in / bolt release | [AR15 Various Sounds](https://freesound.org/people/wadaltmon/sounds/263513/) | wadaltmon | CC0 |
| AR mag in, bolt release | [AR15 pistol load and chamber](https://freesound.org/people/michorvath/sounds/427599/) | michorvath | CC0 |
| pistol mag in, slide release | [9mm pistol load and chamber](https://freesound.org/people/michorvath/sounds/427593/) | michorvath | CC0 |
| pistol slide release | [Reload Pistol Slide.mp3](https://freesound.org/people/baconandbeans/sounds/609668/) | baconandbeans | CC0 |
| pistol mag out / mag in / slide | [Handgun Reload Sound Effect](https://opengameart.org/content/handgun-reload-sound-effect) (`reload.wav`) | zer0_sol | CC0 |
| bolt cycle (handle up / back / forward / down) | [Mosin Nagant Bolt Action Cycle](https://freesound.org/people/Zott820/sounds/370345/) | Zott820 | CC0 |
| stripper clip into the magazine | [Gun reload sound effects](https://opengameart.org/content/gun-reload-sound-effects) (`clipload1/2.wav`) | BMacZero | CC0 |
| pistol dry fire | [Glock 17 Trigger Pull](https://freesound.org/people/qubodup/sounds/842748/) | qubodup | CC0 |
| pistol + rifle dry fire | [Taurus G2c Dry Trigger Pull](https://freesound.org/people/NoonerBear/sounds/589848/) | NoonerBear | CC0 |
| rifle dry fire | [A rifle being dry fired once](https://freesound.org/people/ser%C3%B8ut%C5%8Dnin--depriv%C9%99d/sounds/725402/) | serøutōnin--deprivəd | CC0 |
| rifle draw / handling | [A rifle being moved around and handled w/ magazine removals](https://freesound.org/people/ser%C3%B8ut%C5%8Dnin--depriv%C9%99d/sounds/725403/) | serøutōnin--deprivəd | CC0 |
| rifle draw / handling, kit rattle | [Hunting Rifle](https://freesound.org/people/Kohnn/sounds/701049/) | Kohnn | CC0 |
| pistol draw | [A pistol being moved around and handled w/ foley](https://freesound.org/people/ser%C3%B8ut%C5%8Dnin--depriv%C9%99d/sounds/725400/) | serøutōnin--deprivəd | CC0 |
| grenade pin pull | [small moving metallic part](https://freesound.org/people/F3ather/sounds/725813/) | F3ather | CC0 |
| grenade spoon | [small metal object fall](https://freesound.org/people/nicktermer/sounds/259553/) | nicktermer | CC0 |
| grenade throw whoosh | [Whooshes](https://freesound.org/people/IENBA/sounds/875462/) | IENBA | CC0 |
| footsteps grass | [Hiking Boot Footsteps on Grass](https://freesound.org/people/Fission9/sounds/521587/) | Fission9 | CC0 |
| footsteps dirt / gravel (sand: low-passed) | [Hiking Boot Footsteps on Gravel](https://freesound.org/people/Fission9/sounds/521588/) | Fission9 | CC0 |
| footsteps dirt / gravel | [Footsteps_Mountain_Boots_Gravel_Mono.wav](https://freesound.org/people/Nox_Sound/sounds/556002/) | Nox_Sound | CC0 |
| footsteps concrete | [Hiking Boot Footsteps on Stone](https://freesound.org/people/Fission9/sounds/521590/) | Fission9 | CC0 |
| footsteps concrete | [Footsteps - Stone, Rock, Concrete, Cement](https://freesound.org/people/SecureSubset/sounds/813622/) | SecureSubset | CC0 |
| footsteps wood | [Footsteps, Solid Wood Rug, Male Boots, Medium Pace and Scuffs.wav](https://freesound.org/people/SpliceSound/sounds/150444/) | SpliceSound | CC0 |
| footsteps metal | [Footsteps On Metal](https://freesound.org/people/IENBA/sounds/834029/) | IENBA | CC0 |
| bullet impact metal | [Foley bullet hit metal 02.wav](https://freesound.org/people/martian/sounds/182263/) | martian | CC0 |
| bullet impact concrete | [Whipper Snappers/Bullet Hits.wav](https://freesound.org/people/deleted_user_1371021/sounds/161001/) | (deleted user) | CC0 |
| bullet impact dirt | [Single Rock hit Dirt.wav](https://freesound.org/people/worthahep88/sounds/319222/), [… 2](https://freesound.org/people/worthahep88/sounds/319229/) | worthahep88 | CC0 |
| bullet impact wood | [Single Rock Hitting wood 3](https://freesound.org/people/worthahep88/sounds/319223/), [… wood](https://freesound.org/people/worthahep88/sounds/319226/), [… wood 2](https://freesound.org/people/worthahep88/sounds/319228/) | worthahep88 | CC0 |
| bullet impact flesh | [Bullet Blood 4](https://freesound.org/people/JustInvoke/sounds/138481/) | JustInvoke | CC0 |
| bullet impact flesh | [VisceralBulletImpacts.wav](https://freesound.org/people/u1769092/sounds/423301/) | u1769092 | CC0 |
| ricochets | [ricochet.mp3](https://freesound.org/people/cedarstudios/sounds/148840/) | cedarstudios | CC0 |
| spent brass (concrete) | [Brass bullet shell casing drop onto concrete, multiple takes](https://freesound.org/people/GrayJoy/sounds/210102/) | GrayJoy | CC0 |
| spent brass (tile, range casings) | [Bouncing Shell Casings (Various Sizes)](https://freesound.org/people/GryffDavid/sounds/318964/) | GryffDavid | CC0 |
| spent brass (wood) | [.30 Shell Bouncing](https://freesound.org/people/Danwardvs/sounds/205126/) | Danwardvs | CC0 |
| impacts (metal / concrete / wood / glass), window breaking, grenade bouncing | [75 CC0 breaking / falling / hit sfx](https://opengameart.org/content/75-cc0-breaking-falling-hit-sfx) (`bfh1_*`) | rubberduck | CC0 |
| explosions | [EOD Explosion](https://freesound.org/people/qubodup/sounds/855798/) — US Army SETAF-AF b-roll | qubodup | CC0 / US Gov. |
| explosions, 120 mm tank gun | [Blast](https://freesound.org/people/qubodup/sounds/855893/) — US Marine Corps (MCIPAC) b-roll | qubodup | CC0 / US Gov. |
| explosions | [Fire Explosion](https://freesound.org/people/qubodup/sounds/855898/) — AFN Okinawa EOD b-roll | qubodup | CC0 / US Gov. |
| 120 mm tank gun (blast + shock wave) | [Blow Up Sound](https://freesound.org/people/qubodup/sounds/855896/) — AFN Okinawa EOD b-roll | qubodup | CC0 / US Gov. |
| explosions | [Explosion](https://freesound.org/people/qubodup/sounds/182429/), [Explosive 1 v2 [DOD 130303]](https://freesound.org/people/qubodup/sounds/182431/) — US Government video | qubodup | CC0 / US Gov. |

Processing: single events cut at their onsets (10–30 ms pre-roll), high-passed (60–300 Hz depending on the material:
removes handling rumble and the overload thump of the firework snaps), trimmed where they fall below −45…−50 dB,
squared fades. Footsteps, impacts and brass are matched on loudness (loudest 30 ms) within a set; foley takes are peak
normalised and the levels are set in `Audio.js` (own handling noise ~15 dB under the own shot, footsteps ~17 dB under).
The explosions come from camera microphones with little real sub-bass, so the game adds a synthesized low body and,
with distance, a long low-passed rumble.

## Still synthesized

Supersonic crack (an N-wave + ground reflection + air-tear hiss) and the subsonic pistol whizz (no usable CC0 recordings),
rocket launch, UI blips, engines / rotor / plane / wind loops (no CC0 loops good enough).
