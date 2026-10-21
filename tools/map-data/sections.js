'use strict';
// The engine part of a program, cut into its named sections: engine.json.
const fs = require('fs');
const path = require('path');
const { build, sections } = require('./instrument');
const { modelOf, commandIndex } = require('./models');

const MODEL = modelOf(process.argv[2]), META = MODEL.meta, QWEN = MODEL.family !== 'smol', Q35 = MODEL.family === 'qwen3.5';
const G = build(MODEL.id), L = G.loadSrc.length, base = META.writerBytes;
const rest = MODEL.readEngine(G);

const secs = sections(G);
// nesting depth at every section start, and statistics per section
let depth = 0, at = 0;
const depthChars = new Float64Array(64);
for (const s of secs) {
  s.depthAtStart = depth; s.counts = new Array(8).fill(0); s.maxDepth = depth; s.loops = 0; s.longestMove = 0;
  let run = 0;
  for (; at < s.to; at++) {
    const c = commandIndex[rest[at]];
    s.counts[c]++;
    if (c === 4) { depth++; s.loops++; if (depth > s.maxDepth) s.maxDepth = depth; } else if (c === 5) depth--;
    if (c === 2 || c === 3) { if (++run > s.longestMove) s.longestMove = run; } else run = 0;
    depthChars[depth]++;
  }
}
const KEEP = new Set(['sweep', 'unsweep', 'sweepEmb', 'slide', 'stripRight', 'stripRight4', 'mul', 'bitCount', 'rqN', 'rqSplit', 'switchTree', 'lookupBig', 'peel', 'lookup', 'mulAcc', 'requantCore']);
const marks = G.marks.filter((m) => (m.kind === 'tok' || (m.kind === 'idiom' && KEEP.has(m.name))) && m.from >= L && m.to - m.from >= 300)
  .sort((a, b) => a.from - b.from || b.to - a.to)
  .map((m) => ({ name: m.name, from: base + m.from - L, to: base + m.to - L, info: m.info || undefined }));
// how often each shape occurs, the short ones too
const shapes = {};
for (const m of G.marks) if (m.kind === 'idiom' && m.from >= L) { const s = shapes[m.name] || (shapes[m.name] = { count: 0, chars: 0 }); s.count++; s.chars += m.to - m.from; }

const hot = {};
for (const s of secs) {
  if (!/^(ud.)?sweep|^cls$/.test(s.id)) continue;
  const m = /\[[<>]*\[[-+<>]+\][<>]*\[[-+<>]+\][<>]*\]/.exec(rest.toString('latin1', s.from, s.to));
  if (m) hot[s.id] = { from: base + s.from + m.index, len: m[0].length };
}

const E = G.engine, a = E.a, tok = G.layout.tok;
// the vision part of the picture program (compiler/qwen3.5/vision/gen.js): its sizes and where it lies on the tape
function visionOf(vp, layout) {
  const V = vp.V, x = vp.x, mat = (m) => ({ rows: m.R, cols: m.C, bits: m.nb || null });
  return {
    dim: V.dim, hidden: V.hidden, heads: V.heads, headSize: V.headSize, layers: vp.depth, out: vp.out, patch: V.P, merge: V.merge,
    squares: vp.N, perVector: vp.G, vectors: vp.N / vp.G, squareBytes: vp.inN, slotSize: x.SS, layerStride: x.stride, imageToken: V.imageToken,
    matrices: { qkv: mat(x.M.qkv), o: mat(x.M.o), w13: mat(x.M.w13), w2: mat(x.M.w2), patch: mat(vp.Mp), m1: mat(vp.Mm1), m2: mat(vp.Mm2) },
    from: layout.visionReal[0], to: layout.visionReal[1] + 1,
  };
}
const hopSec = secs.find((s) => s.id === 'hop' || s.id === 'u3.hop');
// Qwen3.5: the attention layer of the group holds the slots, a DeltaNet layer its own state
const AL = Q35 ? E.Lt.att : E.Lo, SS = Q35 ? AL.SS : E.SS, SO = Q35 ? AL.so : E.so, KV = Q35 ? a.kvHeads * a.headSize : E.kv;
const out = {
  made: 'tools/map-data/sections.js', model: MODEL.id, family: MODEL.family,
  from: base, chars: rest.length, oldProgramChars: G.src ? G.src.length : G.length, oldLoadChars: L,
  comma: base + rest.indexOf(','), dot: base + rest.indexOf('.'),
  commas: rest.filter((c) => c === 44).length, dots: rest.filter((c) => c === 46).length,
  commaAll: (() => { const all = []; for (let i = rest.indexOf(44); i >= 0; i = rest.indexOf(44, i + 1)) all.push(base + i); return all; })(),
  sections: secs.map((s) => ({ id: s.id, ...(s.key ? { key: s.key, u: s.u, layerKind: s.layerKind } : {}), from: base + s.from, to: base + s.to, counts: s.counts, depthAtStart: s.depthAtStart, maxDepth: s.maxDepth, loops: s.loops, longestMove: s.longestMove })),
  depthChars: Array.from(depthChars.subarray(0, depthChars.findLastIndex((v) => v > 0) + 1)),
  marks, shapes, hot,
  slot: { size: SS, kv: KV, fields: SO, headFrame: 32 },
  model: {
    name: MODEL.name, dim: a.dim, layers: a.layers, heads: a.heads, kvHeads: a.kvHeads, headSize: a.headSize, hidden: a.hidden, vocab: a.vocab, chunk: a.chunk, chunks: E.nC, maxTokens: a.maxTokens, weightBits: a.cfg.weightBits,
    kv: KV, share: a.heads / a.kvHeads, stops: a.stops || null, embBits: a.cfg.embBits || null, xBits: a.cfg.xBits || null, biasBits: a.cfg.biasBits || null, gainBits: a.cfg.gainBits || null,
    tables: a.tables ? Object.fromEntries(Object.entries(a.tables).filter(([, v]) => v && v.length).map(([k, v]) => [k, v.length])) : null,
    ...(Q35 ? {
      types: a.types, unit: a.unit, groups: a.groups, qDim: a.qDim, rotDim: a.rotDim,
      deltanet: { keyHeads: a.nk, valueHeads: a.nv, keySize: a.dk, valueSize: a.dv, kernel: a.kernel, keyDim: a.keyDim, valueDim: a.valueDim, convDim: a.convDim, stateNumbers: a.nv * a.dk * a.dv, columnCells: E.Lt.lin.CS, column: E.Lt.lin.co, headCells: E.Lt.lin.RS, stateBits: a.cfg.sBits },
    } : {}),
    ...(E.vp ? { vision: visionOf(E.vp, G.layout) } : {}),
  },
  matrices: Object.fromEntries(Object.entries(Q35 ? { lin: E.Lt.lin.Min, lino: E.Lt.lin.Mo, qkv: E.Lt.att.Min, o: E.Lt.att.Mo, ...E.M } : E.M).map(([k, m]) => [k, { rows: m.R, cols: m.C, bits: m.nb || null }])),
  hop: { cells: QWEN ? AL.HL : null, longest: hopSec ? hopSec.longestMove : null },
  layout: QWEN
    ? { N: E.N, tapeSize: G.layout.tapeSize, layerStride: Q35 ? null : E.stride, groupStride: Q35 ? E.GS : undefined, slotSize: SS, chunkStride: E.CST, weightCells: G.layout.weightCells, tokBase: tok.base, tokRecords: tok.slots, tokRecord: 3, tokHop: tok.U, tokBlock: tok.BSZ, tokBlocks: tok.blocks, tokLongHop: tok.SB, tokByteRecords: tok.byteRecs, maxQuestion: tok.maxChars }
    : { N: E.N, tapeSize: G.layout.tapeSize, layerStride: E.stride, slotSize: E.SS, chunkStride: E.CST, weightCells: G.layout.weightCells, tokBase: tok.base, tokRecords: tok.records, tokRecord: tok.SS, tokHop: tok.U, maxQuestion: tok.maxChars },
};
fs.writeFileSync(path.join(MODEL.dir, 'engine.json'), JSON.stringify(out));
console.log(`engine.json: ${secs.length} sections, ${marks.length} marks; ',' at ${out.comma}, '.' at ${out.dot}`);
for (const s of out.sections) console.log(`  ${s.id.padEnd(8)} ${String(s.to - s.from).padStart(9)} chars  depth ${s.depthAtStart}..${s.maxDepth}  loops ${s.loops}  longest walk ${s.longestMove}  moves ${Math.round(100 * (s.counts[2] + s.counts[3]) / (s.to - s.from))}%`);
