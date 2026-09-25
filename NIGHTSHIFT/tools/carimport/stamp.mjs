// Content fingerprints for every model file, stored in manifest.json ("hashes"). The game appends them
// to model URLs (?v=...), so a re-imported model reaches players at once even though .glb files are
// served with a one-day browser cache. The import tools call this after writing models.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function stampModels(root) {
  const dir = path.join(root, 'public/assets/models');
  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const hashes = {};
  for (const f of fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith('.glb')).sort()) {
    hashes[f.split(path.sep).join('/')] = crypto.createHash('sha1').update(fs.readFileSync(path.join(dir, f))).digest('hex').slice(0, 10);
  }
  manifest.hashes = hashes;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return Object.keys(hashes).length;
}

// run directly: node tools/carimport/stamp.mjs
if (import.meta.url === `file://${process.argv[1]}`) console.log(`stamped ${stampModels(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..'))} models`);
