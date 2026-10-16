'use strict';

// A SMALL random model with the shapes and value ranges of Qwen3.5-0.8B, for testing the engine quickly.
// It has the interface of openWeights() in ../float.js: the shape fields, tensor(kind, l) as floats,
// raw(kind, l) as bfloat16 bits of the same values, close(). So float.js runs it as it is:
//   const F = require('../reference/float'), m = F.modelFrom(synthModel(1)); F.generateIds(m, [1, 2, 3], 8, []);
// size: { dim, hidden, layers, types, heads, kvHeads, headSize, rotDim, nk, nv, dk, dv, kernel, vocab,
//         maxPos, theta, eps, tied, hot } (hot > 1: larger weights, so that values hit their clamps)

// value -> bfloat16 bits, rounded to nearest, ties to even (as torch)
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
function bf16(v) {
  f32[0] = v;
  const b = u32[0];
  if ((b & 0x7fffffff) > 0x7f800000) return 0x7fc0; // NaN
  return ((b + 0x7fff + ((b >>> 16) & 1)) >>> 16) & 0xffff;
}
const fromBf16 = (h) => { u32[0] = h << 16; return f32[0]; };

function synthModel(seed = 1, size = {}) {
  let s = seed >>> 0;
  const rnd = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const gauss = () => { let a = 0; for (let i = 0; i < 6; i++) a += rnd(); return (a - 3) * 1.41; };
  const {
    dim = 32, hidden = 48, layers = 4, heads = 2, kvHeads = 1, headSize = 16, rotDim = 4,
    nk = 2, nv = 2, dk = 8, dv = 8, kernel = 4, vocab = 64, maxPos = 32, theta = 1e7, eps = 1e-6, tied = true, hot = 1,
  } = size;
  // three Gated DeltaNet layers, then one full attention layer, as the real models
  const types = size.types || Array.from({ length: layers }, (_, l) => (l % 4 === 3 ? 'att' : 'lin'));
  if (types.length !== layers) throw new Error('types needs one entry per layer');
  if (nv % nk) throw new Error('nv must be a multiple of nk');
  if (rotDim % 2 || rotDim > headSize) throw new Error('rotDim must be even and at most headSize');
  const shape = {
    dim, hidden, layers, vocab, eps, types,
    heads, kvHeads, headSize, kvDim: kvHeads * headSize, rotDim, theta, maxPos,
    nk, nv, dk, dv, kernel, tied,
  };
  shape.keyDim = nk * dk; shape.valueDim = nv * dv; shape.convDim = 2 * shape.keyDim + shape.valueDim;
  shape.freq = Float64Array.from({ length: rotDim / 2 }, (_, f) => Math.pow(theta, -(2 * f) / rotDim));
  const { keyDim, valueDim, convDim, kvDim } = shape, qDim = heads * headSize;

  // a matrix whose rows have very different sizes: out = rows of about `out` for inputs of about `inp`,
  // some rows 20 times smaller, some 3 to 5 times larger, one in eight columns near zero
  const mat = (rows, cols, out, inp) => {
    const W = new Float32Array(rows * cols), sd = (out * hot) / (inp * Math.sqrt(cols));
    for (let r = 0; r < rows; r++) {
      const f = sd * [1, 1, 0.3, 2.5, 1, 4, 0.05, 1][Math.floor(rnd() * 8)];
      for (let c = 0; c < cols; c++) W[r * cols + c] = gauss() * f * (c % 8 === 5 ? 0.02 : 1);
    }
    return W;
  };
  const between = (n, lo, hi) => Float32Array.from({ length: n }, () => lo + (hi - lo) * rnd());
  // gains stored around 0 (the model scales by 1 + w): a few switched off (w = -1), a few large
  const gain = (n, big) => Float32Array.from({ length: n }, (_, i) =>
    (i % 11 === 3 ? -1 : i % 13 === 5 ? big * (0.6 + 0.4 * rnd()) : i % 17 === 7 ? -0.6 : -0.3 + 1.3 * rnd()));

  const T = { L: [] };
  // embeddings |e| <= 0.15: most rows small, some tiny, a few with one large entry of either sign
  T.emb = Float32Array.from({ length: vocab * dim }, () => gauss() * 0.025);
  for (let t = 0; t < vocab; t++) {
    const f = t % 5 === 0 ? 0.05 : t % 7 === 0 ? 2.2 : 1;
    for (let i = 0; i < dim; i++) T.emb[t * dim + i] = Math.max(-0.15, Math.min(0.15, T.emb[t * dim + i] * f));
    if (t % 9 === 4) T.emb[t * dim + (t % dim)] = (t % 2 ? 1 : -1) * (0.1 + 0.05 * rnd());
  }
  if (!tied) T.cls = mat(vocab, dim, 0.12, 1);
  T.rmsFinal = gain(dim, 14).map((w, i) => (i % 11 === 3 ? w : w + 6)); // the logits reach tens
  for (let l = 0; l < layers; l++) {
    const v = [1, 0.6, 1.6][l % 3], L = {};
    // a layer's normalised input reaches about 34
    L.rmsAtt = gain(dim, 8); L.rmsFfn = gain(dim, 4);
    L.w1 = mat(hidden, dim, 0.6 * v, 1.5); L.w3 = mat(hidden, dim, 0.5 / v, 1.5); L.w2 = mat(dim, hidden, 0.5 * v, 2);
    if (types[l] === 'att') {
      L.wq = mat(2 * qDim, dim, 0.8, 1.5); L.wk = mat(kvDim, dim, 3, 1.5); L.wv = mat(kvDim, dim, 1.8 * v, 1.5);
      L.wo = mat(dim, qDim, 0.6, 3);
      L.qNorm = gain(headSize, 3); L.kNorm = gain(headSize, 3);
    } else {
      // queries and keys large (only their direction counts), values small
      L.wqkv = new Float32Array(convDim * dim);
      L.wqkv.set(mat(2 * keyDim, dim, 3.5 * v, 1.5)); L.wqkv.set(mat(valueDim, dim, 0.4 * v, 1.5), 2 * keyDim * dim);
      const loud = 2 * keyDim + dv - 1; // one value channel three times larger, with the largest tap
      for (let c = 0; c < dim; c++) L.wqkv[loud * dim + c] *= 3;
      L.wz = mat(valueDim, dim, 1, 1.5);
      L.wa = mat(nv, dim, 1, 1.5); L.wb = mat(nv, dim, 2.5, 1.5); L.wout = mat(dim, valueDim, 0.3 * v, 3);
      // [convDim, kernel]: the last tap (the token itself) the largest; |w| <= 1.8, the largest on query and key channels
      L.conv = Float32Array.from({ length: convDim * kernel }, (_, i) => {
        const tap = i % kernel, ch = Math.floor(i / kernel), qk = ch < 2 * keyDim;
        const w = ((qk && ch % 7 === 2) || ch === 2 * keyDim + dv - 1) && tap === kernel - 1 ? 1.8 * (ch % 2 ? -1 : 1) : gauss() * (tap === kernel - 1 ? (qk ? 0.6 : 0.35) : qk ? 0.25 : 0.12);
        return Math.max(-1.8, Math.min(1.8, w));
      });
      L.aLog = between(nv, -3, 2); L.dtBias = between(nv, -7, 5);
      if (nv > 1) { L.aLog[0] = -3; L.dtBias[nv - 1] = 5; } // the slowest and the fastest forgetting
      L.gNorm = between(dv, 0.4, 1.2);
    }
    T.L.push(L);
  }

  // every value rounded to bfloat16 once, so that tensor() and raw() agree
  const bits = new Map(), floats = new Map();
  const key = (kind, l) => (l === undefined ? kind : kind + '.' + l);
  const lookup = (kind, l) => {
    if (kind === 'cls' && tied) kind = 'emb';
    const t = ['emb', 'cls', 'rmsFinal'].includes(kind) ? T[kind] : T.L[l] && T.L[l][kind];
    if (!t) throw new Error(`no tensor ${kind} in layer ${l} (${l === undefined ? '' : types[l]})`);
    const k = key(kind, ['emb', 'cls', 'rmsFinal'].includes(kind) ? undefined : l);
    if (!bits.has(k)) {
      const b = Uint16Array.from(t, bf16);
      bits.set(k, b);
      floats.set(k, Float32Array.from(b, fromBf16));
    }
    return k;
  };
  const raw = (kind, l) => bits.get(lookup(kind, l)).slice();
  const tensor = (kind, l) => floats.get(lookup(kind, l)).slice();
  return { ...shape, shape, raw, tensor, close: () => {} };
}

// The synth model as float.js's loadModel gives it.

module.exports = { synthModel, bf16, fromBf16 };
