'use strict';

// The training run and the child's sampling in plain whole-number JavaScript. The brainfuck programs
// must match it to the bit: the same log lines, the same weights, the same names.

const S = require('./spec');
const { SW, SV, SC, MU, rs, clamp, check, lcg, tanhAt, tprimeAt, expAt, RECIP, LN } = S;

// ---- parameters ----------------------------------------------------------------------------

// Every parameter as { w, v } in named groups; the random start values are drawn unit by unit,
// in the order the brainfuck program draws them.
function initParams(m) {
  const V = m.chars.length;
  let x = S.SEED | 0;
  const draw = (s) => { x = lcg(x); return (x << 1) >> (s + 1); };   // bits s..30 of x, signed
  const P = () => ({ w: 0, v: 0 });
  const grid = (a, b, f) => Array.from({ length: a }, () => Array.from({ length: b }, f));
  if (m.kind === 'bigram') {
    const W = grid(V, V, P), b = Array.from({ length: V }, P);
    for (let j = 0; j < V; j++) for (let c = 0; c < V; c++) W[c][j].w = draw(20);
    return { W, b };
  }
  const H = m.hidden, attn = m.kind === 'attn', T = m.T, D = m.dk;
  const out = {};
  if (attn) {
    // the query and key tables, one unit per key dimension: start values of about +-2
    Object.assign(out, { Qt: grid(V, D, P), Qp: Array.from({ length: D }, P), Kt: grid(V, D, P), Kp: grid(T, D, P) });
    for (let b = 0; b < D; b++) {
      for (let c = 0; c < V; c++) out.Qt[c][b].w = draw(15);
      for (let c = 0; c < V; c++) out.Kt[c][b].w = draw(15);
      for (let i = 0; i < T; i++) out.Kp[i][b].w = draw(15);
    }
  }
  const E = Array.from({ length: m.ctx }, () => grid(V, H, P));
  const b1 = Array.from({ length: H }, P), W2 = grid(H, V, P), b2 = Array.from({ length: V }, P);
  Object.assign(out, { E, b1, W2 });
  if (attn) Object.assign(out, { Vt: grid(V, H, P), Vp: grid(T, H, P) });
  out.b2 = b2;
  for (let o = 0; o < H; o++) {
    for (let k = 0; k < m.ctx; k++) for (let c = 0; c < V; c++) E[k][c][o].w = draw(17);
    for (let j = 0; j < V; j++) W2[o][j].w = draw(20);
    if (attn) {
      for (let c = 0; c < V; c++) out.Vt[c][o].w = draw(18);
      for (let i = 0; i < T; i++) out.Vp[i][o].w = draw(18);
    }
  }
  return out;
}

function* allParams(p) {
  const walk = function* (x) { if (Array.isArray(x)) for (const y of x) yield* walk(y); else yield x; };
  for (const k of Object.keys(p)) yield* walk(p[k]);
}

// ---- the forward pass: logit indices u (1/16 nat, -128..127) -------------------------------

// sw: the weights' scale (SW while training, SC in the child). Returns u and what backward needs.
function forward(m, p, ctx, sw) {
  const V = m.chars.length;
  if (m.kind === 'bigram') {
    const u = [];
    for (let j = 0; j < V; j++) u.push(clamp(rs(check(p.W[ctx[0]][j].w + p.b[j].w), sw - 4), -128, 127));
    return { u };
  }
  const H = m.hidden, h = [], t = [], n = ctx.length, f = {};
  if (m.kind === 'attn') Object.assign(f, attention(m, p, ctx, sw));
  for (let o = 0; o < H; o++) {
    let z = p.b1[o].w;
    for (let k = 0; k < m.ctx; k++) z += p.E[k][ctx[n - m.ctx + k]][o].w;
    if (f.att) {
      // the values of the positions, weighted by the attention: a / 2^13 is added to z
      const v8 = ctx.map((c, i) => clamp(rs(check(p.Vp[i][o].w + p.Vt[c][o].w), sw - 5), -128, 127));
      let a = 0;
      for (let i = 0; i < n; i++) a += f.att[i] * v8[i];
      z += sw >= 13 ? a * 2 ** (sw - 13) : rs(a, 13 - sw);
      f.v8.push(v8);
    }
    const i = clamp(rs(check(z), sw - 5), -128, 127);
    h.push(tanhAt(i)); t.push(tprimeAt(i));
  }
  const u = [];
  for (let j = 0; j < V; j++) {
    let L = 128 * p.b2[j].w;
    for (let o = 0; o < H; o++) L += h[o] * p.W2[o][j].w;
    u.push(clamp(rs(check(L), sw + 3), -128, 127));
  }
  return { u, h, t, ...f };
}

// The attention over the last T letters, from the newest one: q and k are 8-bit numbers / 32, the
// scores s = q.k / 4 (in 1/4096), att / 256 their softmax.
function attention(m, p, ctx, sw) {
  const T = m.T, D = m.dk, q8 = [], k8 = ctx.map(() => []), s = new Array(T).fill(0);
  const r8 = (x) => clamp(rs(check(x), sw - 5), -128, 127);
  for (let b = 0; b < D; b++) {
    q8.push(r8(p.Qp[b].w + p.Qt[ctx[T - 1]][b].w));
    for (let i = 0; i < T; i++) { k8[i].push(r8(p.Kp[i][b].w + p.Kt[ctx[i]][b].w)); s[i] += q8[b] * k8[i][b]; }
  }
  const us = s.map((x) => clamp(rs(check(x), 8), -128, 127));
  const { e, i2 } = softmax(us);
  const att = e.map((x) => rs(rs(x * RECIP[i2], 14), 8));
  return { q8, k8, s, att, v8: [] };
}

// Softmax pieces shared by training and sampling.
function softmax(u) {
  const M = Math.max(...u), e = u.map((x) => expAt(x - M));
  const Ssum = e.reduce((a, b) => a + b, 0);
  return { M, e, S: Ssum, i2: rs(Ssum, 7, 0) };
}

// ---- training ------------------------------------------------------------------------------

function exampleStep(m, p, ctx, tgt) {
  const V = m.chars.length;
  const f = forward(m, p, ctx, SW), { u } = f;
  const { M, e, i2 } = softmax(u);
  const R = RECIP[i2];
  const g = e.map((ej, j) => rs(rs(ej * R, 14) - (j === tgt ? 65536 : 0), m.gs));
  const loss = LN[i2] + 256 * (M - u[tgt]);
  const acc = (q, d) => { q.v = check(q.v + d); };
  if (m.kind === 'bigram') {
    for (let j = 0; j < V; j++) { acc(p.W[ctx[0]][j], 128 * g[j]); acc(p.b[j], 128 * g[j]); }
    return loss;
  }
  for (let j = 0; j < V; j++) acc(p.b2[j], 128 * g[j]);
  const n = ctx.length, datt = new Array(n).fill(0);
  for (let o = 0; o < m.hidden; o++) {
    let dh = 0;
    for (let j = 0; j < V; j++) { dh += g[j] * p.W2[o][j].w; acc(p.W2[o][j], f.h[o] * g[j]); }
    const dz = rs(rs(check(dh), 7) * f.t[o], 7);
    acc(p.b1[o], dz);
    for (let k = 0; k < m.ctx; k++) acc(p.E[k][ctx[n - m.ctx + k]][o], dz);
    if (f.att) {
      const dzs = rs(dz, 4);
      for (let i = 0; i < n; i++) {
        datt[i] = check(datt[i] + dzs * f.v8[o][i]);
        const dv = rs(check(f.att[i] * dzs), 4);
        acc(p.Vp[i][o], dv); acc(p.Vt[ctx[i]][o], dv);
      }
    }
  }
  if (f.att) {
    // back through the softmax of the attention, then into the queries and keys
    const dd = datt.map((x) => rs(x, 8));
    const bar = rs(check(dd.reduce((a, x, i) => a + f.att[i] * x, 0)), 8);
    const ds = dd.map((x, i) => rs(check(f.att[i] * (x - bar)), 8));
    for (let b = 0; b < m.dk; b++) {
      let dq = 0;
      for (let i = 0; i < n; i++) {
        dq += ds[i] * f.k8[i][b];
        const dk = check(ds[i] * f.q8[b]);
        acc(p.Kp[i][b], dk); acc(p.Kt[ctx[i]][b], dk);
      }
      acc(p.Qp[b], check(dq)); acc(p.Qt[ctx[n - 1]][b], dq);
    }
  }
  return loss;
}

// After a batch: w -= v (rounded to the weight's scale), then v *= 1 - 2^-MU for the next step.
// With m.decay (weight decay): then every weight shrinks by w / 2^decay (rounded), so that no weight grows without end.
function update(p, m = {}) {
  const d = m.decay;
  for (const q of allParams(p)) {
    const s = q.v + 2 ** (SV - SW - 1);
    q.w = check(q.w - Math.floor(check(s, 2 ** 30) / 2 ** (SV - SW)));
    q.v -= Math.floor(s / 2 ** MU) - 2 ** (SV - SW - 1 - MU);
    if (d) q.w -= Math.floor((q.w + 2 ** (d - 1)) / 2 ** d);
  }
}

const milli = (x) => `${Math.floor(x / 1000)}.${String(x % 1000).padStart(3, '0')}`;

// text: bytes "name\nname\n..."; its length must be a multiple of the batch.
// from: { params, step, ctx } to go on where an earlier run stopped (the state it returned)
function train(m, text, { onStep, from } = {}) {
  const tokens = S.tokensOf(m);
  const p = from ? from.params : initParams(m), B = m.batch, lb = Math.log2(B);
  if (text.length % B) throw new Error('text length must be a multiple of the batch');
  let ctx = from ? from.ctx.slice() : new Array(m.T || m.ctx).fill(0), sum = 0, step = from ? from.step : 0;
  const log = [], losses = [];
  for (let i = 0; i < text.length; i++) {
    const t = tokens[text[i]];
    sum += exampleStep(m, p, ctx, t);
    ctx = t || !m.reset ? [...ctx.slice(1), t] : ctx.map(() => 0);
    if ((i + 1) % B === 0) {
      update(p, m);
      const l = rs(check(sum * 125), 9 + lb);
      step++; sum = 0;
      losses.push(l / 1000);
      log.push(`step ${step} loss ${milli(l)}`);
      if (onStep) onStep(step, l, p);
    }
  }
  return { params: p, log, losses, step, ctx };
}

// ---- the child ---------------------------------------------------------------------------------

// The child's weights: every trained weight rounded to the child's scale.
function childParams(p) {
  const map = (x) => (Array.isArray(x) ? x.map(map) : { w: rs(x.w, SW - SC), v: 0 });
  const out = {};
  for (const k of Object.keys(p)) out[k] = map(p[k]);
  return out;
}

// n names from the child's weights, as the child program prints them.
function sample(m, cp, n, seed = S.SAMPLE_SEED) {
  const V = m.chars.length;
  let x = seed | 0, out = '', ctx = new Array(m.T || m.ctx).fill(0), len = 0;
  while (n > 0) {
    const { u } = forward(m, cp, ctx, SC);
    const { e, S: Ssum } = softmax(u);
    x = lcg(x);
    const rb = S.sampleBits(m), r = rs(((x << 1) >>> (32 - rb)) * Ssum, rb, 0);       // the top rb bits of x (below the sign) times S / 2^rb
    let tok = 0, cum = 0;
    for (let j = 0; j < V - 1; j++) { cum += e[j]; if (r - cum >= 0) tok++; }
    out += m.chars[tok];
    if (tok) { ctx = [...ctx.slice(1), tok]; if (m.reset && ++len > 60) throw new Error('a name of more than 60 letters'); }
    else { ctx = m.reset ? ctx.map(() => 0) : [...ctx.slice(1), tok]; n--; len = 0; }
  }
  return out;
}

module.exports = { attention, initParams, allParams, forward, softmax, exampleStep, update, train, childParams, sample, milli };
