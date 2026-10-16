'use strict';

// THE SPEC of the brainfuck engine in this folder.

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  weightBits: 8,    // weights are stored in this many bits, sign included; every matrix row has its own power-of-two scale
  tops: { wq: 12, wk: 12, wv: 14, wo: 12, w1: 12, w3: 12, w2: 12, cls: 12 },
  EB: 12, embBits: 11, // embedding table (|value| <= 0.201), also read by the output layer
  XB: 12, xBits: 21,
  NB: 8, nBits: 14,    // normalised residual x / rms(x) (|value| < sqrt(896) = 29.9)
  gainB: 8, gainBits: 14, // normalisation gain (0.00 .. 16.8)
  ngBits: 17,          // normalised residual times gain, NB fraction bits (|value| <= 162)
  biasBits: 31,        // q, k, v bias at the scale of the doubled sum (|bias| <= 214)
  QB: 4, qBits: 12,    // queries (|q| <= 81)
  KB: 4, kBits: 13,    // keys (|k| <= 219)
  VB: 6, vBits: 12,    // values and mixed values (|v| <= 12.1)
  GB: 6, gBits: 13,    // feed-forward gate (|gate| <= 38.7); the silu table has 2^gBits entries
  uBits: 13,           // feed-forward up values, GB fraction bits (|up| <= 36.1)
  HB: 8, hBits: 16,    // feed-forward hidden values (|hid| <= 75.1)
  RB: 8,               // sines and cosines of the position rotation
  invSize: 4096,       // entries of the 1/sqrt table (index = top bits of the sum of squares)
  invB: 12,
  gapShift: 6,         // score gap is divided by 2^gapShift to index the exp table
  expSize: 256,        // entries of the exp table
  attMax: 255,         // attention weight of the best-matching position
  recipSize: 1024,     // entries of the reciprocal table (index = top 10 bits of the total weight)
  LB: 8, logitBits: 16, // output scores (|score| <= 30)
  scoreBits: 29,       // |attention score| and score gaps stay below 2^scoreBits (at most 29)
  maxTokens: 256,      // longest conversation (prefix included)
};

const u32 = (v) => v >>> 0;                       // exact for |v| < 2^53
const bitlen = (v) => 32 - Math.clz32(v);         // number of bits of an unsigned 32-bit value

function rq32(v, k, n, lo = -(2 ** (n - 1)), addend = k > 0 ? 2 ** (k - 1) : 0) {
  const X = (v + addend - lo * 2 ** k) | 0;       // what the cell holds
  const q = X >> k, hi = 2 ** n - 1;
  return lo + (q < 0 ? 0 : q > hi ? hi : q);
}
// The same without clamp: the result is taken modulo 2^n (k + n <= 32).
function rqWrap(v, k, n, lo = -(2 ** (n - 1)), addend = k > 0 ? 2 ** (k - 1) : 0) {
  return lo + ((u32(v + addend - lo * 2 ** k) >>> k) & (2 ** n - 1));
}

// Every row gets the largest power-of-two scale 2^wb that fits, wb <= top; d = top - wb, the doublings it lacks.
function quantise(W, cols, bits, top) {
  const lim = 2 ** (bits - 1) - 1, rows = W.length / cols;
  const w = new (bits <= 8 ? Int8Array : Int16Array)(W.length), d = new Uint8Array(rows);
  for (let r = 0, i = 0; r < rows; r++) {
    let mx = 0;
    for (let c = 0; c < cols; c++) { const a = Math.abs(W[i + c]); if (a > mx) mx = a; }
    const wb = mx > 0 ? Math.min(top, Math.floor(Math.log2(lim / mx))) : top, f = 2 ** wb;
    d[r] = top - wb;
    for (let c = 0; c < cols; c++, i++) w[i] = Math.round(W[i] * f);
  }
  return { w, d };
}

// y = (W x) * 2^d for whole numbers (exact in doubles).
const POW2 = Float64Array.from({ length: 64 }, (_, i) => 2 ** i);
function matvec(W, x, rows, y, d) {
  const cols = x.length, c4 = cols & ~3;
  for (let r = 0, at = 0; r < rows; r++, at += cols) {
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0, c = 0;
    for (; c < c4; c += 4) {
      s0 += W[at + c] * x[c];
      s1 += W[at + c + 1] * x[c + 1];
      s2 += W[at + c + 2] * x[c + 2];
      s3 += W[at + c + 3] * x[c + 3];
    }
    for (; c < cols; c++) s0 += W[at + c] * x[c];
    y[r] = (s0 + s1 + s2 + s3) * POW2[d[r]];
  }
}

// The integer tables, as a function of the sizes only (they are part of the program text).
function makeTables(cfg, dim, headSize, freq) {
  const { GB, gBits, RB, invSize, invB, gapShift, expSize, attMax, recipSize, QB, KB, maxTokens } = cfg;
  const gHalf = 2 ** (gBits - 1);
  return {
    // sqrt(dim) * 2^invB / sqrt(i): i = top 12 bits of the normalised sum of squares
    inv: Array.from({ length: invSize }, (_, i) => (i ? Math.round((Math.sqrt(dim) * 2 ** invB) / Math.sqrt(i + 0.5)) : 0)),
    // attention weight as a function of (best score - this score) >> gapShift
    exp: Array.from({ length: expSize }, (_, e) => Math.round(attMax * Math.exp((-e * 2 ** gapShift) / (2 ** (QB + KB) * Math.sqrt(headSize))))),
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

function settings(shape, options = {}) {
  const cfg = { ...DEFAULTS, ...options, tops: { ...DEFAULTS.tops, ...(options.tops || {}) } };
  const { dim, headSize } = shape;
  const { weightBits: WB, EB, XB, xBits, NB, nBits, QB, KB, VB, vBits, GB, gBits, uBits, HB, hBits, qBits, kBits, invB, attMax, LB, logitBits, scoreBits, maxTokens } = cfg;
  if (WB > 16) throw new Error('weightBits > 16 is not supported by the Int16 storage');
  if (dim * 2 ** (xBits - 1) >= 2 ** 30) throw new Error('sum |x| must stay below 2^30: xBits is too wide for this hidden size');
  if (14 + invB - NB + nBits > 32) throw new Error('nBits too wide for the normalisation');
  if (Math.sqrt(dim) * 2 ** NB >= 2 ** (nBits - 1)) throw new Error('nBits too narrow: x / rms(x) can reach sqrt(dim)');
  if (Math.sqrt(dim) * 2 ** (14 + invB) >= 2 ** 31) throw new Error('invB too large for this hidden size: the product of the normalisation would not fit 32 bits');
  if (attMax * maxTokens >= 65536) throw new Error('total attention weight must fit 16 bits');
  if (scoreBits > 29) throw new Error('scoreBits must be at most 29');
  const tops = Object.fromEntries(Object.entries(cfg.tops).map(([k, t]) => [k, t + WB - 10]));
  tops.cls = EB;
  const IB = NB; // fraction bits of what goes into the q, k, v, gate, up and output matrices
  const R = {
    q: [tops.wq + IB - QB, qBits], k: [tops.wk + IB - KB, kBits], v: [tops.wv + IB - VB, vBits],
    o: [tops.wo + VB - XB, xBits], g: [tops.w1 + IB - GB, gBits], u: [tops.w3 + IB - GB, uBits],
    f: [tops.w2 + HB - XB, xBits], c: [tops.cls + IB - LB, logitBits],
  };
  for (const [name, [k, n]] of Object.entries(R)) if (k < 0 || k + n > 31) throw new Error(`rounding ${name}: k = ${k}, n = ${n} is not possible (k >= 0, k + n <= 31)`);
  return {
    cfg, tops, R, IB,
    eo: tops.wo + VB - XB, e2: tops.w2 + HB - XB,
    K3: 14 + invB - NB,                                    // shift of the last rounding of the normalisation
    xUpBits: Math.max(0, XB - EB), xDown: Math.max(0, EB - XB), // embedding table -> residual stream
    tables: makeTables(cfg, dim, headSize, shape.freq),
  };
}

function build(src, prefix, options = {}) {
  const { cfg, tops, R, IB, eo, e2, K3, xUpBits, xDown, tables } = settings(src, options);
  const { dim, layers, heads, headSize, kvDim, hidden, vocab } = src;
  const { weightBits: WB, EB, embBits, xBits, nBits, gainB, gainBits, ngBits, biasBits, qBits, KB, kBits,
    VB, vBits, GB, gBits, HB, hBits, RB, gapShift, expSize, scoreBits, maxTokens } = cfg;
  const scoreLim = 2 ** scoreBits;

  const stats = {};
  // out[i] = rq(S[i], k, n) for a whole vector
  const rqAll = (S, len, [k, n], out) => { for (let i = 0; i < len; i++) out[i] = rq32(S[i], k, n); };
  const clampTo = (v, bits) => { const lim = 2 ** (bits - 1); return v < -lim ? -lim : v > lim - 1 ? lim - 1 : v; };
  const ints = (a, f, bits) => Float64Array.from(a, (v) => { const r = Math.round(v * f); if (r !== clampTo(r, bits)) throw new Error(`a constant needs more than ${bits} bits`); return r; });

  // ---- weights, one tensor at a time; biases at the scale of the doubled sums, gains as constants
  const L = [];
  const quant = (kind, l, cols, top) => quantise(src.tensor(kind, l), cols, WB, top);
  for (let l = 0; l < layers; l++) {
    L.push({
      wq: quant('wq', l, dim, tops.wq), wk: quant('wk', l, dim, tops.wk), wv: quant('wv', l, dim, tops.wv),
      wo: quant('wo', l, dim, tops.wo),
      w1: quant('w1', l, dim, tops.w1), w3: quant('w3', l, dim, tops.w3), w2: quant('w2', l, hidden, tops.w2),
      bq: ints(src.tensor('bq', l), 2 ** (tops.wq + IB), biasBits), bk: ints(src.tensor('bk', l), 2 ** (tops.wk + IB), biasBits),
      bv: ints(src.tensor('bv', l), 2 ** (tops.wv + IB), biasBits),
      g1: ints(src.tensor('rmsAtt', l), 2 ** gainB, gainBits), g2: ints(src.tensor('rmsFfn', l), 2 ** gainB, gainBits),
    });
  }
  let emb;
  {
    const E = src.tensor('emb');
    emb = new (embBits <= 8 ? Int8Array : Int16Array)(E.length);
    for (let i = 0; i < E.length; i++) emb[i] = clampTo(Math.round(E[i] * 2 ** EB), embBits);
  }
  const gFinal = ints(src.tensor('rmsFinal'), 2 ** gainB, gainBits);
  const wcls = { w: emb, d: new Uint8Array(vocab) };     // the output layer reads the embedding table, without row scales

  const gMask = 2 ** gBits - 1, share = heads / src.kvHeads;

  // xn = x / rms(x) at NB fraction bits, times the gain
  const w = new Int32Array(dim);
  const normalise = (x, out, gain) => {
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
    for (let i = 0; i < dim; i++) out[i] = rqWrap(Math.imul(w[i], T) * 2 ** D3, K3, nBits);
    for (let i = 0; i < dim; i++) out[i] = rq32(out[i] * gain[i], gainB, ngBits);
    return out;
  };

  // Rotate adjacent pairs by the angle for this position.
  const rotate = (vec, pos, n, bits) => {
    const cos = tables.cos[pos], sin = tables.sin[pos];
    for (let i = 0; i < n; i += 2) {
      const f = (i % headSize) >> 1, a = vec[i], b = vec[i + 1];
      vec[i] = rq32(a * cos[f] - b * sin[f], RB, bits);
      vec[i + 1] = rq32(a * sin[f] + b * cos[f], RB, bits);
    }
  };

  // ---- the fixed prefix: keys and values as data; position 0 from the float model (its values are far outside every range)
  const NP = prefix.ids.length;
  const pre = {
    n: NP, ids: prefix.ids.slice(),
    k: Array.from({ length: layers }, () => new Int32Array(NP * kvDim)),
    v: Array.from({ length: layers }, () => new Int32Array(NP * kvDim)),
  };
  for (let l = 0; l < layers; l++) {
    for (let i = 0; i < kvDim; i++) {
      pre.k[l][i] = clampTo(Math.round(prefix.k[l][i] * 2 ** KB), kBits);
      pre.v[l][i] = clampTo(Math.round(prefix.v[l][i] * 2 ** VB), vBits);
    }
  }

  const x = new Float64Array(dim), xn = new Float64Array(dim), q = new Float64Array(dim), k = new Float64Array(kvDim), v = new Float64Array(kvDim);
  const mixed = new Float64Array(dim), out = new Float64Array(dim), a = new Float64Array(hidden), b = new Float64Array(hidden);
  const hid = new Float64Array(hidden), score = new Float64Array(maxTokens), sums = new Float64Array(headSize);
  const logits = new Float64Array(vocab);
  const expBits = Math.log2(expSize), xUp = 2 ** xUpBits;
  let building = true;

  function step(cache, token, pos, wantLogits = true, trace = null) {
    const tr = (name, l, arr) => { if (trace) trace(name, l, Array.from(arr)); };
    if (pos >= maxTokens) throw new Error(`position ${pos} is beyond maxTokens`);
    if (pos < NP && !building) {
      if (token !== pre.ids[pos] || wantLogits) throw new Error(`position ${pos} belongs to the fixed prefix`);
      return null;
    }
    // the embedding at the scale of the residual stream (a rounding when the table is finer)
    if (xDown) for (let i = 0; i < dim; i++) x[i] = rq32(emb[token * dim + i], xDown, xBits);
    else for (let i = 0; i < dim; i++) x[i] = emb[token * dim + i] * xUp;
    tr('emb', -1, x);

    for (let l = 0; l < layers; l++) {
      const { wq, wk, wv, wo, w1, w2, w3, bq, bk, bv, g1, g2 } = L[l];
      normalise(x, xn, g1); tr('xn1', l, xn);
      // the sums start at the bias
      matvec(wq.w, xn, dim, q, wq.d); for (let i = 0; i < dim; i++) q[i] += bq[i];
      matvec(wk.w, xn, kvDim, k, wk.d); for (let i = 0; i < kvDim; i++) k[i] += bk[i];
      matvec(wv.w, xn, kvDim, v, wv.d); for (let i = 0; i < kvDim; i++) v[i] += bv[i];
      rqAll(q, dim, R.q, q); rqAll(k, kvDim, R.k, k); rqAll(v, kvDim, R.v, v);
      tr('qraw', l, q); tr('kraw', l, k); tr('v', l, v);
      rotate(q, pos, dim, qBits); rotate(k, pos, kvDim, kBits);
      tr('q', l, q); tr('k', l, k);
      const ck = cache.k[l], cv = cache.v[l];
      ck.set(k, pos * kvDim); cv.set(v, pos * kvDim);

      const trTot = [];
      let bigScore = 0;
      for (let h = 0; h < heads; h++) {
        // the first `share` query heads read key/value head 0, the next ones key/value head 1
        const kvAt = Math.floor(h / share) * headSize, qAt = h * headSize;
        let best = -Infinity;
        for (let t = 0; t <= pos; t++) {
          let s = 0;
          const base = t * kvDim + kvAt;
          for (let i = 0; i < headSize; i++) s += q[qAt + i] * ck[base + i];
          score[t] = s;
          if (s > best) best = s;
          if (s > bigScore) bigScore = s; else if (-s > bigScore) bigScore = -s;
        }
        let total = 0;
        sums.fill(0);
        for (let t = 0; t <= pos; t++) {
          if (best - score[t] > bigScore) bigScore = best - score[t];
          const wt = tables.exp[rq32(best - score[t], gapShift, expBits, 0, 0)];
          if (wt === 0) continue; // adds nothing (the engine may add the zeros)
          total += wt;
          const base = t * kvDim + kvAt;
          for (let i = 0; i < headSize; i++) sums[i] += wt * cv[base + i];
        }
        trTot.push(total);
        // mixed = sums / total: both are shifted left by D = 16 - (bits of total)
        const tb = bitlen(total & 0xffff), D = tb ? 16 - tb : 0;
        const Rc = tables.recip[(u32(total * 2 ** D) >>> 6) & 1023];
        for (let i = 0; i < headSize; i++) {
          const n = rq32(sums[i] * 2 ** D, 11, 17);
          mixed[qAt + i] = rq32(Math.imul(n, Rc), 14, vBits);
        }
      }
      if (bigScore >= scoreLim) stats.scoreOverflow = (stats.scoreOverflow || 0) + 1;
      tr('tot', l, trTot); tr('mixed', l, mixed);

      // Residual add: x is put into the doubled sums at their scale, then one rounding.
      matvec(wo.w, mixed, dim, out, wo.d);
      for (let i = 0; i < dim; i++) out[i] += x[i] * 2 ** eo;
      rqAll(out, dim, R.o, x);
      tr('xatt', l, x);

      normalise(x, xn, g2); tr('xn2', l, xn);
      matvec(w1.w, xn, hidden, a, w1.d); rqAll(a, hidden, R.g, a);
      matvec(w3.w, xn, hidden, b, w3.d); rqAll(b, hidden, R.u, b);
      for (let i = 0; i < hidden; i++) hid[i] = rq32(tables.silu[a[i] & gMask] * b[i], 2 * GB - HB, hBits);
      tr('hid', l, hid);
      matvec(w2.w, hid, dim, out, w2.d);
      for (let i = 0; i < dim; i++) out[i] += x[i] * 2 ** e2;
      rqAll(out, dim, R.f, x);
      tr('xout', l, x);
    }
    if (!wantLogits && !trace) return null;
    normalise(x, xn, gFinal); tr('xnf', -1, xn);
    matvec(wcls.w, xn, vocab, logits, wcls.d);
    rqAll(logits, vocab, R.c, logits);
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
    for (let pos = 1; pos < NP; pos++) step(cache, pre.ids[pos], pos, false);
    for (let l = 0; l < layers; l++) { pre.k[l].set(cache.k[l].subarray(0, NP * kvDim)); pre.v[l].set(cache.v[l].subarray(0, NP * kvDim)); }
  }
  building = false;

  return { step, cfg, stats, layers: L, emb, gFinal, prefix: pre };
}

const argmax = (a) => { let best = 0; for (let i = 1; i < a.length; i++) if (a[i] > a[best]) best = i; return best; };

const STOP = [151645, 151643];

const MODEL_SETTINGS = {
  '0.5b': {},
  '1.5b': { EB: 11, embBits: 11, XB: 10, xBits: 20, nBits: 15, invB: 11, qBits: 13, kBits: 14, gBits: 14, uBits: 15, hBits: 17 },
};
function generateIds(net, promptIds, maxNew) {
  const cache = net.step.newCache(), out = [];
  let logits = null;
  for (let pos = 0; pos < promptIds.length; pos++) logits = net.step(cache, promptIds[pos], pos, pos === promptIds.length - 1);
  for (let n = 0; n < maxNew; n++) {
    const token = argmax(logits);
    if (STOP.includes(token)) break;
    out.push(token);
    if (n + 1 < maxNew) logits = net.step(cache, token, promptIds.length + n, true);
  }
  return out;
}

const modelDir = (name) => path.join(__dirname, '..', '..', 'downloads', 'qwen2.5-' + name);
const optionsFor = (name) => ({ ...MODEL_SETTINGS[name] });

// The sizes of a real model from its config.json alone (no weights are read).
function shapeOf(name) {
  const c = JSON.parse(fs.readFileSync(path.join(modelDir(name), 'config.json'), 'utf8'));
  const dim = c.hidden_size, heads = c.num_attention_heads, kvHeads = c.num_key_value_heads, headSize = dim / heads;
  return {
    dim, hidden: c.intermediate_size, layers: c.num_hidden_layers, heads, kvHeads, vocab: c.vocab_size, headSize, kvDim: kvHeads * headSize,
    freq: Float64Array.from({ length: headSize / 2 }, (_, f) => Math.pow(c.rope_theta, -(2 * f) / headSize)),
  };
}

// The whole-number model of a real model, with the calibration of its fixed prefix (data/<model>/calib.json).
function buildReal(name) {
  const F = require('../reference/float');
  const src = F.openWeights(modelDir(name)), tok = F.loadTokenizer(modelDir(name));
  if (tok.stop.join() !== STOP.join()) throw new Error('unexpected stop tokens');
  const cal = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', name, 'calib.json'), 'utf8'));
  const ids = tok.encode(tok.chatPrefix());
  if (ids.join() !== cal.ids.join()) throw new Error('calib.json belongs to another prefix');
  const net = build(src, { ids, k: cal.k, v: cal.v }, optionsFor(name));
  src.close();
  return { tok, net, shape: src.shape };
}

module.exports = { buildReal, settings, shapeOf, optionsFor, modelDir, generateIds, argmax, STOP, rq32, rqWrap, quantise };
