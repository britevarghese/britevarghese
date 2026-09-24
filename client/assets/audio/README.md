# Gunshot recordings

Single shots cut from real firearm recordings in **"The Free Firearm Sound Library"**
(OpenGameArt.org, "Prepared SFX Library"), released under **CC0 1.0** (public domain).

| Files | Source recording | Used for |
|---|---|---|
| `ar_0` … `ar_3` | AR-15 (`D_24P`, `D_32P`) | AR-15 Carbine |
| `ar_4`, `ar_5` | AK-47 (`C_31P`) | AR-15 Carbine (variation) |
| `sniper_0` … `sniper_2` | Mosin-Nagant (`M_26P`) | M-38 Bolt Rifle |
| `sniper_3`, `sniper_4` | Tikka T3 (`W_24P`) | M-38 Bolt Rifle (variation) |
| `pistol_0` … `pistol_3` | M1911 (`A_34P`, `A_42P`) | P-17 Service Pistol |

Processing: onset detection, 1.2–2.4 s cut with the natural outdoor tail, 25 % squared fade-out, stereo → mono,
96 kHz → 32 kHz (windowed-sinc low-pass), peak-normalised, 16-bit PCM WAV. The game picks a random take per shot
with ±5 % pitch variation and applies distance low-pass, speed-of-sound delay and reverb send (`client/js/audio/Audio.js`).
