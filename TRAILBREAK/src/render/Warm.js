// Shaders compiled ahead of the frame that needs them (render/Renderer.js warm): three.js's compile, with a part's lights
// counted as the frames count them.
//
// three.js compiles a material's shader for the count of lights it is drawn under. Asked to compile a part of a scene
// (renderer.compile(part, camera, scene)), it gathers the scene's lights and then the part's own on top: a part that is
// already in the scene and carries lights (the player's truck: its headlamps) has them counted twice, and its shaders
// are made for lamps that aren't there, the real ones still to compile when a frame comes to them. And the count is
// left behind for the next frame's shadow pass, which then makes its own shaders over again for it. So such a part is
// out of its parent's list while it is compiled: the scene's lights without it, then its own, each once.

/** Whether something carries a light that is on (as three.js gathers them: the visible ones). */
function lit(o) {
  let has = false;
  o.traverseVisible((c) => { if (c.isLight) has = true; });
  return has;
}

function within(o, scene) {
  for (let p = o.parent; p; p = p.parent) if (p === scene) return true;
  return false;
}

/** gl.compile(part, camera, scene): the shaders `part` is drawn with in `scene` (part: the scene itself, something in it, or something about to join it). */
export function compilePart(gl, part, camera, scene) {
  const from = part !== scene && within(part, scene) && lit(part) ? part.parent.children : null;
  const at = from ? from.indexOf(part) : -1;
  if (at >= 0) from.splice(at, 1);
  try { gl.compile(part, camera, scene); } finally { if (at >= 0) from.splice(at, 0, part); }
}
