'use strict';
// The writing part of a program: writer.json, blocks.bin and block-*.json.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Module = require('module');
const { build } = require('./instrument');
const { modelOf, ROOT, COMMANDS, commandIndex, num, gib } = require('./models');
const { tapeRegions, regionAt } = require('./regions');

const MODEL = modelOf(process.argv[2]);
const FILE = MODEL.file, META = MODEL.meta, DATA = MODEL.dir, QWEN = MODEL.family === 'qwen';
const now = () => Date.now() / 1000;
let t0 = now();
const lap = (s) => { console.log(`${s}  [${(now() - t0).toFixed(1)} s]`); t0 = now(); };

// ---- the encoder of compiler/smollm/pure/encode.js, with three report lines added
function hookedEncoder() {
  const file = path.join(ROOT, 'compiler', 'smollm', 'pure', 'encode.js');
  let src = fs.readFileSync(file, 'utf8');
  const put = (find, add, before = false) => {
    const i = src.indexOf(find);
    if (i < 0 || src.indexOf(find, i + 1) >= 0) throw new Error('encode.js changed: cannot place the report line at  ' + find);
    src = before ? src.slice(0, i) + add + src.slice(i) : src.slice(0, i + find.length) + add + src.slice(i + find.length);
  };
  put("stats.blocks++; stats.blockCells += K; stats.blockChars += out.length - before;", " if (o.onBlock) o.onBlock(c, K, ch, before, out.length, sp, fix);");
  put("stats.directCells += K; stats.directChars += out.length - before;", " if (o.onDirect) o.onDirect(c, K, before, out.length);");
  put("stats.skips++; stats.skipCells += z; stats.skipChars += out.length - before;", " if (o.onSkip) o.onSkip(pos, z, before, out.length);");
  const m = new Module(file, null);
  m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(src, file);
  return m.exports;
}

// ---- the tape
console.log(`model ${MODEL.id}: ${MODEL.web}, ${num(META.programBytes)} characters; free memory ${gib(os.freemem())}`);
const run = MODEL.runWriter();
const tape = run.tape;
lap(`writing part run: tape of ${num(tape.length)} cells, pointer on ${run.pointer}`);

const G = build(MODEL.id);
const regions = tapeRegions(G.engine, G.layout);
const OFFW = G.engine.OFFW, OFFE = QWEN ? G.engine.OFFE : 2 ** 20 + 1;
lap('engine generated again, ' + regions.length + ' tape regions');

// ---- the encoder again, reporting
const events = [];
const radKeys = [], radIndex = new Map();
const digitHist = new Float64Array(41);          // lower digits -20..20
const topHist = new Float64Array(81);            // top digits -40..40 (clamped)
const perCell = new Float64Array(64);            // characters per cell inside blocks: planes + digits (clamped)
const kindChars = {}, kindCells = {};
const enc = hookedEncoder();
const hash = crypto.createHash('sha256');
const onBlock = (c, K, ch, from, to, sp, fix) => {
  const key = ch.R.join(',') || '-';
  if (!radIndex.has(key)) { radIndex.set(key, radKeys.length); radKeys.push(key); }
  events.push({ kind: 0, off: from, len: to - from, cell: c, K, D: ch.D, R: ch.R, rad: radIndex.get(key), m: ch.m, b: sp.b, b0: sp.b0, f: sp.f, fix });
  const P = ch.D - 1, R = ch.R;
  for (let i = 0; i < K; i++) {
    let e = (tape[c + i] | 0) - ch.m, cost = ch.D;
    for (let j = 0; j < P; j++) {
      const r = R[j], h = (r - 1) >> 1;
      let d = (e + h) % r; if (d < 0) d += r; d -= h;
      digitHist[d + 20]++; cost += d < 0 ? -d : d; e = (e - d) / r;
    }
    topHist[Math.max(-40, Math.min(40, e)) + 40]++; cost += Math.abs(e);
    perCell[Math.min(63, cost)]++;
  }
};
const stats = enc.encodeTape(tape, META.pointerAfterWriting, (b) => hash.update(b), {
  onBlock,
  onDirect: (c, K, from, to) => events.push({ kind: 1, off: from, len: to - from, cell: c, K }),
  onSkip: (c, z, from, to) => events.push({ kind: 2, off: from, len: to - from, cell: c, K: z }),
});
if (stats.chars !== META.writerBytes) throw new Error('the encoder gave another size than the file has');
{
  const fd = fs.openSync(FILE, 'r'), buf = Buffer.allocUnsafe(1 << 22);
  for (let at = META.writerBytes, k; (k = fs.readSync(fd, buf, 0, buf.length, at)) > 0; at += k) hash.update(buf.subarray(0, k));
  fs.closeSync(fd);
  if (hash.digest('hex') !== META.sha256) throw new Error('the text of the hooked encoder is not the text of the file');
}
lap(`encoder run again: ${num(events.length)} events (${num(stats.blocks)} blocks); its text plus the engine has the SHA-256 of the file`);

// ---- the file
const countW = new Float64Array(8), countE = new Float64Array(8);
const PROF = 2048, prof = new Float64Array(PROF * 8), per = META.programBytes / PROF;
let maxDepthW = 0, maxDepthE = 0, longRunLT = 0;
{
  const fd = fs.openSync(FILE, 'r'), buf = Buffer.allocUnsafe(1 << 22), c9 = new Uint32Array(9), code9 = Uint8Array.from(commandIndex, (v) => (v < 0 ? 8 : v));
  let at = 0, depth = 0, run2 = 0, bin = 0, told = now();
  for (let k; (k = fs.readSync(fd, buf, 0, buf.length, null)) > 0; at += k) {
    for (let i = 0; i < k;) {
      // one stretch that lies in one slice of the profile and in one part of the program
      const pos = at + i, w = pos < META.writerBytes;
      while (bin < PROF - 1 && pos >= Math.ceil((bin + 1) * per)) bin++;
      let end = bin < PROF - 1 ? Math.min(k, Math.ceil((bin + 1) * per) - at) : k;
      if (w) end = Math.min(end, META.writerBytes - at);
      let maxD = 0;
      for (; i < end; i++) {
        const c = code9[buf[i]];
        c9[c]++;
        if (c === 2) { if (++run2 > longRunLT) longRunLT = run2; } else { run2 = 0; if (c === 4) { if (++depth > maxD) maxD = depth; } else if (c === 5) depth--; }
      }
      if (c9[8]) throw new Error('not a command before ' + (at + i));
      if (w) { if (maxD > maxDepthW) maxDepthW = maxD; } else if (maxD > maxDepthE) maxDepthE = maxD;
      const into = w ? countW : countE;
      for (let c = 0; c < 8; c++) { into[c] += c9[c]; prof[8 * bin + c] += c9[c]; c9[c] = 0; }
    }
    if (now() - told > 30) { told = now(); console.log(`      ... ${num(at)} characters read`); }
  }
  fs.closeSync(fd);
  if (at !== META.programBytes) throw new Error('size');
}
lap('file scanned: ' + [...COMMANDS].map((c, i) => `${c} ${num(countW[i] + countE[i])}`).join('  '));

// ---- tape statistics
let entropyBits = 0, nonZero = 0, unary = 0;
{
  const BITS = 21, SIZE = 1 << BITS, keys = new Int32Array(SIZE), cnts = new Int32Array(SIZE), used = new Int32Array(1 << 20);
  for (let at = 0; at < tape.length; at += 1 << 20) {
    const end = Math.min(tape.length, at + (1 << 20));
    let n = 0;
    for (let i = at; i < end; i++) {
      const v = tape[i] | 0;
      if (v) nonZero++;
      unary += 1 + (v < 0 ? -v : v);
      let h = Math.imul(v, 0x9E3779B1) >>> (32 - BITS);
      while (cnts[h] !== 0 && keys[h] !== v) h = (h + 1) & (SIZE - 1);
      if (cnts[h] === 0) { keys[h] = v; used[n++] = h; }
      cnts[h]++;
    }
    for (let j = 0; j < n; j++) { const c = cnts[used[j]]; entropyBits += c * Math.log2((end - at) / c); cnts[used[j]] = 0; }
  }
}
if (nonZero !== META.encoder.nonZero) throw new Error('non-zero count differs from the meta file');
lap(`entropy ${(entropyBits / nonZero).toFixed(3)} bits per non-zero cell; plain counting ${num(unary)} characters`);

const WK = QWEN ? ['qkv', 'o', 'w13', 'w2'] : ['qkv', 'o', 'w13', 'w2', 'cls'], WMAX = 2 * OFFW - 1, EUNIT = QWEN ? 4 : 256;
const whist = {}; for (const k of WK) whist[k] = new Float64Array(2 * OFFW);
const embHist = new Float64Array(801);            // table value / EUNIT, clamped to -400..400
let embMin = Infinity, embMax = -Infinity;
const regionStats = regions.map(() => ({ nonZero: 0 }));
for (const r of regions) {
  let nz = 0;
  if (whist[r.kind]) { const h = whist[r.kind]; for (let i = r.from; i < r.to; i++) { const v = tape[i]; if (v) { nz++; h[Math.max(0, Math.min(WMAX, v))]++; } } }
  else if (r.kind === 'emb') { for (let i = r.from; i < r.to; i++) { const v = tape[i]; if (v) { nz++; const e = v - OFFE; if (e < embMin) embMin = e; if (e > embMax) embMax = e; embHist[Math.max(0, Math.min(800, Math.round(e / EUNIT) + 400))]++; } } }
  else for (let i = r.from; i < r.to; i++) if (tape[i]) nz++;
  regionStats[r.id].nonZero = nz;
}
lap('histograms');

// ---- events -> stretches of the file with a name
events.sort((x, y) => x.off - y.off);
let regOfNext = null;
for (let i = events.length - 1; i >= 0; i--) {
  const e = events[i];
  if (e.kind === 2) e.region = regOfNext === null ? regionAt(regions, e.cell).id : regOfNext;
  else {
    let best = null, bestN = 0; const also = [];
    for (let r = regionAt(regions, e.cell); r && r.from < e.cell + e.K; r = regions[r.id + 1]) {
      if (r.kind === 'work') continue;
      const n = Math.min(r.to, e.cell + e.K) - Math.max(r.from, e.cell);
      also.push(r.id);
      if (n > bestN) { bestN = n; best = r; }
    }
    e.region = best ? best.id : regionAt(regions, e.cell + (e.K >> 1)).id; regOfNext = e.region;
    e.also = also.filter((id) => id !== e.region);
  }
}
const stretches = [];
for (const e of events) {
  const last = stretches[stretches.length - 1];
  if (last && last.region === e.region) { last.to = e.off + e.len; last.events++; if (e.kind !== 2) last.cells += e.K; if (e.kind === 0) last.blocks++; }
  else stretches.push({ region: e.region, from: e.off, to: e.off + e.len, events: 1, cells: e.kind !== 2 ? e.K : 0, blocks: e.kind === 0 ? 1 : 0, also: new Set() });
  if (e.also) for (const id of e.also) stretches[stretches.length - 1].also.add(id);
}
const folded = [];
for (const s of stretches) {
  const r = regions[s.region], last = folded[folded.length - 1];
  if (r.kind === 'work' && last && s.to - s.from < 20000) { last.to = s.to; last.events += s.events; last.extra = (last.extra || 0) + s.cells; for (const id of s.also) last.also.add(id); continue; }
  folded.push(s);
}
const finalMoveFrom = events.length ? events[events.length - 1].off + events[events.length - 1].len : 0;
lap(`${stretches.length} stretches, ${folded.length} after folding; final move from ${num(finalMoveFrom)} (${num(META.writerBytes - finalMoveFrom)} characters)`);
for (const s of folded) { const k = regions[s.region].kind; kindChars[k] = (kindChars[k] || 0) + s.to - s.from; kindCells[k] = (kindCells[k] || 0) + s.cells; }

// ---- output
const arr = (a) => Array.from(a);
const trim = (h, lo) => { let a = 0, b = h.length - 1; while (a < b && !h[a]) a++; while (b > a && !h[b]) b--; return { from: a + lo, counts: arr(h.subarray(a, b + 1)) }; };

const RECORD = 32;
{
  const b = Buffer.alloc(events.length * RECORD);
  events.forEach((e, i) => {
    const o = i * RECORD;
    b.writeDoubleLE(e.off, o); b.writeUInt32LE(e.len, o + 8); b.writeUInt32LE(e.cell, o + 12); b.writeUInt32LE(e.K, o + 16);
    b.writeUInt8(e.kind, o + 20); b.writeUInt8(e.D || 0, o + 21); b.writeUInt8(e.kind === 0 ? e.rad : 255, o + 22); b.writeUInt8(Math.min(255, e.f || 0), o + 23);
    b.writeInt32LE(e.m || 0, o + 24);
  });
  fs.writeFileSync(path.join(DATA, 'blocks.bin'), b);
}
lap('blocks.bin written');

// ---- sample blocks: their whole text and the values they must produce
const samples = [];
{
  const blocks = events.filter((e) => e.kind === 0);
  const inKind = (kind, layer) => blocks.filter((e) => { const r = regions[e.region]; return r.kind === kind && (layer === undefined || r.layer === layer); });
  const pick = (list, f) => list.length ? list.reduce((a, b) => (f(b) < f(a) ? b : a)) : null;
  const L = G.engine.a.layers, la = Math.min(5, L - 1), lb = Math.min(12, L - 1), nth = (list, i) => list[Math.min(i, list.length - 1)];
  const strip = (kind) => pick(blocks.filter((e) => [e.region, ...e.also].some((id) => regions[id].kind === kind && regions[id].layer === lb)), (e) => e.len);
  const want = [
    ['slots', 'Memory of the fixed opening lines, layer ' + (la + 1), pick(inKind('slots', la), (e) => -e.K)],
    ['qkv', 'Attention weights, layer 1', nth(inKind('qkv', 0), 10)],
    ['w13', 'Feed-forward weights, layer ' + (lb + 1), nth(inKind('w13', lb), 40)],
    ['cls', 'Output table, part 1 of ' + G.engine.nC, nth(inKind('cls', 0), 20)],
    ['emb', 'Table of word pieces', nth(inKind('emb'), 100)],
    ['tok', QWEN ? 'Vocabulary table: the joining rules of word pieces' : 'Vocabulary table: the text of word pieces', nth(inKind('toktable'), 30)],
    ...(QWEN ? [['bias', 'Strips of constants in layer ' + (lb + 1) + ': the block that holds the bias', strip('bias')], ['gain', 'Strips of constants in layer ' + (lb + 1) + ': the block that holds a gain strip', strip('gain')]] : []),
    ['tiny', 'The smallest block of the file', pick(blocks, (e) => e.len)],
    ['deep', 'The block with the most digit positions', pick(blocks, (e) => -e.D * 1e6 + e.K)],
  ];
  const fd = fs.openSync(FILE, 'r');
  for (const [id, title, e] of want) {
    if (!e) { console.log('no block for', id); continue; }
    const text = Buffer.alloc(e.len); fs.readSync(fd, text, 0, e.len, e.off);
    const r = regions[e.region];
    const offset = WK.includes(r.kind) ? OFFW : r.kind === 'emb' || r.kind === 'cls' ? OFFE : null;
    const s = { id, title, offset, also: (e.also || []).map((i2) => regions[i2].kind), index: events.indexOf(e), off: e.off, len: e.len, cell: e.cell, K: e.K, D: e.D, R: e.R, m: e.m, b: e.b, b0: e.b0, f: e.f, fix: e.fix, kind: r.kind, layer: r.layer, text: text.toString('latin1'), values: arr(tape.subarray(e.cell, e.cell + e.K)).map((v) => v | 0) };
    fs.writeFileSync(path.join(DATA, 'block-' + id + '.json'), JSON.stringify(s));
    samples.push({ id, title, off: e.off, len: e.len, cell: e.cell, K: e.K, D: e.D, R: e.R, m: e.m, kind: r.kind, layer: r.layer });
    console.log(`  sample ${id}: block at ${num(e.off)}, ${num(e.len)} characters, ${e.K} cells, ${e.D} planes, radices ${e.R.join(',') || '-'}, centre ${e.m}, start ${e.b} (${e.b0} x ${e.f}^2), fix ${e.fix}`);
  }
  fs.closeSync(fd);
}

const sizes = events.filter((e) => e.kind === 0).map((e) => e.K);
const out = {
  made: 'tools/map-data/writer.js', model: MODEL.id, modelName: MODEL.name, file: MODEL.web,
  program: { memoryBits: META.memoryBits || 32, replacesDataBytes: META.replacesDataBytes, chars: META.programBytes, writer: META.writerBytes, engine: META.restBytes, sha256: META.sha256, tape: META.tapeSize, pointerAfterWriting: META.pointerAfterWriting },
  counts: { order: COMMANDS, writer: arr(countW), engine: arr(countE), maxDepthWriter: maxDepthW, maxDepthEngine: maxDepthE, longestRunLeft: longRunLT },
  profile: { bins: PROF, charsPerBin: per, shares: arr(prof).map((v) => Math.round(255 * v / per)) },
  encoder: { ...META.encoder, radices: undefined, planes: undefined, planeCells: META.encoder.planes, radixCells: META.encoder.radices },
  tape: { nonZero, entropyBitsPerCell: entropyBits / nonZero, entropyBits, floorCharsAt3Bits: entropyBits / 3, plainCounting: unary, weightOffset: OFFW, embOffset: OFFE },
  digits: { lower: trim(digitHist, -20), top: trim(topHist, -40), charsPerCell: trim(perCell, 0) },
  weights: { kinds: WK, hist: Object.fromEntries(WK.map((k) => [k, trim(whist[k], -OFFW)])), emb: { ...trim(embHist, -400), unit: EUNIT, min: embMin, max: embMax } },
  blocks: { events: events.length, blocks: sizes.length, record: RECORD, radKeys, medianCells: sizes.slice().sort((a, b) => a - b)[sizes.length >> 1], full: sizes.filter((k) => k === 8192).length },
  regions: regions.map((r) => ({ ...r, id: undefined, cells: undefined, nonZero: regionStats[r.id].nonZero })),
  stretches: folded.map((s) => [s.region, s.from, s.to, s.cells, s.blocks, [...s.also].filter((id) => id !== s.region)]),
  kindChars, kindCells,
  finalMove: { from: finalMoveFrom, chars: META.writerBytes - finalMoveFrom },
  samples,
};
fs.writeFileSync(path.join(DATA, 'writer.json'), JSON.stringify(out));
lap('writer.json written (' + num(fs.statSync(path.join(DATA, 'writer.json')).size) + ' bytes)');
