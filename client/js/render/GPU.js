// Graphics card detection: which GPU the browser actually renders with (dedicated NVIDIA / AMD / Intel Arc,
// integrated, or software fallback), a recommended quality preset, and advice for dual-GPU laptops whose browser
// ended up on the weaker integrated chip.
let cached = null;

export function detectGPU() {
  if (cached) return cached;
  let renderer = '', vendor = '', maxTex = 0;
  try {
    const c = document.createElement('canvas');
    // same request the game makes: prefer the high-performance (dedicated) GPU on dual-GPU machines
    const gl = c.getContext('webgl2', { powerPreference: 'high-performance' }) || c.getContext('webgl', { powerPreference: 'high-performance' });
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      vendor = String(ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR));
      maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch { /* no WebGL */ }
  cached = classify(renderer, vendor, maxTex);
  return cached;
}

// "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU (0x00002560) Direct3D11 vs_5_0 ps_5_0, D3D11)" -> "NVIDIA GeForce RTX 3060 Laptop GPU"
export function prettyName(r) {
  let s = r.replace(/^ANGLE \(/, '').replace(/\)$/, '');
  const parts = s.split(', ');
  if (parts.length >= 2 && /ANGLE/.test(r)) s = parts[1];
  return s.replace(/\(0x[0-9a-f]+\)/i, '').replace(/Direct3D.*|vs_\d.*|OpenGL.*|Metal.*|, or similar/i, '').replace(/\s+/g, ' ').trim() || 'Unknown GPU';
}

export function classify(renderer, vendor = '', maxTex = 0) {
  const r = `${renderer} ${vendor}`;
  const name = renderer ? prettyName(renderer) : 'WebGL unavailable';
  let tier = 'integrated', kind = 'integrated';
  if (!renderer || /SwiftShader|llvmpipe|softpipe|Microsoft Basic Render|Software|Mesa Offscreen/i.test(r)) { kind = 'software'; tier = 'software'; }
  else if (/NVIDIA|GeForce|Quadro|RTX|GTX|Tesla/i.test(r)) {
    kind = 'dedicated';
    // RTX 20/30/40/50 series and 16xx+ are comfortably above the HIGH budget
    tier = /RTX\s*(20|30|40|50)\d\d|RTX\s*A\d{4}/i.test(r) && !/\b(2050|3050)\b/.test(r) ? 'ultra' : /GTX\s*(9|10)\d\d|MX\s*\d/i.test(r) ? 'mid' : 'high';
  } else if (/Radeon/i.test(r) && /\bRX\s*\d|Pro\s*W\d|\bR9\s|Vega\s*(56|64)/i.test(r)) {
    kind = 'dedicated';
    tier = /RX\s*(6[6-9]|7\d|9\d)\d\d/i.test(r) ? 'ultra' : 'high';
  } else if (/Arc\S*\s*[AB]\d{3}/i.test(r)) { kind = 'dedicated'; tier = 'high'; }
  else if (/Apple M\d\s*(Pro|Max|Ultra)/i.test(r)) { kind = 'dedicated'; tier = 'high'; }
  else if (/Apple M\d|Apple GPU|Radeon.*(780M|760M|680M)|Iris\S*\s*Xe|Arc.*Graphics/i.test(r)) { kind = 'integrated'; tier = 'mid'; }
  else if (/Mali|Adreno|PowerVR|Apple A\d/i.test(r)) { kind = 'mobile'; tier = 'integrated'; }
  const recommended = { software: 'verylow', integrated: 'low', mid: 'medium', high: 'high', ultra: 'ultra' }[tier];
  return { name, raw: renderer, vendor, kind, tier, recommended, maxTex, dedicated: kind === 'dedicated' };
}

// Is this probably a laptop / PC whose dedicated card is being skipped? (Intel/AMD integrated or software rendering
// on a desktop browser.) We can't see the other GPU from the page, so the advice is phrased as "if you have one".
export function adviceFor(gpu) {
  const ua = navigator.userAgent;
  const win = /Windows/i.test(ua), mac = /Mac OS X/i.test(ua) && !/iPhone|iPad/i.test(ua), linux = /Linux/i.test(ua) && !/Android/i.test(ua);
  const browser = /Edg\//.test(ua) ? 'Microsoft Edge' : /Firefox\//.test(ua) ? 'Firefox' : /OPR\//.test(ua) ? 'Opera' : 'Google Chrome';
  const exe = { 'Microsoft Edge': 'msedge.exe', Firefox: 'firefox.exe', Opera: 'opera.exe', 'Google Chrome': 'chrome.exe' }[browser];
  if (gpu.kind === 'software') {
    return {
      level: 'bad',
      title: 'Hardware acceleration is OFF — the game is drawing with the CPU',
      steps: [
        `${browser}: Settings → System → turn ON "Use graphics acceleration when available", then restart the browser.`,
        'Update your graphics driver (NVIDIA GeForce Experience / AMD Adrenalin / Intel Driver & Support Assistant).',
        'Open chrome://gpu (edge://gpu) — "WebGL: Hardware accelerated" should be shown.',
      ],
    };
  }
  if (gpu.dedicated || gpu.kind === 'mobile' || !(win || linux || mac)) return null;
  const steps = [];
  if (win) {
    const chrome = browser !== 'Firefox';
    steps.push(`FULLY quit ${browser} — closing the windows is not enough, it keeps running in the background and keeps the Intel GPU: menu ⋮ → Exit${chrome ? `, and turn OFF Settings → System → "Continue running background apps when ${browser} is closed"` : ''}. Check Task Manager: no ${exe} left.`);
    steps.push(`Windows Settings → System → Display → Graphics → ${browser} (if it is listed twice, set both; use "Browse" → C:\\Program Files\\…\\${exe} if missing) → Options → "High performance" → Save. Windows 11: also Advanced graphics settings → Default high performance GPU → your NVIDIA/AMD card.`);
    steps.push(`NVIDIA Control Panel → Manage 3D settings → Global Settings → Preferred graphics processor → "High-performance NVIDIA processor" → Apply (and Program Settings → ${exe} → same). AMD: Adrenalin → Graphics → ${exe} → High Performance.`);
    if (chrome) {
      steps.push(`Still Intel? Force it: right-click the ${browser} shortcut → Properties → at the end of "Target" add  --force_high_performance_gpu  (after the closing quote) → OK, quit ${browser} completely and start it from that shortcut.`);
      steps.push(`Still Intel? Open ${browser === 'Microsoft Edge' ? 'edge' : 'chrome'}://flags/#use-angle → "Choose ANGLE graphics backend" → D3D11on12 (or OpenGL) → Relaunch.`);
    }
    steps.push('Laptop on battery / power saver keeps the NVIDIA card asleep: plug in the charger, Windows power mode "Best performance". Gaming laptops with a MUX switch: NVIDIA Control Panel → Manage Display Mode → "NVIDIA GPU only" (or the vendor app: Armoury Crate / Lenovo Vantage / OMEN Hub → Discrete/Ultimate GPU mode), then reboot.');
    steps.push(`Check: ${browser === 'Microsoft Edge' ? 'edge' : 'chrome'}://gpu → "GL_RENDERER" must mention NVIDIA/AMD. Then reload this page — the GPU line above updates.`);
  } else if (mac) {
    steps.push('System Settings → Battery → turn off "Automatic graphics switching" (Intel MacBook Pro with AMD graphics), then restart the browser.');
  } else {
    steps.push('Start the browser on the dedicated GPU: NVIDIA → `__NV_PRIME_RENDER_OFFLOAD=1 __GLX_VENDOR_LIBRARY_NAME=nvidia google-chrome`, AMD → `DRI_PRIME=1 google-chrome`.');
  }
  return { level: 'hint', title: 'Using integrated graphics. Laptop with an NVIDIA / AMD card? Switch the browser to it:', steps };
}
