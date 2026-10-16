'use strict';

// The Gated DeltaNet token mixer (spec.js deltaNet()).
//
// One layer, from P: the input matrix (rows: queries, keys and values before the convolution, z, a, b), the
// stations that round its sums, run the convolution (its window of the last kernel - 1 inputs rests here) and
// normalise the queries and keys, then one region per value head, one more region, and the output matrix.
// A region holds the state St of its head as dk columns of dv numbers, each column with room beside it:
// a pass over the state is a loop over the columns that peels the bits of that column's input once and adds
// the column into an accumulator (which then moves on to the next column) once per bit.
// The inputs of the heads travel through the regions on a conveyor (q, k, v, a, b and two constants per head),
// together with the residual, z and the outputs of the heads done so far (the last head first).

const sizes = (a) => {
  const { nk, nv, dk, dv, kernel, keyDim, valueDim, convDim, dim } = a;
  return { nk, nv, dk, dv, kernel, keyDim, valueDim, convDim, dim, rep: nv / nk, Rin: convDim + valueDim + 2 * nv };
};

function layout(e, K) {
  const a = e.a, { ZW } = K, { ngBits, ohBits } = a.cfg, { nk, nv, dk, dv, kernel, keyDim, valueDim, convDim, dim, rep, Rin } = sizes(a);
  if (nv % nk || kernel < 2 || dk < 2 || dv < 2) throw new Error('bad DeltaNet sizes');
  const Min = e.mat(Rin, dim, dim, ngBits), Mo = e.mat(dim, valueDim, dim, ohBits);
  let at;
  const take = (n) => { const x = at; at += n + 1; return x; };

  // one column of a head's state, and its room
  const co = {};
  at = 0;
  co.S = take(dv); co.AC = take(dv); co.DV = take(dv); co.QU = take(dk); co.XK = take(1);
  co.T = take(56);                 // counter, flags of the bits, scratch
  co.W = take(dv + ZW + 4);        // window of the slides inside a column
  const CS = at + 1;

  // one region
  const ro = {};
  at = 1;
  ro.RC = take(1);                 // counter of the loop over the regions
  ro.D = take(1);                  // the head scale D (rests here)
  // the conveyor: the inputs of the heads still to come (head by head, the next one first), the outputs, the residual, z
  ro.IQ = take(nv * dk); ro.IK = take(nv * dk); ro.IV = take(nv * dv); ro.IA = take(nv); ro.IB = take(nv); ro.IDT = take(nv); ro.ILA = take(nv);
  ro.OUT = take(nv * dv); ro.XR = take(dim); ro.ZR = take(valueDim); ro.CT = take(4);
  ro.OH = take(dv); ro.VT = take(dv); ro.QD = take(dk);
  ro.T = take(60);
  ro.WC = take(8);                 // a walk over the regions: counter, two cells, hop cells
  ro.SW = take(Math.max(nv * dk, nv * dv, dim, valueDim) + ZW + 4);
  ro.Y = take(valueDim); ro.GN = take(valueDim); ro.FLY = take(valueDim);       // after the last head: the gated norm
  ro.NBY = take(valueDim + dv + ZW + 4); ro.NTY = take(valueDim + 40);
  ro.C0 = at; at += (dk + 1) * CS + 1;          // dk columns and one more (where the sums of a pass arrive)
  const RS = at + 1;

  const Lo = { Min, Mo, co, CS, ro, RS };
  Lo.aIn = dim * (Rin + 1);
  at = Lo.aIn + Min.G + 2;
  Lo.Dscr = take(Math.max(Rin, convDim, dim) + ZW + 4);
  Lo.Ddr = take(Rin);              // doublings per row of the input matrix
  Lo.Dt = take(10);
  Lo.MIX = take(convDim);
  Lo.WIN = take((kernel - 1) * convDim);        // the window: input j tokens ago at WIN + (kernel - 1 - j) * convDim (rests here)
  Lo.CW = take(kernel * convDim);  // convolution weights, tap by tap
  Lo.C = take(convDim);
  Lo.FL = take(keyDim); Lo.NB = take(keyDim + dk + ZW + 4); Lo.NT = take(keyDim + 40);
  Lo.QN = take(keyDim); Lo.KN = take(keyDim);
  Lo.DT = take(nv); Lo.LA = take(nv);           // dt_bias and log A per head
  Lo.R0 = at; at += (nv + 1) * RS + 1;
  Lo.oO = at; Lo.aO = Lo.oO + valueDim * (dim + 1);
  Lo.mix = Lo.aO + Mo.G + 1;
  void rep;
  return Lo;
}

// ---- helpers ----------------------------------------------------------------------------------

// A loop of n rounds whose frame moves `stride` cells a round; the counter at CNT travels with it.
function frames(e, CNT, n, stride, body) {
  const p = e.p;
  p.addBig(CNT, n, [CNT + 1, CNT + 2]);
  p.to(CNT).raw('[').add(CNT, -1);
  body();
  p.move(CNT, CNT + stride);
  p.to(CNT + stride).raw(']');
  p.ptr = CNT + n * stride;
}

// Carry the cells at offsets `cells` of region `from` to region `to`, one region per round.
function walk(e, Lo, R0, from, to, cells) {
  const p = e.p, { ro, RS } = Lo, n = Math.abs(to - from), d = Math.sign(to - from) * RS, s = R0 + from * RS, cnt = s + ro.WC;
  if (!n) return;
  p.addBig(cnt, n, [cnt + 4, cnt + 5]);
  p.to(cnt).raw('[').add(cnt, -1);
  for (const c of cells) p.move(s + c, s + c + d);
  p.move(cnt, cnt + d);
  p.to(cnt + d).raw(']');
  p.ptr = R0 + to * RS + ro.WC;
}

// The index of the sigmoid table for v at frac fraction bits (spec.js sigOf).
const sigIndex = (a, frac) => {
  const { sigIn, sigRange } = a.cfg, k = frac - sigIn;
  if (k < 0) throw new Error('the sigmoid needs at least sigIn fraction bits');
  return { k, n: Math.log2(a.tables.sig.length), lo: 0, addend: (k > 0 ? 2 ** (k - 1) : 0) + sigRange * 2 ** frac };
};

// dst = rqWrap(X * sigmoid(X), SGB, bits) (spec.js siluOf); X is used up. s: 30 cells.
function silu(e, X, frac, bits, dst, s) {
  const p = e.p, a = e.a, [X2, IX, SG, y2, PR, tmp, e0, e1] = s, t = s.slice(8, 18);
  p.copy(X, X2, tmp);
  e.rqN(X2, IX, sigIndex(a, frac), t, [e0, e1]);
  e.lookupBig(IX, SG, y2, a.tables.sig, t.slice(0, 9));
  e.mul(X, bits, [[SG, PR, 1]], t.slice(0, 8), false);
  p.clear(SG);
  e.rqN(PR, dst, { ...e.rq(a.cfg.SGB, bits), clamp: false }, t, [e0, e1]);
}

// The bits of the signed value X (nbits wide): NEG = 1 when it is negative, B[b] = bit b of |X|. X is used up.
function bitsOf(e, X, nbits, NEG, B, s) {
  const p = e.p, half = 2 ** (nbits - 1), [LOW, TOP, E1, CODE, tmp, e0, e1] = s, t = s.slice(7, 17), [Za, Zb, TT, h0, h1, KK, Kt] = t;
  e.rqSplit(X, LOW, TOP, { k: 0, n: nbits, lo: -half, addend: 0 }, t, [e0, e1]);
  // CODE - 1 = 2 |x| + (x < 0)
  e.ifElse(TOP, E1, () => { p.scatter(LOW, [[CODE, 2]]); }, () => { p.scatter(LOW, [[CODE, -2]]); p.addConst(CODE, 2 * half + 1, tmp); });
  p.shl(CODE, Za, 32 - (nbits + 1), [h0, h1]);
  p.peel(Za, { m: nbits + 1, onSet: (j) => p.add(j === 0 ? NEG : B[j - 1], 1) }, { Zo: Zb, T: TT, H: [h0, h1], K: KK, Kt });
}

// One pass over the columns of a head (frame: column 0 at COL). For every column: its input x (taken by take(V)),
// then ACC += x * SRC for the dv numbers SRC of the column (SRC: the state, or the deltas the pass carries).
// after(): the rest of the round. The input has xBits bits.
function pass(e, Lo, COL, xBits, take, SRC, after) {
  const p = e.p, { co, CS } = Lo, { dk, dv } = sizes(e.a), T = (k) => COL + co.T + k;
  const CNT = T(0), V = T(3), NEG = T(4), N2 = T(5), E2 = T(6), tm = T(7), B = Array.from({ length: xBits }, (_, b) => T(8 + b)), s = Array.from({ length: 20 }, (_, i) => T(30 + i));
  if (xBits > 22) throw new Error('pass: input too wide');
  frames(e, CNT, dk, CS, () => {
    take(V);
    bitsOf(e, V, xBits, NEG, B, s);
    for (let b = 0; b < xBits; b++) {
      p.loop(B[b], () => {
        p.add(B[b], -1);
        const add = (sign) => e.slide(dv, COL + co.W, 1, 1, (c) => {
          p.shl(COL + SRC, COL + co.AC, b, [c.sc(0), c.sc(1)], sign, c.sc(2));
          p.move(c.sc(2), COL + SRC);
        });
        p.copy(NEG, N2, tm);
        e.ifElse(N2, E2, () => add(-1), () => add(1));
      });
    }
    p.clear(NEG);
    after();
  });
}

// ---- the layer ----------------------------------------------------------------------------------

function emit(e, K, P, Lo) {
  const a = e.a;
  e.S('xn1', () => e.normEmit(P, Lo.Min, false));
  e.S('sweep1', () => e.sweep(P, Lo.Min));
  e.S('round', () => roundIn(e, K, P, Lo));
  e.S('conv', () => conv(e, K, P, Lo));
  e.S('qk', () => normQK(e, K, P, Lo));
  e.S('load', () => conveyor(e, K, P, Lo));
  e.S('heads', () => heads(e, K, P, Lo));
  e.S('gated', () => gated(e, K, P, Lo));
  e.S('sweep2', () => e.sweep(P + Lo.oO, Lo.Mo));
  e.S('xatt', () => e.residual(P + Lo.aO, Lo.Mo, a.R.out[0], a.eout, P + Lo.mix));
}

// The sums of the input matrix, rounded: mix (q, k, v) to MIX, z to the conveyor, a and b to their strips.
// The residual and the control cells go onto the conveyor too.
function roundIn(e, K, P, Lo) {
  const p = e.p, a = e.a, { car1, SXT, POS, LC } = K, { nv, valueDim, convDim, dim } = sizes(a), R = a.R, M = Lo.Min;
  const arr = P + Lo.aIn, c = (k) => arr + M.ctrl + k, base = P + Lo.Dscr, tmp = P + Lo.Dt, R0 = P + Lo.R0, ro = Lo.ro;
  const round = (n, row, dst, [k, bits], last) => {
    if (last) p.move(c(SXT), car1(base, 0)); else p.copy(c(SXT), car1(base, 0), tmp);
    const w = e.slide(n, base, 1, 1, (cc) => {
      const X = cc.sc(0), t = cc.sc(1), tm = cc.sc(2);
      e.fixSum(arr + M.m + row, X, cc.car(0), e.OFFW);
      e.doubleRow(X, P + Lo.Ddr + row, t, tm);
      e.rqN(X, cc.sc(13), e.rq(k, bits), cc.ss(3, 10), [cc.sc(14), cc.sc(15)]);
      p.move(cc.sc(13), dst);
    });
    p.clear(w.end(w.car(0)));
  };
  round(convDim, 0, P + Lo.MIX, R.mix, false);
  round(valueDim, convDim, R0 + ro.ZR, R.z, false);
  round(nv, convDim + valueDim, R0 + ro.IA, R.a, false);
  round(nv, convDim + valueDim + nv, R0 + ro.IB, R.b, true);
  e.slide(dim, base, 1, 1, () => p.move(arr + M.y, R0 + ro.XR));
  p.move(c(POS), R0 + ro.CT).move(c(LC), R0 + ro.CT + 1);
}

// The causal convolution over the last kernel tokens of every channel, then silu; the window moves on.
function conv(e, K, P, Lo) {
  const p = e.p, a = e.a, { convDim, kernel } = sizes(a), { mixBits, CWB, MB, CB, cBits } = a.cfg;
  const WIN = (j) => P + Lo.WIN + j * convDim, CW = (j) => P + Lo.CW + j * convDim, MIX = P + Lo.MIX;
  // (the numbers of a channel are first moved next to the work: the strips are far apart)
  e.slide(convDim, P + Lo.Dscr, 1, 1, (c) => {
    const S = c.sc(0), PRE = c.sc(1), OUT = c.sc(2), m = c.ss(3, 8), s = c.ss(11, 30), Xw = c.ss(41, kernel), Wc = c.ss(41 + kernel, kernel);
    for (let j = 0; j < kernel - 1; j++) p.move(WIN(j), Xw[j]);
    p.move(MIX, Xw[kernel - 1]);
    for (let j = 0; j < kernel; j++) p.move(CW(j), Wc[j]);
    for (let j = 0; j < kernel; j++) e.mul(Xw[j], mixBits, [[Wc[j], S, 1]], m, j > 0);
    for (let j = 1; j < kernel; j++) p.move(Xw[j], WIN(j - 1));
    for (let j = 0; j < kernel; j++) p.move(Wc[j], CW(j));
    e.rqN(S, PRE, e.rq(CWB + MB - CB, cBits), s.slice(0, 10), [s[10], s[11]]);
    silu(e, PRE, CB, cBits, OUT, s);
    p.move(OUT, P + Lo.C);
  });
}

// Queries to length 1/sqrt(dk), keys to length 1, per key head.
// (straight onto the conveyor when every value head has a key head of its own)
function normQK(e, K, P, Lo) {
  const p = e.p, a = e.a, { nk, dk, keyDim, rep } = sizes(a), R0 = P + Lo.R0;
  const [QN, KN] = rep === 1 ? [R0 + Lo.ro.IQ, R0 + Lo.ro.IK] : [P + Lo.QN, P + Lo.KN];
  p.eachFrame(P + Lo.FL, dk, nk, P + Lo.Dt, () => e.normVec(P + Lo.C, QN, a.tables.normQ, P + Lo.NB, P + Lo.NT));
  p.eachFrame(P + Lo.FL, dk, nk, P + Lo.Dt, () => e.normVec(P + Lo.C + keyDim, KN, a.tables.normK, P + Lo.NB, P + Lo.NT));
}

// The rest of the inputs of the heads onto the conveyor (in region 0): v, dt, log A (and q, k when key heads are shared).
function conveyor(e, K, P, Lo) {
  const p = e.p, a = e.a, { nv, dk, keyDim, valueDim, rep } = sizes(a), R0 = P + Lo.R0, ro = Lo.ro, base = P + Lo.Dscr;
  if (rep > 1) {
    for (let h = 0; h < nv; h++) {
      const kh = Math.floor(h / rep), last = h % rep === rep - 1;
      for (const [src, dst] of [[P + Lo.QN + kh * dk, R0 + ro.IQ + h * dk], [P + Lo.KN + kh * dk, R0 + ro.IK + h * dk]]) {
        e.slide(dk, base, 1, 1, (c) => (last ? p.move(src, dst) : p.copy(src, dst, c.sc(0))));
      }
    }
  }
  e.slide(valueDim, base, 1, 1, () => p.move(P + Lo.C + 2 * keyDim, R0 + ro.IV));
  e.slide(nv, base, 1, 1, (c) => { p.copy(P + Lo.DT, R0 + ro.IDT, c.sc(0)); p.copy(P + Lo.LA, R0 + ro.ILA, c.sc(0)); });
}

// Every value head, one copy of the code: decay, beta, D, the delta rule on St, the read.
function heads(e, K, P, Lo) {
  const p = e.p, a = e.a, { car1, range } = K, { nv, dk, dv, valueDim, dim } = sizes(a), { ro, co, CS, RS } = Lo;
  const { AB, LDB, DB, BB, SGB, TB, KB, QB, SB, CB, cBits, sBits, qBits, OB, oBits } = a.cfg, tb = a.tables;
  const R0 = P + Lo.R0, T = (k) => R0 + ro.T + k, COL = R0 + ro.C0, END = COL + dk * CS, SW = R0 + ro.SW;
  const s9 = range(9, (i) => T(30 + i)), s10 = range(10, (i) => T(30 + i)), ex = [T(41), T(42)], s8 = s10.slice(0, 8);
  const q = R0 + ro.IQ, k = R0 + ro.IK, v = R0 + ro.IV, A = R0 + ro.IA, B = R0 + ro.IB, DTc = R0 + ro.IDT, LAc = R0 + ro.ILA, D = R0 + ro.D;
  const nwB = Math.min(sBits, 31 - KB), npB = Math.min(sBits, 32 - KB), Mfold = 2 ** Math.ceil(Math.log2(DB + 1));
  const [U, IX, LSP, y2, LAM, DEC, BIX, SG, BETA, PD, D2, M, MC, DI, DINV, Dq, tm] = range(17, (i) => T(i));

  frames(e, R0 + ro.RC, nv, RS, () => {
    e.S('decay', () => {
      // decay = exp(-exp(log A + log softplus(a + dt)))
      p.move(A, U).move(DTc, U); p.addBig(U, 32 * 2 ** AB, ex);
      e.rqN(U, IX, { k: 0, n: Math.log2(tb.lsp.length), lo: 0, addend: 0 }, s10, ex);
      e.lookupBig(IX, LSP, y2, tb.lsp, s9);
      p.move(LAc, LSP); p.addBig(LSP, -tb.lamLo * 2 ** LDB, ex);
      e.rqN(LSP, LAM, { k: 0, n: Math.log2(tb.dec.length), lo: 0, addend: 0 }, s10, ex);
      e.lookupBig(LAM, DEC, y2, tb.dec, s9);
      // beta = sigmoid(b)
      e.rqN(B, BIX, sigIndex(a, BB), s10, ex);
      e.lookupBig(BIX, SG, y2, tb.sig, s9);
      e.rqN(SG, BETA, { ...e.rq(SGB - TB, TB + 2), clamp: false }, s10, ex);
      // D = D * decay; below 1/2: St = round(St / 2^m), D = D * 2^m (m = DB - bits of D), or St = 0, D = 1 when D = 0
      e.mul(D, DB + 2, [[DEC, PD, 1]], s8, false);
      p.clear(DEC);
      e.rqN(PD, D2, { k: DB, n: DB + 2, lo: 0, clamp: false }, s10, ex);
      p.copy(D2, MC, tm);
      p.add(M, DB);
      e.bitCount(MC, DB + 2, (j) => [Math.max(0, DB - 1 - j)], [M], s9);
      p.copy(M, MC, tm);
      e.doubleBy(D2, MC, tm);
      p.move(D2, D);
      e.switchTree(M, Math.log2(Mfold), (m) => {
        if (m === 0 || m > DB) return;
        frames(e, COL + co.T, dk, CS, () => e.slide(dv, COL + co.W, 1, 1, (c) => {
          if (m === DB) { p.clear(COL + co.S); return; }
          e.rqN(COL + co.S, c.sc(13), { ...e.rq(m, sBits - m), clamp: false }, c.ss(0, 10), [c.sc(14), c.sc(15)]);
          p.move(c.sc(13), COL + co.S);
        }));
        if (m === DB) p.addBig(D, 2 ** DB, ex);
      }, s9, false);
    });
    e.S('vq', () => {
      // values at the scale of St (v / D), queries times D
      p.copy(D, DI, tm); p.addBig(DI, -(2 ** (DB - 1)), ex);
      e.lookupBig(DI, DINV, y2, tb.recipD, s9);
      p.move(DINV, car1(SW, 0));
      let w = e.slide(dv, SW, 1, 1, (c) => {
        const PR = c.sc(0);
        e.mul(v, cBits, [[c.car(0), PR, 1]], c.ss(1, 8), false);
        e.rqN(PR, R0 + ro.VT, { ...e.rq(DB - (SB - CB), sBits), clamp: false }, c.ss(9, 10), [c.sc(19), c.sc(20)]);
        c.carry(0);
      });
      p.clear(w.end(w.car(0)));
      p.copy(D, car1(SW, 0), tm);
      w = e.slide(dk, SW, 1, 1, (c) => {
        const PR = c.sc(0);
        e.mul(q, qBits, [[c.car(0), PR, 1]], c.ss(1, 8), false);
        e.rqN(PR, R0 + ro.QD, { ...e.rq(DB, QB + 2), clamp: false }, c.ss(9, 10), [c.sc(19), c.sc(20)]);
        c.carry(0);
      });
      p.clear(w.end(w.car(0)));
      e.slide(dk, SW, 1, 1, () => p.move(k, COL + co.QU));
    });
    // what St predicts for the key (the keys stay in the columns for the write)
    const queue = (V, keep) => {
      p.move(COL + co.QU, V);
      if (keep) p.copy(V, COL + co.XK, COL + co.T + 2);
    };
    const onward = () => {
      e.slide(dv, COL + co.W, 1, 1, () => p.move(COL + co.AC, COL + co.AC + CS));
      e.slide(dk - 1, COL + co.W, 1, 1, () => p.move(COL + co.QU + 1, COL + co.QU + CS));
    };
    e.S('predict', () => pass(e, Lo, COL, KB + 2, (V) => queue(V, true), co.S, onward));
    e.S('delta', () => {
      // d = (v / D - round(St k)) * beta, into the first column
      p.move(BETA, car1(SW, 0));
      const w = e.slide(dv, SW, 1, 1, (c) => {
        const PRD = c.sc(0), DD = c.sc(1), PR = c.sc(2), X = c.sc(23), Y = c.sc(24);
        p.move(END + co.AC, X);
        e.rqN(X, PRD, { ...e.rq(KB, npB), clamp: false }, c.ss(3, 10), [c.sc(13), c.sc(14)]);
        p.move(R0 + ro.VT, DD); p.scatter(PRD, [[DD, -1]]);
        e.mul(DD, sBits + 1, [[c.car(0), PR, 1]], c.ss(15, 8), false);
        e.rqN(PR, Y, { ...e.rq(TB, sBits), clamp: false }, c.ss(3, 10), [c.sc(13), c.sc(14)]);
        p.move(Y, COL + co.DV);
        c.carry(0);
      });
      p.clear(w.end(w.car(0)));
    });
    // write: St += round(k d / 2^KB), column by column; the deltas move on with the pass
    e.S('write', () => {
      pass(e, Lo, COL, KB + 2, (V) => p.move(COL + co.XK, V), co.DV, () => {
        e.slide(dv, COL + co.W, 1, 1, (c) => {
          e.rqN(COL + co.AC, c.sc(13), { ...e.rq(KB, nwB), clamp: false }, c.ss(0, 10), [c.sc(14), c.sc(15)]);
          p.move(c.sc(13), COL + co.S);
          p.move(COL + co.DV, COL + co.DV + CS);
        });
      });
      e.slide(dv, SW, 1, 1, () => p.clear(END + co.DV));
    });
    // read with the query times D
    e.S('read', () => {
      e.slide(dk, SW, 1, 1, () => p.move(R0 + ro.QD, COL + co.QU));
      pass(e, Lo, COL, QB + 2, (V) => queue(V, false), co.S, onward);
      e.slide(dv, SW, 1, 1, (c) => {
        const X = c.sc(15), Y = c.sc(16);
        p.move(END + co.AC, X);
        e.rqN(X, Y, e.rq(SB + QB - OB, oBits), c.ss(0, 10), [c.sc(13), c.sc(14)]);
        p.move(Y, R0 + ro.OH);
      });
    });
    // the conveyor moves on to the next region: the inputs of the next heads, the outputs (this one first), the residual, z
    e.S('next', () => {
      for (const [X, n] of [[q, dk], [k, dk], [v, dv], [A, 1], [B, 1], [DTc, 1], [LAc, 1]]) e.slide((nv - 1) * n, SW, 1, 1, () => p.move(X + n, X + RS));
      e.slide((nv - 1) * dv, SW, 1, 1, () => p.move(R0 + ro.OUT, R0 + ro.OUT + dv + RS));
      e.slide(dv, SW, 1, 1, () => p.move(R0 + ro.OH, R0 + ro.OUT + RS));
      e.slide(dim, SW, 1, 1, () => p.move(R0 + ro.XR, R0 + ro.XR + RS));
      e.slide(valueDim, SW, 1, 1, () => p.move(R0 + ro.ZR, R0 + ro.ZR + RS));
      p.move(R0 + ro.CT, R0 + ro.CT + RS).move(R0 + ro.CT + 1, R0 + ro.CT + 1 + RS);
    });
  });
}

// After the last head: rms norm per head, times the gain, times silu(z), coded into the queue of the output matrix.
function gated(e, K, P, Lo) {
  const p = e.p, a = e.a, { CN, POS, SXT, LC, range } = K, { nv, dv, valueDim, dim } = sizes(a), { ro } = Lo, Mo = Lo.Mo;
  const { yBits, gnB, ZB, zBits, YB, OHB, ohBits } = a.cfg;
  const RN = P + Lo.R0 + nv * Lo.RS, at = (k) => P + Lo.oO + Mo.ctrl + k;
  p.eachFrame(RN + ro.FLY, dv, nv, RN + ro.T, () => e.normVec(RN + ro.OUT, RN + ro.Y, a.tables.normY, RN + ro.NBY, RN + ro.NTY));
  const w = e.slide(valueDim, RN + ro.SW, 1, 1, (c) => {
    const [PG, G, SZ, PH, LOW, TOP, CODE, E1, E2, e0, e1] = c.ss(0, 11), m = c.ss(11, 8), s = c.ss(19, 30);
    e.mul(RN + ro.Y, yBits, [[RN + ro.GN, PG, 1]], m, false);
    e.rqN(PG, G, { ...e.rq(gnB, yBits), clamp: false }, s.slice(0, 10), [e0, e1]);
    silu(e, RN + ro.ZR, ZB, zBits, SZ, s);
    e.mul(G, yBits, [[SZ, PH, 1]], m, false);
    p.clear(SZ);
    e.rqSplit(PH, LOW, TOP, e.rq(YB + ZB - OHB, ohBits), s.slice(0, 10), [e0, e1]);
    e.encode(LOW, TOP, CODE, c.car(0), E1, E2, ohBits);
    p.move(CODE, P + Lo.oO + Mo.q);
    c.carry(0);
  });
  p.move(w.end(w.car(0)), at(SXT));
  e.slide(dim, RN + ro.SW, 1, 1, () => p.move(RN + ro.XR, P + Lo.oO + Mo.y));
  p.move(RN + ro.CT, at(POS)).move(RN + ro.CT + 1, at(LC));
  p.addBig(at(CN), valueDim, [RN + ro.T, RN + ro.T + 1]);
  void range;
}

// ---- reading, the walk home, what rests -----------------------------------------------------

function read(e, K, P, Lo, u, lcr) {
  const p = e.p, a = e.a, pre = e.pre, { nv, dv, convDim, kernel, Rin, valueDim } = sizes(a), { ro, RS } = Lo, R0 = P + Lo.R0, RN = R0 + nv * RS;
  e.readStrip('linDrO', u, P + Lo.mix + pre.dr, a.dim, 1, 0, P + Lo.mix + pre.scr);
  lcr = e.readMat('linO', u, P + Lo.oO, Lo.Mo, e.wBytes, lcr);
  e.readStrip('linGN', u, RN + ro.GN, valueDim, 2, 2 ** 15, RN + ro.SW);
  for (let h = 0; h < nv; h++) p.addBig(R0 + h * RS + ro.D, 2 ** a.cfg.DB, [R0 + h * RS + ro.T, R0 + h * RS + ro.T + 1]);
  // the counter crosses the regions
  p.move(lcr, RN + ro.WC + 1);
  walk(e, Lo, R0, nv, 0, [ro.WC + 1]);
  lcr = R0 + ro.WC + 1;
  e.readStrip('linLA', u, P + Lo.LA, nv, 2, 2 ** 15, P + Lo.Dscr);
  e.readStrip('linDT', u, P + Lo.DT, nv, 2, 2 ** 15, P + Lo.Dscr);
  for (let j = kernel - 1; j >= 0; j--) e.readStrip('linCW' + j, u, P + Lo.CW + j * convDim, convDim, 2, 2 ** 15, P + Lo.Dscr);
  e.readStrip('linDrIn', u, P + Lo.Ddr, Rin, 1, 0, P + Lo.Dscr);
  void dv;
  return e.readMat('linIn', u, P, Lo.Min, e.wBytes, lcr);
}

function home(e, K, P, Lo) {
  const p = e.p, { nv } = sizes(e.a), { ro, RS } = Lo, R0 = P + Lo.R0, RN = R0 + nv * RS;
  p.move(P + Lo.o13 + 2, P + Lo.aO + 2).move(P + Lo.o13 + 3, P + Lo.aO + 3);
  e.unsweep(P + Lo.aO, Lo.Mo, [2, 3]);
  p.move(P + Lo.oO + 2, RN + ro.WC + 1).move(P + Lo.oO + 3, RN + ro.WC + 2);
  walk(e, Lo, R0, nv, 0, [ro.WC + 1, ro.WC + 2]);
  e.slide(2, R0 + ro.SW, 1, 1, () => p.move(R0 + ro.WC + 1, P + Lo.aIn + 2));
  e.unsweep(P + Lo.aIn, Lo.Min, [2, 3]);
}

function resting(e, K, P, Lo) {
  const { nv, dk, dv, convDim, kernel, Rin, valueDim } = sizes(e.a), { Min, Mo, ro, co, CS, RS } = Lo, r = [], R0 = P + Lo.R0;
  r.push([P + Min.G + 1, P + Min.G + Min.C * (Min.R + 1)], [P + Lo.oO + Mo.G + 1, P + Lo.oO + Mo.G + Mo.C * (Mo.R + 1)]);
  r.push([P + Lo.Ddr, P + Lo.Ddr + Rin - 1], [P + Lo.WIN, P + Lo.WIN + (kernel - 1) * convDim - 1], [P + Lo.CW, P + Lo.CW + kernel * convDim - 1]);
  r.push([P + Lo.DT, P + Lo.DT + nv - 1], [P + Lo.LA, P + Lo.LA + nv - 1], [P + Lo.mix + e.pre.dr, P + Lo.mix + e.pre.dr + e.a.dim - 1]);
  for (let h = 0; h < nv; h++) {
    const R = R0 + h * RS;
    for (let i = 0; i < dk; i++) r.push([R + ro.C0 + i * CS + co.S, R + ro.C0 + i * CS + co.S + dv - 1]);
    r.push([R + ro.D, R + ro.D]);
  }
  const RN = R0 + nv * RS;
  r.push([RN + ro.GN, RN + ro.GN + valueDim - 1]);
  return r;
}

// Where the state of a layer rests: St[h][i][j] and D[h] (for the tests and the second question of a page).
function stateCells(e, P, Lo) {
  const { nv, dk, dv, convDim, kernel } = sizes(e.a), { ro, co, CS, RS } = Lo, R0 = P + Lo.R0;
  return {
    S: (h, i, j) => R0 + h * RS + ro.C0 + i * CS + co.S + j, D: (h) => R0 + h * RS + ro.D,
    win: (j, ch) => P + Lo.WIN + j * convDim + ch, ranges: () => {
      const r = [[P + Lo.WIN, P + Lo.WIN + (kernel - 1) * convDim - 1]];
      for (let h = 0; h < nv; h++) { for (let i = 0; i < dk; i++) r.push([R0 + h * RS + ro.C0 + i * CS + co.S, R0 + h * RS + ro.C0 + i * CS + co.S + dv - 1]); r.push([R0 + h * RS + ro.D, R0 + h * RS + ro.D]); }
      return r;
    },
  };
}

function values(arch, net, layout) {
  const { dim } = arch, { nv, dv, valueDim, convDim, kernel } = sizes(arch), L = net.layers, OFFW = layout.OFFW;
  // z and the columns of the output matrix are in the order the heads leave the conveyor: the last head first
  const zOf = (i) => (nv - 1 - Math.floor(i / dv)) * dv + (i % dv);
  const row = (Q, r) => (r < convDim ? [Q.wqkv, r] : r < convDim + valueDim ? [Q.wz, zOf(r - convDim)] : r < convDim + valueDim + nv ? [Q.wa, r - convDim - valueDim] : [Q.wb, r - convDim - valueDim - nv]);
  const strips = {
    linDrIn: (l) => (i) => { const [m, j] = row(L[l], i); return m.d[j]; },
    linDrO: (l) => (i) => L[l].wout.d[i],
    linGN: (l) => (i) => L[l].gn[i % dv],
    linDT: (l) => (i) => L[l].dt[i],
    linLA: (l) => (i) => L[l].logA[i],
  };
  for (let j = 0; j < kernel; j++) strips['linCW' + j] = (l) => (ch) => L[l].conv[ch * kernel + j];
  return {
    mats: {
      linIn: (l, r, c) => { const [m, i] = row(L[l], r); return OFFW + m.w[i * dim + c]; },
      linO: (l, r, c) => OFFW + L[l].wout.w[r * valueDim + zOf(c)],
    },
    strips,
  };
}

module.exports = { layout, emit, read, home, resting, values, stateCells, sizes };
