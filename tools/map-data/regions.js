'use strict';
// Where everything lives on the tape, as a sorted list of named ranges of real cells.

// The layers of the Qwen3.5 engine (compiler/qwen3.5/engine/gen.js layout() and the resting() of its two mixers):
// a DeltaNet layer or an attention layer, then the feed-forward part that both have.
function layers35(E, add) {
  const { M, a, pre } = E, dim = a.dim, T = a.maxTokens;
  const mat = (kind, l, at, m) => add(kind, l, at + m.G + 1, at + m.G + m.C * (m.R + 1), { rows: m.R, cols: m.C });
  for (let l = 0; l < a.layers; l++) {
    const P = E.Pof(l), Lo = E.Lt[a.types[l]], strip = (kind, o, n, what) => add(kind, l, P + o, P + o + n - 1, { n, what });
    if (Lo.kind === 'lin') {
      const { nv, dk, dv, kernel, convDim, valueDim } = a, { ro, co, CS, RS } = Lo, R0 = P + Lo.R0;
      mat('lin', l, P, Lo.Min); mat('lino', l, P + Lo.oO, Lo.Mo);
      strip('scale', Lo.Ddr, Lo.Min.R, 'lin'); strip('scale', Lo.mix + pre.dr, dim, 'lino');
      strip('conv', Lo.CW, kernel * convDim, 'weights'); strip('convwin', Lo.WIN, (kernel - 1) * convDim, 'window');
      strip('dconst', Lo.DT, nv, 'dt'); strip('dconst', Lo.LA, nv, 'loga');
      for (let h = 0; h < nv; h++) {
        const R = R0 + h * RS;
        add('dscale', l, R + ro.D, R + ro.D, { n: 1, head: h });
        add('state', l, R + ro.C0, R + ro.C0 + (dk - 1) * CS + co.S + dv - 1, { head: h, rows: dv, cols: dk, colStride: CS, numbers: dk * dv });
      }
      add('gain', l, R0 + nv * RS + ro.GN, R0 + nv * RS + ro.GN + valueDim - 1, { n: valueDim, what: 'gated' });
    } else {
      mat('qkv', l, P, Lo.Min); mat('o', l, P + Lo.oO, Lo.Mo);
      strip('scale', Lo.Adr, Lo.R, 'qkv'); strip('scale', Lo.mix + pre.dr, dim, 'o');
      strip('gain', Lo.Agn, Lo.W, 'qk');
      add('slots', l, P + Lo.dock + Lo.SS, P + Lo.dock + (T + 1) * Lo.SS - 1, { slot: Lo.SS, slots: T });
    }
    mat('w13', l, P + Lo.o13, M.w13); mat('w2', l, P + Lo.o2, M.w2);
    strip('scale', Lo.Cdr, 2 * a.hidden, 'w13'); strip('scale', Lo.preD + pre.dr, dim, 'w2');
    strip('gain', Lo.preB + pre.g, dim, 'ffn'); strip('gain', Lo.preD + pre.g, dim, 'next');
  }
}

// The vision part of the picture program (compiler/qwen3.5/vision/gen.js layout() and resting()): the queue of the
// squares' positions, the patch embedding, 12 layers of its own, the merger and the queue of the vectors it hands the
// text model. Its kinds start with v; its strips of constants are those of the text layers.
function vision(vp, add) {
  const x = vp.x, { Lo, M, pre, PRE, SS } = x, { dim, hidden } = vp.va, N = vp.N, L = -2;          // layer -2: the picture part as a whole
  const mat = (kind, l, org, m) => add(kind, l, org + m.G + 1, org + m.G + m.C * (m.R + 1), { rows: m.R, cols: m.C });
  const strip = (kind, l, at, n, what) => add(kind, l, at, at + n - 1, { n, what, vision: true });
  add('vpos', L, vp.SQ, vp.SQ + (N + 2) * vp.QS - 1, { squares: N, entry: vp.QS });
  mat('vpatch', L, vp.org, vp.Mp);
  strip('gain', L, vp.P0 - PRE + pre.g, dim, 'vfirst'); strip('scale', L, vp.P0 - PRE + pre.dr, dim, 'vpatch');
  for (let l = 0; l < vp.depth; l++) {
    const P = vp.Pof(l), v = 100 + l;                     // layer 100 + l: layer l of the picture part
    mat('vqkv', v, P, M.qkv); mat('vo', v, P + Lo.oO, M.o); mat('vw13', v, P + Lo.o13, M.w13); mat('vw2', v, P + Lo.o2, M.w2);
    strip('bias', v, P + Lo.Abias, M.qkv.R, 'vqkv'); strip('scale', v, P + Lo.Adr, M.qkv.R, 'vqkv');
    strip('scale', v, P + Lo.Cdr, hidden, 'vw13'); strip('bias', v, P + Lo.Cb, hidden, 'vw13');
    for (const [s, what] of [[P + Lo.preB, 'vffn'], [P + Lo.preD, 'vnext']]) { strip('gain', v, s + pre.g, dim, what); strip('scale', v, s + pre.dr, dim, what === 'vffn' ? 'vo' : 'vw2'); strip('bias', v, s + pre.b, dim, what === 'vffn' ? 'vo' : 'vw2'); }
    add('vslots', v, P + Lo.dock, P + Lo.dock + (N + 2) * SS - 1, { slot: SS, slots: N });
  }
  mat('vm1', L, vp.PM, vp.Mm1); mat('vm2', L, vp.orgM2, vp.Mm2);
  strip('scale', L, vp.A1.dr, vp.wide, 'vm1'); strip('bias', L, vp.A1.b, vp.wide, 'vm1');
  strip('scale', L, vp.A2.dr, vp.out, 'vm2'); strip('bias', L, vp.A2.b, vp.out, 'vm2');
  add('vqueue', L, vp.IQ, vp.IQ + (N / vp.G + 2) * vp.IS - 1, { vectors: N / vp.G, entry: vp.IS });
}

function tapeRegions(E, layout) {
  const { N, M, Lo, a } = E, T = a.maxTokens, dim = a.dim, tok = layout.tok, qwen = tok.BSZ !== undefined;
  const raw = [];
  const add = (kind, layer, vlo, vhi, extra = {}) => raw.push({ kind, layer, from: N - vhi, to: N - vlo + 1, ...extra });
  const P = (l) => E.P0 + l * E.stride, chunkQ = (c) => E.PL + c * E.CST;
  for (let c = 0; c < E.nC; c++) add('cls', c, chunkQ(c) + M.cls.G + 1, chunkQ(c) + M.cls.G + dim * (a.chunk + 1), { rows: a.chunk, cols: dim });
  if (E.Lt) layers35(E, add);
  else for (let l = 0; l < a.layers; l++) {
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
  if (E.vp) vision(E.vp, add);
  if (qwen) add('gain', 0, E.P0 - E.PRE + E.pre.g, E.P0 - E.PRE + E.pre.g + dim - 1, { n: dim, what: 'first' });
  add('emb', -1, E.E + M.emb.G + 1, E.E + M.emb.G + dim * (a.vocab + 1), { rows: a.vocab, cols: dim });
  add('glob', -1, 0, E.E - 1);
  // the tokenizer, in real addresses already
  if (qwen) {
    raw.push({ kind: 'tokbytes', layer: -1, from: tok.base, to: tok.BH + 8, records: tok.byteRecs });
    raw.push({ kind: 'tokids', layer: -1, from: tok.BH + 8, to: tok.T0 + tok.BSZ });
    raw.push({ kind: 'toktable', layer: -1, from: tok.T0 + tok.BSZ, to: E.vp ? tok.tapeSize : layout.tapeSize, records: tok.slots, record: 3, block: tok.BSZ, blocks: tok.blocks });      // (the picture program: the vision part after it)
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
const LAYER_KINDS = new Set(['qkv', 'o', 'w13', 'w2', 'slots', 'bias', 'scale', 'gain', 'lin', 'lino', 'conv', 'convwin', 'dconst', 'dscale', 'state', 'vqkv', 'vo', 'vw13', 'vw2', 'vslots', 'vpatch', 'vm1', 'vm2', 'vpos', 'vqueue']);
const isLayer = (k) => LAYER_KINDS.has(k);

function regionAt(regions, cell) {
  let lo = 0, hi = regions.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (regions[mid].from <= cell) lo = mid; else hi = mid - 1; }
  return regions[lo];
}

module.exports = { tapeRegions, regionAt };
