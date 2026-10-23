'use strict';

// The spec of the vision part of Qwen3.5 (reference/vision.js) in whole numbers; vision/gen.js computes exactly these.
// Built from compiler/qwen/engine/spec.js; out comes one vector of 1024 per four squares, at the text embedding's scale.

const Q = require('../../qwen/engine/spec');
const { rq32, rqWrap, quantise } = Q;

const DEFAULTS = {
  weightBits: 10,
  maxTop: 30,               // weights keep at most this many fraction bits (a row with small weights: fewer than weightBits of its own)
  NB: 8, nBits: 15,         // x / rms(x) (|value| < sqrt(768) = 27.7)
  gainB: 8, gainBits: 14,   // gains w of the norms (-0.41 .. 18)
  ngBits: 18,               // normalised times gain, NB fraction bits (|value| <= 500); n input bits cost 2^n characters per sweep
  invSize: 4096, invB: 11,
  biasBits: 31,             // biases at the scale of the doubled sums
  QB: 7, qBits: 14, KB: 7, kBits: 14,  // queries and keys (|q|, |k| <= 12.8)
  VB: 10, vBits: 15,        // values and mixed values (|v| <= 9.3)
  RB: 8,                    // sines and cosines of the rotation
  gapShift: 12, expSize: 256, attMax: 255, recipSize: 1024, scoreBits: 29,   // |q k| <= 255
  phiIn: 8, phiRange: 8, PHB: 12,     // Phi of gelu: index at phiIn fraction bits over -phiRange .. phiRange, value PHB bits
  // the residual at the input of every layer, and of the merger (last): fraction bits and width
  XB: [14, 14, 14, 14, 14, 14, 11, 11, 11, 11, 11, 11, 6], xBits: 20,
  // the feed-forward layer: its sums before gelu and after it, fraction bits (GB = HB) and widths
  GB: [8, 9, 9, 9, 9, 6, 9, 9, 8, 5, 5, 4], gBits: 15,
  MGB: 11, mgBits: 16,      // the merger: before and after gelu (|u| <= 4.4)
  EB: 12, eBits: 18,        // the output, at the scale of the text model's embedding table (|e| <= 4.7)
  // the largest values on the pictures of pictures/ (reference/vision.js, probe): the doubled sums leave room for 4 times as much
  reach: {
    x: [4.2, 3.4, 9.0, 8.1, 7.1, 4.8, 70.1, 73.2, 73.7, 73.4, 74.1, 75.0, 2240.6],
    a: [20.2, 10.2, 6.5, 7.0, 9.1, 87.1, 11.0, 10.2, 23.6, 159.9, 150.8, 438.9],
    qkv: 21, u: 4.4, e: 4.7,
  },
  room: 4,
  maxSquares: 256,
};

const bitlen = (v) => 32 - Math.clz32(v);
const u32 = (v) => v >>> 0;
const clampTo = (v, bits) => { const lim = 2 ** (bits - 1); return v < -lim ? -lim : v > lim - 1 ? lim - 1 : v; };
const POW2 = Float64Array.from({ length: 64 }, (_, i) => 2 ** i);

// y[r] = (W x)[r] * 2^d[r] (exact in doubles; the cell holds it modulo 2^32)
function matvec({ w: W, d }, x, rows, y) {
  const cols = x.length;
  for (let r = 0, at = 0; r < rows; r++, at += cols) {
    let s = 0;
    for (let c = 0; c < cols; c++) s += W[at + c] * x[c];
    y[r] = s * POW2[d[r]];
  }
  return y;
}

const erfPhi = (x) => 0.5 * (1 + require('../reference/vision').erf(x / Math.SQRT2));
const tanhPhi = (x) => 0.5 * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (x + 0.044715 * x * x * x)));

function settings(V, options = {}) {
  const cfg = { ...DEFAULTS, ...options, reach: { ...DEFAULTS.reach, ...(options.reach || {}) } };
  const { dim, headSize, depth } = V, { NB, nBits, invB, QB, KB, VB, XB, xBits, GB, gBits, MGB, mgBits, EB, eBits, attMax, maxSquares, gapShift, expSize, RB, maxTop, reach, room } = cfg;
  if (XB.length !== depth + 1 || GB.length !== depth) throw new Error('one residual width per layer and one for the merger, one feed-forward width per layer');
  if (dim * 2 ** (xBits - 1) >= 2 ** 30) throw new Error('sum |x| must stay below 2^30');
  if (14 + invB - NB + nBits > 32 || Math.sqrt(dim) * 2 ** NB >= 2 ** (nBits - 1)) throw new Error('nBits does not fit the normalisation');
  if (attMax * maxSquares >= 65536) throw new Error('total attention weight must fit 16 bits');
  // The fraction bits of a matrix's weights (its top): as many as maxTop allows, as the rounding of its sums allows
  // (shift + width <= 31), and as keep its doubled sums, with room for `room` times the largest value, below 2^30.
  const top = (inB, outB, outBits, biggest) => Math.min(maxTop, 31 - outBits - inB + outB, Math.floor(30 - inB - Math.log2(room * biggest)));
  const L = Array.from({ length: depth }, (_, l) => {
    const xi = XB[l], xo = XB[l + 1], G = GB[l];
    const t = {
      qkv: Math.min(top(NB, QB, cfg.qBits, reach.qkv), top(NB, VB, cfg.vBits, reach.qkv)),
      o: top(VB, xi, xBits, reach.x[l]), fc1: top(NB, G, gBits, reach.a[l]), fc2: top(G, xo, xBits, reach.x[l + 1]),
    };
    const r = {
      XB: xi, XBo: xo, GB: G, HB: G, tops: t,
      q: [t.qkv + NB - QB, cfg.qBits], k: [t.qkv + NB - KB, cfg.kBits], v: [t.qkv + NB - VB, cfg.vBits],
      o: [t.o + VB - xi, xBits], eo: t.o + VB - xi,               // the residual joins the sums of o at their scale
      g: [t.fc1 + NB - G, gBits],                                 // gelu(a) = round(a * Phi / 2^PHB), at HB = GB
      f: [t.fc2 + G - xo, xBits], e2: t.fc2 + G - xi,
    };
    for (const n of ['q', 'k', 'v', 'o', 'g', 'f']) if (r[n][0] < 0 || r[n][0] + r[n][1] > 31) throw new Error(`layer ${l}, rounding ${n}: k = ${r[n][0]}, n = ${r[n][1]}`);
    if (r.eo < 0 || r.e2 < 0) throw new Error(`layer ${l}: the residual is finer than the sums it joins`);
    return r;
  });
  const tops = { patch: top(0, XB[0], xBits, reach.x[0]), m1: top(NB, MGB, mgBits, reach.u), m2: top(MGB, EB, eBits, reach.e) };
  const P = { k: tops.patch - XB[0], n: xBits };      // the patch embedding: sums at tops.patch, its residual (the positions) at XB[0]
  const M = { u: [tops.m1 + NB - MGB, mgBits], h: [cfg.PHB, mgBits], e: [tops.m2 + MGB - EB, eBits] };
  if (P.k < 0 || M.u[0] < 0 || M.e[0] < 0) throw new Error('a rounding of the patch embedding or the merger shifts left');
  // Phi at pin fraction bits of its input: pin = phiIn, or the fraction bits of a when it has fewer (the wide layers)
  const phi = (f, pin) => Array.from({ length: 2 * cfg.phiRange * 2 ** pin }, (_, i) => Math.round(2 ** cfg.PHB * f(i / 2 ** pin - cfg.phiRange)));
  const tables = {
    inv: Array.from({ length: cfg.invSize }, (_, i) => (i ? Math.round((Math.sqrt(dim) * 2 ** invB) / Math.sqrt(i + 0.5)) : 0)),
    exp: Array.from({ length: expSize }, (_, e) => Math.round(attMax * Math.exp((-e * 2 ** gapShift) / (2 ** (QB + KB) * Math.sqrt(headSize))))),
    recip: Array.from({ length: cfg.recipSize }, (_, i) => (i ? Math.round(2 ** 19 / (i + 0.5)) : 0)),
    phiTanh: {}, phiErf: {},
  };
  for (const pin of new Set(cfg.GB.map((g) => Math.min(g, cfg.phiIn)))) tables.phiTanh[pin] = phi(tanhPhi, pin);
  tables.phiErf[Math.min(MGB, cfg.phiIn)] = phi(erfPhi, Math.min(MGB, cfg.phiIn));
  for (const t of [...Object.values(tables.phiTanh), ...Object.values(tables.phiErf)]) if (t[0] !== 0 || t[t.length - 1] !== 2 ** cfg.PHB) throw new Error('the ends of the Phi tables must be 0 and 1');
  return { cfg, tops, L, P, M, K3: 14 + invB - NB, tables, RB };
}

// The rotation of square s: pair f (numbers 2f, 2f+1 of a head in our order) turns by the row for f < hs/4, by the
// column for the others; cos and sin at RB fraction bits.
function trigTables(V, sq, RB) {
  const half = V.headSize / 2, cos = [], sin = [];
  for (let s = 0; s < sq.n; s++) {
    const [row, col] = sq.rc[s];
    cos.push(Array.from({ length: half }, (_, f) => Math.round(Math.cos((f < half / 2 ? row : col) * V.freq[f % (half / 2)]) * 2 ** RB)));
    sin.push(Array.from({ length: half }, (_, f) => Math.round(Math.sin((f < half / 2 ? row : col) * V.freq[f % (half / 2)]) * 2 ** RB)));
  }
  return { cos, sin };
}

// our order of the numbers of q and k in a head: 2i <- i, 2i + 1 <- i + hs/2 (rotation pairs next to each other)
const ourToModel = (hs) => (j) => { const h = Math.floor(j / hs), i = j % hs; return h * hs + (i % 2 ? (i >> 1) + hs / 2 : i >> 1); };

// V: reference/vision.js loadVision(); sq: the layout of the squares (squares() of a picture of this size).
function build(V, sq, options = {}) {
  const S = settings(V, options), { cfg, tops, L: W, P, M, K3, tables, RB } = S;
  const { dim, hidden, heads, headSize: hs, depth } = V, n = sq.n, inN = 3 * V.P * V.P, G = V.merge * V.merge;
  if (n > cfg.maxSquares) throw new Error('more squares than maxSquares');
  const { weightBits: WB, NB, nBits, gainB, gainBits, ngBits, biasBits, QB, KB, kBits, qBits, VB, vBits, gapShift, expSize, scoreBits, xBits, gBits, phiIn, phiRange, PHB, MGB, mgBits } = cfg;
  const F = require('../reference/float'), FL = (W16) => F.toFloat(W16);
  const ints = (a, f, bits) => Float64Array.from(a, (v) => { const r = Math.round(v * f); if (r !== clampTo(r, bits)) throw new Error(`a constant needs more than ${bits} bits`); return r; });
  // All that is added to the residual is centered, so x has mean 0 and LayerNorm(x) = x / rms(x) * w + b (the rms norm).
  const center = (Wt, rows, cols) => {             // C W: every column minus its mean over the rows
    const out = new Float64Array(Wt.length);
    for (let c = 0; c < cols; c++) { let m = 0; for (let r = 0; r < rows; r++) m += Wt[r * cols + c]; m /= rows; for (let r = 0; r < rows; r++) out[r * cols + c] = Wt[r * cols + c] - m; }
    return out;
  };
  const centerVec = (v) => { let m = 0; for (const x of v) m += x; m /= v.length; return Float64Array.from(v, (x) => x - m); };
  // W (b_norm) + b: the bias of the norm before a matrix goes into the matrix's bias
  const fold = (Wt, rows, cols, bn, b) => Float64Array.from({ length: rows }, (_, r) => { let s = b[r]; for (let c = 0; c < cols; c++) s += Wt[r * cols + (c % cols)] * bn[c % bn.length]; return s; });
  const perm = ourToModel(hs);

  // ---- weights
  const T = trigTables(V, sq, RB);
  // the patch embedding: W / 127.5 on the bytes, centered; its bias (b - W 1) and the positions, centered, are the residual it starts from
  const Wp = center(Float64Array.from(V.patch, (w) => w / 127.5), dim, inN);
  const bp = Float64Array.from({ length: dim }, (_, o) => { let s = V.patchBias[o]; for (let i = 0; i < inN; i++) s -= V.patch[o * inN + i]; return s; });
  const pos = new Float64Array(dim), start = [];
  for (let s = 0; s < n; s++) {
    require('../reference/vision').position(V, sq.rc[s][0], sq.rc[s][1], sq.gh, sq.gw, pos);
    start.push(ints(centerVec(Float64Array.from(pos, (v, i) => v + bp[i])), 2 ** cfg.XB[0], xBits));
  }
  const patch = quantise(Wp, inN, WB, tops.patch);
  const layers = V.blocks.map((B, l) => {
    const r = W[l], qkvF = FL(B.qkv), fc1F = FL(B.fc1);
    // q and k rows in our order (rotation pairs side by side), v as it is
    const Wq = new Float64Array(3 * dim * dim), bq = new Float64Array(3 * dim), bf = fold(qkvF, 3 * dim, dim, B.n1b, B.qkvB);
    for (let j = 0; j < 3 * dim; j++) {
      const src = j < 2 * dim ? (j < dim ? perm(j) : dim + perm(j - dim)) : j;
      Wq.set(qkvF.subarray(src * dim, (src + 1) * dim), j * dim); bq[j] = bf[src];
    }
    const t = r.tops, qkv = quantise(Wq, dim, WB, t.qkv);
    const o = quantise(center(FL(B.proj), dim, dim), dim, WB, t.o), fc1 = quantise(fc1F, dim, WB, t.fc1), fc2 = quantise(center(FL(B.fc2), dim, hidden), hidden, WB, t.fc2);
    return {
      qkv, o, fc1, fc2, g1: ints(B.n1w, 2 ** gainB, gainBits), g2: ints(B.n2w, 2 ** gainB, gainBits),
      bqkv: ints(bq, 2 ** (t.qkv + NB), biasBits),
      bo: ints(centerVec(B.projB), 2 ** (t.o + VB), biasBits),
      b1: ints(fold(fc1F, hidden, dim, B.n2b, B.fc1B), 2 ** (t.fc1 + NB), biasBits),
      b2: ints(centerVec(B.fc2B), 2 ** (t.fc2 + r.HB), biasBits),
    };
  });
  const Mg = V.merger, m1F = FL(Mg.fc1), wide = G * dim;
  const merger = {
    g: ints(Mg.nw, 2 ** gainB, gainBits),
    m1: quantise(m1F, wide, WB, tops.m1), m2: quantise(FL(Mg.fc2), wide, WB, tops.m2),
    b1: ints(fold(m1F, wide, wide, Mg.nb, Mg.fc1B), 2 ** (tops.m1 + NB), biasBits),
    b2: ints(Mg.fc2B, 2 ** (tops.m2 + MGB), biasBits),
  };

  // ---- the parts
  const wn = new Int32Array(dim);
  const normalise = (x, at, out, oat, gain) => {        // compiler/qwen/engine/spec.js: x / rms(x) at NB fraction bits, times the gain
    let A = 0;
    for (let i = 0; i < dim; i++) A += Math.abs(x[at + i]);
    if (A >= 2 ** 30) throw new Error('normalise: sum |x| beyond 2^30');
    const b = bitlen(A), D1 = b ? 30 - b : 0;
    let ss = 0;
    for (let i = 0; i < dim; i++) {
      wn[i] = rqWrap(x[at + i] * 2 ** D1, 11, 21);
      const u = rq32(wn[i], 4, 17);
      ss = u32(ss + u * u);
    }
    const c = bitlen(ss), D2 = c ? (c % 2 ? 31 - c : 32 - c) : 0, D3 = D2 / 2;
    const Tv = tables.inv[u32(ss * 2 ** D2) >>> 20];
    for (let i = 0; i < dim; i++) out[oat + i] = rq32(rqWrap(Math.imul(wn[i], Tv) * 2 ** D3, K3, nBits) * gain[i], gainB, ngBits);
  };
  // gelu(a) = round(a * Phi(a) / 2^PHB), a at frac fraction bits: the index of Phi clamped to the table
  const gelu = (a, frac, tabs, bits) => {
    const pin = Math.min(frac, phiIn), table = tabs[pin], k = frac - pin;
    const idx = rq32(a, k, Math.log2(table.length), 0, (k > 0 ? 2 ** (k - 1) : 0) + phiRange * 2 ** frac);
    return rq32(a * table[idx], PHB, bits);
  };

  const x = new Float64Array(n * dim), xn = new Float64Array(dim), sums = new Float64Array(Math.max(3 * dim, hidden, wide)), t1 = new Float64Array(Math.max(dim, hidden, wide));
  const q = new Int32Array(n * dim), k = new Int32Array(n * dim), v = new Int32Array(n * dim), mixed = new Float64Array(dim), score = new Float64Array(n), hsum = new Float64Array(hs);
  const scoreLim = 2 ** scoreBits, expBits = Math.log2(expSize), stats = { scoreOverflow: 0 }, seen = new Int32Array(n);

  // bytes: the squares one after the other (squares() of reference/vision.js); trace(name, layer, values of all squares);
  // look(layer, square, head, weights, total), when given, sees the attention weights of every square and head.
  function encode(bytes, trace = null, look = null) {
    const tr = (name, l, a) => { if (trace) trace(name, l, Array.from(a)); };
    // the patch embedding
    const pix = new Float64Array(inN);
    for (let s = 0; s < n; s++) {
      for (let i = 0; i < inN; i++) pix[i] = bytes[s * inN + i];
      matvec(patch, pix, dim, sums);
      for (let o = 0; o < dim; o++) x[s * dim + o] = rq32(sums[o] + start[s][o] * 2 ** P.k, P.k, P.n);
    }
    tr('embed', -1, x);
    for (let l = 0; l < depth; l++) {
      const Ly = layers[l], r = W[l];
      // every square: its key, value and query
      for (let s = 0; s < n; s++) {
        normalise(x, s * dim, xn, 0, Ly.g1);
        matvec(Ly.qkv, xn, 3 * dim, sums);
        for (let i = 0; i < dim; i++) {
          q[s * dim + i] = rq32(sums[i] + Ly.bqkv[i], ...r.q);
          k[s * dim + i] = rq32(sums[dim + i] + Ly.bqkv[dim + i], ...r.k);
          v[s * dim + i] = rq32(sums[2 * dim + i] + Ly.bqkv[2 * dim + i], ...r.v);
        }
        const cos = T.cos[s], sin = T.sin[s];
        for (const [vec, bits] of [[q, qBits], [k, kBits]]) for (let i = 0; i < dim; i += 2) {
          const f = (i % hs) >> 1, a = vec[s * dim + i], b = vec[s * dim + i + 1];
          vec[s * dim + i] = rq32(a * cos[f] - b * sin[f], RB, bits);
          vec[s * dim + i + 1] = rq32(a * sin[f] + b * cos[f], RB, bits);
        }
      }
      tr('q', l, q); tr('k', l, k); tr('v', l, v);
      // every square: the attention over all squares, the output matrix, the feed-forward layer
      const xo = new Float64Array(n * dim);
      for (let s = 0; s < n; s++) {
        for (let h = 0; h < heads; h++) {
          const at = h * hs;
          let best = -Infinity;
          for (let t = 0; t < n; t++) {
            let sc = 0;
            for (let i = 0; i < hs; i++) sc += q[s * dim + at + i] * k[t * dim + at + i];
            score[t] = sc;
            if (sc > best) best = sc;
            if (Math.abs(sc) >= scoreLim) stats.scoreOverflow++;
          }
          let total = 0;
          hsum.fill(0);
          for (let t = 0; t < n; t++) {
            if (best - score[t] >= scoreLim) stats.scoreOverflow++;
            const wt = tables.exp[rq32(best - score[t], gapShift, expBits, 0, 0)];
            if (look) seen[t] = wt;
            if (wt === 0) continue;
            total += wt;
            for (let i = 0; i < hs; i++) hsum[i] += wt * v[t * dim + at + i];
          }
          const tb = bitlen(total & 0xffff), D = tb ? 16 - tb : 0, Rc = tables.recip[(u32(total * 2 ** D) >>> 6) & 1023];
          for (let i = 0; i < hs; i++) mixed[at + i] = rq32(Math.imul(rq32(hsum[i] * 2 ** D, 11, 17), Rc), 14, vBits);
          if (look) look(l, s, h, seen, total);
        }
        if (trace && s === 0) tr('mixed0', l, mixed);
        matvec(Ly.o, mixed, dim, sums);
        const xm = new Float64Array(dim);
        for (let i = 0; i < dim; i++) xm[i] = rq32(sums[i] + Ly.bo[i] + x[s * dim + i] * 2 ** r.eo, ...r.o);
        normalise(xm, 0, xn, 0, Ly.g2);
        matvec(Ly.fc1, xn, hidden, sums);
        for (let i = 0; i < hidden; i++) t1[i] = gelu(rq32(sums[i] + Ly.b1[i], ...r.g), r.GB, tables.phiTanh, gBits);
        matvec(Ly.fc2, t1.subarray(0, hidden), dim, sums);
        for (let i = 0; i < dim; i++) xo[s * dim + i] = rq32(sums[i] + Ly.b2[i] + xm[i] * 2 ** r.e2, ...r.f);
      }
      x.set(xo);
      tr('x', l, x);
    }
    // the merger: the norm per square, four squares side by side, two matrices with gelu between them
    const out = new Int32Array((n / G) * V.out), cat = new Float64Array(wide);
    for (let g = 0; g < n / G; g++) {
      for (let j = 0; j < G; j++) normalise(x, (g * G + j) * dim, cat, j * dim, merger.g);
      matvec(merger.m1, cat, wide, sums);
      for (let i = 0; i < wide; i++) t1[i] = gelu(rq32(sums[i] + merger.b1[i], ...M.u), MGB, tables.phiErf, mgBits);
      matvec(merger.m2, t1.subarray(0, wide), V.out, sums);
      for (let i = 0; i < V.out; i++) out[g * V.out + i] = rq32(sums[i] + merger.b2[i], ...M.e);
    }
    tr('emb', -1, out);
    return out;
  }
  return { encode, settings: S, layers, patch, start, merger, trig: T, stats, n };
}

// Widths from measured ranges (for models other than Qwen3.5-0.8B, such as synth.js): the residual and the input of gelu
// with `room` times their largest value inside their width.
function widthsFor(reach, room = DEFAULTS.room) {
  const fb = (bits, v) => Math.floor(bits - 1 - Math.log2(room * v));
  return { reach, XB: reach.x.map((v) => fb(DEFAULTS.xBits, v)), GB: reach.a.map((v) => fb(DEFAULTS.gBits, v)) };
}

// The largest values of a model on some pictures (reference/vision.js encode, its probe): reach for settings().
function measure(V, pictures) {
  const VR = require('../reference/vision'), mx = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const r = { x: new Array(V.depth + 1).fill(0), a: new Array(V.depth).fill(0), qkv: 0, u: 0, e: 0 };
  for (const sq of pictures) {
    VR.encode(V, sq, (nm, l, a) => {
      if (nm === 'embed') r.x[0] = Math.max(r.x[0], mx(a));
      else if (nm === 'x') r.x[l + 1] = Math.max(r.x[l + 1], mx(a));
      else if (nm === 'fc1') r.a[l] = Math.max(r.a[l], mx(a));
      else if (nm === 'qkv') r.qkv = Math.max(r.qkv, mx(a));
      else if (nm === 'mfc1') r.u = Math.max(r.u, mx(a));
      else if (nm === 'emb') r.e = Math.max(r.e, mx(a));
    });
  }
  return r;
}

module.exports = { DEFAULTS, settings, build, ourToModel, trigTables, widthsFor, measure };
