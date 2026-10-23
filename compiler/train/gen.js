'use strict';

// The brainfuck programs of a model: the trainer (a momentum step per batch, a loss line per step, then the child), the
// child (weights as runs of + or -, then a sampling engine), and selfTrainer, which prints itself with its new weights.

const S = require('./spec');
const { Kernels } = require('./kernels');
const { layout, regionValues, SL, MK, W, VEL, LA, LB, S: Sc, HSZ, HF } = require('./layout');

const byIndex = (f) => Array.from({ length: 256 }, (_, i) => f(i < 128 ? i : i - 256));
const TANH256 = byIndex(S.tanhAt), TPRIME256 = byIndex(S.tprimeAt);
const EXP256 = Array.from({ length: 256 }, (_, i) => S.expAt(i === 0 ? 0 : i - 256));
const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);

class Gen {
  constructor(m, { child = false } = {}) {
    this.m = m; this.L = layout(m); this.child = child;
    this.sw = child ? S.SC : S.SW;
    this.e = new Kernels();
    this.parts = []; this.seen = 0; this.chars = 0;
  }

  // A part of the program starts here: [name, its first character]
  mark(name) {
    const code = this.e.code;
    for (; this.seen < code.length; this.seen++) this.chars += code[this.seen].length;
    this.parts.push([name, this.chars]);
  }

  // ---- inside one frame --------------------------------------------------------------------

  // Walk the V slots from `first` on with the token held in tk: onMatch(slot) runs in the slot
  // whose position equals the token; a carry rides along in the slots' S0 (from first to first + V).
  tokenWalk(A, tk, first, tmp, onMatch) {
    const V = this.L.V;
    const e = this.e;
    e.copy(tk, A(first, Sc(1)), tmp);
    for (let c = 0; c < V; c++) {
      const s = first + c;
      e.whenZero(A(s, Sc(1)), [A(s, Sc(2)), A(s, Sc(3)), A(s, Sc(4))], () => onMatch(s));
      e.add(A(s, Sc(1)), -1);
      if (c < V - 1) e.move(A(s, Sc(1)), A(s + 1, Sc(1))); else e.clear(A(s, Sc(1)));
      e.move(A(s, Sc(0)), A(s + 1, Sc(0)));
    }
  }

  // The 8-bit value of (W of slot `start` + W of the table slot the token picks), into `out`:
  // clamp(round(sum / 2^(sw - 5)), -128, 127). The sum is carried to slot first + V.
  pick8(A, tk, table0, start, out, tmp) {
    const V = this.L.V;
    const e = this.e;
    e.copy(A(start, W), A(table0, Sc(0)), A(start, Sc(1)));
    this.tokenWalk(A, tk, table0, tmp, (s) => e.copy(A(s, W), A(s, Sc(0)), A(s, Sc(5))));
    const end = table0 + V;
    e.shift(A(end, Sc(0)), out, this.sw - 5, 8, { lo: -128, clamp: true }, this.s10(A, end));
  }

  // Add the carry `x` to V of the slot `start` and of the table slot the token picks; x ends 0.
  addPicked(A, tk, table0, start, x, tmp) {
    const V = this.L.V;
    const e = this.e;
    e.copy(x, A(start, VEL), tmp);
    e.move(x, A(table0, Sc(0)));
    this.tokenWalk(A, tk, table0, tmp, (s) => e.copy(A(s, Sc(0)), A(s, VEL), A(s, Sc(5))));
    e.clear(A(table0 + V, Sc(0)));
  }

  // ten scratch cells: S1..S7 of a slot and S0..S2 of the next one
  s10(A, s) { return [...range(1, 8).map((i) => A(s, Sc(i))), A(s + 1, Sc(0)), A(s + 1, Sc(1)), A(s + 1, Sc(2))]; }

  // Forward through one key frame (attn): q, the keys of the T positions, and the scores q.k added
  // to the score lanes.
  keyForwardBody(fb) {
    const { e, L, child } = this, R = L.key, sl = R.sl, nx = fb + R.FS, T = L.T;
    const A = (s, f) => fb + s * SL + f;
    this.pick8(A, fb + R.TK[T - 1], sl.qt(0), sl.qp, fb + R.Q8, A(sl.qp, Sc(2)));
    for (let i = 0; i < T; i++) this.pick8(A, fb + R.TK[i], sl.kt(0), sl.kp(i), fb + R.K8(i), A(sl.kp(i), Sc(2)));
    const pairs = range(0, T).map((i) => [fb + R.K8(i), fb + R.SC(i), A(sl.kt(i), Sc(7))]);
    e.mulAcc(fb + R.Q8, 8, pairs, range(0, 8).map((i) => A(sl.qp, Sc(i))), { keepA: !child });
    if (child) for (let i = 0; i < T; i++) e.clear(fb + R.K8(i));
    for (let i = 0; i < T; i++) { e.move(fb + R.TK[i], nx + R.TK[i]); e.move(fb + R.SC(i), nx + R.SC(i)); }
    if (!child) e.move(fb + R.TT, nx + R.TT);
  }

  // Backward through one key frame: dk = ds q and dq = sum of ds k into the velocities.
  keyBackwardBody(fb) {
    const { e, L } = this, R = L.key, sl = R.sl, nx = fb + R.FS, T = L.T;
    const A = (s, f) => fb + s * SL + f;
    for (let i = 0; i < T; i++) { e.move(nx + R.TK[i], fb + R.TK[i]); e.move(nx + R.DS(i), fb + R.DS(i)); }
    const s8 = range(0, 8).map((i) => A(sl.qp, Sc(i)));
    e.mulAcc(fb + R.Q8, 8, range(0, T).map((i) => [fb + R.DS(i), A(sl.kp(i), Sc(7)), A(sl.kt(i), Sc(7))]), s8, { keepA: false });
    const DQ = A(sl.qp, LB);
    for (let i = 0; i < T; i++) e.mulAcc(fb + R.K8(i), 8, [[fb + R.DS(i), DQ, A(sl.kt(i), Sc(7))]], s8, { keepA: false });
    this.addPicked(A, fb + R.TK[T - 1], sl.qt(0), sl.qp, DQ, A(sl.qp, Sc(2)));
    for (let i = 0; i < T; i++) this.addPicked(A, fb + R.TK[i], sl.kt(0), sl.kp(i), A(sl.kp(i), Sc(7)), A(sl.kp(i), Sc(2)));
  }

  // Forward through one frame of the main region (written for the frame at fb; the next is at fb + FS).
  forwardBody(fb) {
    const V = this.L.V;
    const { e, L, child, sw } = this, R = L.hid, nx = fb + R.FS, hdr = R.sl.hdr;
    const A = (s, f) => fb + s * SL + f, N = (s, f) => nx + s * SL + f;
    const copyW = (s) => e.copy(A(s, W), A(s, Sc(0)), A(s, Sc(5)));
    if (L.bigram) {
      const { w, b } = R.sl;
      e.copy(A(b, W), A(w(0), Sc(0)), A(b, Sc(0)));
      this.tokenWalk(A, fb + R.TK[0], w(0), A(hdr, Sc(0)), copyW);
      e.move(fb + R.TK[0], nx + R.TK[0]);
      const s10 = [...range(2, 8).map((i) => A(b, Sc(i))), A(b, LA), A(b, LB), N(hdr, Sc(0)), N(hdr, Sc(1))];
      e.shift(A(b, Sc(0)), A(b, Sc(1)), sw - 4, 8, { lo: -128, clamp: true }, s10);
      for (let i = V - 2; i >= 0; i--) e.move(A(w(i), LB), N(w(i + 1), LB));      // the queue of logits
      e.move(A(b, Sc(1)), N(w(0), LB));
    } else {
      const { e: E, b1, w2 } = R.sl;
      e.copy(A(b1, W), A(E(0, 0), Sc(0)), A(b1, Sc(0)));
      for (let k = 0; k < L.K; k++) this.tokenWalk(A, fb + R.TKm[k], E(k, 0), A(hdr, Sc(0)), copyW);
      if (L.attn) this.valuesForward(A, fb);
      for (let i = 0; i < L.T; i++) e.move(fb + R.TK[i], nx + R.TK[i]);
      const s10 = [...range(2, 8).map((i) => A(b1, Sc(i))), ...range(0, 4).map((i) => A(w2(0), Sc(i)))];
      e.shift(A(b1, Sc(0)), A(b1, Sc(1)), sw - 5, 8, { lo: -128, clamp: true }, s10);
      e.lookupAll(A(b1, Sc(1)), child ? [[A(b1, LA), TANH256]] : [[A(b1, LA), TANH256], [A(b1, LB), TPRIME256]], s10.slice(0, 9), { keepX: false });
      const pairs = range(0, V).map((j) => [A(w2(j), W), A(w2(j), LA), A(w2(j), Sc(0))]);
      e.mulAcc(A(b1, LA), 8, pairs, range(0, 8).map((i) => A(b1, Sc(i))));
      if (child) e.clear(A(b1, LA));
      for (let j = 0; j < V; j++) e.move(A(w2(j), LA), N(w2(j), LA));              // the logits travel on
    }
    if (!child) e.move(fb + R.TT, nx + R.TT);
  }

  // attn: z (in S0 of b1) += the attention-weighted values of the positions; the weights travel on
  valuesForward(A, fb) {
    const { e, L, child, sw } = this, R = L.hid, { vt, vp, b1 } = R.sl, nx = fb + R.FS;
    const AA = A(b1, Sc(7)), Z = A(b1, Sc(0));
    for (let i = 0; i < L.T; i++) {
      this.pick8(A, fb + R.TK[i], vt(0), vp(i), fb + R.V8(i), A(vp(i), Sc(2)));
      e.mulAcc(fb + R.V8(i), 8, [[fb + R.ATT(i), AA, A(vp(i), Sc(3))]], range(0, 8).map((j) => A(vt(i), Sc(j))), { keepA: !child });
      e.move(fb + R.ATT(i), nx + R.ATT(i));
    }
    if (sw >= 13) e.scatter(AA, [[Z, 2 ** (sw - 13)]]);
    else { e.shift(AA, A(b1, Sc(1)), 13 - sw, 20, { lo: -(2 ** 19) }, this.s10(A, vp(0))); e.move(A(b1, Sc(1)), Z); }
  }

  // Backward through one frame of the main region (written for the frame at fb, which pulls its lanes from fb + FS).
  backwardBody(fb) {
    const V = this.L.V;
    const { e, L, m } = this, R = L.hid, nx = fb + R.FS, hdr = R.sl.hdr;
    const A = (s, f) => fb + s * SL + f, N = (s, f) => nx + s * SL + f;
    for (let i = 0; i < L.T; i++) e.move(nx + R.TK[i], fb + R.TK[i]);
    if (L.bigram) {
      const { w, b } = R.sl;
      for (let i = 0; i < V; i++) e.move(N(w(i), LB), A(w(i), LB));
      // this frame's gradient is first in the queue: v_b += 128 g, then the row of the context token
      e.scatter(A(w(0), LB), [[A(b, VEL), 128], [A(w(0), Sc(0)), 1]]);
      this.tokenWalk(A, fb + R.TK[0], w(0), A(hdr, Sc(0)), (s) => {
        e.scatter(A(s, Sc(0)), [[A(s, VEL), 128], [A(s, Sc(5)), 1]]).move(A(s, Sc(5)), A(s, Sc(0)));
      });
      e.clear(A(b, Sc(0)));
      for (let i = 0; i < V - 1; i++) e.move(A(w(i + 1), LB), A(w(i), LB));
      return;
    }
    const { e: E, b1, w2 } = R.sl, GB = 18 - m.gs;
    for (let j = 0; j < V; j++) e.move(N(w2(j), LB), A(w2(j), LB));
    if (L.attn) for (let i = 0; i < L.T; i++) { e.move(nx + R.ATT(i), fb + R.ATT(i)); e.move(nx + R.DATT(i), fb + R.DATT(i)); }
    const s8 = range(0, 8).map((i) => A(b1, Sc(i)));
    const s10 = [...range(2, 8).map((i) => A(b1, Sc(i))), ...range(0, 4).map((i) => A(w2(0), Sc(i)))];
    // v_W2 += h g
    e.mulAcc(A(b1, LA), 8, range(0, V).map((j) => [A(w2(j), LB), A(w2(j), VEL), A(w2(j), Sc(0))]), s8, { keepA: false });
    // dh = sum over the tokens of g W2, carried along the slots
    for (let j = 0; j < V; j++) {
      const s = w2(j);
      e.mulAcc(A(s, LB), GB, [[A(s, W), A(s, LA), A(s + 1, Sc(0))]], range(0, 8).map((i) => A(s, Sc(i))));
      if (j < V - 1) e.move(A(s, LA), A(s + 1, LA));
    }
    e.move(A(w2(V - 1), LA), A(b1, Sc(0)));
    e.shift(A(b1, Sc(0)), A(b1, Sc(1)), 7, 24, { lo: -(2 ** 23) }, s10);
    // dz = dh * (1 - tanh^2)
    e.mulAcc(A(b1, LB), 9, [[A(b1, Sc(1)), A(b1, Sc(0)), A(b1, Sc(2))]], [...range(3, 8).map((i) => A(b1, Sc(i))), ...range(0, 3).map((i) => A(w2(0), Sc(i)))], { keepA: false });
    e.clear(A(b1, Sc(1)));
    e.shift(A(b1, Sc(0)), A(b1, Sc(1)), 7, 24, { lo: -(2 ** 23) }, s10);
    if (L.attn) e.copy(A(b1, Sc(1)), A(b1, LA), A(b1, Sc(2)));
    e.copy(A(b1, Sc(1)), A(b1, VEL), A(b1, Sc(2)));
    e.move(A(b1, Sc(1)), A(E(0, 0), Sc(0)));
    for (let k = 0; k < L.K; k++) {
      this.tokenWalk(A, fb + R.TKm[k], E(k, 0), A(hdr, Sc(0)), (s) => e.copy(A(s, Sc(0)), A(s, VEL), A(s, Sc(5))));
    }
    e.clear(A(b1, Sc(0)));
    if (L.attn) this.valuesBackward(A, fb, s10);
  }

  // attn: datt += (dz / 16) v8 on the lanes, and dv = att (dz / 16) / 16 into the values' velocities
  valuesBackward(A, fb, s10) {
    const { e, L } = this, R = L.hid, { vt, vp, b1 } = R.sl;
    const DZ = A(b1, LA), DZS = A(b1, LB);
    e.copy(DZ, A(b1, Sc(0)), A(b1, Sc(1)));
    e.shift(A(b1, Sc(0)), DZS, 4, 24, { lo: -(2 ** 23) }, s10);
    for (let i = 0; i < L.T; i++) {
      const s8 = range(0, 8).map((j) => A(vp(i), Sc(j)));
      e.mulAcc(fb + R.V8(i), 8, [[DZS, fb + R.DATT(i), A(vt(i), Sc(7))]], s8, { keepA: false });
      const ACC = A(vp(i), Sc(0)), DV = A(vp(i), Sc(1));
      e.mulAcc(fb + R.ATT(i), 10, [[DZS, ACC, DV]], range(0, 8).map((j) => A(vt(i), Sc(j))));
      e.shift(ACC, DV, 4, 24, { lo: -(2 ** 23) }, [...range(2, 8).map((j) => A(vp(i), Sc(j))), ...range(0, 4).map((j) => A(vt(i), Sc(j)))]);
      this.addPicked(A, fb + R.TK[i], vt(0), vp(i), DV, A(vp(i), Sc(2)));
    }
    e.clear(DZ).clear(DZS);
  }

  walkRegion(R, body, dir = 1) {
    const hdr = R.sl.hdr;
    if (dir > 0) this.e.walk(R.at(0, hdr, W), R.FS, R.units, () => body(R.frame(0)));
    else this.e.walk(R.at(R.units - 1, hdr, W), R.FS, R.units, () => body(R.frame(R.units - 1)), -1);
  }

  // ---- heads: a softmax over the head slots ------------------------------------------------

  headWalk(H, body) {
    const h = H.hs(0);
    this.e.walk(h + HF.MK, HSZ, H.n, () => body((x) => h + x, (i) => h + HF.s(i), (x) => h + HSZ + x));
  }

  // U = clamp(round(P / 2^k)) (when k is given), and M = the largest U
  indexMax(H, k) {
    const e = this.e;
    e.add(H.hs(0) + HF.CA, -128);
    this.headWalk(H, (f, s, n) => {
      if (k !== null) e.shift(f(HF.P), f(HF.U), k, 8, { lo: -128, clamp: true }, range(0, 10).map(s));
      e.copy(f(HF.U), s(10), s(11));
      e.scatter(f(HF.CA), [[s(10), -1], [s(11), 1]]).move(s(11), f(HF.CA));
      e.copy(s(10), s(12), s(11));
      e.shift(s(12), s(13), 8, 1, { addend: 255 }, range(0, 10).map(s));
      e.loop(s(13), () => { e.clear(s(13)); e.move(s(10), f(HF.CA)); });
      e.clear(s(10));
      e.move(f(HF.CA), n(HF.CA));
    });
    e.move(H.hs(H.n) + HF.CA, H.g.M);
  }

  // E = EXP[U - M] and S = the sum of E; with a target: Y marks it and CD gathers -256 (U_t - M)
  expSum(H, withTarget) {
    const e = this.e, g = H.g, h0 = H.hs(0), end = H.hs(H.n);
    e.move(g.M, h0 + HF.CA);
    if (withTarget) e.move(g.T, h0 + HF.CB);
    this.headWalk(H, (f, s, n) => {
      if (withTarget) {
        e.whenZero(f(HF.CB), [s(0), s(1), s(2)], () => e.add(f(HF.Y), 1));
        e.add(f(HF.CB), -1);
      }
      e.scatter(f(HF.CA), [[f(HF.U), -1], [s(0), 1]]).move(s(0), f(HF.CA));
      if (withTarget) {
        e.copy(f(HF.Y), s(0), s(1));
        e.loop(s(0), () => { e.clear(s(0)); e.scatter(f(HF.U), [[f(HF.CD), -256], [s(1), 1]]).move(s(1), f(HF.U)); });
      }
      e.lookupAll(f(HF.U), [[f(HF.E), EXP256]], range(0, 9).map(s), { keepX: false });
      e.copy(f(HF.E), f(HF.CC), s(0));
      for (const c of withTarget ? [HF.CA, HF.CB, HF.CC, HF.CD] : [HF.CA, HF.CC]) e.move(f(c), n(c));
    });
    e.clear(end + HF.CA);
    if (withTarget) { e.clear(end + HF.CB); e.move(end + HF.CD, g.LOSS); }
    e.move(end + HF.CC, g.S);
  }

  // R = RECIP[S >> 7] (and the loss gets LN[S >> 7]); then p = E R / 2^14 into U, and finish(f, s)
  probs(H, withLoss, finish) {
    const e = this.e, g = H.g, N = H.n * 128 + 1;            // S < (n + 1) 2^14
    e.shift(g.S, g.I2, 7, Math.ceil(Math.log2(N)), { addend: 0 }, range(0, 10).map(H.c));
    const outs = [[g.R, S.RECIP.slice(0, N)]];
    if (withLoss) outs.push([g.LOSS, S.LN.slice(0, N)]);
    e.chainAll(g.I2, outs, 128, range(0, 16).map(H.c), { keepX: false });
    e.move(g.R, H.hs(0) + HF.CA);
    this.headWalk(H, (f, s, n) => {
      e.mulAcc(f(HF.E), 16, [[f(HF.CA), f(HF.P), s(0)]], range(1, 9).map(s), { keepA: false });
      e.shift(f(HF.P), f(HF.U), 14, 17, {}, range(0, 10).map(s));
      finish(f, s);
      e.move(f(HF.CA), n(HF.CA));
    });
    e.clear(H.hs(H.n) + HF.CA);
  }

  // logits from the landing frame into the head slots, u = the logit index, M = the largest u
  headLogits() {
    const V = this.L.V;
    const { e, L, sw } = this, R = L.hid, land = R.units;
    for (let j = 0; j < V; j++) {
      const h = L.hs(j);
      if (L.bigram) e.move(R.at(land, R.sl.w(V - 1 - j), LB), h + HF.U);
      else {
        const b2 = R.B2 + j * SL;
        e.move(R.at(land, R.sl.w2(j), LA), h + HF.P);
        e.scatter(b2 + W, [[h + HF.P, 128], [b2 + Sc(0), 1]]).move(b2 + Sc(0), b2 + W);
      }
    }
    this.indexMax(L.H, L.bigram ? null : sw + 3);
  }

  head() {
    const V = this.L.V;
    const { e, L, m } = this, R = L.hid, gs = m.gs;
    e.move(R.frame(R.units) + R.TT, L.hg.T);
    this.headLogits();
    this.expSum(L.H, true);
    // p = e R / 2^14, d = p - 65536 [target], g = d / 2^gs
    this.probs(L.H, true, (f, s) => {
      e.shl(f(HF.Y), f(HF.U), 16, [s(0), s(1)], -1);
      if (gs) e.shift(f(HF.U), f(HF.G), gs, 18 - gs, { lo: -(2 ** (17 - gs)) }, range(0, 10).map(s));
      else e.move(f(HF.U), f(HF.G));
    });
    // the gradients go to the landing frame, where the backward walk picks them up
    for (let j = 0; j < V; j++) {
      const h = L.hs(j);
      if (L.bigram) e.move(h + HF.G, R.at(R.units, R.sl.w(V - 1 - j), LB));
      else {
        const b2 = R.B2 + j * SL;
        e.scatter(h + HF.G, [[b2 + VEL, 128], [h + HF.s(0), 1]]).move(h + HF.s(0), h + HF.G);
        e.move(h + HF.G, R.at(R.units, R.sl.w2(j), LB));
      }
    }
  }

  // attn: the softmax of the scores into att (in G of the attention head and on the lanes of frame 0)
  attentionForward() {
    const { e, L, child } = this, K = L.key, AH = L.AH, R = L.hid;
    for (let i = 0; i < L.T; i++) e.move(K.frame(K.units) + K.SC(i), AH.hs(i) + HF.P);
    this.indexMax(AH, 8);
    this.expSum(AH, false);
    this.probs(AH, false, (f, s) => e.shift(f(HF.U), f(HF.G), 8, 10, {}, range(0, 10).map(s)));
    for (let i = 0; i < L.T; i++) {
      const h = AH.hs(i);
      if (child) e.move(h + HF.G, R.frame(0) + R.ATT(i));
      else e.copy(h + HF.G, R.frame(0) + R.ATT(i), h + HF.s(0));
    }
  }

  // attn: back through the softmax: dd = datt / 256, ds = att (dd - sum of att dd / 256) / 256,
  // on the lanes of the key landing frame
  attentionBackward() {
    const { e, L } = this, K = L.key, AH = L.AH, R = L.hid;
    for (let i = 0; i < L.T; i++) e.move(R.frame(0) + R.DATT(i), AH.hs(i) + HF.P);
    this.headWalk(AH, (f, s, n) => {
      e.shift(f(HF.P), f(HF.U), 8, 24, { lo: -(2 ** 23) }, range(0, 10).map(s));
      e.mulAcc(f(HF.G), 10, [[f(HF.U), f(HF.CA), s(0)]], range(1, 9).map(s));
      e.move(f(HF.CA), n(HF.CA));
    });
    const end = AH.hs(AH.n);
    e.shift(end + HF.CA, AH.hs(0) + HF.CB, 8, 24, { lo: -(2 ** 23) }, range(0, 10).map(AH.c));
    this.headWalk(AH, (f, s, n) => {
      e.scatter(f(HF.CB), [[f(HF.U), -1], [s(0), 1]]).move(s(0), f(HF.CB));
      e.mulAcc(f(HF.G), 10, [[f(HF.U), f(HF.P), s(0)]], range(1, 9).map(s), { keepA: false });
      e.clear(f(HF.U));
      e.shift(f(HF.P), f(HF.E), 8, 24, { lo: -(2 ** 23) }, range(0, 10).map(s));
      e.move(f(HF.CB), n(HF.CB));
    });
    e.clear(end + HF.CB);
    for (let i = 0; i < L.T; i++) e.move(AH.hs(i) + HF.E, K.frame(K.units) + K.DS(i));
  }

  // ---- slot walks: start values, the momentum step, printing the child ------------------------

  slotWalk(R, body) {
    const c = (x) => R.R0 + x, n = (x) => R.R0 + SL + x;
    this.e.walk(R.R0 + MK, SL, R.regionSlots, () => body(c, n));
  }

  // A slot draws its start value when LA is 1 (about +-1/2), 2 (+-1/4), 3 (+-2) or LB is 1 (+-1/16).
  initWeights() {
    const { e, L } = this;
    L.regions.forEach((R, r) => {
      if (r) e.move(L.regions[r - 1].END + VEL, R.R0 + VEL);
      this.slotWalk(R, (c, n) => {
        const s10 = [...range(1, 8).map((i) => c(Sc(i))), n(Sc(0)), n(Sc(1)), n(Sc(2))];
        const draw = (k) => {
          e.lcg(c(VEL), [c(Sc(0)), c(Sc(1))]);
          e.copy(c(VEL), c(Sc(0)), c(Sc(1)));
          e.shift(c(Sc(0)), c(W), k, 31 - k, { lo: -(2 ** (30 - k)), addend: 0 }, s10);
        };
        e.switchOn(c(LA), n(Sc(3)), [[1, () => draw(17)], [2, () => draw(18)], [3, () => draw(15)]], n(Sc(4)));
        e.loop(c(LB), () => { e.clear(c(LB)); draw(20); });
        e.move(c(VEL), n(VEL));
      });
    });
    e.clear(L.hid.END + VEL);
  }

  // w -= v / 2^14 (rounded), v -= v / 8: one pass over the 32 bits of v + 2^13
  momentumStep() {
    const e = this.e, sh = S.SV - S.SW;
    for (const R of this.L.regions) {
      this.slotWalk(R, (c) => {
        const H = [c(Sc(3)), c(Sc(4))];
        e.copy(c(VEL), c(Sc(0)), c(Sc(7)));
        e.addBig(c(Sc(0)), 2 ** (sh - 1), H);
        e.peel(c(Sc(0)), {
          m: 32,
          onSet: (j) => {
            const sg = j === 31 ? 1 : -1;
            if (j >= sh) e.addPow(c(W), j - sh, sg, H);
            if (j >= S.MU) e.addPow(c(VEL), j - S.MU, sg, H);
          },
        }, { Zo: c(Sc(1)), T: c(Sc(2)), H, K: c(Sc(5)), Kt: c(Sc(6)) });
        e.add(c(VEL), 2 ** (sh - 1 - S.MU));
        // weight decay: w -= w / 2^decay, rounded, from the bits of w + 2^(decay - 1)
        const d = this.m.decay;
        if (d) {
          e.copy(c(W), c(Sc(0)), c(Sc(7)));
          e.addBig(c(Sc(0)), 2 ** (d - 1), H);
          e.peel(c(Sc(0)), { m: 32, onSet: (j) => { if (j >= d) e.addPow(c(W), j - d, j === 31 ? 1 : -1, H); } }, { Zo: c(Sc(1)), T: c(Sc(2)), H, K: c(Sc(5)), Kt: c(Sc(6)) });
        }
      });
    }
  }

  // Print every slot's weight at the child's scale as a run of + or -, then 13 times >.
  printChildWeights() {
    const { e, L } = this, g = L.g, k = S.SW - S.SC;
    e.printText('>'.repeat(L.regions[0].R0 + W), g.O, g.N, g.ntmp);
    L.regions.forEach((R, r) => {
      if (r) e.printText('>'.repeat(R.R0 - L.regions[r - 1].END), g.O, g.N, g.ntmp);
      this.slotWalk(R, (c, n) => {
        const s10 = [...range(3, 8).map((i) => c(Sc(i))), ...range(0, 5).map((i) => n(Sc(i)))];
        e.copy(c(W), c(Sc(0)), c(Sc(1)));
        e.shift(c(Sc(0)), c(Sc(2)), k, 24, { clamp: true }, s10);
        e.scatter(c(W), [[c(Sc(0)), -1], [c(Sc(1)), 1]]).move(c(Sc(1)), c(W));
        e.shift(c(Sc(0)), c(Sc(1)), k, 24, { addend: 2 ** (k - 1) - 1, clamp: true }, s10);
        e.add(c(LA), 43).loop(c(Sc(2)), () => { e.add(c(Sc(2)), -1); e.out(c(LA)); });
        e.add(c(LA), 2).loop(c(Sc(1)), () => { e.add(c(Sc(1)), -1); e.out(c(LA)); });
        e.add(c(LA), 17).to(c(LA)).raw('.'.repeat(SL));
        e.clear(c(LA));
      });
    });
  }

  // ---- the training program ----------------------------------------------------------------

  // The writing part: the walk markers, which slots draw a random start value, the seed.
  writeStart() {
    const V = this.L.V;
    const { e, L } = this;
    const cells = new Map();
    const put = (a, v) => cells.set(a, (cells.get(a) || 0) + v);
    const flag = (R, f, s, field, v) => put(R.at(f, s, field), v);
    for (const R of L.regions) {
      for (let r = 0; r < R.regionSlots; r++) put(R.R0 + r * SL + MK, 1);
      for (let f = 0; f < R.units; f++) put(R.at(f, R.sl.hdr, W), 64);
    }
    for (let f = 0; f < L.hid.units; f++) {
      const R = L.hid, sl = R.sl;
      if (L.bigram) { for (let c = 0; c < V; c++) flag(R, f, sl.w(c), LB, 1); continue; }
      for (let k = 0; k < L.K; k++) for (let c = 0; c < V; c++) flag(R, f, sl.e(k, c), LA, 1);
      for (let j = 0; j < V; j++) flag(R, f, sl.w2(j), LB, 1);
      if (L.attn) {
        for (let c = 0; c < V; c++) flag(R, f, sl.vt(c), LA, 2);
        for (let i = 0; i < L.T; i++) flag(R, f, sl.vp(i), LA, 2);
      }
    }
    if (L.key) {
      const R = L.key, sl = R.sl;
      for (let f = 0; f < R.units; f++) {
        for (let c = 0; c < V; c++) { flag(R, f, sl.qt(c), LA, 3); flag(R, f, sl.kt(c), LA, 3); }
        for (let i = 0; i < L.T; i++) flag(R, f, sl.kp(i), LA, 3);
      }
    }
    this.headMarkers(put);
    for (const a of [...cells.keys()].sort((x, y) => x - y)) e.add(a, cells.get(a));
    e.addBig(L.regions[0].R0 + VEL, S.SEED, [L.g.t(0), L.g.t(1)]);
  }

  headMarkers(put) {
    for (const H of [this.L.AH, this.L.H]) if (H) for (let j = 0; j < H.n; j++) put(H.hs(j) + HF.MK, 1);
  }

  // One training example: the character in X is the target, the context comes from C.
  example() {
    const V = this.L.V;
    const { e, L } = this, g = L.g, R = L.hid, K = L.key, first = K || R;
    for (let i = 0; i < L.T; i++) e.copy(g.C(i), first.frame(0) + first.TK[i], g.t(0));
    const cases = [...this.m.chars].map((ch, t) => [ch.charCodeAt(0), () => { if (t) e.add(g.TOK, t); }]);
    e.switchOn(g.X, g.F, cases, g.ftmp);
    e.copy(g.TOK, first.frame(0) + first.TT, g.t(0));
    // the context moves on; after the end of a name it starts empty
    e.clear(g.C(0));
    for (let k = 1; k < L.T; k++) e.move(g.C(k), g.C(k - 1));
    e.copy(g.TOK, g.C(L.T - 1), g.t(0));
    if (this.m.reset) e.whenZero(g.TOK, [g.t(0), g.t(1), g.t(2)], () => { for (let k = 0; k < L.T - 1; k++) e.clear(g.C(k)); });
    e.clear(g.TOK);
    if (K) {
      this.mark('key-forward');
      this.walkRegion(K, (fb) => this.keyForwardBody(fb));
      this.mark('attention');
      this.attentionForward();
      for (const [a, b] of [...K.TK.map((t, i) => [t, R.TK[i]]), [K.TT, R.TT]]) e.move(K.frame(K.units) + a, R.frame(0) + b);
    }
    this.mark('forward');
    this.walkRegion(R, (fb) => this.forwardBody(fb));
    this.mark('head');
    this.head();
    this.mark('backward');
    this.walkRegion(R, (fb) => this.backwardBody(fb), -1);
    if (!L.bigram) for (let j = 0; j < V; j++) e.clear(R.at(0, R.sl.w2(j), LB));
    if (K) {
      for (let i = 0; i < L.T; i++) { e.move(R.frame(0) + R.TK[i], K.frame(K.units) + K.TK[i]); e.clear(R.frame(0) + R.ATT(i)); }
      this.mark('attention-backward');
      this.attentionBackward();
      this.mark('key-backward');
      this.walkRegion(K, (fb) => this.keyBackwardBody(fb), -1);
      for (let i = 0; i < L.T; i++) { e.clear(K.frame(0) + K.TK[i]); e.clear(K.frame(0) + K.DS(i)); }
    } else for (let i = 0; i < L.T; i++) e.clear(R.frame(0) + R.TK[i]);
  }

  printStep() {
    const { e, L, m } = this, hg = L.hg, lb = Math.log2(m.batch), c = L.H.c;
    const pt = (s) => e.printText(s, c(20), c(21), c(22));
    e.add(hg.STEP, 1);
    e.scatter(hg.LOSS, [[c(0), 125]]);
    e.shift(c(0), c(1), 9 + lb, 22 - lb, {}, range(2, 12).map(c));
    pt('step ');
    e.copy(hg.STEP, c(2), c(3));
    // up to 7 digits: a long run passes step 100,000 (the digits in c(12..18), its three free cells in c(23..25))
    e.printNumber(c(2), 7, range(12, 19).map(c), range(23, 26).map(c));
    pt(' loss ');
    e.move(c(1), c(2));
    e.printNumber(c(2), 4, range(12, 17).map(c), range(17, 20).map(c), { point: true });
    pt('\n');
  }

  // resume: the program without its writing part and its start weights, for a tape on which an earlier
  // run of the training program stopped (it goes on from there)
  trainer(engineText, { resume = false } = {}) {
    const { e, L, m } = this, g = L.g;
    if (!Number.isInteger(Math.log2(m.batch))) throw new Error('the batch must be a power of two');
    this.mark('start');
    if (!resume) this.writeStart();
    const writerChars = e.toString().length;
    this.mark('init');
    if (!resume) this.initWeights();
    this.mark('read');
    e.read(g.X);
    this.trainLoop();
    this.mark('child-weights');
    this.printChildWeights();
    this.mark('engine');
    e.printText(engineText, g.O, g.N, g.ntmp);
    this.mark('end');
    return { src: e.toString(), writerChars, parts: this.parts };
  }

  // A batch for every m.batch characters read, as long as the character read is not 0 (the end)
  trainLoop() {
    const { e, m } = this, g = this.L.g;
    e.loop(g.X, () => {
      e.addConst(g.BC, m.batch, g.t(0));
      e.loop(g.BC, () => {
        this.example();
        e.add(g.BC, -1);
        e.whenNonZero(g.BC, [g.t(0), g.t(1)], () => e.read(g.X));
      });
      this.mark('momentum');
      this.momentumStep();
      this.mark('print-step');
      this.printStep();
      e.read(g.X);
    });
  }

  // ---- the training program that prints its next version --------------------------------------

  // gen0 = [writing part: markers, seed] [body as data] [start weights] [body]; gen1 = [writing part: gen0's end state]
  // [body as data] [body]. The body prints that writing part, the data's writing part, and the data as code (itself).

  // where a value cell's writing part goes: at the cell, the cell after it free
  printValue(X, s) {
    const e = this.e, pt = (t) => e.printText(t, s[3], s[4], s[5]);
    const [Z, Zo, NEG] = s, CH = s[9], D = s.slice(10, 20);
    e.copy(X, Z, Zo);
    e.shift(Z, NEG, 31, 1, { addend: 0 }, s.slice(3, 13));
    // Z = |X|, CH = + or -
    e.copy(X, Z, Zo);
    e.add(CH, 43);
    e.loop(NEG, () => { e.clear(NEG); e.add(CH, 2); e.scatter(Z, [[Zo, -1]]); e.move(Zo, Z); });
    e.peel(Z, { m: 32, onSet: (j) => { if (j < 30) e.add(D[Math.floor(j / 3)], 2 ** (j % 3)); } },
      { Zo, T: s[4], H: [s[5], s[6]], K: s[7], Kt: s[8] });
    // the octal digits from the highest one that is not 0: MUL between two digits
    const [ST, t0, t1] = s;
    for (let i = D.length - 1; i >= 0; i--) {
      e.whenNonZero(ST, [t0, t1], () => pt(MUL));
      e.whenNonZero(D[i], [t0, t1], () => { e.clear(ST); e.add(ST, 1); });
      e.loop(D[i], () => { e.add(D[i], -1); e.out(CH); });
    }
    e.clear(ST).clear(CH);
  }

  printNext() {
    const { e, L } = this, g = L.g, c = L.H.c, D0 = dataStart(L);
    // fixed text goes out through the free cells closest to the pointer
    const pads = [[g.O, g.N, g.ntmp], [D0 - 8, D0 - 7, D0 - 6], ...[L.AH, L.H].filter(Boolean).map((H) => [31, 32, 33].map(H.c))];
    const pt = (t) => e.printText(t, ...pads.reduce((a, b) => (Math.abs(b[0] - e.ptr) < Math.abs(a[0] - e.ptr) ? b : a)));
    let cur = 0;
    pt(']\n');
    for (const it of stateItems(L)) {
      pt('>'.repeat(it.a - cur));
      cur = it.a;
      if (it.kind === 'ctx') {
        const [a, b, o] = [3, 4, 5].map(g.t);
        e.copy(g.C(it.k), a, b).add(o, 43);
        e.loop(a, () => { e.add(a, -1); e.out(o); });
        e.clear(o);
      } else if (it.kind === 'one') pt('+');
      else if (it.kind === 'step') this.printValue(L.hg.STEP, range(0, 20).map(c));
      else {
        this.slotWalk(it.R, (c, n) => {
          const s = [...range(0, 8).map((i) => c(Sc(i))), c(LA), c(LB), ...range(0, 8).map((i) => n(Sc(i))), n(LA), n(LB)];
          const ps = (t) => e.printText(t, s[3], s[4], s[5]);
          ps('+>');
          this.printValue(c(W), s);
          ps('>');
          this.printValue(c(VEL), s);
          ps('>'.repeat(SL - VEL));
        });
        cur = it.R.END;
      }
    }
    pt('>'.repeat(D0 - cur));
    // the data, token by token (symbol S, run length R, two free cells): first as its own writing part
    const [Sy, R, T1, T2] = [0, 1, 2, 3].map((i) => D0 + i);
    const dataWalk = (body) => {
      e.to(D0).raw('[');
      body();
      e.to(D0).raw('>>>>]<<<<[<<<<]');
      e.ptr = D0 - 4;
    };
    dataWalk(() => {
      e.add(T1, 43);
      e.loop(Sy, () => { e.add(Sy, -1).add(T2, 1).out(T1); }).move(T2, Sy);
      e.add(T1, 19).out(T1).add(T1, -19);
      e.loop(R, () => { e.add(R, -1).add(T2, 1).out(T1); }).move(T2, R);
      e.add(T1, 19).out(T1).out(T1).out(T1).add(T1, -62);
    });
    pt('<<<<[<<<<]' + '<'.repeat(D0 - 4));
    // then as code: the body (the cells of the token before are free by then)
    dataWalk(() => {
      const O = D0 - 1;
      e.copy(Sy, T1, T2);
      e.switchOn(T1, D0 - 2, [...SYMS].map((ch, i) => [i + 1, () => e.add(O, ch.charCodeAt(0))]), D0 - 3);
      e.loop(R, () => { e.add(R, -1).out(O); }).clear(O);
    });
  }

  // The body: train on what it reads, then print the next generation (or the child, if it read nothing)
  selfBody(engineText) {
    const { e, L } = this, g = L.g, TR = g.t(4), ELSE = g.t(3);
    this.mark('read');
    e.read(g.X);
    e.copy(g.X, TR, g.t(5));
    // the loss lines go inside [ ], a loop the next generation skips (its cell 0 is 0 at the start)
    e.whenNonZero(TR, [g.t(5), g.t(6)], () => e.printText('[\n', g.O, g.N, g.ntmp));
    this.trainLoop();
    this.mark('next-generation');
    e.add(ELSE, 1);
    e.loop(TR, () => { e.clear(TR).clear(ELSE); this.printNext(); });
    this.mark('child-weights');
    e.loop(ELSE, () => {
      e.clear(ELSE);
      this.printChildWeights();
      this.mark('engine');
      e.printText(engineText, g.O, g.N, g.ntmp);
    });
    this.mark('end');
    return e.toString();
  }

  // gen0: the start of a training program, the body as data, the start weights, the body
  selfTrainer(engineText) {
    const { e, L, m } = this, D0 = dataStart(L);
    const body = new Gen(m).selfBody(engineText), runs = runsOf(body);
    this.mark('start');
    this.writeStart();
    this.mark('body-as-data');
    e.to(D0).raw(dataText(runs));
    e.ptr = D0 - 4;
    const writerChars = e.toString().length;
    this.mark('init');
    this.initWeights();
    e.to(0);
    const src = e.toString() + body;
    return { src, body, tokens: runs.length, tapeSize: tapeFor(L, runs.length), writerChars };
  }

  // ---- the child: sampling names --------------------------------------------------------------

  // seed: of its random numbers; lines: how many names (lines) it prints before it stops
  childEngine({ seed = S.SAMPLE_SEED, lines = this.m.samples } = {}) {
    const V = this.L.V;
    const { e, L, m } = this, hg = L.hg, c = L.H.c, R = L.hid, K = L.key;
    const TOK = c(25), OC = c(26), NAMES = c(27), RNG = c(28);
    e.ptr = R.END + W;                                 // where the writing part leaves the pointer
    const marks = new Map();
    this.headMarkers((a, v) => marks.set(a, v));
    for (const a of [...marks.keys()].sort((x, y) => x - y)) e.add(a, marks.get(a));
    e.addConst(NAMES, lines, c(0));
    e.addBig(RNG, seed, [c(0), c(1)]);
    e.loop(NAMES, () => {
      if (K) {
        this.walkRegion(K, (fb) => this.keyForwardBody(fb));
        this.attentionForward();
        for (let i = 0; i < L.T; i++) e.move(K.frame(K.units) + K.TK[i], R.frame(0) + R.TK[i]);
      }
      this.walkRegion(R, (fb) => this.forwardBody(fb));
      if (K) for (let i = 0; i < L.T; i++) e.clear(R.frame(R.units) + R.ATT(i));
      this.headLogits();
      this.expSum(L.H, false);
      // r = (the rb bits below the sign of the next random number) * S / 2^rb; the token: how many running sums of e are <= r
      const rb = S.sampleBits(m), sb = S.sumBits(m);
      e.lcg(RNG, [c(0), c(1)]);
      e.copy(RNG, c(2), c(3));
      e.shift(c(2), c(4), 31 - rb, rb, { addend: 0 }, range(5, 15).map(c));
      e.mulAcc(c(4), rb + 1, [[hg.S, c(15), c(16)]], range(17, 25).map(c), { keepA: false });
      e.clear(hg.S);
      e.shift(c(15), c(16), rb, sb + 1, { addend: 0 }, range(5, 15).map(c));
      e.move(c(16), L.hs(0) + HF.CA);
      this.headWalk(L.H, (f, s, n) => {
        e.scatter(f(HF.E), [[f(HF.CA), -1]]);
        e.copy(f(HF.CA), s(0), s(1));
        e.shift(s(0), s(2), sb, 1, { addend: 2 ** sb }, range(3, 13).map(s));
        e.move(s(2), f(HF.CB));
        e.move(f(HF.CA), n(HF.CA)).move(f(HF.CB), n(HF.CB));
      });
      e.clear(L.hs(V) + HF.CA);
      e.move(L.hs(V) + HF.CB, TOK);
      // print it: a..z, or a newline for the end of a name
      if (this.m.chars === S.NAMES) { e.copy(TOK, OC, c(0)).add(OC, 96); e.whenZero(TOK, [c(0), c(1), c(2)], () => e.add(OC, -86)); }
      else { e.copy(TOK, c(3), c(0)); e.switchOn(c(3), c(1), [...this.m.chars].map((ch, t) => [t, () => e.add(OC, ch.charCodeAt(0))]), c(2)); }
      e.out(OC).clear(OC);
      // the context (in the landing frame) moves on, and walks back to frame 0
      const tk = (k) => R.frame(R.units) + R.TK[k];
      e.clear(tk(0));
      for (let k = 1; k < L.T; k++) e.move(tk(k), tk(k - 1));
      e.copy(TOK, tk(L.T - 1), c(0));
      e.whenZero(TOK, [c(0), c(1), c(2)], () => { if (this.m.reset) for (let k = 0; k < L.T - 1; k++) e.clear(tk(k)); e.add(NAMES, -1); });
      e.clear(TOK);
      const back = (Rg) => this.walkRegion(Rg, (fb) => { for (const t of Rg.TK) e.move(fb + Rg.FS + t, fb + t); }, -1);
      back(R);
      if (K) {
        for (let i = 0; i < L.T; i++) e.move(R.frame(0) + R.TK[i], K.frame(K.units) + K.TK[i]);
        back(K);
      }
    });
    return e.toString();
  }
}

// The child's writing part from the reference's trained parameters.
function childWriting(m, p) {
  const L = layout(m);
  return childWritingOf(L, regionValues(L, p).map((vals) => vals.map((w) => S.rs(w, S.SW - S.SC))));
}

// The same from the values at the child's scale, region by region (as the child program holds them)
function childWritingOf(L, cvals) {
  const parts = ['>'.repeat(L.regions[0].R0 + W)];
  cvals.forEach((vals, r) => {
    if (r) parts.push('>'.repeat(L.regions[r].R0 - L.regions[r - 1].END));
    for (const c of vals) parts.push((c >= 0 ? '+'.repeat(c) : '-'.repeat(-c)) + '>'.repeat(SL));
  });
  return parts.join('');
}

// ---- the next generation's writing part ------------------------------------------------------

// A value v is written as octal digits from the highest: + (or -) d times, and between two digits
// MUL, which multiplies the cell by 8 through the cell after it.
const MUL = '[->++++++++<]>[-<+>]<';
function valueText(v) {
  if (Math.abs(v) >= 2 ** 30) throw new Error(`value out of range for the next generation: ${v}`);
  const sg = v < 0 ? '-' : '+';
  return v ? Math.abs(v).toString(8).split('').map((d, i) => (i ? MUL : '') + sg.repeat(+d)).join('') : '';
}

// The body as data: one token per run of a command, 4 cells (symbol 1..8, run length, two free cells)
const SYMS = '+-.<>[],';
const dataStart = (L) => L.tapeSize + 8;
const tapeFor = (L, tokens) => dataStart(L) + 4 * tokens + 8;
function runsOf(body) {
  const runs = [];
  for (let i = 0; i < body.length;) {
    let j = i;
    while (j < body.length && body[j] === body[i]) j++;
    runs.push([SYMS.indexOf(body[i]) + 1, j - i]);
    i = j;
  }
  return runs;
}
// written from dataStart on; the pointer ends 4 cells before it
const dataText = (runs) => runs.map(([s, r]) => '+'.repeat(s) + '>' + '+'.repeat(r) + '>>>').join('') + '<<<<[<<<<]';

// The cells that are not 0 when training stops, by address: the context, the slots of each region
// (marker, weight, velocity), the head markers, the step
function stateItems(L) {
  const items = [];
  for (let k = 0; k < L.T; k++) items.push({ a: L.g.C(k), kind: 'ctx', k });
  for (const R of L.regions) items.push({ a: R.R0, kind: 'region', R });
  for (const H of [L.AH, L.H]) if (H) for (let j = 0; j < H.n; j++) items.push({ a: H.hs(j) + HF.MK, kind: 'one' });
  items.push({ a: L.hg.STEP, kind: 'step' });
  return items.sort((x, y) => x.a - y.a);
}

// The next generation as the body prints it after its loss lines, from the reference's state ({ params, step, ctx })
function nextWriting(m, st, body) {
  const L = layout(m), D0 = dataStart(L), w = regionValues(L, st.params, 'w'), v = regionValues(L, st.params, 'v');
  const parts = [']\n'];
  let cur = 0;
  for (const it of stateItems(L)) {
    parts.push('>'.repeat(it.a - cur));
    cur = it.a;
    if (it.kind === 'ctx') parts.push('+'.repeat(st.ctx[it.k]));
    else if (it.kind === 'one') parts.push('+');
    else if (it.kind === 'step') parts.push(valueText(st.step));
    else {
      const r = L.regions.indexOf(it.R);
      for (let i = 0; i < it.R.regionSlots; i++) parts.push('+>' + valueText(w[r][i]) + '>' + valueText(v[r][i]) + '>'.repeat(SL - VEL));
      cur = it.R.END;
    }
  }
  parts.push('>'.repeat(D0 - cur), dataText(runsOf(body)), '<'.repeat(D0 - 4), body);
  return parts.join('');
}

module.exports = { Gen, childWriting, childWritingOf, nextWriting, runsOf, tapeFor, layout };
