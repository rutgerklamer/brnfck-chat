'use strict';

// Where every cell of a training program (and of its child, which has the same tape) lives.
//
//   [global cells]
//   attn only: [key frame -1] [key frame 0] ... [key frame dk-1] [landing] [end slot] [attention head]
//   [frame -1] [frame 0] ... [frame units-1] [landing frame] [b2 slots] [end slot]
//   [head cells] [head slot 0] ... [head slot 26] [end head slot]
//
// A frame holds one unit: an output token (bigram), a hidden unit (mlp, attn) or a dimension of the
// queries and keys (the key frames of attn). It is a row of slots of 13 cells; a slot holds one
// parameter (W, its velocity V), 8 scratch cells and two lanes. Lanes carry values from frame to
// frame. The walks over frames, slots and head slots all stop on a zero marker.


const SL = 13;
const MK = 0, W = 1, VEL = 2, LA = 11, LB = 12;
const S = (i) => 3 + i;
const HSZ = 24;          // a head slot: one token, or one position of the attention
const HF = { MK: 0, U: 1, E: 2, P: 3, Y: 4, G: 5, CA: 6, CB: 7, CC: 8, CD: 9, s: (i) => 10 + i };

// A row of frames from frame -1 to the landing frame, `extra` slots after it, then the end slot.
function region(R0, units, slots, sl, extra = 0) {
  const FS = slots * SL;
  const frame = (f) => R0 + (f + 1) * FS;                // f = -1 .. units (the landing frame)
  const regionSlots = (units + 2) * slots + extra;
  return { R0, units, slots, sl, FS, frame, at: (f, s, field) => frame(f) + s * SL + field, regionSlots, END: R0 + regionSlots * SL };
}

// The cells of a head: globals, then head slots of HSZ cells (n of them and an end slot).
function headArea(base, n) {
  const g = { M: base, T: base + 2, S: base + 4, I2: base + 6, R: base + 8, LOSS: base + 10, STEP: base + 12 };
  const c = (i) => base + 14 + i;                        // 34 scratch cells
  const hs = (j) => base + 48 + j * HSZ;
  return { g, c, hs, n, end: hs(n + 1) };
}

function layout(m) {
  const V = m.chars.length;
  const bigram = m.kind === 'bigram', attn = m.kind === 'attn', K = m.ctx, T = m.T || m.ctx;
  const g = { X: 2, BC: 4, TOK: 6, F: 8, ftmp: 9, t: (i) => 11 + i, O: 18, N: 19, ntmp: 20, C: (k) => 24 + k };
  let at = 40;

  let key = null, AH = null;
  if (attn) {
    const D = m.dk, sl = { hdr: 0, qt: (c) => 1 + c, qp: 1 + V, kt: (c) => 2 + V + c, kp: (i) => 2 + 2 * V + i };
    key = region(at, D, 2 + 2 * V + T, sl);
    const off = (s, f) => s * SL + f;
    Object.assign(key, {
      TK: [...Array(T)].map((_, i) => off(sl.kp(i), LA)), TT: S(6),
      Q8: off(sl.qp, LA), K8: (i) => off(sl.kt(i), LB), SC: (i) => off(sl.kp(i), LB), DS: (i) => off(sl.kt(i), LA),
    });
    AH = headArea(key.END + SL + 4, T);
    at = AH.end + 8;
  }

  const units = bigram ? V : m.hidden;
  let sl, slots;
  if (bigram) { sl = { hdr: 0, w: (c) => 1 + c, b: 1 + V }; slots = 2 + V; }
  else {
    sl = { hdr: 0, e: (k, c) => 1 + k * V + c, b1: 1 + K * V, w2: (j) => 2 + K * V + j };
    slots = 2 + K * V + V;
    if (attn) { const v0 = slots; sl.vt = (c) => v0 + c; sl.vp = (i) => v0 + V + i; slots += V + T; }
  }
  const hid = region(at, units, slots, sl, bigram ? 0 : V);
  const off = (s, f) => s * SL + f;
  hid.B2 = hid.R0 + (units + 2) * hid.FS;                // mlp, attn: the output biases, one slot each
  hid.TT = S(6);
  if (attn) {
    hid.TK = [...Array(T)].map((_, i) => off(sl.vp(i), LA));
    Object.assign(hid, { ATT: (i) => off(sl.vp(i), LB), DATT: (i) => off(sl.vt(i), LA), V8: (i) => off(sl.vt(i), LB) });
  } else {
    if (T > 3) throw new Error(`a context of ${T} does not fit: without attention the header slot holds 3 tokens`);
    hid.TK = [LA, LB, S(7)].slice(0, T);                 // in the header slot
  }
  hid.TKm = hid.TK.slice(T - K);                         // the tokens the first layer reads

  const H = headArea(hid.END + SL + 4, V);
  const tapeSize = H.end + 64;
  return { m, V, bigram, attn, K, T, g, key, AH, H, hid, regions: key ? [key, hid] : [hid], tapeSize, ...hid, hg: H.g, hs: H.hs };
}

// The slot of every parameter: for each region, an array over its slots of the parameter it holds
// ({ w, v } of the reference), HDR for a frame marker, null for an empty slot.
const HDR = 'hdr';
function slotParams(L, p) {
  const V = L.V;
  const fill = (R) => {
    const out = new Array(R.regionSlots).fill(null);
    const put = (f, s, x) => { out[(f + 1) * R.slots + s] = x; };
    for (let f = 0; f < R.units; f++) put(f, R.sl.hdr, HDR);
    return { out, put };
  };
  const res = [];
  if (L.key) {
    const R = L.key, { out, put } = fill(R);
    for (let b = 0; b < R.units; b++) {
      for (let c = 0; c < V; c++) { put(b, R.sl.qt(c), p.Qt[c][b]); put(b, R.sl.kt(c), p.Kt[c][b]); }
      put(b, R.sl.qp, p.Qp[b]);
      for (let i = 0; i < L.T; i++) put(b, R.sl.kp(i), p.Kp[i][b]);
    }
    res.push(out);
  }
  const R = L.hid, { out, put } = fill(R);
  if (L.bigram) {
    for (let j = 0; j < V; j++) {
      for (let c = 0; c < V; c++) put(j, R.sl.w(c), p.W[c][j]);
      put(j, R.sl.b, p.b[j]);
    }
  } else {
    for (let o = 0; o < R.units; o++) {
      for (let k = 0; k < L.K; k++) for (let c = 0; c < V; c++) put(o, R.sl.e(k, c), p.E[k][c][o]);
      put(o, R.sl.b1, p.b1[o]);
      for (let j = 0; j < V; j++) put(o, R.sl.w2(j), p.W2[o][j]);
      if (L.attn) {
        for (let c = 0; c < V; c++) put(o, R.sl.vt(c), p.Vt[c][o]);
        for (let i = 0; i < L.T; i++) put(o, R.sl.vp(i), p.Vp[i][o]);
      }
    }
    for (let j = 0; j < V; j++) out[(R.units + 2) * R.slots + j] = p.b2[j];
  }
  res.push(out);
  return res;
}

// The W (or V) cell of every slot of each region, from the reference's parameters: the frame markers
// (64), the parameters, zero elsewhere.
function regionValues(L, p, field = 'w') {
  return slotParams(L, p).map((slots) => slots.map((q) => (q === HDR ? (field === 'w' ? 64 : 0) : q ? q[field] : 0)));
}

// The other way: every weight w of the parameters p from region values (the child's, for one)
function setFromValues(L, p, vals) {
  slotParams(L, p).forEach((slots, r) => slots.forEach((q, i) => { if (q && q !== HDR) { q.w = vals[r][i]; q.v = 0; } }));
  return p;
}

module.exports = { layout, regionValues, setFromValues, SL, MK, W, VEL, LA, LB, S, HSZ, HF };
