'use strict';

// One Gated DeltaNet layer of Qwen3.5 / Qwen3.8 in whole numbers, as compiler/qwen/engine/spec.js does for
// Qwen2.5's attention: every number is an integer with a fixed number of fraction bits, every product and
// sum fits a wrapping 32-bit cell, and every function (sigmoid, softplus, exp, 1/sqrt, 1/x) is a table.
//
// The state S of a value head (dk x dv) is kept as S = D * St: St whole numbers, D one number per head.
// The decay multiplies only D; when D drops below 1/2 it is multiplied into St once and set back to 1.
// Multiplying St itself by a decay of 0.9999 every token would round small entries back to themselves
// forever (decay: 'direct' does that, for comparison).

const DEFAULTS = {
  weightBits: 8,       // weights in this many bits, sign included; every matrix row has its own power-of-two scale
  tops: { wqkv: 12, wz: 12, wa: 12, wb: 12, wout: 12 },
  NB: 8, nBits: 16,    // input: the normalised residual times its gain (|xn| <= 34.3)
  MB: 10, mixBits: 18, // queries, keys and values before the convolution (|mix| <= 82.5)
  CWB: 10,             // convolution weights (|w| <= 1.82)
  CB: 13, cBits: 21,   // after the convolution and silu (|q|, |k| <= 82 before their norm, |v| <= 19.4; most are near 0.05,
                       // and only the direction of queries and keys counts)
  ZB: 10, zBits: 16,   // gate z of the output norm (|z| <= 15.9)
  AB: 6, aBits: 12,    // a + dt_bias, index of the log-softplus table (|a + dt| <= 19.1, table over -32 .. 32)
  BB: 8, bBits: 14,    // b, index of the sigmoid table for beta
  sigIn: 8, sigRange: 16, SGB: 12, // sigmoid table: input at sigIn fraction bits over -sigRange .. sigRange, output SGB bits
  LB: 6,               // log of the decay rate: lambda = log A + log softplus(a + dt), decay = exp(-exp(lambda))
  DB: 12,              // per-token decay and the head scale D (at most 15: their product fits 31 bits)
  DQB: 11,             // D as it is multiplied into the output and its reciprocal (2^DQB .. 2^(DQB+1) for 1 .. 2)
  TB: 7,               // beta (a delta times beta fits 31 bits when SB + TB <= 23)
  KB: 9,               // unit keys
  QB: 14,              // queries, of length 1/sqrt(dk); the state read with them fits 31 bits when SB + QB <= 30
  SB: 16, sBits: 24,   // state St, values, what the state predicts and the deltas (|S| <= 14.3, |St| <= 2 |S|);
                       // St times a key fits 31 bits when SB + KB <= 25
  OB: 19, oBits: 20,   // output of the state for the query, before the norm (|o| <= 0.54)
  YB: 12, yBits: 17,   // o normalised (|y| <= sqrt(dv)), and times the gain
  gainB: 10,           // gains of the output norm (0.35 .. 1.19)
  HB: 10, hBits: 18,   // input of out_proj: norm times silu(z) (|h| <= 40.9)
  XB: 12, xBits: 21,   // output, at the scale of the residual stream (|out| <= 3.5)
  decay: 'block',      // 'block': S = D * St as above; 'direct': St is multiplied by the decay every token
  checks: true,        // count overflows and clamps (drift.js)
};

const u32 = (v) => v >>> 0;
const bitlen = (v) => 32 - Math.clz32(v);

// What a 32-bit cell gives for round(v / 2^k), clamped to n bits (spec.js).
function rq32(v, k, n, lo = -(2 ** (n - 1)), addend = k > 0 ? 2 ** (k - 1) : 0) {
  const X = (v + addend - lo * 2 ** k) | 0;
  const q = X >> k, hi = 2 ** n - 1;
  return lo + (q < 0 ? 0 : q > hi ? hi : q);
}
// The same, for a value known to fit 31 bits: the window is narrowed to 31 - k bits when n is wider.
// None of these roundings should ever clamp; CLAMPS.n counts the times one did.
const CLAMPS = { n: 0 };
const rq = (v, k, n) => {
  const r = rq32(v, k, Math.min(n, 31 - k)), lim = 2 ** (Math.min(n, 31 - k) - 1);
  if (r === -lim || r === lim - 1) CLAMPS.n++;
  return r;
};
// round(S * f / 2^k) for S of n bits and f of up to 16 bits, as two products that each fit 31 bits:
// S = hi * 2^b + lo with 0 <= lo < 2^b, b = min(12, k) (a long multiplication over two cells)
const mulSplit = (S, f, k, n) => {
  const b = Math.min(12, k), lo = S & (2 ** b - 1), hi = (S - lo) / 2 ** b;
  return rq32(rq(hi * f, k - b, n) + rq(lo * f, k, b + 2), 0, n);
};
const clampTo = (v, bits) => { const lim = 2 ** (bits - 1); return v < -lim ? -lim : v > lim - 1 ? lim - 1 : v; };

// Every row gets the largest power-of-two scale 2^wb that fits, wb <= top; d = top - wb, the doublings it lacks (spec.js).
function quantise(W, cols, bits, top) {
  const lim = 2 ** (bits - 1) - 1, rows = W.length / cols;
  const w = hooks.alloc(bits <= 8 ? Int8Array : Int16Array, W.length), d = hooks.alloc(Uint8Array, rows);
  for (let r = 0, i = 0; r < rows; r++) {
    let mx = 0;
    for (let c = 0; c < cols; c++) { const a = Math.abs(W[i + c]); if (a > mx) mx = a; }
    const wb = mx > 0 ? Math.min(top, Math.floor(Math.log2(lim / mx))) : top, f = 2 ** wb;
    d[r] = top - wb;
    for (let c = 0; c < cols; c++, i++) w[i] = Math.round(W[i] * f);
  }
  return { w, d };
}
const POW2 = Float64Array.from({ length: 64 }, (_, i) => 2 ** i);
function matvec({ w: W, d }, x, rows, y = new Float64Array(rows)) {
  const cols = x.length;
  for (let r = 0, at = 0; r < rows; r++, at += cols) {
    let s = 0;
    for (let c = 0; c < cols; c++) s += W[at + c] * x[c];
    y[r] = s * POW2[d[r]];
  }
  return y;
}

// site/compare/live/worker.js puts the weights in shared memory and the products on threads
const hooks = { matvec, alloc: (Type, n) => new Type(n) };

// x * c / sqrt(sum x^2 + e), over n numbers at inB fraction bits, to outB fraction bits.
// As spec.js: x is shifted so that sum |w| < 2^19; the sum of squares of w / 16 fits 31 bits;
// its top 12 bits index a table of c / sqrt.
function invSqrtTable(c) {
  const TB = Math.floor(11 + 14.5 - Math.log2(c)); // keeps |w * T| < 2^30.5
  return { TB, T: Int32Array.from({ length: 4096 }, (_, i) => (i < 1024 ? 0 : Math.round((c * 2 ** TB) / Math.sqrt((i + 0.5) * 2 ** 19)))) };
}
function normalise(x, at, n, inB, eps, { TB, T }, outB, outBits, out, w) {
  let A = 0;
  for (let i = at; i < at + n; i++) A += Math.abs(x[i]);
  if (A === 0) { out.fill(0, at, at + n); return; }
  // shift so that sum |w| < 2^19, but never so far up that eps would not fit 29 bits at the scale of the sum
  // (a vector far below sqrt(eps) comes out near zero, and keeps fewer bits)
  const s = Math.max(bitlen(A) - 19, Math.ceil(inB - 4 - (29 - Math.log2(eps)) / 2));
  let ss = 0;
  for (let i = at; i < at + n; i++) {
    w[i] = s > 0 ? rq32(x[i], s, 21) : x[i] * 2 ** -s;
    const u = rq32(w[i], 4, 17);
    ss += u * u;
  }
  ss += Math.round(eps * 2 ** (2 * (inB - s - 4))); // eps at the scale of the sum: a small table indexed by s
  const D2 = (31 - bitlen(ss)) & ~1, Ti = T[u32(ss * 2 ** D2) >>> 19];
  for (let i = at; i < at + n; i++) out[i] = rq(w[i] * Ti, TB + 4 - outB - D2 / 2, outBits);
}

function makeTables(cfg, m) {
  const { sigIn, sigRange, SGB, AB, LB, DB, DQB } = cfg;
  const sigN = 2 * sigRange * 2 ** sigIn;
  return {
    // sigmoid(i / 2^sigIn - sigRange) * 2^SGB
    sig: Int32Array.from({ length: sigN }, (_, i) => Math.round(2 ** SGB / (1 + Math.exp(-(i / 2 ** sigIn - sigRange))))),
    // log(softplus(u)) * 2^LB for u = i / 2^AB - 32
    lsp: Int32Array.from({ length: 64 * 2 ** AB }, (_, i) => {
      const u = i / 2 ** AB - 32, sp = u > 20 ? u : Math.log1p(Math.exp(u));
      return Math.round(Math.log(sp) * 2 ** LB);
    }),
    // decay exp(-exp(lambda)) * 2^DB for lambda = i / 2^LB + lamLo; below lamLo it is 1, above the end 0
    lamLo: -Math.ceil((DB + 1) * Math.LN2), lamHi: Math.ceil(Math.log((DB + 1) * Math.LN2)),
    get dec() {
      const n = (this.lamHi - this.lamLo) * 2 ** LB;
      return Int32Array.from({ length: n }, (_, i) => Math.round(2 ** DB * Math.exp(-Math.exp(i / 2 ** LB + this.lamLo))));
    },
    // 2^(2 DQB) / Dq for Dq = 2^(DQB-1) .. 2^DQB (D = 1/2 .. 1)
    recip: Int32Array.from({ length: 2 ** (DQB - 1) + 1 }, (_, i) => Math.round(2 ** (2 * DQB) / (i + 2 ** (DQB - 1)))),
    invK: invSqrtTable(1),                 // unit keys
    invQ: invSqrtTable(1 / Math.sqrt(m.dk)), // queries to length 1/sqrt(dk)
    invY: invSqrtTable(Math.sqrt(m.dv)),     // rms norm of the output: sqrt(dv) / sqrt(sum o^2 + dv eps)
  };
}

// src: openWeights() of float.js; l: a linear_attention layer.
function build(src, l, options = {}) {
  const cfg = { ...DEFAULTS, ...options, tops: { ...DEFAULTS.tops, ...(options.tops || {}) } };
  const { nk, nv, dk, dv, keyDim, valueDim, convDim, kernel, dim, eps } = src;
  const { weightBits: WB, NB, nBits, MB, mixBits, CWB, CB, cBits, ZB, zBits, AB, aBits, BB, bBits, sigIn, sigRange, SGB,
    LB, DB, DQB, TB, KB, QB, SB, sBits, OB, oBits, YB, yBits, gainB, HB, hBits, XB, xBits } = cfg;
  if (src.types[l] !== 'lin') throw new Error(`layer ${l} is not a Gated DeltaNet layer`);
  const tops = Object.fromEntries(Object.entries(cfg.tops).map(([k, t]) => [k, t + WB - 10]));
  const tbl = makeTables(cfg, src), decTab = tbl.dec;
  const R = {
    mix: [tops.wqkv + NB - MB, mixBits], z: [tops.wz + NB - ZB, zBits], a: [tops.wa + NB - AB, aBits], b: [tops.wb + NB - BB, bBits],
    out: [tops.wout + HB - XB, xBits],
  };
  for (const [name, [k, n]] of Object.entries(R)) if (k < 0 || k + n > 31) throw new Error(`rounding ${name}: k = ${k}, n = ${n} is not possible`);
  if (SB + QB - OB < 0) throw new Error('OB too large');
  if (SB < CB || SB - CB > DQB) throw new Error('need CB <= SB <= CB + DQB (values go into the state by a shift)');
  if (SB + KB > 25 || SB + TB > 23 || SB + QB > 30) throw new Error('need SB + KB <= 25, SB + TB <= 23, SB + QB <= 30: the state times a key or a query and a delta times beta fit 31 bits');
  if (DB > 15 || DQB > DB) throw new Error('need DQB <= DB <= 15: D times the decay fits 31 bits');

  const W = {
    qkv: quantise(src.tensor('wqkv', l), dim, WB, tops.wqkv), z: quantise(src.tensor('wz', l), dim, WB, tops.wz),
    a: quantise(src.tensor('wa', l), dim, WB, tops.wa), b: quantise(src.tensor('wb', l), dim, WB, tops.wb),
    out: quantise(src.tensor('wout', l), valueDim, WB, tops.wout),
  };
  const ints = (a, f, bits) => Int32Array.from(a, (v) => clampTo(Math.round(v * f), bits));
  const conv = ints(src.tensor('conv', l), 2 ** CWB, 16);
  const dt = ints(src.tensor('dtBias', l), 2 ** AB, aBits);
  const logA = ints(src.tensor('aLog', l), 2 ** LB, 16); // log A = A_log itself
  const gain = ints(src.tensor('gNorm', l), 2 ** gainB, 16);

  // the state: the convolution window (last kernel-1 inputs, oldest first), St and D per head
  const win = new Int32Array((kernel - 1) * convDim), St = new Int32Array(nv * dk * dv), D = new Int32Array(nv).fill(2 ** DB);
  const stats = { overflow: 0, renorm: 0, steps: 0 };
  const big = cfg.checks ? (v) => { if (v >= 2 ** 31 || v < -(2 ** 31)) stats.overflow++; } : () => {};
  // the rounding of the hot loop: rq, or without its clamp count
  // without checks the write into St is inlined: the same numbers as rq32 while nothing wraps (drift.js shows nothing does)
  const nW = Math.min(sBits, 31 - KB), wLo = -(2 ** (nW - 1)), wHi = 2 ** (nW - 1) - 1, wHalf = 2 ** (KB - 1), wScale = 2 ** -KB;
  const sLo = -(2 ** (sBits - 1)), sHi = 2 ** (sBits - 1) - 1;
  // and so is St times D at a renormalisation (mulSplit with k = DB, n = sBits)
  const mb = Math.min(12, DB), mMask = 2 ** mb - 1, mDiv = 2 ** -mb, mK = DB - mb;
  const mHalfA = mK > 0 ? 2 ** (mK - 1) : 0, mScaleA = 2 ** -mK, mA = Math.min(sBits, 31 - mK), mALo = -(2 ** (mA - 1)), mAHi = 2 ** (mA - 1) - 1;
  const mHalfC = 2 ** (DB - 1), mScaleC = 2 ** -DB, mC = Math.min(mb + 2, 31 - DB), mCLo = -(2 ** (mC - 1)), mCHi = 2 ** (mC - 1) - 1;
  const scaleSt = (S, f) => {
    if (cfg.checks) { for (let i = 0; i < S.length; i++) S[i] = mulSplit(S[i], f, DB, sBits); return; }
    for (let i = 0; i < S.length; i++) {
      const x = S[i], lo = x & mMask, hi = (x - lo) * mDiv;
      let a = Math.floor((hi * f + mHalfA) * mScaleA), c = Math.floor((lo * f + mHalfC) * mScaleC);
      a = a < mALo ? mALo : a > mAHi ? mAHi : a;
      c = c < mCLo ? mCLo : c > mCHi ? mCHi : c;
      const v = a + c;
      S[i] = v < sLo ? sLo : v > sHi ? sHi : v;
    }
  };

  const mix = new Float64Array(convDim), z = new Float64Array(valueDim), a = new Float64Array(nv), b = new Float64Array(nv);
  const c = new Float64Array(convDim), qk = new Float64Array(2 * keyDim), tmp = new Float64Array(Math.max(convDim, valueDim));
  const qd = new Float64Array(dk), vt = new Float64Array(dv), mem = new Float64Array(dv), o = new Float64Array(valueDim), y = new Float64Array(valueDim);
  const h = new Float64Array(valueDim), outS = new Float64Array(dim);
  // silu(x) = x * sigmoid(x) at frac fraction bits; beyond the table the sigmoid is 0 or 1 and silu is 0 or x
  const siluOf = (x, frac, bits) => (x >= sigRange * 2 ** frac ? x : x <= -sigRange * 2 ** frac ? 0 : rq(x * sigOf(x, frac), SGB, bits));
  const sigOf = (v, frac) => tbl.sig[rq32(v, frac - sigIn, Math.log2(tbl.sig.length), 0, frac > sigIn ? 2 ** (frac - sigIn - 1) + sigRange * 2 ** frac : sigRange * 2 ** frac)];

  // xn: whole numbers at NB fraction bits; out: whole numbers at XB fraction bits
  // trace(name, values, fraction bits), when given, sees the stages (as float.js's probe)
  function step(xn, out, trace) {
    stats.steps++;
    hooks.matvec(W.qkv, xn, convDim, mix); for (let i = 0; i < convDim; i++) { big(mix[i]); mix[i] = rq32(mix[i], ...R.mix); }
    hooks.matvec(W.z, xn, valueDim, z); for (let i = 0; i < valueDim; i++) { big(z[i]); z[i] = rq32(z[i], ...R.z); }
    hooks.matvec(W.a, xn, nv, a); for (let i = 0; i < nv; i++) a[i] = rq32(a[i], ...R.a);
    hooks.matvec(W.b, xn, nv, b); for (let i = 0; i < nv; i++) b[i] = rq32(b[i], ...R.b);

    // causal convolution, then silu = x * sigmoid(x)
    for (let ch = 0; ch < convDim; ch++) {
      let s = conv[ch * kernel + kernel - 1] * mix[ch];
      for (let j = 0; j < kernel - 1; j++) s += conv[ch * kernel + j] * win[j * convDim + ch];
      big(s);
      const pre = rq(s, CWB + MB - CB, cBits);
      c[ch] = siluOf(pre, CB, cBits);
    }
    if (trace) { trace('mix', mix, MB); trace('z', z, ZB); }
    win.copyWithin(0, convDim); win.set(mix, (kernel - 2) * convDim);
    for (let hd = 0; hd < nk; hd++) normalise(c, hd * dk, dk, CB, 1e-6, tbl.invQ, QB, QB, qk, tmp);
    for (let hd = nk; hd < 2 * nk; hd++) normalise(c, hd * dk, dk, CB, 1e-6, tbl.invK, KB, KB + 2, qk, tmp);

    if (trace) { trace('q', qk.subarray(0, keyDim), QB); trace('k', qk.subarray(keyDim), KB); trace('v', c.subarray(2 * keyDim), CB); }
    for (let hd = 0; hd < nv; hd++) {
      const kh = Math.floor(hd / (nv / nk)), qAt = kh * dk, kAt = keyDim + kh * dk, vAt = 2 * keyDim + hd * dv;
      const S = St.subarray(hd * dk * dv, (hd + 1) * dk * dv);
      // decay = exp(-exp(log A + log softplus(a + dt)))
      const u = rq32(a[hd] + dt[hd] + 32 * 2 ** AB, 0, Math.log2(tbl.lsp.length), 0, 0);
      const lam = tbl.lsp[u] + logA[hd] - tbl.lamLo * 2 ** LB;
      const dec = lam < 0 ? 2 ** DB : lam >= decTab.length ? 0 : decTab[lam];
      const beta = rq32(sigOf(b[hd], BB), SGB - TB, TB + 2);

      let Dq, Dinv;
      if (cfg.decay === 'block') {
        big(D[hd] * dec);
        D[hd] = rq32(D[hd] * dec, DB, DB + 1, 0);
        if (D[hd] < 2 ** (DB - 1)) {
          // fold D into St (a renormalisation: once per halving of the head's memory)
          stats.renorm++;
          scaleSt(S, D[hd]);
          D[hd] = 2 ** DB;
        }
        Dq = rq32(D[hd], DB - DQB, DQB + 2);
        Dinv = tbl.recip[Dq - 2 ** (DQB - 1)]; // 2^DQB / D
      } else {
        scaleSt(S, dec);
        Dq = 2 ** DQB; Dinv = 2 ** DQB;
      }
      // values at the scale of St: v / D
      for (let j = 0; j < dv; j++) { big(c[vAt + j] * Dinv); vt[j] = rq(c[vAt + j] * Dinv, DQB - (SB - CB), sBits); }
      // what St predicts for the key, and the deltas
      mem.fill(0);
      for (let i = 0; i < dk; i++) { const k = qk[kAt + i]; if (k) for (let j = 0; j < dv; j++) mem[j] += S[i * dv + j] * k; }
      for (let j = 0; j < dv; j++) {
        big(mem[j]);
        const p = rq(mem[j], KB, sBits), dd = vt[j] - p;
        big(dd * beta);
        mem[j] = rq(dd * beta, TB, sBits);
      }
      for (let i = 0; i < dk; i++) {
        const k = qk[kAt + i];
        if (!k) continue;
        if (cfg.checks) for (let j = 0; j < dv; j++) { big(k * mem[j]); S[i * dv + j] = rq32(S[i * dv + j] + rq(k * mem[j], KB, sBits), 0, sBits); }
        else {
          for (let j = 0, at = i * dv; j < dv; j++, at++) {
            let w = Math.floor((k * mem[j] + wHalf) * wScale);
            w = w < wLo ? wLo : w > wHi ? wHi : w;
            const v = S[at] + w;
            S[at] = v < sLo ? sLo : v > sHi ? sHi : v;
          }
        }
      }
      // read with the query times D: the output at its true scale
      for (let i = 0; i < dk; i++) qd[i] = rq(qk[qAt + i] * Dq, DQB, QB);
      for (let j = 0; j < dv; j++) {
        let s = 0;
        for (let i = 0; i < dk; i++) s += S[i * dv + j] * qd[i];
        big(s);
        o[hd * dv + j] = rq(s, SB + QB - OB, oBits);
      }
    }

    if (trace) trace('core', o, OB);
    // per value head: rms norm, times the gain, times silu(z)
    for (let hd = 0; hd < nv; hd++) normalise(o, hd * dv, dv, OB, dv * eps, tbl.invY, YB, yBits, y, tmp);
    for (let i = 0; i < valueDim; i++) {
      const g = rq(y[i] * gain[i % dv], gainB, yBits), sz = siluOf(z[i], ZB, zBits);
      h[i] = rq(g * sz, YB + ZB - HB, hBits);
    }
    if (trace) trace('gated', h, HB);
    hooks.matvec(W.out, h, dim, outS);
    for (let i = 0; i < dim; i++) { big(outS[i]); out[i] = rq32(outS[i], ...R.out); }
    return out;
  }

  // The state as floats (S = D * St / 2^SB), for the comparison with the float reference.
  const state = () => {
    const out = new Float64Array(St.length);
    for (let hd = 0; hd < nv; hd++) {
      const f = D[hd] / 2 ** DB / 2 ** SB;
      for (let i = hd * dk * dv; i < (hd + 1) * dk * dv; i++) out[i] = St[i] * f;
    }
    return out;
  };
  // |S| of every head (the root of the sum of squares), without making the state as floats
  const norms = () => Float64Array.from({ length: nv }, (_, hd) => {
    let ss = 0;
    for (let i = hd * dk * dv; i < (hd + 1) * dk * dv; i++) ss += St[i] * St[i];
    return (Math.sqrt(ss) * D[hd]) / 2 ** DB / 2 ** SB;
  });
  const reset = () => { win.fill(0); St.fill(0); D.fill(2 ** DB); };

  // A drop-in token mixer for float.js forward(): float xn in, float out.
  const xi = new Float64Array(dim), xo = new Float64Array(dim);
  const mixer = (xn, out, pos, trace) => {
    for (let i = 0; i < dim; i++) xi[i] = clampTo(Math.round(xn[i] * 2 ** NB), nBits);
    step(xi, xo, trace);
    for (let i = 0; i < dim; i++) out[i] = xo[i] / 2 ** XB;
  };

  return { cfg, step, state, norms, reset, mixer, stats, weights: W };
}

module.exports = { DEFAULTS, build, CLAMPS, hooks, matvec };
