'use strict';

// The parts of the engine that work BETWEEN the matrices: one token's trip, one layer, normalising, rounding.

const SC = 1, BEST = 2, TOT = 3, WW = 4, DD = 5, EE = 6, HSC = 7;   // fields of a head frame; HSC.. = scratch cells

module.exports = (Engine, K) => {
  const { range, HS, CN, POS, SXT, LC, C4, C5, TT, H0, H1 } = K;
  const E = Engine.prototype;
  const car1 = (base, j) => base + 2 * (j + 1);        // carried cell j of a slide with stride 1, direction +1

  E.shifts = function () {
    const { NB, QB, VB, XB, GB, HB, LB, tops } = this.a.cfg;
    return { q: tops.wq + NB - QB, k: tops.wk + NB - QB, v: tops.wv + NB - VB, o: tops.wo + VB - XB, a: tops.w1 + NB - GB, b: tops.w3 + NB - GB, f: tops.w2 + HB - XB, cls: tops.cls + NB - LB };
  };

  E.fixSum = function (c, src, X, sx, t, tm, d, others = []) {
    const p = this.p;
    p.move(src, X);
    for (const [s2, X2] of others) p.move(s2, X2);
    p.scatter(sx, [[X, -this.OFFW], ...others.map(([, X2]) => [X2, -this.OFFW]), [sx + 1, 1]]);
    this.double(X, d, t, tm);
  };
  // X *= 2^d inside a slide (stride 1, to the right); d moves on to the next round.
  E.double = function (X, d, t, tm) {
    const p = this.p;
    p.scatter(d, [[t, 1], [d + 1, 1]]);
    p.loop(t, () => { p.add(t, -1); p.scatter(X, [[tm, 2]]); p.move(tm, X); });
  };
  // X *= 2^cnt; cnt is used up.
  E.doubleBy = function (X, cnt, tm) {
    const p = this.p;
    p.loop(cnt, () => { p.add(cnt, -1); p.scatter(X, [[tm, 2]]); p.move(tm, X); });
  };

  E.preload = function (n, base, src, dst, ecell, tmp) {
    const p = this.p;
    p.copy(ecell, car1(base, 0), tmp);
    const w = this.slide(n, base, 1, 1, (c) => {
      p.move(src, c.sc(0)); p.addBig(c.sc(0), -this.OFFX, [c.sc(3), c.sc(4)]);
      this.double(c.sc(0), c.car(0), c.sc(1), c.sc(2));
      p.move(c.sc(0), dst);
    });
    p.clear(w.end(w.car(0)));
  };

  // ---- one position: token in, next token chosen ------------------------------------

  E.token = function () {
    const { p, gl, M, a, pre } = this, { dim } = a, ce = (k) => this.E + M.emb.ctrl + k;
    this.S('take', () => this.emitTakePrompt());
    this.S('emb', () => {
      p.copy(gl.TOKEN, ce(2), gl.T); p.copy(gl.POS, ce(1), gl.T);
      p.addBig(ce(0), dim, [ce(6), ce(7)]);
      this.sweepEmb();
      // x = values - OFFX, as a strip in the area before the first layer
      const aE = this.aE, ca = (k) => aE + M.emb.ctrl + k, s0 = this.P0 - this.PRE, X = s0 + pre.x;
      p.clear(ca(2));
      this.slide(dim, s0 + pre.scr, 1, 1, (c) => { p.move(aE + M.emb.y, X); p.addBig(X, -this.OFFX, [c.sc(0), c.sc(1)]); });
      p.move(ca(1), s0 + pre.pos);
    });

    // The layers: one copy of the code in a loop; LC counts the layers to go.
    const lc0 = this.P0 - this.PRE + pre.lc;
    p.add(lc0, a.layers);
    this.P = this.P0;
    p.to(lc0).raw('[').add(lc0, -1);
    this.layer();
    p.to(lc0 + this.stride).raw(']');
    p.ptr = lc0 + a.layers * this.stride;
    this.S('xnf', () => { this.normEmit(this.PL, M.cls, true); p.clear(this.PL - this.PRE + pre.pos); });
    this.S('cls', () => this.clsLoop());
    this.S('return', () => this.goHome());
    this.S('print', () => { this.emitFeedAndPrint(gl.T); p.add(gl.POS, 1); });
  };

  E.layer = function () {
    const { P, Lo, M, p } = this, sh = this.shifts();
    this.S('xn1', () => this.normEmit(P, M.qkv, false));
    this.S('sweep1', () => this.sweep(P, M.qkv));
    this.S('qkv', () => this.qkvRound());
    this.S('rot', () => this.rotate());
    this.S('store', () => { this.markSlot(); this.storeKeyValue(); });
    this.S('att', () => this.attention());
    this.S('mixed', () => this.mixed());
    this.S('hop', () => {
      // queue, sums and control cells cross the slots in one loop
      const land = P + Lo.oO + M.o.q, at = P + Lo.oO + M.o.a1;
      this.slide(Lo.HL, P + Lo.Ascr, 1, 1, () => p.move(P + Lo.Ahop, land));
      for (const k of [LC, SXT, POS, CN]) p.move(at + k, P + Lo.oO + M.o.ctrl + k);
    });
    this.S('sweep2', () => this.sweep(P + Lo.oO, M.o));
    this.S('xatt', () => this.residual(P + Lo.aO, M.o, sh.o, P + Lo.preB));
    this.S('xn2', () => this.normEmit(P + Lo.o13, M.w13, false));
    this.S('sweep3', () => this.sweep(P + Lo.o13, M.w13));
    this.S('hid', () => this.hiddenStage());
    this.S('sweep4', () => this.sweep(P + Lo.o2, M.w2));
    this.S('xout', () => this.residual(P + Lo.a2, M.w2, sh.f, P + Lo.preD));
  };

  E.normEmit = function (o, Mx, final) {
    const { p, a, pre } = this, { dim } = a, { xBits, nBits, NB } = a.cfg;
    const s0 = o - this.PRE, X = s0 + pre.x, base = s0 + pre.scr, t = (k) => s0 + pre.t + k, c = (k) => o + Mx.ctrl + k;
    const S = range(10, (i) => t(10 + i)), hop = [t(20), t(21)], half = 2 ** (xBits - 1), K3 = 26 - NB;

    // 1. A = sum of |x|: split x + 2^(xBits-1) into its top bit (1 = not negative) and the rest
    let w = this.slide(dim, base, 1, 1, (c) => {
      const [V, LOW, TOP, E1, e0, e1] = c.ss(0, 6), s = c.ss(6, 10);
      p.copy(X, V, LOW);
      this.rqSplit(V, LOW, TOP, { k: 0, n: xBits, lo: -half, addend: 0 }, s, [e0, e1]);
      this.ifElse(TOP, E1, () => p.move(LOW, c.car(0)), () => { p.scatter(LOW, [[c.car(0), -1]]); p.addBig(c.car(0), half, [e0, e1]); });
      c.carry(0);
    });
    p.move(w.end(w.car(0)), t(0));
    // D1 = 30 - (number of bits of A)
    this.bitCount(t(0), 31, (j) => [Math.max(0, 29 - j)], [t(1)], S);

    // 2. w = round(x * 2^D1 / 2^11), left where x was; ss = sum of round(w / 16)^2
    p.move(t(1), car1(base, 0));
    w = this.slide(dim, base, 1, 1, (c) => {
      const [V, tt, tm, Wc, U, U2, e0, e1] = c.ss(0, 8), s = c.ss(8, 10);
      if (final) p.move(X, V);
      else { p.copy(X, V, tt); p.move(X, o + Mx.y); p.addBig(o + Mx.y, this.OFFX, [e0, e1]); }
      this.double(V, c.car(0), tt, tm);
      this.rqN(V, Wc, { ...this.rq(11, 21), clamp: false }, s, [e0, e1]);
      p.copy(Wc, U, tt); p.move(Wc, X);
      this.rqN(U, U2, this.rq(4, 17), s, [e0, e1]);
      this.mul(U2, 17, [[U2, c.car(1), 1]], s.slice(0, 8), true);
      p.clear(U2);
      c.carry(1);
    });
    p.clear(w.end(w.car(0))); p.move(w.end(w.car(1)), t(0));
    // D2 = the even shift that brings the top bit of ss to bit 30 or 31, D3 = D2 / 2
    p.copy(t(0), t(2), t(3));
    this.bitCount(t(2), 32, (j) => { const b = j + 1, D2 = b % 2 ? 31 - b : 32 - b; return [D2, D2 / 2]; }, [t(3), t(4)], S);
    this.doubleBy(t(0), t(3), t(2));
    // T = table[top 12 bits of the shifted ss]
    p.requantCore(t(0), [{ cell: t(5), bits: 8 }, { cell: t(8), bits: 4 }], 20, 12, false, S);
    p.shl(t(8), t(5), 8, hop);
    this.lookupBig(t(5), t(6), t(7), a.tables.inv, S.slice(0, 9));

    // 3. xn = round(w * T * 2^D3 / 2^K3) (no clamp: it always fits), coded into the queue
    p.move(t(6), car1(base, 0)); p.move(t(4), car1(base, 1));
    w = this.slide(dim, base, 1, 1, (c) => {
      const [V, P, tt, tm, LOW, TOP, CODE, E1, E2, e0, e1] = c.ss(0, 11), s = c.ss(11, 10);
      p.move(X, V);
      this.mul(V, 21, [[c.car(0), P, 1]], s.slice(0, 8), false);
      this.double(P, c.car(1), tt, tm);
      this.rqSplit(P, LOW, TOP, { ...this.rq(K3, nBits), clamp: false }, s, [e0, e1]);
      this.encode(LOW, TOP, CODE, c.car(2), E1, E2, nBits);
      if (final) p.scatter(CODE, [[o + Mx.q, 1], [o + Mx.y, 1]]); else p.move(CODE, o + Mx.q);
      c.carry(0); c.carry(2);
    });
    p.clear(w.end(w.car(0))).clear(w.end(w.car(1))).move(w.end(w.car(2)), c(SXT));
    p.addBig(c(CN), Mx.C, [c(H0), c(H1)]);
    if (!final) p.move(s0 + pre.pos, c(POS)).move(s0 + pre.lc, c(LC));
  };

  E.qkvRound = function () {
    const { p, P, Lo, M, a, so, kv } = this, { dim } = a, { qBits, vBits } = a.cfg, sh = this.shifts(), Mq = M.qkv;
    const arr = P + Lo.aQ, c = (k) => arr + Mq.ctrl + k, base = P + Lo.Ascr, QK = P + Lo.Aqk, slot0 = P + Lo.dock + this.SS, tmp = P + Lo.At;
    const round = (n, src, dst, dcell, k, bits, last) => {
      if (last) p.move(c(SXT), car1(base, 0)); else p.copy(c(SXT), car1(base, 0), tmp);
      p.copy(dcell, car1(base, 1), tmp);
      const w = this.slide(n, base, 1, 1, (c) => {
        this.fixSum(c, src, c.sc(0), c.car(0), c.sc(1), c.sc(2), c.car(1));
        this.rqN(c.sc(0), c.sc(13), this.rq(k, bits), c.ss(3, 10), [c.sc(14), c.sc(15)]);
        p.move(c.sc(13), dst);
      });
      p.clear(w.end(w.car(0))).clear(w.end(w.car(1)));
    };
    round(dim, arr + Mq.m, QK, P + Lo.Ad, sh.q, qBits, false);
    round(kv, arr + Mq.m + dim, QK + dim, P + Lo.Ad + 1, sh.k, qBits, false);
    round(kv, arr + Mq.m + dim + kv, slot0 + so.SM, P + Lo.Ad + 2, sh.v, vBits, true);
  };

  E.rotate = function () {
    const { p, P, Lo, M, a, so, kv } = this, { dim, headSize: hs } = a, { RB, qBits } = a.cfg;
    const arr = P + Lo.aQ, c = (k) => arr + M.qkv.ctrl + k, base = P + Lo.Ascr, QK = P + Lo.Aqk, PT = P + Lo.Apt, slot0 = P + Lo.dock + this.SS;
    const COS = (f) => P + Lo.Atrig + 4 * f, SIN = (f) => COS(f) + 2, n = dim + kv;
    const split = (v) => { let lo = ((v % 16) + 16) % 16; if (lo > 8) lo -= 16; return [lo, (v - lo) / 16]; };
    this.switchTree(c(POS), Math.log2(a.maxTokens), (pos) => {
      for (let f = 0; f < hs / 2; f++) {
        const [cl, ch] = split(a.tables.cos[pos][f]), [sl, sh] = split(a.tables.sin[pos][f]);
        p.add(COS(f), cl).add(COS(f) + 1, ch).add(SIN(f), sl).add(SIN(f) + 1, sh);
      }
    }, range(9, (i) => P + Lo.Asw + i));
    for (let f = 0; f < hs / 2; f++) { p.scatter(COS(f) + 1, [[COS(f), 16]]); p.scatter(SIN(f) + 1, [[SIN(f), 16]]); }
    // pattern strip: cos under the first element of every pair, sin under the second
    for (let f = 0; f < hs / 2; f++) {
      const mine = range(n).filter((i) => ((i % hs) >> 1) === f);
      p.scatter(COS(f), mine.filter((i) => !(i & 1)).map((i) => [PT + i, 1]));
      p.scatter(SIN(f), mine.filter((i) => i & 1).map((i) => [PT + i, 1]));
    }
    const rot = (pairs, src, pt, dst) => this.slide(pairs, base, 1, 2, (c) => {
      const t1 = c.sc(0), t2 = c.sc(1), cos = c.sc(12), sin = c.sc(13), near = c.sc(14), ex = [c.sc(15), c.sc(16)];
      p.move(pt, cos).move(pt + 1, sin);
      this.mul(src, qBits, [[cos, t1, 1], [sin, t2, 1]], c.ss(2, 8), false);        // a*cos, a*sin
      this.mul(src + 1, qBits, [[sin, t1, -1], [cos, t2, 1]], c.ss(2, 8), false);   // -b*sin, b*cos
      this.rqN(t1, near, this.rq(RB, qBits), c.ss(2, 10), ex); p.move(near, dst);
      this.rqN(t2, near, this.rq(RB, qBits), c.ss(2, 10), ex); p.move(near, dst + 1);
      p.clear(cos).clear(sin);
    });
    rot(dim / 2, QK, PT, slot0 + so.QS);
    rot(kv / 2, QK + dim, PT + dim, slot0 + so.WS);
  };

  // ---- attention: the slots of this layer (dock first, then position 0, 1, ...) -------------

  // Claim the first free slot. The pointer ends in the dock (never used).
  E.markSlot = function () {
    const { p, P, Lo, so, SS } = this, U = P + Lo.dock + SS + so.U;
    p.to(U).raw('[' + '>'.repeat(SS) + ']');
    p.add(U, 1);
    p.raw('[' + '<'.repeat(SS) + ']');
    p.ptr = P + Lo.dock + so.U;
  };

  E.storeKeyValue = function () {
    const { p, P, Lo, so, SS, kv } = this, s0 = P + Lo.dock + SS, U = s0 + so.U;
    p.to(U + SS).raw('[');
    this.slide(kv, s0 + so.scr, 1, 1, () => { p.move(s0 + so.WS, s0 + so.WS + SS); p.move(s0 + so.SM, s0 + so.SM + SS); });
    p.to(U + 2 * SS).raw(']');
    p.ptr = U + SS;
    this.slide(kv, s0 + so.scr, 1, 1, () => { p.move(s0 + so.WS, s0 + so.KS); p.move(s0 + so.SM, s0 + so.VS); });
    p.to(U).raw('[' + '<'.repeat(SS) + ']');
    p.ptr = P + Lo.dock + so.U;
  };

  E.attention = function () {
    const { p, P, Lo, so, SS, kv, share, a } = this, { heads, headSize: hs, kvHeads } = a, { qBits, vBits } = a.cfg, s0 = P + Lo.dock + SS, U = s0 + so.U;
    const head = (h, f) => s0 + so.H + h * HS + f, H = (f) => head(0, f), hsc = range(10, (i) => H(HSC + i));
    const eachHead = (body) => p.eachFrame(H(0), HS, heads, s0 + so.Hc, body);
    const KS = s0 + so.KS, VS = s0 + so.VS, QS = s0 + so.QS, WS = s0 + so.WS, SM = s0 + so.SM, FL = s0 + so.FL;
    const SB = 2 * (qBits - 1) + Math.ceil(Math.log2(hs)), nClamp = SB + 2;            // scores fit in SB bits
    const expBits = Math.log2(a.tables.exp.length);

    for (let h = 0; h < heads; h++) p.addBig(head(h, BEST), -(2 ** SB), [head(h, HSC), head(h, HSC + 1)]);
    p.to(U).raw('[');
    {
      for (let g = 0; g < kvHeads; g++) p.add(FL + g * hs + hs - 1, 1);
      this.slide(kv, s0 + so.scr, 1, 1, (c) => {
        // score of every query head sharing this key += key * q; the sums are carried
        this.mul(KS, qBits, range(share, (s) => [QS + s * kv, c.car(s), 1]), c.ss(0, 8), true);
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
        p.requant(H(DD), 0, { ...this.rq(0, nClamp, 0, 0), outs: [{ cell: H(WW), bits: 8 }, { cell: d1, bits: 8 }, { cell: d2, bits: nClamp - 16 }] }, hsc);
        p.shl(d1, H(WW), 8, [h0, h1]).shl(d2, H(WW), 16, [h0, h1]);
        p.move(H(WW), H(BEST) + SS);
      });
    }
    p.to(U + SS).raw(']');
    p.ptr = U;
    // In the first unused slot: drop q, send the maxima back.
    for (let i = 0; i < a.dim; i++) p.clear(QS + i);
    eachHead(() => p.move(H(BEST), H(BEST) - SS));
    p.to(U - SS); p.ptr = U;
    p.raw('[');
    {
      eachHead(() => {
        p.scatter(H(BEST), [[H(DD), 1], [H(BEST) - SS, 1]]);
        p.scatter(H(SC), [[H(DD), -1]]);
        p.requant(H(DD), H(EE), this.rq(a.cfg.gapShift, expBits, 0, 0), hsc);
        p.lookup(H(EE), H(WW), a.tables.exp, hsc.slice(0, 9), { keepX: false });
        p.move(H(TOT), H(TOT) - SS);
        p.scatter(H(WW), [[H(TOT) - SS, 1], [H(DD), 1]]).move(H(DD), H(WW));
      });
      for (let g = 0; g < kvHeads; g++) for (let s = 0; s < share; s++) p.scatter(head(g * share + s, WW), range(hs, (i) => [WS + s * kv + g * hs + i, 1]));
      this.slide(kv, s0 + so.scr, 1, 1, (c) => {
        this.mul(VS, vBits, range(share, (s) => [WS + s * kv, SM + s * kv, 1]), c.ss(0, 8), true);
        for (let s = 0; s < share; s++) { p.clear(WS + s * kv); p.move(SM + s * kv, SM + s * kv - SS); }
      });
    }
    p.to(U - SS).raw(']');
    p.ptr = P + Lo.dock + so.U;
  };

  E.mixed = function () {
    const { p, P, Lo, so, M, kv, share, a } = this, { heads, headSize: hs, kvHeads, dim } = a, { vBits } = a.cfg;
    const dk = P + Lo.dock, hd = (h, f) => dk + so.H + h * HS + f, base = P + Lo.Ascr, Mo = M.o;
    const arr = P + Lo.aQ, c = (k) => arr + M.qkv.ctrl + k, QI = P + Lo.Ahop, AI = QI + Mo.m - Mo.q, hc = (k) => AI + dim + 1 + k;
    p.eachFrame(hd(0, 0), HS, heads, dk + so.Hc, () => {
      const f = (k) => hd(0, k), S = range(10, (i) => f(HSC + i)), t1 = f(HSC + 10), t2 = f(HSC + 11), MANT = f(HSC + 12), y2 = f(HSC + 13), ex = f(HSC + 14);
      p.clear(f(BEST));
      p.copy(f(TOT), t1, t2);
      this.bitCount(t1, 16, (j) => [15 - j], [f(DD)], S);            // D = 16 - bits of the total
      p.copy(f(DD), t1, t2);
      this.doubleBy(f(TOT), t1, t2);
      p.requantCore(f(TOT), [{ cell: MANT, bits: 8 }, { cell: ex, bits: 2 }], 6, 10, false, S);
      p.shl(ex, MANT, 8, [t1, t2]);
      this.lookupBig(MANT, f(WW), y2, a.tables.recip, S.slice(0, 9));
    });
    const RC = dk + so.WS, DC = dk + so.QS, SM = dk + so.SM;
    for (let g = 0; g < kvHeads; g++) {
      for (let s = 0; s < share; s++) {
        const at = s * kv + g * hs;
        p.scatter(hd(g * share + s, WW), range(hs, (i) => [RC + at + i, 1]));
        p.scatter(hd(g * share + s, DD), range(hs, (i) => [DC + at + i, 1]));
      }
    }
    const w = this.slide(dim, base, 1, 1, (c) => {
      const [Sv, R1, Dn, tm, Nn, PR, LOW, TOP, CODE, E1, E2, e0, e1] = c.ss(0, 13), s = c.ss(13, 10);
      p.move(SM, Sv).move(RC, R1).move(DC, Dn);
      this.doubleBy(Sv, Dn, tm);
      this.rqN(Sv, Nn, this.rq(11, 17), s, [e0, e1]);
      this.mul(Nn, 17, [[R1, PR, 1]], s.slice(0, 8), false);
      p.clear(R1);
      this.rqSplit(PR, LOW, TOP, this.rq(14, vBits), s, [e0, e1]);
      this.encode(LOW, TOP, CODE, c.car(0), E1, E2, vBits);
      p.move(CODE, QI);
      c.carry(0);
    });
    p.move(w.end(w.car(0)), hc(SXT));
    this.preload(dim, base, arr + M.qkv.y, AI, P + Lo.Ad + 3, P + Lo.At);
    p.move(c(POS), hc(POS)).move(c(LC), hc(LC));
    p.addBig(hc(CN), dim, [P + Lo.At, P + Lo.At + 1]);
  };

  // ---- residual add ------------------------------------------------------------------

  E.residual = function (arr, Mx, k, s0) {
    const { p, a, pre } = this, { dim } = a, c = (i) => arr + Mx.ctrl + i, X = s0 + pre.x, base = s0 + pre.scr;
    p.move(c(SXT), car1(base, 0));
    p.copy(s0 + pre.d, car1(base, 1), s0 + pre.t);
    const w = this.slide(dim, base, 1, 1, (c) => {
      this.fixSum(c, arr + Mx.m, c.sc(0), c.car(0), c.sc(1), c.sc(2), c.car(1));
      this.rqN(c.sc(0), c.sc(13), this.rq(k, a.cfg.xBits), c.ss(3, 10), [c.sc(14), c.sc(15)]);
      p.move(c.sc(13), X);
    });
    p.clear(w.end(w.car(0))).clear(w.end(w.car(1)));
    p.move(c(POS), s0 + pre.pos).move(c(LC), s0 + pre.lc);
  };

  // ---- feed-forward: hidden = round(silu(a) * b), coded into the queue of the next matrix ----

  E.hiddenStage = function () {
    const { p, P, Lo, M, a } = this, { dim, hidden: h } = a, { GB, HB, gBits, hBits } = a.cfg, sh = this.shifts();
    const arr = P + Lo.a13, Mx = M.w13, c = (k) => arr + Mx.ctrl + k, base = P + Lo.Cscr, o2 = P + Lo.o2, M2 = M.w2, c2 = (k) => o2 + M2.ctrl + k;
    p.move(c(SXT), car1(base, 0));
    p.copy(P + Lo.Cd, car1(base, 1), c(TT)).copy(P + Lo.Cd + 1, car1(base, 2), c(TT));
    const w = this.slide(h, base, 1, 1, (c) => {
      const [Xa, Xb, t, tm, A8, B8, SL, PRD, LOW, TOP, CODE, y2, e0, e1] = c.ss(0, 14), s = c.ss(14, 10);
      this.fixSum(c, arr + Mx.m, Xa, c.car(0), t, tm, c.car(1), [[arr + Mx.m + h, Xb]]);
      this.double(Xb, c.car(2), t, tm);
      this.rqN(Xa, A8, this.rq(sh.a, gBits), s, [e0, e1]);
      this.rqN(Xb, B8, this.rq(sh.b, gBits), s, [e0, e1]);
      this.lookupBig(A8, SL, y2, a.tables.silu, s.slice(0, 9));
      this.mul(B8, gBits, [[SL, PRD, 1]], s.slice(0, 8), false);
      p.clear(SL);
      this.rqSplit(PRD, LOW, TOP, this.rq(2 * GB - HB, hBits), s, [e0, e1]);
      this.encode(LOW, TOP, CODE, c.car(3), s[0], s[1], hBits);
      p.move(CODE, o2 + M2.q);
      c.carry(3);
    });
    for (let j = 0; j < 3; j++) p.clear(w.end(w.car(j)));
    p.move(w.end(w.car(3)), c2(SXT));
    this.preload(dim, base, arr + Mx.y, o2 + M2.m, P + Lo.Cd + 2, c(TT));
    p.move(c(POS), c2(POS)).move(c(LC), c2(LC));
    p.addBig(c2(CN), h, [c2(H0), c2(H1)]);
  };

  // ---- output scores and their winner ------------------------------------------------------

  E.clsLoop = function () {
    const { p, M, a, PL, CST, nC, W } = this, Mc = M.cls, { dim, chunk: CH } = a, { logitBits } = a.cfg, sh = this.shifts();
    const c0 = (k) => PL + Mc.ctrl + k;
    p.add(c0(LC), nC);
    p.to(c0(LC)).raw('[').add(c0(LC), -1);
    {
      const Q = PL, arr = Q + dim * (CH + 1), c = (k) => arr + Mc.ctrl + k, nx = (k) => Q + CST + Mc.ctrl + k;
      const st = arr + Mc.G + 1, base = st + W.scr, t = (k) => st + W.d + 1 + k;
      this.sweep(Q, Mc);
      // more chunks to come: fill the next gap from the master copy; else drop it
      p.copy(c(LC), t(0), t(1));
      this.ifElseNZ(t(0), t(1), () => {
        p.copy(c(SXT), nx(SXT), t(2));
        this.slide(dim, base, 1, 1, () => p.scatter(arr + Mc.y, [[Q + CST + Mc.q, 1], [Q + CST + Mc.y, 1]]));
        p.addBig(nx(CN), dim, [t(2), t(3)]);
      }, () => { this.slide(dim, base, 1, 1, () => p.clear(arr + Mc.y)); });
      // the scores of this chunk, one after the other, against the best so far
      p.move(c(SXT), car1(base, 0)); p.copy(st + W.d, car1(base, 1), t(0));
      p.move(c(POS), car1(base, 2)).move(c(C4), car1(base, 3)).move(c(C5), car1(base, 4));
      const w = this.slide(CH, base, 1, 1, (c) => {
        const [X, tt, tm, Uc, Dc, G, F, e0, e1] = c.ss(0, 9), s = c.ss(9, 10), best = c.car(2), bidx = c.car(3), idx = c.car(4);
        this.fixSum(c, arr + Mc.m, X, c.car(0), tt, tm, c.car(1));
        this.rqN(X, Uc, { ...this.rq(sh.cls, logitBits), offset: true }, s, [e0, e1]);     // score + 2^(logitBits-1)
        // G = max(score - best, 0); if it is not zero this score is the new best
        p.move(Uc, Dc); p.scatter(best, [[Dc, -1], [tt, 1]]); p.move(tt, best);
        this.rqN(Dc, G, { k: 0, n: logitBits + 1, lo: 0, addend: 0 }, s, [e0, e1]);
        p.copy(G, F, tt); p.move(G, best);
        p.ifNonZero(F, () => { p.clear(bidx); p.copy(idx, bidx, tt); });
        p.add(idx, 1);
        c.carry(2); c.carry(3); c.carry(4);
      }, 5);
      p.clear(w.end(w.car(0))).clear(w.end(w.car(1)));
      p.move(w.end(w.car(2)), nx(POS)).move(w.end(w.car(3)), nx(C4)).move(w.end(w.car(4)), nx(C5));
      p.move(c(LC), nx(LC));
    }
    p.to(c0(LC) + CST).raw(']');
    p.ptr = c0(LC) + nC * CST;
    const tail = PL + nC * CST, ct = (k) => tail + Mc.ctrl + k;
    p.clear(ct(POS)).clear(ct(C5));
    p.move(ct(C4), tail + 2);
  };

  E.goHome = function () {
    const { p, M, a, pre, PL, Lo, stride, gl, CST, nC } = this, T0 = (Q) => Q - this.PRE + pre.t + 34;
    const tail = PL + nC * CST;
    p.add(tail + 3, nC);
    p.to(tail + 3).raw('[').add(tail + 3, -1);
    {
      const Q = tail - CST, arr = Q + a.dim * (a.chunk + 1);
      p.move(tail + 2, arr + 2).move(tail + 3, arr + 3);
      this.unsweep(arr, M.cls, [2, 3]);
      p.to(Q + 3).raw(']');
    }
    p.ptr = PL + 3;
    p.move(PL + 2, T0(PL)).add(T0(PL) + 1, a.layers);
    const P = PL - stride;
    p.to(T0(PL) + 1).raw('[').add(T0(PL) + 1, -1);
    const hop = (from, to) => { p.move(from + 2, to + 2).move(from + 3, to + 3); };
    p.move(T0(PL), P + Lo.a2 + 2).move(T0(PL) + 1, P + Lo.a2 + 3);
    this.unsweep(P + Lo.a2, M.w2, [2, 3]); hop(P + Lo.o2, P + Lo.a13);
    this.unsweep(P + Lo.a13, M.w13, [2, 3]); hop(P + Lo.o13, P + Lo.aO);
    this.unsweep(P + Lo.aO, M.o, [2, 3]);
    this.slide(2, P + Lo.oO + 5, 1, 1, () => p.move(P + Lo.oO + 2, P + Lo.aQ + 2));      // over the slots: one copy of the long walk
    this.unsweep(P + Lo.aQ, M.qkv, [2, 3]);
    p.move(P + 2, T0(P)).move(P + 3, T0(P) + 1);
    p.to(T0(P) + 1).raw(']');
    p.ptr = T0(this.P0) + 1;
    p.move(T0(this.P0), this.aE + 2);
    this.unsweep(this.aE, M.emb, [2]);
    p.move(this.E + 2, gl.T);
  };
};
