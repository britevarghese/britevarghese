# Your own assets (override the defaults)

Drop GLB files here and restart/reload — the asset manager picks them up automatically
(see `client/assets/asset-manifest.json` for the lookup order):

| File | Used for |
|---|---|
| `characters/soldier.glb` | US soldiers (local player, remote players, bots) |
| `characters/fsb_operator.glb` | RU soldiers (falls back to `soldier.glb`) |
| `weapons/ss2_v5_assault_rifle.glb` (or `assault_rifle.glb`) | Assault kit rifle (1st and 3rd person) |
| `weapons/pistol.glb` | Sidearm |

Characters must be skinned (any common rig naming: Mixamo, UE, Blender .L/.R …). Bones are discovered
automatically; if something is missed add `"bones": { "rightHand": "<bone name>" }` overrides in the manifest.
For weapons with no named sockets, open `/debug/weapon?w=assault_rifle` and set `"forward"` / `"sockets"`
under `"userForward"` / `"userSockets"` for that weapon in the manifest.
