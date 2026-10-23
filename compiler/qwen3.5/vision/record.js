'use strict';

// Data of site/vision/: where each square looks in each vision layer (spec.js attention weights, averaged over heads).
//   node compiler/qwen3.5/vision/record.js [cat windmills ...]

const fs = require('fs');
const path = require('path');
const VR = require('../reference/vision');
const VS = require('./spec');
const Spec = require('../engine/spec');

const SITE = path.join(__dirname, '..', '..', '..', 'site', 'vision'), DATA = path.join(SITE, 'data'), PICS = path.join(SITE, 'pictures');
const names = process.argv.slice(2).length ? process.argv.slice(2) : ['cat', 'windmills', 'bicycle', 'apples'];

const V = VR.loadVision(Spec.modelDir('qwen3.5-0.8b'));
fs.mkdirSync(DATA, { recursive: true }); fs.mkdirSync(PICS, { recursive: true });
const index = { made: 'compiler/qwen3.5/vision/record.js', layers: V.depth, heads: V.heads, side: 256, square: V.P, merge: V.merge, pictures: [] };
for (const name of names) {
  const t = Date.now(), file = path.join(__dirname, 'pictures', name + '.png'), sq = VR.squares(VR.readPng(file), V.P, V.merge), n = sq.n;
  const net = VS.build(V, sq), look = new Float64Array(V.depth * n * n);
  net.encode(sq.bytes, null, (l, s, h, w, total) => { const at = (l * n + s) * n; for (let u = 0; u < n; u++) look[at + u] += w[u] / total / V.heads; });
  // look-<name>.bin: layers x squares x squares bytes, the share of t in what s takes in, 255 at the largest of that s
  const bytes = new Uint8Array(look.length);
  for (let r = 0; r < V.depth * n; r++) {
    let mx = 0;
    for (let u = 0; u < n; u++) mx = Math.max(mx, look[r * n + u]);
    for (let u = 0; u < n; u++) bytes[r * n + u] = mx > 0 ? Math.round((255 * look[r * n + u]) / mx) : 0;
  }
  fs.writeFileSync(path.join(DATA, `look-${name}.bin`), bytes);
  fs.copyFileSync(file, path.join(PICS, name + '.png'));
  // the square of every place in the picture: block row and column, then the square inside the block (the program's order)
  index.pictures.push({ name, file: `pictures/${name}.png`, look: `data/look-${name}.bin`, rc: sq.rc });
  console.log(`${name}: ${V.depth} layers x ${n} squares  [${((Date.now() - t) / 1000).toFixed(0)} s]`);
}
fs.writeFileSync(path.join(DATA, 'look.json'), JSON.stringify(index));
console.log(`${path.join(DATA, 'look.json')} written`);
