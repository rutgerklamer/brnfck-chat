'use strict';

// The gated full attention token mixer (spec.js attention()), after the attention of the Qwen2.5 engine
// (compiler/qwen/engine/stations.js).

const SC = 1, BEST = 2, TOT = 3, WW = 4, DD = 5, EE = 6, HSC = 7, HS = 32;   // fields of a head frame; HSC.. = scratch

const sizes = (a) => {
  const { heads, kvHeads, headSize: hs, qDim, rotDim } = a, kv = kvHeads * hs;
  return { heads, kvHeads, hs, qDim, kv, share: heads / kvHeads, rotHalf: rotDim / 2, NH: heads + kvHeads, W: qDim + kv, T: a.maxTokens };
};
// Engine order: segment s of kvDim numbers holds query head g * share + s of every key/value head g, so one pass
// over a key serves all the query heads that read it. permOf: query number j in engine order -> its number in the model.
const permOf = (a) => {
  const { hs, kv, share } = sizes(a);
  return (j) => { const s = Math.floor(j / kv), g = Math.floor((j % kv) / hs), i = j % hs; return (g * share + s) * hs + i; };
};

// One layer from P: the input matrix (rows q, k, gate, v), the area where heads are rounded, normalised and rotated,
// the slots (a dock, one per position, one more), the output matrix.
function layout(e, K) {
  const a = e.a, { ZW } = K, { dim } = a, { qDim, kv, hs, heads, rotHalf, W, T } = sizes(a), { ngBits, vBits } = a.cfg;
  if (a.heads % a.kvHeads || a.rotDim % 2 || a.rotDim > a.headSize) throw new Error('bad head sizes');
  const R = 2 * qDim + 2 * kv;
  const Min = e.mat(R, dim, dim, ngBits), Mo = e.mat(dim, qDim, dim, vBits);
  const HL = Mo.y - Mo.q + dim + 1 + 8;           // the queue of the output matrix, the residual and its control cells
  let at;
  const take = (n) => { const x = at; at += n + 1; return x; };

  // One slot (the dock is slot 0, position t is slot t + 1): offsets inside it.
  const so = {};
  at = 0;
  so.U = take(1);                  // 1 when this slot holds a position
  so.KS = take(kv); so.VS = take(kv);           // the stored key and value
  so.scr = take(kv + ZW + 2);      // sliding scratch (next to the query: short walks in the products)
  so.QK = take(qDim + 2 * kv);     // the query, travelling through the slots; behind it the new key and value
  so.WS = take(qDim);              // attention weights spread out, one per value
  so.SM = take(qDim);              // weighted sums, travelling back
  so.FL = take(kv);                // flags: last element of a head
  so.Hc = take(1); so.H = take(heads * HS);
  so.HB = so.QK; so.HW = so.HB + HL + 1;        // what crosses the slots after the attention, and its scratch
  at = Math.max(at, so.HW + HL + ZW + 4);
  so.WC = take(6);                 // counter and two cells of a walk over the slots
  const SS = at + 1;

  const Lo = { Min, Mo, so, SS, HL, R, W };
  Lo.aQ = dim * (R + 1);
  at = Lo.aQ + Min.G + 2;
  Lo.Ascr = take(R + ZW + 4);
  Lo.Adr = take(R);                // doublings per row of the input matrix
  Lo.At = take(6);
  // one frame per head (stride headSize): flags, scratch of the norm, gains, then the values
  Lo.Afl = take(W); Lo.Ant = take(W + 40); Lo.Agn = take(W);
  Lo.Agt = take(qDim);             // the output gate
  Lo.Anb = take(Math.max(W + kv, qDim, dim) + ZW + 4);
  Lo.Aqk = take(W);                // q and k rounded, then normalised times the gain
  Lo.Atrig = take(4 * rotHalf);    // per rotation speed: cos (2 cells), sin (2 cells)
  Lo.Asw = take(10);
  Lo.Apt = take(W + hs);           // cos and sin under the numbers they rotate (each head hands them on to the next)
  Lo.Aqn = take(W + kv);           // q and k normalised, then rotated; behind them v
  Lo.dock = at; at += (T + 2) * SS + 1;
  Lo.oO = at; Lo.aO = Lo.oO + qDim * (dim + 1);
  Lo.mix = Lo.aO + Mo.G + 1;
  Lo.slot = (k) => Lo.dock + k * SS;
  return Lo;
}

// Carry the cells at offsets `cells` of slot `from` to slot `to`, one slot per round, so no code walks the whole
// length of the slots; body(s, d) runs in every round.
function walk(e, P, Lo, from, to, cells, body) {
  const p = e.p, { so, SS } = Lo, n = Math.abs(to - from), d = Math.sign(to - from) * SS, s = P + Lo.slot(from), cnt = s + so.WC;
  p.addBig(cnt, n, [cnt + 4, cnt + 5]);
  p.to(cnt).raw('[').add(cnt, -1);
  for (const c of cells) p.move(s + c, s + c + d);
  if (body) body(s, d);
  p.move(cnt, cnt + d);
  p.to(cnt + d).raw(']');
  p.ptr = P + Lo.slot(to) + so.WC;
}

function emit(e, K, P, Lo) {
  const a = e.a;
  e.S('xn1', () => e.normEmit(P, Lo.Min, false));
  e.S('sweep1', () => e.sweep(P, Lo.Min));
  e.S('qkv', () => qkvRound(e, K, P, Lo));
  e.S('trig', () => trig(e, K, P, Lo));
  e.S('heads', () => headStage(e, K, P, Lo));
  e.S('store', () => { markSlot(e, P, Lo); storeKeyValue(e, K, P, Lo); });
  e.S('att', () => attention(e, K, P, Lo));
  e.S('mixed', () => mixed(e, K, P, Lo));
  e.S('hop', () => hop(e, K, P, Lo));
  e.S('sweep2', () => e.sweep(P + Lo.oO, Lo.Mo));
  e.S('xatt', () => e.residual(P + Lo.aO, Lo.Mo, a.R.o[0], a.eo, P + Lo.mix));
}

// The sums of the input matrix, rounded: q and k to the head frames, the gate to its strip, v behind them.
function qkvRound(e, K, P, Lo) {
  const p = e.p, a = e.a, { car1, SXT } = K, { qDim, kv, W } = sizes(a), R = a.R, M = Lo.Min;
  const arr = P + Lo.aQ, c = (k) => arr + M.ctrl + k, base = P + Lo.Ascr, tmp = P + Lo.At;
  // n rows from row `row` (engine order), rounded by [k, bits]
  const round = (n, row, dst, [k, bits], last) => {
    if (last) p.move(c(SXT), car1(base, 0)); else p.copy(c(SXT), car1(base, 0), tmp);
    const w = e.slide(n, base, 1, 1, (c) => {
      const X = c.sc(0), t = c.sc(1), tm = c.sc(2);
      e.fixSum(arr + M.m + row, X, c.car(0), e.OFFW);
      e.doubleRow(X, P + Lo.Adr + row, t, tm);
      e.rqN(X, c.sc(13), e.rq(k, bits), c.ss(3, 10), [c.sc(14), c.sc(15)]);
      p.move(c.sc(13), dst);
    });
    p.clear(w.end(w.car(0)));
  };
  if (R.q.join() === R.k.join()) round(W, 0, P + Lo.Aqk, R.q, false);
  else { round(qDim, 0, P + Lo.Aqk, R.q, false); round(kv, qDim, P + Lo.Aqk + qDim, R.k, false); }
  round(qDim, W, P + Lo.Agt, R.gate, false);
  round(kv, W + qDim, P + Lo.Aqn + W, R.v, true);
}

// cos and sin of this position, under the numbers of the first head (number f with cos, f + rotDim/2 with sin)
function trig(e, K, P, Lo) {
  const p = e.p, a = e.a, { range, POS } = K, { rotHalf } = sizes(a);
  const COS = (f) => P + Lo.Atrig + 4 * f, SIN = (f) => COS(f) + 2, PT = P + Lo.Apt, X = P + Lo.Asw + 9;
  const split = (v) => { let lo = ((v % 16) + 16) % 16; if (lo > 8) lo -= 16; return [lo, (v - lo) / 16]; };
  p.copy(P + Lo.aQ + Lo.Min.ctrl + POS, X, P + Lo.Asw);
  e.switchTree(X, Math.log2(a.maxTokens), (pos) => {
    for (let f = 0; f < rotHalf; f++) {
      const [cl, ch] = split(a.tables.cos[pos][f]), [sl, sh] = split(a.tables.sin[pos][f]);
      p.add(COS(f), cl).add(COS(f) + 1, ch).add(SIN(f), sl).add(SIN(f) + 1, sh);
    }
  }, range(9, (i) => P + Lo.Asw + i), false);
  for (let f = 0; f < rotHalf; f++) {
    p.scatter(COS(f) + 1, [[COS(f), 16]]); p.scatter(SIN(f) + 1, [[SIN(f), 16]]);
    p.move(COS(f), PT + f); p.move(SIN(f), PT + f + rotHalf);
  }
}

// Every head (the query heads, then the key heads), one copy of the code: rms norm, times the gain, rotated.
// Then q, k and v go to the slot of position 0.
function headStage(e, K, P, Lo) {
  const p = e.p, a = e.a, { hs, NH, rotHalf, W, kv } = sizes(a), { gainB, NHB, QKB, nhBits, qkBits, RB } = a.cfg, { rotDim } = a;
  const QK = P + Lo.Aqk, QN = P + Lo.Aqn, GN = P + Lo.Agn, PT = P + Lo.Apt, NB = P + Lo.Anb;
  p.eachFrame(P + Lo.Afl, hs, NH, P + Lo.At, () => {
    e.normVec(QK, QN, a.tables.normH, NB, P + Lo.Ant);
    e.S('gain', () => e.slide(hs, NB, 1, 1, (c) => {
      const PG = c.sc(0), s = c.ss(1, 10);
      e.mul(QN, nhBits, [[GN, PG, 1]], s.slice(0, 8), false);                // the gain cell is kept
      e.rqN(PG, QK, e.rq(gainB + NHB - QKB, qkBits), s, [c.sc(11), c.sc(12)]);
    }));
    e.slide(rotHalf, NB, 1, 1, (c) => {
      const t1 = c.sc(0), t2 = c.sc(1), cos = c.sc(12), sin = c.sc(13), near = c.sc(14), ex = [c.sc(15), c.sc(16)];
      p.move(PT, cos).move(PT + rotHalf, sin);
      e.mul(QK, qkBits, [[cos, t1, 1], [sin, t2, 1]], c.ss(2, 8), false);              // p cos, p sin
      e.mul(QK + rotHalf, qkBits, [[sin, t1, -1], [cos, t2, 1]], c.ss(2, 8), false);   // -q sin, q cos
      e.rqN(t1, near, e.rq(RB, qkBits), c.ss(2, 10), ex); p.move(near, QN);
      e.rqN(t2, near, e.rq(RB, qkBits), c.ss(2, 10), ex); p.move(near, QN + rotHalf);
      p.move(cos, PT + hs).move(sin, PT + rotHalf + hs);                              // for the next head
    });
    if (hs > rotDim) e.slide(hs - rotDim, NB, 1, 1, () => p.move(QK + rotDim, QN + rotDim));
  });
  for (let f = 0; f < rotDim; f++) p.clear(PT + NH * hs + f);
  const s1 = P + Lo.slot(1);
  e.slide(W + kv, NB, 1, 1, () => p.move(QN, s1 + Lo.so.QK));
}

// ---- the slots of this layer: dock first, then position 0, 1, ... (compiler/qwen/engine/stations.js) ----

// Claim the first free slot. The pointer ends in the dock (never used).
function markSlot(e, P, Lo) {
  const p = e.p, { so, SS } = Lo, U = P + Lo.slot(1) + so.U;
  p.to(U).raw('[' + '>'.repeat(SS) + ']');
  p.add(U, 1);
  p.raw('[' + '<'.repeat(SS) + ']');
  p.ptr = P + Lo.dock + so.U;
}

// The new key and value travel from the slot of position 0 to the slot just claimed.
function storeKeyValue(e, K, P, Lo) {
  const p = e.p, { so, SS } = Lo, { qDim, kv } = sizes(e.a), s0 = P + Lo.slot(1), U = s0 + so.U, KT = s0 + so.QK + qDim, VT = KT + kv;
  p.to(U + SS).raw('[');
  e.slide(kv, s0 + so.scr, 1, 1, () => { p.move(KT, KT + SS); p.move(VT, VT + SS); });
  p.to(U + 2 * SS).raw(']');
  p.ptr = U + SS;
  e.slide(kv, s0 + so.scr, 1, 1, () => { p.move(KT, s0 + so.KS); p.move(VT, s0 + so.VS); });
  p.to(U).raw('[' + '<'.repeat(SS) + ']');
  p.ptr = P + Lo.dock + so.U;
}

function attention(e, K, P, Lo) {
  const p = e.p, a = e.a, { range } = K, { so, SS } = Lo, { heads, kvHeads, hs, qDim, kv, share } = sizes(a), { qkBits, vBits, scoreBits, gapShift } = a.cfg;
  const s0 = P + Lo.slot(1), U = s0 + so.U;
  const head = (h, f) => s0 + so.H + h * HS + f, H = (f) => head(0, f), hsc = range(10, (i) => H(HSC + i));
  const eachHead = (body) => p.eachFrame(H(0), HS, heads, s0 + so.Hc, body);
  const KS = s0 + so.KS, VS = s0 + so.VS, QS = s0 + so.QK, WS = s0 + so.WS, SM = s0 + so.SM, FL = s0 + so.FL;
  const SB = Math.min(scoreBits, 2 * (qkBits - 1) + Math.ceil(Math.log2(hs))), nClamp = SB + 2;
  const expBits = Math.log2(a.tables.exp.length);
  // scratch of the pass back: the end of the query field (free by then), next to the weights
  const vw = qDim + kv >= K.ZW + 2 ? so.QK + qDim + 2 * kv - (kv + K.ZW + 2) : so.scr;

  for (let h = 0; h < heads; h++) p.addBig(head(h, BEST), -(2 ** SB), [head(h, HSC), head(h, HSC + 1)]);
  p.to(U).raw('[');
  {
    for (let g = 0; g < kvHeads; g++) p.add(FL + g * hs + hs - 1, 1);
    e.slide(kv, s0 + so.scr, 1, 1, (c) => {
      // score of every query head sharing this key += key * q; the sums are carried
      e.mul(KS, qkBits, range(share, (s) => [QS + s * kv, c.car(s), 1]), c.ss(0, 8), true);
      for (let s = 0; s < share; s++) p.move(QS + s * kv, QS + s * kv + SS);           // q goes on to the next slot
      p.loop(FL, () => { p.add(FL, -1); for (let s = 0; s < share; s++) p.move(c.car(s), WS + s * kv); });
      for (let s = 0; s < share; s++) c.carry(s);
    }, Math.max(4, share));
    for (let g = 0; g < kvHeads; g++) for (let s = 0; s < share; s++) p.move(WS + s * kv + g * hs + hs - 1, head(g * share + s, SC));
    eachHead(() => {
      // best = max(best, score), and send it on: best + max(score - best, 0)
      p.scatter(H(SC), [[H(DD), 1], [H(WW), 1]]).move(H(WW), H(SC));
      p.scatter(H(BEST), [[H(DD), -1], [H(BEST) + SS, 1]]);
      const [d1, d2, h0, h1] = [H(EE), H(HSC + 10), H(HSC + 11), H(HSC + 12)];
      p.requant(H(DD), 0, { ...e.rq(0, nClamp, 0, 0), outs: [{ cell: H(WW), bits: 8 }, { cell: d1, bits: 8 }, { cell: d2, bits: nClamp - 16 }] }, hsc);
      p.shl(d1, H(WW), 8, [h0, h1]).shl(d2, H(WW), 16, [h0, h1]);
      p.move(H(WW), H(BEST) + SS);
    });
  }
  p.to(U + SS).raw(']');
  p.ptr = U;
  // In the first unused slot: drop q, send the maxima back.
  for (let i = 0; i < qDim; i++) p.clear(QS + i);
  eachHead(() => p.move(H(BEST), H(BEST) - SS));
  p.to(U - SS); p.ptr = U;
  p.raw('[');
  {
    eachHead(() => {
      p.scatter(H(BEST), [[H(DD), 1], [H(BEST) - SS, 1]]);
      p.scatter(H(SC), [[H(DD), -1]]);
      p.requant(H(DD), H(EE), e.rq(gapShift, expBits, 0, 0), hsc);
      p.lookup(H(EE), H(WW), a.tables.exp, hsc.slice(0, 9), { keepX: false });
      p.move(H(TOT), H(TOT) - SS);
      p.scatter(H(WW), [[H(TOT) - SS, 1], [H(DD), 1]]).move(H(DD), H(WW));
    });
    for (let g = 0; g < kvHeads; g++) for (let s = 0; s < share; s++) p.scatter(head(g * share + s, WW), range(hs, (i) => [WS + s * kv + g * hs + i, 1]));
    e.slide(kv, s0 + vw, 1, 1, (c) => {
      e.mul(VS, vBits, range(share, (s) => [WS + s * kv, SM + s * kv, 1]), c.ss(0, 8), true);
      for (let s = 0; s < share; s++) { p.clear(WS + s * kv); p.move(SM + s * kv, SM + s * kv - SS); }
    });
  }
  p.to(U - SS).raw(']');
  p.ptr = P + Lo.dock + so.U;
}

// mixed = sums / total, times sigmoid(gate), coded into the queue of the output matrix (in the slot of position 0).
function mixed(e, K, P, Lo) {
  const p = e.p, a = e.a, { range, CN, POS, SXT, LC } = K, { so } = Lo, { heads, kvHeads, hs, qDim, kv, share } = sizes(a), { dim } = a;
  const { vBits, SGB, GTB, sigIn, sigRange } = a.cfg, Mi = Lo.Min, Mo = Lo.Mo;
  const dk = P + Lo.dock, hd = (h, f) => dk + so.H + h * HS + f, base = P + Lo.Anb;
  const arr = P + Lo.aQ, c = (k) => arr + Mi.ctrl + k, QI = P + Lo.slot(1) + so.HB, YI = QI + Mo.y - Mo.q, hc = (k) => YI + dim + 1 + k;
  p.eachFrame(hd(0, 0), HS, heads, dk + so.Hc, () => {
    const f = (k) => hd(0, k), S = range(10, (i) => f(HSC + i)), t1 = f(HSC + 10), t2 = f(HSC + 11), MANT = f(HSC + 12), y2 = f(HSC + 13), ex = f(HSC + 14);
    p.clear(f(BEST));
    p.copy(f(TOT), t1, t2);
    e.bitCount(t1, 16, (j) => [15 - j], [f(DD)], S);            // D = 16 - bits of the total
    p.copy(f(DD), t1, t2);
    e.doubleBy(f(TOT), t1, t2);
    p.requantCore(f(TOT), [{ cell: MANT, bits: 8 }, { cell: ex, bits: 2 }], 6, 10, false, S);
    p.shl(ex, MANT, 8, [t1, t2]);
    e.lookupBig(MANT, f(WW), y2, a.tables.recip, S.slice(0, 9));
  });
  const RC = dk + so.WS, DC = dk + so.QK, SM = dk + so.SM;
  for (let g = 0; g < kvHeads; g++) {
    for (let s = 0; s < share; s++) {
      const at = s * kv + g * hs;
      p.scatter(hd(g * share + s, WW), range(hs, (i) => [RC + at + i, 1]));
      p.scatter(hd(g * share + s, DD), range(hs, (i) => [DC + at + i, 1]));
    }
  }
  const sigBits = Math.log2(a.tables.sig.length), gk = GTB - sigIn;
  if (gk < 0) throw new Error('the gate needs at least sigIn fraction bits');
  const gate = { k: gk, n: sigBits, lo: 0, addend: (gk > 0 ? 2 ** (gk - 1) : 0) + sigRange * 2 ** GTB };
  const w = e.slide(qDim, base, 1, 1, (c) => {
    const [Sv, R1, Dn, tm, Nn, PR, MX, IX, SG, y2, LOW, TOP, CODE, E1, E2, e0, e1] = c.ss(0, 17), s = c.ss(17, 10);
    p.move(SM, Sv).move(RC, R1).move(DC, Dn);
    e.doubleBy(Sv, Dn, tm);
    e.rqN(Sv, Nn, e.rq(11, 17), s, [e0, e1]);
    e.mul(Nn, 17, [[R1, PR, 1]], s.slice(0, 8), false);
    p.clear(R1);
    e.rqN(PR, MX, e.rq(14, vBits), s, [e0, e1]);
    // times sigmoid(gate)
    e.rqN(P + Lo.Agt, IX, gate, s, [e0, e1]);
    e.lookupBig(IX, SG, y2, a.tables.sig, s.slice(0, 9));
    e.mul(MX, vBits, [[SG, PR, 1]], s.slice(0, 8), false);
    p.clear(SG);
    e.rqSplit(PR, LOW, TOP, e.rq(SGB, vBits), s, [e0, e1]);
    e.encode(LOW, TOP, CODE, c.car(0), E1, E2, vBits);
    p.move(CODE, QI);
    c.carry(0);
  }, 4);
  p.move(w.end(w.car(0)), hc(SXT));
  e.slide(dim, base, 1, 1, () => p.move(arr + Mi.y, YI));      // the residual goes along
  p.move(c(POS), hc(POS)).move(c(LC), hc(LC));
  p.addBig(hc(CN), qDim, [P + Lo.At, P + Lo.At + 1]);
}

// The queue, the residual and the control cells cross the slots to the output matrix.
function hop(e, K, P, Lo) {
  const p = e.p, { CN, POS, SXT, LC } = K, { so } = Lo, { T } = sizes(e.a), Mo = Lo.Mo;
  walk(e, P, Lo, 1, T + 1, [], (s, d) => e.slide(Lo.HL, s + so.HW, 1, 1, () => p.move(s + so.HB, s + so.HB + d)));
  const sl = P + Lo.slot(T + 1), at = P + Lo.oO + Mo.m;
  e.slide(Lo.HL, sl + so.HW, 1, 1, () => p.move(sl + so.HB, P + Lo.oO + Mo.q));
  for (const k of [LC, SXT, POS, CN]) p.move(at + k, P + Lo.oO + Mo.ctrl + k);
}

// ---- reading, the walk home, what rests -----------------------------------------------------

function read(e, K, P, Lo, u, lcr) {
  const p = e.p, a = e.a, pre = e.pre, { so } = Lo, { T } = sizes(a);
  e.readStrip('attDrO', u, P + Lo.mix + pre.dr, a.dim, 1, 0, P + Lo.mix + pre.scr);
  lcr = e.readMat('attO', u, P + Lo.oO, Lo.Mo, e.wBytes, lcr);
  // the counter crosses the slots
  p.move(lcr, P + Lo.slot(T + 1) + so.WC + 1);
  walk(e, P, Lo, T + 1, 0, [so.WC + 1]);
  lcr = P + Lo.dock + so.WC + 1;
  const gainOff = 2 ** (a.cfg.gainBits - 1), gBytes = Math.ceil((a.cfg.gainBits + 1) / 8);
  e.readStrip('attGain', u, P + Lo.Agn, Lo.W, gBytes, gainOff, P + Lo.Anb);
  e.readStrip('attDrIn', u, P + Lo.Adr, Lo.R, 1, 0, P + Lo.Ascr);
  return e.readMat('attIn', u, P, Lo.Min, e.wBytes, lcr);
}

function home(e, K, P, Lo) {
  const p = e.p, { so } = Lo, { T } = sizes(e.a), sl = P + Lo.slot(T + 1), dk = P + Lo.dock;
  p.move(P + Lo.o13 + 2, P + Lo.aO + 2).move(P + Lo.o13 + 3, P + Lo.aO + 3);
  e.unsweep(P + Lo.aO, Lo.Mo, [2, 3]);
  p.move(P + Lo.oO + 2, sl + so.WC + 1).move(P + Lo.oO + 3, sl + so.WC + 2);
  walk(e, P, Lo, T + 1, 0, [so.WC + 1, so.WC + 2]);
  e.slide(2, dk + so.HW, 1, 1, () => p.move(dk + so.WC + 1, P + Lo.aQ + 2));
  e.unsweep(P + Lo.aQ, Lo.Min, [2, 3]);
}

function resting(e, K, P, Lo) {
  const { so } = Lo, { kv, T } = sizes(e.a), { Min, Mo } = Lo, r = [];
  r.push([P + Min.G + 1, P + Min.G + Min.C * (Min.R + 1)], [P + Lo.oO + Mo.G + 1, P + Lo.oO + Mo.G + Mo.C * (Mo.R + 1)]);
  r.push([P + Lo.Adr, P + Lo.Adr + Lo.R - 1], [P + Lo.Agn, P + Lo.Agn + Lo.W - 1], [P + Lo.mix + e.pre.dr, P + Lo.mix + e.pre.dr + e.a.dim - 1]);
  for (let t = 0; t < T; t++) {
    const s = P + Lo.slot(t + 1);
    r.push([s + so.U, s + so.U], [s + so.KS, s + so.KS + kv - 1], [s + so.VS, s + so.VS + kv - 1]);
  }
  return r;
}

function values(arch, net, layout) {
  const { dim } = arch, { qDim, kv, W, hs } = sizes(arch), perm = permOf(arch), L = net.layers, OFFW = layout.OFFW;
  // row r of the input matrix (engine order): [matrix, its row]
  const row = (Q, r) => (r < qDim ? [Q.wq, perm(r)] : r < W ? [Q.wk, r - qDim] : r < W + qDim ? [Q.wg, perm(r - W)] : [Q.wv, r - W - qDim]);
  return {
    mats: {
      attIn: (l, r, c) => { const [m, i] = row(L[l], r); return OFFW + m.w[i * dim + c]; },
      attO: (l, r, c) => OFFW + L[l].wo.w[r * qDim + perm(c)],
    },
    strips: {
      attDrIn: (l) => (i) => { const [m, j] = row(L[l], i); return m.d[j]; },
      attDrO: (l) => (i) => L[l].wo.d[i],
      attGain: (l) => (i) => (i < qDim ? L[l].qn : L[l].kn)[i % hs],
    },
  };
}

module.exports = { layout, emit, read, home, resting, values, permOf, HS, fields: { SC, BEST, TOT, WW, DD, EE } };
