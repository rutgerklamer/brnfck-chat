'use strict';

// Integer-only forward pass for SmolLM2-135M-Instruct.

const fs = require('fs');
const path = require('path');
const F = require('../reference/float');

const DEFAULTS = {
  weightBits: 10,   // weights are stored in this many bits, sign included
  tops: { wq: 10, wk: 10, wv: 12, wo: 8, w1: 10, w3: 10, w2: 7, cls: 7 },
  XB: 8, xBits: 21, // residual stream: fraction bits / stored bits (sign included)
  NB: 8, nBits: 14, // normalised residual
  QB: 4, qBits: 10, // queries and keys
  VB: 6, vBits: 11, // values and mixed values
  GB: 6, gBits: 12, // feed-forward gate and up values; the silu table has 2^gBits entries
  HB: 8, hBits: 16, // feed-forward hidden values
  RB: 8,            // sines and cosines of the position rotation
  invSize: 4096,    // entries of the 1/sqrt table (index = top bits of the sum of squares)
  gapShift: 6,      // score gap is divided by 2^gapShift to index the exp table
  expSize: 256,     // entries of the exp table
  attMax: 255,      // attention weight of the best-matching position
  recipSize: 1024,  // entries of the reciprocal table (index = top 10 bits of the total weight)
  LB: 6, logitBits: 16, // output scores
  maxTokens: 256,   // longest conversation (prefix included)
};

const u32 = (v) => v >>> 0;                       // exact for |v| < 2^53
const bitlen = (v) => 32 - Math.clz32(v);         // number of bits of an unsigned 32-bit value

function rq32(v, k, n, lo = -(2 ** (n - 1)), addend = k > 0 ? 2 ** (k - 1) : 0) {
  if (k + n > 31) throw new Error('rq32: k + n must be <= 31');
  const X = (v + addend - lo * 2 ** k) | 0;       // what the cell holds
  const q = X >> k, hi = 2 ** n - 1;
  return lo + (q < 0 ? 0 : q > hi ? hi : q);
}
// The same without clamp: the result is taken modulo 2^n (k + n <= 32).
function rqWrap(v, k, n, lo = -(2 ** (n - 1)), addend = k > 0 ? 2 ** (k - 1) : 0) {
  return lo + ((u32(v + addend - lo * 2 ** k) >>> k) & (2 ** n - 1));
}

function quantise(W, bits, gain, cols, top) {
  const lim = 2 ** (bits - 1) - 1;
  let max = 0;
  for (let i = 0; i < W.length; i++) { const a = Math.abs(gain ? W[i] * gain[i % cols] : W[i]); if (a > max) max = a; }
  const wb = Math.min(top, Math.floor(Math.log2(lim / max)));
  const f = 2 ** wb, w = new Int16Array(W.length);
  for (let i = 0; i < W.length; i++) {
    const v = Math.round((gain ? W[i] * gain[i % cols] : W[i]) * f);
    w[i] = v > lim ? lim : v < -lim ? -lim : v;
  }
  return { w, wb, d: top - wb };
}

// The integer tables, as a function of the sizes only (they are part of the program text).
function makeTables(cfg, dim, headSize, freq) {
  const { GB, gBits, RB, invSize, gapShift, expSize, attMax, recipSize, QB, maxTokens } = cfg;
  const gHalf = 2 ** (gBits - 1);
  return {
    // sqrt(dim) * 2^12 / sqrt(i): i = top 12 bits of the normalised sum of squares
    inv: Array.from({ length: invSize }, (_, i) => (i ? Math.round((Math.sqrt(dim) * 4096) / Math.sqrt(i + 0.5)) : 0)),
    // attention weight as a function of (best score - this score) >> gapShift
    exp: Array.from({ length: expSize }, (_, e) => Math.round(attMax * Math.exp((-e * 2 ** gapShift) / (2 ** (2 * QB) * Math.sqrt(headSize))))),
    // 2^19 / i: i = top 10 bits of the total attention weight
    recip: Array.from({ length: recipSize }, (_, i) => (i ? Math.round(2 ** 19 / (i + 0.5)) : 0)),
    // silu(a) * 2^GB, indexed by a & (2^gBits - 1) (negative a wraps to the top half)
    silu: Array.from({ length: 2 ** gBits }, (_, i) => {
      const a = (i < gHalf ? i : i - 2 ** gBits) / 2 ** GB;
      return Math.round((a / (1 + Math.exp(-a))) * 2 ** GB);
    }),
    // rotation per position: cos and sin for each of the headSize/2 speeds
    cos: Array.from({ length: maxTokens }, (_, pos) => Array.from(freq, (fr) => Math.round(Math.cos(pos * fr) * 2 ** RB))),
    sin: Array.from({ length: maxTokens }, (_, pos) => Array.from(freq, (fr) => Math.round(Math.sin(pos * fr) * 2 ** RB))),
  };
}

function build(m, prefix) {
  const cfg = { ...DEFAULTS, tops: { ...DEFAULTS.tops } };
  const { dim, layers, heads, headSize, kvDim, hidden, vocab } = m;
  const { weightBits: WB, tops, XB, xBits, NB, nBits, QB, qBits, VB, vBits, GB, gBits, HB, hBits, RB,
    gapShift, expSize, attMax, LB, logitBits, maxTokens } = cfg;
  if (dim * 2 ** (xBits - 1) >= 2 ** 30) throw new Error('sum |x| must stay below 2^30');
  if (26 - NB + nBits > 32) throw new Error('nBits too wide for the normalisation');
  if (attMax * maxTokens >= 65536) throw new Error('total attention weight must fit 16 bits');

  const L = [];
  for (let l = 0; l < layers; l++) {
    L.push({
      wq: quantise(m.wq[l], WB, m.rmsAtt[l], dim, tops.wq), wk: quantise(m.wk[l], WB, m.rmsAtt[l], dim, tops.wk),
      wv: quantise(m.wv[l], WB, m.rmsAtt[l], dim, tops.wv), wo: quantise(m.wo[l], WB, null, dim, tops.wo),
      w1: quantise(m.w1[l], WB, m.rmsFfn[l], dim, tops.w1), w3: quantise(m.w3[l], WB, m.rmsFfn[l], dim, tops.w3),
      w2: quantise(m.w2[l], WB, null, hidden, tops.w2),
    });
    // how far the residual x is shifted when it is put into the sums of wo / w2
    L[l].eo = L[l].wo.wb + VB - XB; L[l].e2 = L[l].w2.wb + HB - XB;
    if (L[l].eo < 0 || L[l].e2 < 0) throw new Error('residual has more fraction bits than a sum that is added to it');
  }
  const wcls = quantise(m.emb, WB, m.rmsFinal, dim, tops.cls);
  // the embedding table at the scale of the residual stream
  const xLim = 2 ** (xBits - 1);
  const emb = new Int32Array(m.emb.length);
  for (let i = 0; i < emb.length; i++) { const v = Math.round(m.emb[i] * 2 ** XB); emb[i] = v < -xLim ? -xLim : v > xLim - 1 ? xLim - 1 : v; }

  const tables = makeTables(cfg, dim, headSize, m.freq);
  const gMask = 2 ** gBits - 1, K3 = 26 - NB, share = heads / m.kvHeads;

  // xn = x / rms(x) at NB fraction bits
  const w = new Int32Array(dim);
  const normalise = (x, out) => {
    let A = 0;
    for (let i = 0; i < dim; i++) A += Math.abs(x[i]);
    const b = bitlen(A), D1 = b ? 30 - b : 0;
    let ss = 0;
    for (let i = 0; i < dim; i++) {
      w[i] = rqWrap(x[i] * 2 ** D1, 11, 21);     // always fits: no clamp needed
      const u = rq32(w[i], 4, 17);
      ss = u32(ss + u * u);
    }
    const c = bitlen(ss), D2 = c ? (c % 2 ? 31 - c : 32 - c) : 0, D3 = D2 / 2;
    const T = tables.inv[u32(ss * 2 ** D2) >>> 20];
    for (let i = 0; i < dim; i++) {
      const P = Math.imul(w[i], T);
      out[i] = rqWrap(P * 2 ** D3, K3, nBits);
    }
    return out;
  };

  // Rotate adjacent pairs by the angle for this position.
  const rotate = (vec, pos, n) => {
    const cos = tables.cos[pos], sin = tables.sin[pos];
    for (let i = 0; i < n; i += 2) {
      const f = (i % headSize) >> 1, a = vec[i], b = vec[i + 1];
      vec[i] = rq32(a * cos[f] - b * sin[f], RB, qBits);
      vec[i + 1] = rq32(a * sin[f] + b * cos[f], RB, qBits);
    }
  };

  const NP = prefix.ids.length;
  const clampTo = (v, bits) => { const lim = 2 ** (bits - 1); return v < -lim ? -lim : v > lim - 1 ? lim - 1 : v; };
  const pre = {
    n: NP, ids: prefix.ids.slice(),
    k: Array.from({ length: layers }, () => new Int32Array(NP * kvDim)),
    v: Array.from({ length: layers }, () => new Int32Array(NP * kvDim)),
  };
  for (let l = 0; l < layers; l++) {
    pre.k[l].set(Array.from(prefix.bosK[l], (v) => clampTo(Math.round(v * 2 ** QB), qBits)), 0);
    pre.v[l].set(Array.from(prefix.bosV[l], (v) => clampTo(Math.round(v * 2 ** VB), vBits)), 0);
  }

  const x = new Float64Array(dim), xn = new Float64Array(dim), q = new Float64Array(dim), k = new Float64Array(kvDim), v = new Float64Array(kvDim);
  const mixed = new Float64Array(dim), out = new Float64Array(dim), a = new Float64Array(hidden), b = new Float64Array(hidden);
  const hid = new Float64Array(hidden), score = new Float64Array(maxTokens), sums = new Float64Array(headSize);
  const logits = new Float64Array(vocab);
  let building = true;

  function step(_m, cache, token, pos, wantLogits = true, trace = null) {
    const tr = (name, l, arr) => { if (trace) trace(name, l, Array.from(arr)); };
    if (pos >= maxTokens) throw new Error(`position ${pos} is beyond maxTokens`);
    if (pos < NP && !building) {
      if (token !== pre.ids[pos] || wantLogits) throw new Error(`position ${pos} belongs to the fixed prefix`);
      return null;
    }
    for (let i = 0; i < dim; i++) x[i] = emb[token * dim + i];
    tr('emb', -1, x);

    for (let l = 0; l < layers; l++) {
      const { wq, wk, wv, wo, w1, w2, w3, eo, e2 } = L[l];
      normalise(x, xn); tr('xn1', l, xn);
      F.matvec(wq.w, xn, dim, q); for (let i = 0; i < dim; i++) q[i] = rq32(q[i] * 2 ** wq.d, tops.wq + NB - QB, qBits);
      F.matvec(wk.w, xn, kvDim, k); for (let i = 0; i < kvDim; i++) k[i] = rq32(k[i] * 2 ** wk.d, tops.wk + NB - QB, qBits);
      F.matvec(wv.w, xn, kvDim, v); for (let i = 0; i < kvDim; i++) v[i] = rq32(v[i] * 2 ** wv.d, tops.wv + NB - VB, vBits);
      rotate(q, pos, dim); rotate(k, pos, kvDim);
      const ck = cache.k[l], cv = cache.v[l];
      ck.set(k, pos * kvDim); cv.set(v, pos * kvDim);

      for (let h = 0; h < heads; h++) {
        const kvAt = Math.floor(h / share) * headSize, qAt = h * headSize;
        let best = -Infinity;
        for (let t = 0; t <= pos; t++) {
          let s = 0;
          const base = t * kvDim + kvAt;
          for (let i = 0; i < headSize; i++) s += q[qAt + i] * ck[base + i];
          score[t] = s;
          if (s > best) best = s;
        }
        let total = 0;
        sums.fill(0);
        for (let t = 0; t <= pos; t++) {
          const wt = tables.exp[rq32(best - score[t], gapShift, Math.log2(expSize), 0, 0)];
          total += wt;
          const base = t * kvDim + kvAt;
          for (let i = 0; i < headSize; i++) sums[i] += wt * cv[base + i];
        }
        // mixed = sums / total: both are shifted left by D = 16 - (bits of total)
        const tb = bitlen(total & 0xffff), D = tb ? 16 - tb : 0;
        const R = tables.recip[(u32(total * 2 ** D) >>> 6) & 1023];
        for (let i = 0; i < headSize; i++) {
          const n = rq32(sums[i] * 2 ** D, 11, 17);
          mixed[qAt + i] = rq32(Math.imul(n, R), 14, vBits);
        }
      }
      tr('mixed', l, mixed);

      // Residual add: x is put into the sums at their scale, then one rounding.
      F.matvec(wo.w, mixed, dim, out);
      for (let i = 0; i < dim; i++) out[i] = (out[i] + x[i] * 2 ** eo) * 2 ** wo.d;
      for (let i = 0; i < dim; i++) x[i] = rq32(out[i], tops.wo + VB - XB, xBits);
      tr('xatt', l, x);

      normalise(x, xn);
      F.matvec(w1.w, xn, hidden, a); for (let i = 0; i < hidden; i++) a[i] = rq32(a[i] * 2 ** w1.d, tops.w1 + NB - GB, gBits);
      F.matvec(w3.w, xn, hidden, b); for (let i = 0; i < hidden; i++) b[i] = rq32(b[i] * 2 ** w3.d, tops.w3 + NB - GB, gBits);
      for (let i = 0; i < hidden; i++) hid[i] = rq32(tables.silu[a[i] & gMask] * b[i], 2 * GB - HB, hBits);
      tr('hid', l, hid);
      F.matvec(w2.w, hid, dim, out);
      for (let i = 0; i < dim; i++) out[i] = (out[i] + x[i] * 2 ** e2) * 2 ** w2.d;
      for (let i = 0; i < dim; i++) x[i] = rq32(out[i], tops.w2 + HB - XB, xBits);
      tr('xout', l, x);
    }
    if (!wantLogits && !trace) return null;
    normalise(x, xn); tr('xnf', -1, xn);
    F.matvec(wcls.w, xn, vocab, logits);
    for (let i = 0; i < vocab; i++) logits[i] = rq32(logits[i] * 2 ** wcls.d, tops.cls + NB - LB, logitBits);
    return logits;
  }
  step.newCache = () => {
    const c = {
      k: Array.from({ length: layers }, () => new Int32Array(maxTokens * kvDim)),
      v: Array.from({ length: layers }, () => new Int32Array(maxTokens * kvDim)),
    };
    for (let l = 0; l < layers; l++) { c.k[l].set(pre.k[l]); c.v[l].set(pre.v[l]); }
    return c;
  };

  // The prefix beyond position 0: run it once with this spec and keep the keys and values.
  {
    const cache = step.newCache();
    for (let pos = 1; pos < NP; pos++) step(m, cache, pre.ids[pos], pos, false);
    for (let l = 0; l < layers; l++) { pre.k[l].set(cache.k[l].subarray(0, NP * kvDim)); pre.v[l].set(cache.v[l].subarray(0, NP * kvDim)); }
    building = false;
  }

  return { step, cfg, tables, layers: L, wcls, emb, prefix: pre };
}

// The real model with its fixed chat prefix.
const SYSTEM_PREFIX = '<|im_start|>system\nYou are a helpful AI assistant named SmolLM, trained by Hugging Face<|im_end|>\n<|im_start|>user\n';
function buildReal() {
  const m = F.loadModel(), tok = F.loadTokenizer();
  const cal = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'calib.json'), 'utf8'));
  const ids = tok.encode(SYSTEM_PREFIX);
  const net = build(m, { ids, bosK: cal.bosK, bosV: cal.bosV });
  return { m, tok, net };
}

module.exports = { buildReal, makeTables, DEFAULTS };
