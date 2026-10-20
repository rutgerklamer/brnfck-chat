'use strict';

// THE SPEC of the brainfuck engine for Qwen3.5 (model_type qwen3_5): the whole model in whole numbers.
// Every value is an integer with a fixed number of fraction bits, every product and sum is what a wrapping
// 32-bit cell holds, every function is a table. The engine (gen.js) computes exactly these numbers.
//
// Three of every four layers are a Gated DeltaNet (deltanet.js one folder up, with these changes:
// the state is folded by a power of two, roundings that cannot overflow wrap instead of clamping),
// the fourth is full attention with an output gate. Rounding helpers, the residual norm, the feed-forward
// layer and the output layer are those of compiler/qwen/engine/spec.js.

const Q = require('../../qwen/engine/spec');

const DEFAULTS = {
  weightBits: 10,    // weights in this many bits, sign included; every matrix row has its own power-of-two scale
  tops: { wqkv: 12, wz: 12, wa: 12, wb: 12, wout: 12, wq: 12, wk: 12, wv: 13, wo: 12, w1: 12, w3: 12, w2: 12 },
  EB: 12, embBits: 11,   // embedding table, also the output layer (|value| <= 0.153)
  XB: 14, xBits: 20,     // residual stream (|x| <= 8.4)
  NB: 8, nBits: 15,      // x / rms(x) (|value| < sqrt(1024) = 32)
  gainB: 8, gainBits: 14, // gains 1 + w of the norms (-0.02 .. 6.3)
  ngBits: 17,            // normalised residual times gain, NB fraction bits (|value| <= 39)
  invSize: 4096, invB: 11,
  LB: 8, logitBits: 16,  // output scores (|score| <= 37)
  maxTokens: 256,        // longest conversation

  // feed-forward (|gate|, |up| <= 13, |hidden| <= 28)
  GB: 7, gBits: 12, uBits: 12, HB: 8, hBits: 16,

  // Gated DeltaNet
  MB: 10, mixBits: 18,   // queries, keys, values before the convolution (|mix| <= 82)
  ZB: 10, zBits: 16,     // gate z of the output norm (|z| <= 16)
  AB: 6, aBits: 12,      // a, index of the log-softplus table with dt_bias (|a| <= 19)
  BB: 8, bBits: 14,      // b (|b| <= 27)
  CWB: 10,               // convolution weights (|w| <= 1.82)
  CB: 13, cBits: 20,     // after the convolution (and silu: |q|, |k|, |v| <= 19)
  sigIn: 8, sigRange: 16, SGB: 12, // sigmoid table: input at sigIn fraction bits over -sigRange .. sigRange, output SGB bits
  LDB: 6,                // log of the decay rate: lambda = log A + log softplus(a + dt), decay = exp(-exp(lambda))
  DB: 11,                // decay and the head scale D (D in 1/2 .. 1 is 2^(DB-1) .. 2^DB)
  TB: 7,                 // beta
  KB: 9,                 // unit keys
  QB: 14, qBits: 13,     // queries, of length 1/sqrt(dk)
  SB: 16, sBits: 24,     // state St, values at the scale of St, deltas
  OB: 19, oBits: 20,     // output of the state (|o| <= 0.54)
  YB: 12, yBits: 17,     // o normalised (|y| <= sqrt(dv))
  gnB: 10,               // gains of the output norm (0.35 .. 1.19)
  OHB: 10, ohBits: 18,   // input of out_proj: norm times silu(z) (|h| <= 41)

  // full attention
  QA: 10, qaBits: 17,    // q and k before their norm (|q| <= 15, |k| <= 37)
  GTB: 8, gtBits: 14,    // output gate before the sigmoid (|gate| <= 15)
  VB: 6, vBits: 13,      // values, mixed values and gated values (|v| <= 37)
  NHB: 10, nhBits: 16,   // q and k normalised, before the gain (|value| <= 16)
  QKB: 5, qkBits: 12,    // q and k after norm and gain (|value| <= 42)
  RB: 8,                 // sines and cosines of the rotation
  gapShift: 9, expSize: 256, attMax: 255, recipSize: 1024,
  scoreBits: 29,
};

const u32 = (v) => v >>> 0;                       // exact for |v| < 2^53
const bitlen = (v) => 32 - Math.clz32(v);

// rq32: what a 32-bit cell gives for round(v / 2^k), clamped to n bits; quantise: the weights per row (compiler/qwen/engine/spec.js).
const { rq32, quantise } = Q;
// rqWrap: the same without clamp, modulo 2^n. Here k + n > 32 throws: then the result is not what a cell holds,
// and the many settings of Qwen3.5 make that easy to get wrong.
function rqWrap(v, k, n, ...rest) {
  if (k + n > 32) throw new Error(`rqWrap: k + n = ${k + n} does not fit a cell`);
  return Q.rqWrap(v, k, n, ...rest);
}
const clampTo = (v, bits) => { const lim = 2 ** (bits - 1); return v < -lim ? -lim : v > lim - 1 ? lim - 1 : v; };

const POW2 = Float64Array.from({ length: 64 }, (_, i) => 2 ** i);
// y[r] = (W x)[r] * 2^d[r], exact in doubles; the cell holds it modulo 2^32
function matvec({ w: W, d }, x, rows, y, r0 = 0) {
  const cols = x.length, c4 = cols & ~3;
  for (let r = r0, at = r0 * cols; r < r0 + rows; r++, at += cols) {
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0, c = 0;
    for (; c < c4; c += 4) {
      s0 += W[at + c] * x[c];
      s1 += W[at + c + 1] * x[c + 1];
      s2 += W[at + c + 2] * x[c + 2];
      s3 += W[at + c + 3] * x[c + 3];
    }
    for (; c < cols; c++) s0 += W[at + c] * x[c];
    y[r - r0] = (s0 + s1 + s2 + s3) * POW2[d[r]];
  }
  return y;
}

// ---- normalising one vector (a head) ------------------------------------------------------
//
// out = x * c / sqrt(sum x^2 + e), n numbers at inB fraction bits, to outB fraction bits:
//   A = sum |x|; s = max(bits(A) - 19, sLo); w = round(x * 2^(11 - s) / 2^11)  (so that sum |w| < 2^19)
//   ss = sum round(w / 16)^2 + E[s]   (E[s] = e at the scale of the sum; s never goes so low that E[s] needs 29 bits)
//   D2 = the even shift that brings ss to 30 or 31 bits; T = table[top 12 bits of ss * 2^D2]
//   out = round(w * T * 2^(D2/2) / 2^(TB + 4 - outB))
const NK = 11;
function normPlan(n, c, inB, inBits, e, outB, outBits) {
  const TB = Math.min(Math.floor(11 + 14.5 - Math.log2(c)), 28 - outBits + outB); // |w * T| < 2^30.5, and the last rounding fits a cell
  const sLo = Math.ceil(inB - 4 - (29 - Math.log2(e)) / 2);
  const E = (s) => Math.round(e * 2 ** (2 * (inB - s - 4)));
  const K = TB + 4 - outB;
  if (K < 0 || K + outBits > 32) throw new Error(`normPlan: rounding k = ${K}, n = ${outBits} is not possible`);
  if (NK - sLo > 30) throw new Error('normPlan: too many doublings');
  return {
    n, inB, inBits, outB, outBits, TB, sLo, K,
    T: Array.from({ length: 4096 }, (_, i) => (i < 1024 ? 0 : Math.round((c * 2 ** TB) / Math.sqrt((i + 0.5) * 2 ** 19)))),
    // per number of bits of A (0 .. 30): the doublings of x and the eps term
    dbl: Array.from({ length: 31 }, (_, b) => NK - Math.max(b - 19, sLo)),
    eps: Array.from({ length: 31 }, (_, b) => E(Math.max(b - 19, sLo))),
  };
}
function normVec(x, at, NP, out, oat, w) {
  const { n, T, K, outBits } = NP;
  let A = 0;
  for (let i = at; i < at + n; i++) A += Math.abs(x[i]);
  const b = bitlen(A);
  if (b > 30) throw new Error('normVec: sum |x| beyond 2^30');
  const D = NP.dbl[b];
  let ss = NP.eps[b];
  for (let i = 0; i < n; i++) {
    w[i] = rqWrap(x[at + i] * 2 ** D, NK, 21);
    const u = rqWrap(w[i], 4, 17);
    ss += u * u;
  }
  const D2 = (31 - bitlen(ss)) & ~1, Ti = T[u32(ss * 2 ** D2) >>> 19];
  for (let i = 0; i < n; i++) out[oat + i] = rqWrap(Math.imul(w[i], Ti) * 2 ** (D2 / 2), K, outBits);
}

// ---- the tables (part of the program text) ----------------------------------------------------

const { MROPE } = require('../reference/float');
const angleOf = (rope, pos, f) => (rope ? rope[pos][MROPE[f]] : pos);

function makeTables(cfg, shape) {
  const { dim, headSize, rotDim, freq, dk, dv, eps } = shape;
  const { invSize, invB, GB, gBits, RB, gapShift, expSize, attMax, recipSize, QKB, maxTokens, sigIn, sigRange, SGB, AB, LDB, DB,
    CB, cBits, QB, KB, qBits, OB, oBits, YB, yBits, QA, qaBits, NHB, nhBits } = cfg;
  const gHalf = 2 ** (gBits - 1);
  const lamLo = -Math.ceil((DB + 1) * Math.LN2), lamHi = Math.ceil(Math.log((DB + 1) * Math.LN2));
  const decN = 2 ** Math.ceil(Math.log2((lamHi - lamLo) * 2 ** LDB));
  return {
    // the residual norm: sqrt(dim) * 2^invB / sqrt(i), i = top 12 bits of the normalised sum of squares
    inv: Array.from({ length: invSize }, (_, i) => (i ? Math.round((Math.sqrt(dim) * 2 ** invB) / Math.sqrt(i + 0.5)) : 0)),
    // silu(a) * 2^GB, indexed by a & (2^gBits - 1) (feed-forward)
    silu: Array.from({ length: 2 ** gBits }, (_, i) => {
      const a = (i < gHalf ? i : i - 2 ** gBits) / 2 ** GB;
      return Math.round((a / (1 + Math.exp(-a))) * 2 ** GB);
    }),
    // sigmoid(i / 2^sigIn - sigRange) * 2^SGB (DeltaNet: silu, beta; attention: the output gate)
    sig: Array.from({ length: 2 * sigRange * 2 ** sigIn }, (_, i) => Math.round(2 ** SGB / (1 + Math.exp(-(i / 2 ** sigIn - sigRange))))),
    // log(softplus(u)) * 2^LDB for u = i / 2^AB - 32
    lsp: Array.from({ length: 64 * 2 ** AB }, (_, i) => {
      const u = i / 2 ** AB - 32, sp = u > 20 ? u : Math.log1p(Math.exp(u));
      return Math.round(Math.log(sp) * 2 ** LDB);
    }),
    lamLo,
    // decay exp(-exp(lambda)) * 2^DB for lambda = i / 2^LDB + lamLo; index 0 (and below) is 1, the end 0
    dec: Array.from({ length: decN }, (_, i) => (i === 0 ? 2 ** DB : Math.round(2 ** DB * Math.exp(-Math.exp(i / 2 ** LDB + lamLo))))),
    // 2^(2 DB) / D for D = 2^(DB-1) + i (D = 1/2 .. 1)
    recipD: Array.from({ length: 2 ** DB }, (_, i) => (i <= 2 ** (DB - 1) ? Math.round(2 ** (2 * DB) / (i + 2 ** (DB - 1))) : 0)),
    normQ: normPlan(dk, 1 / Math.sqrt(dk), CB, cBits, 1e-6, QB, qBits),          // DeltaNet queries to length 1/sqrt(dk)
    normK: normPlan(dk, 1, CB, cBits, 1e-6, KB, KB + 2),                         // DeltaNet keys to length 1
    normY: normPlan(dv, Math.sqrt(dv), OB, oBits, dv * eps, YB, yBits),          // rms norm of the DeltaNet output
    normH: normPlan(headSize, Math.sqrt(headSize), QA, qaBits, headSize * eps, NHB, nhBits), // rms norm of attention q and k per head
    // attention weight as a function of (best score - this score) >> gapShift
    exp: Array.from({ length: expSize }, (_, e) => Math.round(attMax * Math.exp((-e * 2 ** gapShift) / (2 ** (2 * QKB) * Math.sqrt(headSize))))),
    // 2^19 / i: i = top 10 bits of the total attention weight
    recip: Array.from({ length: recipSize }, (_, i) => (i ? Math.round(2 ** 19 / (i + 0.5)) : 0)),
    // rotation per position: cos and sin for each of the rotDim/2 speeds. cfg.rope, when given, holds for every position
    // its place [time, row, column] (a conversation with a picture, ../vision/), each speed taking one of the three (float.js MROPE)
    cos: Array.from({ length: maxTokens }, (_, pos) => Array.from(freq, (fr, f) => Math.round(Math.cos(angleOf(cfg.rope, pos, f) * fr) * 2 ** RB))),
    sin: Array.from({ length: maxTokens }, (_, pos) => Array.from(freq, (fr, f) => Math.round(Math.sin(angleOf(cfg.rope, pos, f) * fr) * 2 ** RB))),
  };
}

// The settings that follow from the defaults, the options and the sizes of a model.
function settings(shape, options = {}) {
  const cfg = { ...DEFAULTS, ...options, tops: { ...DEFAULTS.tops, ...(options.tops || {}) } };
  const { dim } = shape;
  const { weightBits: WB, EB, XB, xBits, NB, nBits, invB, LB, logitBits, GB, gBits, uBits, HB, hBits,
    MB, mixBits, ZB, zBits, AB, aBits, BB, bBits, OHB, ohBits, QA, qaBits, GTB, gtBits, VB, vBits } = cfg;
  if (WB > 16) throw new Error('weightBits > 16 is not supported by the Int16 storage');
  if (dim * 2 ** (xBits - 1) >= 2 ** 30) throw new Error('sum |x| must stay below 2^30: xBits is too wide for this hidden size');
  if (14 + invB - NB + nBits > 32) throw new Error('nBits too wide for the normalisation');
  if (Math.sqrt(dim) * 2 ** NB >= 2 ** (nBits - 1)) throw new Error('nBits too narrow: x / rms(x) can reach sqrt(dim)');
  if (Math.sqrt(dim) * 2 ** (14 + invB) >= 2 ** 31) throw new Error('invB too large for this hidden size');
  if (2 ** Math.round(Math.log2(cfg.maxTokens)) !== cfg.maxTokens) throw new Error('maxTokens must be a power of two');
  if (cfg.attMax * cfg.maxTokens >= 65536) throw new Error('total attention weight must fit 16 bits');
  if (cfg.SB < cfg.CB || cfg.SB + cfg.KB > 25 || cfg.SB + cfg.TB > 23 || cfg.SB + cfg.QB > 30) throw new Error('state widths: need CB <= SB, SB + KB <= 25, SB + TB <= 23, SB + QB <= 30');
  if (cfg.DB > 13) throw new Error('DB at most 13');
  const tops = Object.fromEntries(Object.entries(cfg.tops).map(([k, t]) => [k, t + WB - 10]));
  tops.cls = EB;
  const IB = NB;
  const R = {
    mix: [tops.wqkv + IB - MB, mixBits], z: [tops.wz + IB - ZB, zBits], a: [tops.wa + IB - AB, aBits], b: [tops.wb + IB - BB, bBits],
    out: [tops.wout + OHB - XB, xBits],
    q: [tops.wq + IB - QA, qaBits], gate: [tops.wq + IB - GTB, gtBits], k: [tops.wk + IB - QA, qaBits], v: [tops.wv + IB - VB, vBits],
    o: [tops.wo + VB - XB, xBits],
    g: [tops.w1 + IB - GB, gBits], u: [tops.w3 + IB - GB, uBits], f: [tops.w2 + HB - XB, xBits],
    c: [tops.cls + IB - LB, logitBits],
  };
  for (const [name, [k, n]] of Object.entries(R)) if (k < 0 || k + n > 31) throw new Error(`rounding ${name}: k = ${k}, n = ${n} is not possible (k >= 0, k + n <= 31)`);
  return {
    cfg, tops, R, IB,
    eout: tops.wout + OHB - XB, eo: tops.wo + VB - XB, e2: tops.w2 + HB - XB, // the residual joins these sums at their scale
    K3: 14 + invB - NB,
    xUpBits: Math.max(0, XB - EB), xDown: Math.max(0, EB - XB),
    tables: makeTables(cfg, shape),
  };
}

// ---- the model ---------------------------------------------------------------------------------

// src: openWeights() of ../float.js (or synth.js): shape fields and tensor(kind, l) as floats.
function build(src, options = {}) {
  const S = settings(src, options), { cfg, tops, R, IB, eout, eo, e2, K3, xUpBits, xDown, tables } = S;
  const { dim, layers, heads, kvHeads, headSize: hs, kvDim, rotDim, hidden, vocab, types, nk, nv, dk, dv, kernel, keyDim, valueDim, convDim } = src;
  const { weightBits: WB, EB, embBits, xBits, nBits, gainB, gainBits, ngBits, GB, gBits, HB, hBits,
    MB, CWB, CB, cBits, ZB, zBits, AB, BB, sigIn, sigRange, SGB, LDB, DB, TB, KB, QB, SB, sBits, OB, oBits, YB, yBits, gnB, OHB, ohBits,
    QA, GTB, VB, vBits, NHB, QKB, qkBits, RB, gapShift, expSize, scoreBits, maxTokens } = cfg;
  const qDim = heads * hs, share = heads / kvHeads, rotHalf = rotDim / 2, scoreLim = 2 ** scoreBits;
  const stats = { scoreOverflow: 0, stateOverflow: 0, folds: 0, clears: 0 };
  const ints = (a, f, bits) => Int32Array.from(a, (v) => { const r = Math.round(v * f); if (r !== clampTo(r, bits)) throw new Error(`a constant needs more than ${bits} bits`); return r; });
  const gains = (a) => ints(Float64Array.from(a, (w) => 1 + w), 2 ** gainB, gainBits); // the norms scale by 1 + w
  const quant = (kind, l, cols) => quantise(src.tensor(kind, l), cols, WB, tops[kind]);

  // ---- weights, one tensor at a time
  const L = [];
  for (let l = 0; l < layers; l++) {
    const t = types[l], Q = { type: t, g1: gains(src.tensor('rmsAtt', l)), g2: gains(src.tensor('rmsFfn', l)),
      w1: quant('w1', l, dim), w3: quant('w3', l, dim), w2: quant('w2', l, hidden) };
    if (t === 'lin') {
      Object.assign(Q, {
        wqkv: quant('wqkv', l, dim), wz: quant('wz', l, dim), wa: quant('wa', l, dim), wb: quant('wb', l, dim), wout: quant('wout', l, valueDim),
        conv: ints(src.tensor('conv', l), 2 ** CWB, 16),
        dt: ints(src.tensor('dtBias', l), 2 ** AB, 16),
        logA: ints(src.tensor('aLog', l), 2 ** LDB, 16),      // log A = A_log
        gn: ints(src.tensor('gNorm', l), 2 ** gnB, 16),
      });
    } else {
      // q_proj holds per head hs query rows, then hs gate rows: split into q and gate
      const W = src.tensor('wq', l), Wq = new Float32Array(qDim * dim), Wg = new Float32Array(qDim * dim);
      for (let h = 0; h < heads; h++) {
        Wq.set(W.subarray(2 * h * hs * dim, (2 * h + 1) * hs * dim), h * hs * dim);
        Wg.set(W.subarray((2 * h + 1) * hs * dim, (2 * h + 2) * hs * dim), h * hs * dim);
      }
      Object.assign(Q, {
        wq: quantise(Wq, dim, WB, tops.wq), wg: quantise(Wg, dim, WB, tops.wq), wk: quant('wk', l, dim), wv: quant('wv', l, dim), wo: quant('wo', l, qDim),
        qn: gains(src.tensor('qNorm', l)), kn: gains(src.tensor('kNorm', l)),
      });
    }
    L.push(Q);
  }
  const emb = (() => {
    const E = src.tensor('emb'), e = new (embBits <= 8 ? Int8Array : Int16Array)(E.length);
    for (let i = 0; i < E.length; i++) e[i] = clampTo(Math.round(E[i] * 2 ** EB), embBits);
    return e;
  })();
  if (!src.tied) throw new Error('this engine reads the output layer from the embedding table');
  const gFinal = gains(src.tensor('rmsFinal'));
  const wcls = { w: emb, d: new Uint8Array(vocab) };

  // ---- the residual norm (compiler/qwen/engine/spec.js): xn = x / rms(x) at NB fraction bits, times the gain
  const wn = new Int32Array(dim);
  const normalise = (x, out, gain) => {
    let A = 0;
    for (let i = 0; i < dim; i++) A += Math.abs(x[i]);
    const b = bitlen(A), D1 = b ? 30 - b : 0;
    let ss = 0;
    for (let i = 0; i < dim; i++) {
      wn[i] = rqWrap(x[i] * 2 ** D1, 11, 21);
      const u = rq32(wn[i], 4, 17);
      ss = u32(ss + u * u);
    }
    const c = bitlen(ss), D2 = c ? (c % 2 ? 31 - c : 32 - c) : 0, D3 = D2 / 2;
    const T = tables.inv[u32(ss * 2 ** D2) >>> 20];
    for (let i = 0; i < dim; i++) out[i] = rqWrap(Math.imul(wn[i], T) * 2 ** D3, K3, nBits);
    for (let i = 0; i < dim; i++) out[i] = rq32(out[i] * gain[i], gainB, ngBits);
    return out;
  };
  const rqAll = (Sv, len, [k, n], out, at = 0) => { for (let i = 0; i < len; i++) out[at + i] = rq32(Sv[i], k, n); };

  // ---- sigmoid and silu from one table
  const sigN = tables.sig.length, sigBits = Math.log2(sigN);
  // sigmoid(v / 2^frac) * 2^SGB; outside -sigRange .. sigRange the end of the table (0 and 2^SGB)
  const sigOf = (v, frac) => tables.sig[rq32(v, frac - sigIn, sigBits, 0, (frac > sigIn ? 2 ** (frac - sigIn - 1) : 0) + sigRange * 2 ** frac)];
  // silu(v) = v * sigmoid(v) at frac fraction bits (|v * 2^SGB| fits 31 bits for v of up to 31 - SGB bits)
  const siluOf = (v, frac, bits) => rqWrap(v * sigOf(v, frac), SGB, bits);
  if (tables.sig[sigN - 1] !== 2 ** SGB || tables.sig[0] !== 0) throw new Error('the ends of the sigmoid table must be 0 and 1');

  // ---- scratch
  const x = new Float64Array(dim), xn = new Float64Array(dim), out = new Float64Array(dim);
  const a = new Float64Array(hidden), b = new Float64Array(hidden), hid = new Float64Array(hidden), logits = new Float64Array(vocab);
  const nw = new Int32Array(Math.max(hs, dk, dv));
  // DeltaNet
  const mix = new Float64Array(convDim), zz = new Float64Array(valueDim), aa = new Float64Array(nv), bb = new Float64Array(nv);
  const cc = new Float64Array(convDim), qk = new Float64Array(2 * keyDim), oo = new Float64Array(valueDim), yy = new Float64Array(valueDim), hh = new Float64Array(valueDim);
  const vt = new Float64Array(dv), qd = new Float64Array(dk), pp = new Float64Array(dv), dd = new Float64Array(dv);
  // attention
  const qr = new Float64Array(qDim), gr = new Float64Array(qDim), kr = new Float64Array(kvDim), vr = new Float64Array(kvDim);
  const qq = new Float64Array(qDim), kk = new Float64Array(kvDim), mixed = new Float64Array(qDim), score = new Float64Array(maxTokens), sums = new Float64Array(hs);

  // Gated DeltaNet: xn (NB fraction bits, times the gain) -> sums of out_proj (before the residual joins)
  function deltaNet(Q, st, xin, outS, tr) {
    const nwB = Math.min(sBits, 31 - KB), npB = Math.min(sBits, 32 - KB);
    // 1. the input matrices, rounded
    matvec(Q.wqkv, xin, convDim, mix); rqAll(mix, convDim, R.mix, mix);
    matvec(Q.wz, xin, valueDim, zz); rqAll(zz, valueDim, R.z, zz);
    matvec(Q.wa, xin, nv, aa); rqAll(aa, nv, R.a, aa);
    matvec(Q.wb, xin, nv, bb); rqAll(bb, nv, R.b, bb);
    tr('mix', mix); tr('z', zz); tr('a', aa); tr('b', bb);
    // 2. causal convolution over the last `kernel` tokens of every channel, then silu
    const w = Q.conv, win = st.win;
    for (let ch = 0; ch < convDim; ch++) {
      let s = w[ch * kernel + kernel - 1] * mix[ch];
      for (let j = 0; j < kernel - 1; j++) s += w[ch * kernel + j] * win[j * convDim + ch];
      cc[ch] = siluOf(rq32(s, CWB + MB - CB, cBits), CB, cBits);
    }
    win.copyWithin(0, convDim); win.set(mix, (kernel - 2) * convDim);
    tr('conv', cc);
    // 3. queries and keys to length 1 per head (the queries to 1/sqrt(dk))
    for (let h = 0; h < nk; h++) normVec(cc, h * dk, tables.normQ, qk, h * dk, nw);
    for (let h = 0; h < nk; h++) normVec(cc, keyDim + h * dk, tables.normK, qk, keyDim + h * dk, nw);
    tr('qk', qk);
    // 4. every value head: decay, beta, the delta rule on St = S / D, the read
    const dhd = [], bhd = [];
    for (let h = 0; h < nv; h++) {
      const kh = Math.floor(h / (nv / nk)), qAt = kh * dk, kAt = keyDim + kh * dk, vAt = 2 * keyDim + h * dv;
      const St = st.S[h];
      // decay = exp(-exp(log A + log softplus(a + dt)))
      const u = rq32(aa[h] + Q.dt[h] + 32 * 2 ** AB, 0, Math.log2(tables.lsp.length), 0, 0);
      const lam = rq32(tables.lsp[u] + Q.logA[h] - tables.lamLo * 2 ** LDB, 0, Math.log2(tables.dec.length), 0, 0);
      const dec = tables.dec[lam];
      const beta = rqWrap(sigOf(bb[h], BB), SGB - TB, TB + 2);
      dhd.push(dec); bhd.push(beta);
      // D = D * decay; below 1/2 it is folded into St by the power of two that brings it back to 1/2 .. 1
      let D = rqWrap(st.D[h] * dec, DB, DB + 2, 0);
      if (D < 2 ** (DB - 1)) {
        if (D === 0) { St.fill(0); D = 2 ** DB; stats.clears++; }
        else {
          const m = DB - bitlen(D);
          for (let i = 0; i < St.length; i++) St[i] = rqWrap(St[i], m, sBits - m);
          D *= 2 ** m; stats.folds++;
        }
      }
      st.D[h] = D;
      const Dinv = tables.recipD[D - 2 ** (DB - 1)];                  // 2^DB / D at DB fraction bits
      // values at the scale of St (v / D), queries times D
      for (let j = 0; j < dv; j++) vt[j] = rqWrap(cc[vAt + j] * Dinv, DB - (SB - CB), sBits);
      for (let i = 0; i < dk; i++) qd[i] = rqWrap(qk[qAt + i] * D, DB, QB + 2);
      // what St predicts for the key, and the deltas
      pp.fill(0);
      for (let i = 0; i < dk; i++) { const kv = qk[kAt + i]; for (let j = 0; j < dv; j++) pp[j] += St[i * dv + j] * kv; }
      for (let j = 0; j < dv; j++) dd[j] = rqWrap((vt[j] - rqWrap(pp[j], KB, npB)) * beta, TB, sBits);
      // write: St += k d^T
      for (let i = 0; i < dk; i++) {
        const kv = qk[kAt + i];
        for (let j = 0, at = i * dv; j < dv; j++, at++) {
          const v = St[at] + rqWrap(kv * dd[j], KB, nwB);
          if (v >= 2 ** (sBits - 1) || v < -(2 ** (sBits - 1))) stats.stateOverflow++;
          St[at] = v;                  // (stateOverflow counts the times v leaves sBits; it never does on real text)
        }
      }
      // read with the query times D: the output at its true scale
      for (let j = 0; j < dv; j++) {
        let s = 0;
        for (let i = 0; i < dk; i++) s += St[i * dv + j] * qd[i];
        oo[h * dv + j] = rq32(s, SB + QB - OB, oBits);
      }
    }
    tr('decay', dhd); tr('beta', bhd); tr('core', oo);
    // 5. per value head: rms norm, times the gain, times silu(z)
    for (let h = 0; h < nv; h++) normVec(oo, h * dv, tables.normY, yy, h * dv, nw);
    for (let i = 0; i < valueDim; i++) {
      const g = rqWrap(yy[i] * Q.gn[i % dv], gnB, yBits), sz = siluOf(zz[i], ZB, zBits);
      hh[i] = rq32(g * sz, YB + ZB - OHB, ohBits);
    }
    tr('gated', hh);
    return matvec(Q.wout, hh, dim, outS);
  }

  // Gated full attention: xn -> sums of o_proj
  function attention(Q, ck, cv, xin, pos, outS, tr) {
    matvec(Q.wq, xin, qDim, qr); rqAll(qr, qDim, R.q, qr);
    matvec(Q.wg, xin, qDim, gr); rqAll(gr, qDim, R.gate, gr);
    matvec(Q.wk, xin, kvDim, kr); rqAll(kr, kvDim, R.k, kr);
    matvec(Q.wv, xin, kvDim, vr); rqAll(vr, kvDim, R.v, vr);
    tr('qraw', qr); tr('graw', gr); tr('kraw', kr); tr('v', vr);
    // rms norm per head, times the gain 1 + w
    for (let h = 0; h < heads; h++) {
      normVec(qr, h * hs, tables.normH, qq, h * hs, nw);
      for (let i = 0; i < hs; i++) qq[h * hs + i] = rq32(qq[h * hs + i] * Q.qn[i], gainB + NHB - QKB, qkBits);
    }
    for (let h = 0; h < kvHeads; h++) {
      normVec(kr, h * hs, tables.normH, kk, h * hs, nw);
      for (let i = 0; i < hs; i++) kk[h * hs + i] = rq32(kk[h * hs + i] * Q.kn[i], gainB + NHB - QKB, qkBits);
    }
    tr('qn', qq); tr('kn', kk);
    // rotate number f with number f + rotDim/2, f < rotDim/2, of every head
    const cos = tables.cos[pos], sin = tables.sin[pos];
    const rot = (vec, n) => {
      for (let at = 0; at < n; at += hs) {
        for (let f = 0; f < rotHalf; f++) {
          const p = vec[at + f], q = vec[at + f + rotHalf];
          vec[at + f] = rq32(p * cos[f] - q * sin[f], RB, qkBits);
          vec[at + f + rotHalf] = rq32(q * cos[f] + p * sin[f], RB, qkBits);
        }
      }
    };
    rot(qq, qDim); rot(kk, kvDim);
    tr('q', qq); tr('k', kk);
    ck.set(kk, pos * kvDim); cv.set(vr, pos * kvDim);
    // attention weights from a table of exp(best - score), the mixed values as sums / total (compiler/qwen/engine/spec.js)
    const expBits = Math.log2(expSize), trTot = [];
    for (let h = 0; h < heads; h++) {
      const kvAt = Math.floor(h / share) * hs, qAt = h * hs;
      let best = -Infinity;
      for (let t = 0; t <= pos; t++) {
        let s = 0;
        const base = t * kvDim + kvAt;
        for (let i = 0; i < hs; i++) s += qq[qAt + i] * ck[base + i];
        score[t] = s;
        if (s > best) best = s;
        if (Math.abs(s) >= scoreLim) stats.scoreOverflow++;
      }
      let total = 0;
      sums.fill(0);
      for (let t = 0; t <= pos; t++) {
        if (best - score[t] >= scoreLim) stats.scoreOverflow++;
        const wt = tables.exp[rq32(best - score[t], gapShift, expBits, 0, 0)];
        if (wt === 0) continue;
        total += wt;
        const base = t * kvDim + kvAt;
        for (let i = 0; i < hs; i++) sums[i] += wt * cv[base + i];
      }
      trTot.push(total);
      const tb = bitlen(total & 0xffff), Dt = tb ? 16 - tb : 0;
      const Rc = tables.recip[(u32(total * 2 ** Dt) >>> 6) & 1023];
      for (let i = 0; i < hs; i++) mixed[qAt + i] = rq32(Math.imul(rq32(sums[i] * 2 ** Dt, 11, 17), Rc), 14, vBits);
    }
    tr('tot', trTot); tr('mixed', mixed);
    // times sigmoid(gate)
    for (let i = 0; i < qDim; i++) mixed[i] = rq32(mixed[i] * sigOf(gr[i], GTB), SGB, vBits);
    tr('gated', mixed);
    return matvec(Q.wo, mixed, dim, outS);
  }

  // One position: the token's embedding through every layer; the output scores when asked for.
  // trace(name, layer, values), when given, sees every stage.
  // input, when given: the vector of a picture's word piece at EB fraction bits (../vision/spec.js), read in place of the row of the token.
  function step(cache, token, pos, wantLogits = true, trace = null, input = null) {
    if (pos >= maxTokens) throw new Error(`position ${pos} is beyond maxTokens`);
    const tr0 = (name, l, arr) => { if (trace) trace(name, l, Array.from(arr)); };
    const row = input || emb.subarray(token * dim, (token + 1) * dim);
    if (xDown) for (let i = 0; i < dim; i++) x[i] = rq32(row[i], xDown, xBits);
    else for (let i = 0; i < dim; i++) x[i] = row[i] * 2 ** xUpBits;
    tr0('emb', -1, x);
    for (let l = 0; l < layers; l++) {
      const Q = L[l], tr = (name, arr) => tr0(name, l, arr);
      normalise(x, xn, Q.g1); tr('xn1', xn);
      if (!cfg.noMixer && !(cfg.skip || []).includes(Q.type)) {   // (noMixer, skip: the residual goes on as it is; tests the engine without its mixers)
        let e;
        if (Q.type === 'lin') { deltaNet(Q, cache.lin[l], xn, out, tr); e = [R.out[0], eout]; }
        else { attention(Q, cache.k[l], cache.v[l], xn, pos, out, tr); e = [R.o[0], eo]; }
        // the residual joins the sums at their scale, then one rounding
        for (let i = 0; i < dim; i++) out[i] += x[i] * 2 ** e[1];
        for (let i = 0; i < dim; i++) x[i] = rq32(out[i], e[0], xBits);
      }
      tr('xatt', x);
      normalise(x, xn, Q.g2); tr('xn2', xn);
      matvec(Q.w1, xn, hidden, a); rqAll(a, hidden, R.g, a);
      matvec(Q.w3, xn, hidden, b); rqAll(b, hidden, R.u, b);
      const gMask = 2 ** gBits - 1;
      for (let i = 0; i < hidden; i++) hid[i] = rq32(tables.silu[a[i] & gMask] * b[i], 2 * GB - HB, hBits);
      tr('hid', hid);
      matvec(Q.w2, hid, dim, out);
      for (let i = 0; i < dim; i++) out[i] += x[i] * 2 ** e2;
      for (let i = 0; i < dim; i++) x[i] = rq32(out[i], R.f[0], xBits);
      tr('xout', x);
    }
    if (!wantLogits && !trace) return null;
    return head(x, tr0);
  }
  // The output layer on its own: the scores of a residual xs (tools/map-data/lens.js gives it the residual after every layer).
  function head(xs, tr = () => {}) {
    normalise(xs, xn, gFinal); tr('xnf', -1, xn);
    matvec(wcls, xn, vocab, logits);
    rqAll(logits, vocab, R.c, logits);
    return logits;
  }
  const newCache = () => ({
    k: types.map((t) => (t === 'att' ? new Int32Array(maxTokens * kvDim) : null)),
    v: types.map((t) => (t === 'att' ? new Int32Array(maxTokens * kvDim) : null)),
    lin: types.map((t) => (t === 'lin' ? {
      win: new Int32Array((kernel - 1) * convDim),
      S: Array.from({ length: nv }, () => new Int32Array(dk * dv)),
      D: new Int32Array(nv).fill(2 ** DB),
    } : null)),
  });
  step.newCache = newCache;
  // The state of a DeltaNet layer as floats (S = D * St / 2^SB), for the comparison with the float model.
  const stateOf = (cacheLin) => {
    const outS = new Float64Array(nv * dk * dv);
    for (let h = 0; h < nv; h++) { const f = cacheLin.D[h] / 2 ** DB / 2 ** SB; for (let i = 0; i < dk * dv; i++) outS[h * dk * dv + i] = cacheLin.S[h][i] * f; }
    return outS;
  };
  return { step, head, cfg, settings: S, stats, layers: L, emb, gFinal, stateOf };
}

const argmax = (a) => { let best = 0; for (let i = 1; i < a.length; i++) if (a[i] > a[best]) best = i; return best; };

const STOP = [248046, 248044];        // <|im_end|>, <|endoftext|>

function generateIds(net, promptIds, maxNew, stop = STOP) {
  const cache = net.step.newCache(), out = [];
  let logits = null;
  for (let pos = 0; pos < promptIds.length; pos++) logits = net.step(cache, promptIds[pos], pos, pos === promptIds.length - 1);
  for (let n = 0; n < maxNew; n++) {
    const token = argmax(logits);
    if (stop.includes(token)) break;
    out.push(token);
    if (n + 1 < maxNew) logits = net.step(cache, token, promptIds.length + n, true);
  }
  return out;
}

const MODEL_SETTINGS = { 'qwen3.5-0.8b': {} };
// compiler/downloads/<name>, through float.js's modelDir (which takes it from --model= in a list of arguments)
const modelDir = (name = 'qwen3.5-0.8b') => require('../reference/float').modelDir(['', '', `--model=${name}`]);
const optionsFor = (name = 'qwen3.5-0.8b') => ({ ...MODEL_SETTINGS[name] });

// The whole-number model of a real model.
function buildReal(name = 'qwen3.5-0.8b', options = {}) {
  const F = require('../reference/float');
  const src = F.openWeights(modelDir(name)), tok = F.loadTokenizer(modelDir(name));
  if (tok.stop.join() !== STOP.join()) throw new Error('unexpected stop tokens');
  const net = build(src, { ...optionsFor(name), ...options });
  src.close();
  return { tok, net, shape: src.shape };
}

module.exports = { DEFAULTS, settings, build, buildReal, generateIds, argmax, STOP, modelDir, optionsFor, rq32, rqWrap, normPlan, normVec, quantise };
