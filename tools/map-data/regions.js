'use strict';
// Where everything lives on the tape, as a sorted list of named ranges of real cells.

function tapeRegions(E, layout) {
  const { N, M, Lo, a } = E, T = a.maxTokens, dim = a.dim, tok = layout.tok, qwen = tok.BSZ !== undefined;
  const raw = [];
  const add = (kind, layer, vlo, vhi, extra = {}) => raw.push({ kind, layer, from: N - vhi, to: N - vlo + 1, ...extra });
  const P = (l) => E.P0 + l * E.stride, chunkQ = (c) => E.PL + c * E.CST;
  for (let c = 0; c < E.nC; c++) add('cls', c, chunkQ(c) + M.cls.G + 1, chunkQ(c) + M.cls.G + dim * (a.chunk + 1), { rows: a.chunk, cols: dim });
  for (let l = 0; l < a.layers; l++) {
    for (const [kind, o, m] of [['qkv', 0, M.qkv], ['o', Lo.oO, M.o], ['w13', Lo.o13, M.w13], ['w2', Lo.o2, M.w2]]) add(kind, l, P(l) + o + m.G + 1, P(l) + o + m.G + m.C * (m.R + 1), { rows: m.R, cols: m.C });
    add('slots', l, P(l) + Lo.dock + E.SS, P(l) + Lo.dock + (T + 1) * E.SS - 1, { slot: E.SS, slots: T });
    if (qwen) {
      // The strips of constants of the Qwen engine (compiler/qwen/engine/gen.js layout(): constRanges).
      const kv = E.kv, pre = E.pre, strip = (kind, o, n, what) => add(kind, l, P(l) + o, P(l) + o + n - 1, { n, what });
      strip('bias', Lo.Abias, dim + 2 * kv, 'qkv');
      strip('scale', Lo.Adr, dim + 2 * kv, 'qkv'); strip('scale', Lo.Cdr, 2 * a.hidden, 'w13');
      strip('scale', Lo.preB + pre.dr, dim, 'o'); strip('scale', Lo.preD + pre.dr, dim, 'w2');
      strip('gain', Lo.preB + pre.g, dim, 'ffn'); strip('gain', Lo.preD + pre.g, dim, 'next');
    }
  }
  if (qwen) add('gain', 0, E.P0 - E.PRE + E.pre.g, E.P0 - E.PRE + E.pre.g + dim - 1, { n: dim, what: 'first' });
  add('emb', -1, E.E + M.emb.G + 1, E.E + M.emb.G + dim * (a.vocab + 1), { rows: a.vocab, cols: dim });
  add('glob', -1, 0, E.E - 1);
  // the tokenizer, in real addresses already
  if (qwen) {
    raw.push({ kind: 'tokbytes', layer: -1, from: tok.base, to: tok.BH + 8, records: tok.byteRecs });
    raw.push({ kind: 'tokids', layer: -1, from: tok.BH + 8, to: tok.T0 + tok.BSZ });
    raw.push({ kind: 'toktable', layer: -1, from: tok.T0 + tok.BSZ, to: layout.tapeSize, records: tok.slots, record: 3, block: tok.BSZ, blocks: tok.blocks });
  } else {
    raw.push({ kind: 'tokbytes', layer: -1, from: tok.base, to: tok.RD });
    raw.push({ kind: 'tokids', layer: -1, from: tok.RD, to: tok.T0 + tok.H });
    raw.push({ kind: 'toktable', layer: -1, from: tok.T0 + tok.H, to: layout.tapeSize, records: tok.records, record: tok.SS });
  }
  raw.sort((x, y) => x.from - y.from);
  const out = [];
  let at = 0;
  for (const r of raw) {
    if (r.from < at) throw new Error('regions overlap at ' + r.from);
    if (r.from > at) out.push({ kind: 'work', layer: -1, from: at, to: r.from });
    out.push(r); at = r.to;
  }
  if (at < layout.tapeSize) out.push({ kind: 'work', layer: -1, from: at, to: layout.tapeSize });
  // a work stretch belongs to the layer / chunk of its neighbours when they agree
  out.forEach((r, i) => {
    if (r.kind === 'work') { const a1 = out[i - 1], b1 = out[i + 1]; if (a1 && b1 && a1.layer === b1.layer && isLayer(a1.kind) && isLayer(b1.kind)) r.layer = a1.layer; }
    r.cells = r.to - r.from; r.id = i;
  });
  return out;
}
const isLayer = (k) => k === 'qkv' || k === 'o' || k === 'w13' || k === 'w2' || k === 'slots' || k === 'bias' || k === 'scale' || k === 'gain';

function regionAt(regions, cell) {
  let lo = 0, hi = regions.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (regions[mid].from <= cell) lo = mid; else hi = mid - 1; }
  return regions[lo];
}

module.exports = { tapeRegions, regionAt };
