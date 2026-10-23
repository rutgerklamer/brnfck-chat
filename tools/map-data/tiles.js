'use strict';
// The picture tiles of the program map, and the pieces of program text behind them: tiles/, deep/ and tiles.json.
const fs = require('fs');
const path = require('path');
const { modelOf, num } = require('./models');

const MODEL = modelOf(process.argv[2]), FILE = MODEL.file, META = MODEL.meta, DATA = MODEL.dir;
const W = JSON.parse(fs.readFileSync(path.join(DATA, 'writer.json'), 'utf8'));
const total = META.programBytes, CHUNK = 65536, LOW = 8;
let ORDER = 1; while (4 ** ORDER < total) ORDER++;
const TOP = ORDER - 3, SIDE = 2 ** ORDER, PER = 4 ** (ORDER - TOP);       // 64 characters per pixel at the finest level
const t0 = Date.now();

// The cell of the folded line (a Hilbert curve) that character d falls on.
function d2xy(d) {
  let x = 0, y = 0, lo = d % 1073741824, hi = Math.floor(d / 1073741824);
  for (let s = 1, k = 0; s < SIDE; s *= 2, k++) {
    let t;
    if (k < 15) { t = lo & 3; lo >>= 2; } else { t = hi & 3; hi >>= 2; }
    const rx = 1 & (t >> 1), ry = 1 & (t ^ rx);
    if (ry === 0) { if (rx === 1) { x = s - 1 - x; y = s - 1 - y; } const q = x; x = y; y = q; }
    x += s * rx; y += s * ry;
  }
  return [x, y];
}

const tilesDir = path.join(DATA, 'tiles');
fs.rmSync(tilesDir, { recursive: true, force: true });
const levels = {};
for (let L = LOW; L <= TOP; L++) { fs.mkdirSync(path.join(tilesDir, String(L)), { recursive: true }); levels[L] = { tiles: 0, charsPerPixel: 4 ** (ORDER - L) }; }
let bytes = 0, files = 0;

// The counts of + - < > per pixel of the tile that is being filled, for every level.
const acc = {}; for (let L = LOW; L <= TOP; L++) acc[L] = new Uint32Array(CHUNK * 4);

// Write tile t of level L (256 x 256 pixels, 2 bytes each: + - < > as 4-bit shares of 15), then hand its counts up.
function flush(L, t) {
  const a = acc[L], cpp = levels[L].charsPerPixel, shift = ORDER - L, out = Buffer.alloc(CHUNK * 2);
  const [ox, oy] = d2xy(t * CHUNK * cpp).map((v) => Math.floor(v / 2 ** shift) & ~255);
  for (let i = 0; i < CHUNK; i++) {
    const d = (t * CHUNK + i) * cpp;
    if (d >= total) break;
    const [x, y] = d2xy(d), o = (((y >> shift) - oy) * 256 + ((x >> shift) - ox)) * 2;
    const here = Math.min(cpp, total - d), f = (c) => Math.round(15 * a[i * 4 + c] / here);
    let p = f(0), m = f(1), l = f(2), g = f(3);
    // rounding must not push the sum over 15
    while (p + m + l + g > 15) { if (l >= p && l >= m && l >= g) l--; else if (p >= m && p >= g) p--; else if (m >= g) m--; else g--; }
    out[o] = (p << 4) | m; out[o + 1] = (l << 4) | g;
  }
  fs.writeFileSync(path.join(tilesDir, String(L), t + '.bin'), out); bytes += out.length; files++; levels[L].tiles++;
  if (L > LOW) {
    const up = acc[L - 1], base = (t % 4) * CHUNK;
    for (let i = 0; i < CHUNK; i++) { const q = ((base + i) >> 2) * 4, s = i * 4; up[q] += a[s]; up[q + 1] += a[s + 1]; up[q + 2] += a[s + 2]; up[q + 3] += a[s + 3]; }
  }
  a.fill(0);
}
function done(t, last) {
  for (let L = TOP; L >= LOW; L--) {
    flush(L, t);
    if (L > LOW && (t % 4 === 3 || last)) t = Math.floor(t / 4); else break;
  }
}

// ---- one pass over the file
{
  const idx = new Int8Array(256).fill(-1); idx[43] = 0; idx[45] = 1; idx[60] = 2; idx[62] = 3;
  const fd = fs.openSync(FILE, 'r'), buf = Buffer.allocUnsafe(1 << 22), TILE = CHUNK * PER, a = acc[TOP];
  let at = 0, tile = 0, told = Date.now();
  for (let k; (k = fs.readSync(fd, buf, 0, buf.length, null)) > 0; at += k) {
    for (let i = 0; i < k;) {
      const r0 = at + i - tile * TILE, end = Math.min(k, i + TILE - r0);
      for (let r = r0; i < end; i++, r++) { const c = idx[buf[i]]; if (c >= 0) a[((r / PER) | 0) * 4 + c]++; }
      if (at + i - tile * TILE === TILE) { done(tile, false); tile++; }
    }
    if (Date.now() - told > 30000) { told = Date.now(); console.log(`      ... ${num(at)} characters read, ${files} tiles`); }
  }
  fs.closeSync(fd);
  if (at !== total) throw new Error('size');
  if (at > tile * TILE) done(tile, true);
  else {                                     // the file ended exactly on a tile: the coarser tiles that are still open
    for (let L = TOP - 1, t = tile - 1, open = false; L >= LOW; L--) { const was = t; t = Math.floor(t / 4); if (open || was % 4 !== 3) { flush(L, t); open = true; } }
  }
}
for (let L = LOW; L <= TOP; L++) {
  const want = Math.ceil(total / (levels[L].charsPerPixel * CHUNK));
  if (levels[L].tiles !== want) throw new Error(`level ${L}: ${levels[L].tiles} tiles written, ${want} expected`);
  console.log(`level ${L}: ${levels[L].tiles} tiles, ${num(levels[L].charsPerPixel)} characters per pixel`);
}
console.log(`${files} tiles, ${num(bytes)} bytes  [${((Date.now() - t0) / 1000).toFixed(0)} s]`);

// ---- the text itself, in pieces of 65,536 characters
const deepDir = path.join(DATA, 'deep');
fs.rmSync(deepDir, { recursive: true, force: true }); fs.mkdirSync(deepDir, { recursive: true });
const want = new Set([0]);
const engineFirst = Math.floor(META.writerBytes / CHUNK), last = Math.floor((total - 1) / CHUNK);
for (let c = engineFirst; c <= last; c++) want.add(c);
if (META.deepAll) for (let c = 0; c < engineFirst; c++) want.add(c);      // a small program (compiler/train): all of its text
for (const [, from] of W.stretches) want.add(Math.floor(from / CHUNK));
for (const s of W.samples) for (let c = Math.floor(s.off / CHUNK); c <= Math.floor((s.off + s.len - 1) / CHUNK); c++) want.add(c);
{
  const fd = fs.openSync(FILE, 'r'), buf = Buffer.alloc(CHUNK);
  let b2 = 0;
  for (const c of want) { const k = fs.readSync(fd, buf, 0, CHUNK, c * CHUNK); fs.writeFileSync(path.join(deepDir, c + '.txt'), buf.subarray(0, k)); b2 += k; }
  fs.closeSync(fd);
  console.log(`${want.size} pieces of text, ${num(b2)} bytes (engine: pieces ${engineFirst} to ${last})`);
  const list = [...want].filter((c) => c < engineFirst).sort((a, b) => a - b);
  fs.writeFileSync(path.join(DATA, 'tiles.json'), JSON.stringify({
    made: 'tools/map-data/tiles.js', model: MODEL.id, file: MODEL.web, order: ORDER, side: SIDE, chars: total, chunk: CHUNK, low: LOW, top: TOP, levels, tiles: files, tileBytes: bytes,
    deep: { engineFirst, last, writer: list, bytes: b2, pieces: want.size },
  }));
}
