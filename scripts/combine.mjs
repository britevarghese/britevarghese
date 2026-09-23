// node scripts/combine.mjs out.png a.png b.png [c.png d.png] -> 2-column grid, each tile 640x360
import sharp from 'sharp';
const [out, ...ins] = process.argv.slice(2);
const tiles = await Promise.all(ins.map((f) => sharp(f).resize(640, 360).toBuffer()));
const rows = Math.ceil(tiles.length / 2);
await sharp({ create: { width: 1280, height: 360 * rows, channels: 3, background: '#000' } })
  .composite(tiles.map((t, i) => ({ input: t, left: (i % 2) * 640, top: Math.floor(i / 2) * 360 }))).png().toFile(out);
