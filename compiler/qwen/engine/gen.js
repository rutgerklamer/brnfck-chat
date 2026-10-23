'use strict';

// A transformer ENGINE in brainfuck for 32-bit wrapping cells, for the Qwen2.5 Instruct models.

const { Patterns } = require('../../../site/runtime/patterns');
const Spec = require('./spec');

const range = (n, f = (i) => i) => Array.from({ length: n }, (_, i) => f(i));
const ZW = 80;            // width of the scratch window of a slide loop
const HS = 32;            // cells per attention head frame

// The CT control cells that travel with a matrix's gap, by offset; B0.. hold the bits of the current input.
const CT = 46;
const CN = 0, POS = 1, SXT = 2, LC = 3, C4 = 4, C5 = 5, XC = 6, NEG = 7, PAR = 8, FIRST = 9, LOC = 10, TT = 11,
  TA = 12, EA = 13, TB = 14, EB = 15, TC = 16, EC = 17, ZA = 18, ZB = 19, TP = 20, H0 = 21, H1 = 22, KK = 23, KT = 24, B0 = 25;

function archOf(shape, options = {}) {
  const S = Spec.settings(shape, options);
  const { dim, layers, heads, kvHeads, headSize, hidden, vocab } = shape;
  return {
    dim, layers, heads, kvHeads, headSize, hidden, vocab,
    chunk: defaultChunk(vocab, 2 * hidden),
    maxTokens: S.cfg.maxTokens, cfg: S.cfg, R: S.R, eo: S.eo, e2: S.e2, K3: S.K3, xUpBits: S.xUpBits, xDown: S.xDown,
    tables: S.tables, stops: Spec.STOP.slice(),
  };
}
// The largest divisor of the vocabulary that is not above `limit`.
function defaultChunk(vocab, limit) {
  for (let c = Math.min(vocab, limit); c >= 1; c--) if (vocab % c === 0) return c;
  return vocab;
}

class Engine {
  constructor(arch) {
    this.a = arch;
    this.p = new Patterns(32);
    const a = arch, c = a.cfg;
    if (a.heads % a.kvHeads || a.headSize % 2 || a.dim !== a.heads * a.headSize) throw new Error('bad head sizes');
    if (2 ** Math.round(Math.log2(a.maxTokens)) !== a.maxTokens) throw new Error('maxTokens must be a power of two');
    if (a.vocab % a.chunk) throw new Error('vocab must be a multiple of chunk');
    if (Math.max(c.ngBits, c.vBits, c.hBits) > CT - B0) throw new Error(`matrix inputs wider than ${CT - B0} bits`);
    if (Math.max(...a.stops, a.vocab) >= 2 ** 24) throw new Error('token ids must fit 3 bytes');
    this.kv = a.kvHeads * a.headSize; this.share = a.heads / a.kvHeads; this.nC = a.vocab / a.chunk;
    this.OFFW = 2 ** (c.weightBits - 1);       // weights are stored as w + OFFW (1 .. 2^weightBits - 1)
    this.OFFE = 2 ** (c.embBits - 1) + 1;      // values of the embedding table are stored as e + OFFE (1 .. 2^embBits)
    this.wBytes = Math.ceil(c.weightBits / 8); this.eBytes = Math.ceil((c.embBits + 1) / 8);   // bytes per value in the weight stream
    this.OFFX = 2 ** (c.xBits - 1) + 1;        // residual values travel and rest as x + OFFX (never zero)
    this.plan = [];
    this.prepareLayout();
  }

  rq(k, n, lo = -(2 ** (n - 1)), addend = k > 0 ? 2 ** (k - 1) : 0) { return { k, n, lo, addend }; }

  // ---- layout ----------------------------------------------------------------

  mat(R, C, Ylen, nb, carry = [LC, SXT, POS, CN]) {
    const q = R + 5, y = q + C + 4, m = y + Ylen + 1, a1 = m + R + 1, ctrl = a1 + R + 1;
    return { R, C, Ylen, nb, carry, dst: 1, q, y, m, a1, ctrl, G: ctrl + CT };
  }

  prepareLayout() {
    const a = this.a, { dim, hidden, vocab: V, headSize: hs, chunk: CH } = a, { ngBits, vBits, hBits } = a.cfg, kv = this.kv, T = a.maxTokens;
    const M = this.M = {
      qkv: this.mat(dim + 2 * kv, dim, dim, ngBits), o: this.mat(dim, dim, dim, vBits),
      w13: this.mat(2 * hidden, dim, dim, ngBits), w2: this.mat(dim, hidden, dim, hBits),
      cls: this.mat(CH, dim, dim, ngBits, [LC, SXT, POS, CN, C4, C5]),
    };
    // Gap of the embedding table: lane = V+1 cells that run alongside the column.
    const ectrl = 2 * V + 4, ey = ectrl + CT + 1;
    M.emb = { R: V, C: dim, dst: 1, lane: V + 2, ctrl: ectrl, y: ey, G: ey + dim };

    let at = 0;
    const take = (n) => { const x = at; at += n + 1; return x; };
    // One attention slot (one per position and layer): offsets inside it.
    const so = this.so = {};
    so.U = take(1);                 // 1 when this slot holds a position
    so.cn = take(1);                // counter of the weight reader
    so.scr = take(kv + ZW + 2);     // sliding scratch
    so.KS = take(kv); so.VS = take(kv);        // the stored key and value
    so.QS = take(dim);              // the query, travelling through the slots
    so.WS = take(dim);              // attention weights spread out, one per value
    so.SM = take(dim);              // weighted sums, travelling back
    so.FL = take(kv);               // flags: last element of a head
    so.Hc = take(1); so.H = take(a.heads * HS);
    this.SS = at + 1;

    const pre = this.pre = {};
    at = 1;
    pre.scr = take(dim + ZW + 2); pre.x = take(dim); pre.g = take(dim); pre.dr = take(dim); pre.pos = take(1); pre.lc = take(1); pre.t = take(40); pre.h = take(4);
    this.PRE = at + 1;

    // One layer, as offsets from P (the gap origin of its first matrix).
    const L = this.Lo = {};
    L.HL = M.o.y - M.o.q + dim + 1 + 8;
    L.aQ = dim * (M.qkv.R + 1);
    at = L.aQ + M.qkv.G + 2;
    L.Ascr = take(Math.max(dim + 2 * kv, L.HL) + ZW + 4);
    L.Abias = take(dim + 2 * kv); L.Adr = take(dim + 2 * kv);     // constants per row of qkv: bias, doublings
    L.Aqk = take(dim + kv); L.Apt = take(dim + kv);
    L.Atrig = take(2 * hs);                           // per rotation speed: cos (2 cells), sin (2 cells)
    L.Asw = take(9); L.At = take(6); L.Ahop = take(L.HL);
    L.dock = at; at += (T + 2) * this.SS + 1;
    L.oO = at; L.aO = L.oO + dim * (dim + 1);
    L.preB = L.aO + M.o.G + 1; L.o13 = L.preB + this.PRE;
    L.a13 = L.o13 + dim * (M.w13.R + 1);
    at = L.a13 + M.w13.G + 2;
    L.Cscr = take(Math.max(2 * hidden, dim) + ZW + 4); L.Cdr = take(2 * hidden);     // doublings per row of w1, then of w3
    L.o2 = at; L.a2 = L.o2 + hidden * (dim + 1);
    L.preD = L.a2 + M.w2.G + 1;
    this.stride = L.preD + this.PRE;

    // The station after a chunk of the output matrix (offsets from its first cell).
    const W = this.W = {};
    at = 1;
    W.scr = take(Math.max(CH, dim) + ZW + 4); W.d = take(8); W.log = take(CH); W.h = take(6);
    this.WS = at + 1;
    this.CST = dim * (CH + 1) + M.cls.G + 1 + this.WS;     // from one chunk's gap origin to the next

    // The whole tape.
    let g = 2;
    const alloc = (n = 1) => { const x = g; g += n; return x; };
    const gl = this.gl = {};
    gl.TOKEN = alloc(); gl.POS = alloc(); gl.REM = alloc(); gl.PN = alloc();
    alloc(2); gl.PR = alloc(T + 4);          // prompt queue (ids + 1), next one first
    gl.T = alloc(8); gl.PRT = alloc(24);
    alloc(2);
    this.E = g;                                // gap origin of the embedding table
    this.aE = this.E + dim * (V + 1);
    this.P0 = this.aE + M.emb.G + 1 + this.PRE;
    this.PL = this.P0 + a.layers * this.stride; // gap origin of the first chunk of the output matrix
    this.N = this.PL + this.nC * this.CST + M.cls.G + 16;   // last virtual address; real cell = N - v
  }

  // ---- small code patterns -----------------------------------------------------

  // acc += sign * a * b for every [b, acc, sign], with a read as an nb-bit two's-complement number.
  mul(a, nb, triples, s, keepA) {
    const p = this.p, [Za, Zb, T, h0, h1, K, Kt, tmp] = s;
    p.shl(a, Za, 32 - nb, [h0, h1], 1, keepA ? tmp : null);
    if (keepA) p.move(tmp, a);
    p.peel(Za, {
      m: nb,
      onSet: (j) => {
        for (const [b, acc, sign = 1] of triples) {
          const sg = (j === nb - 1 ? -1 : 1) * sign;
          if (j <= p.L) p.scatter(b, [[acc, sg * 2 ** j], [tmp, 1]]); else p.shl(b, acc, j, [h0, h1], sg, tmp);
          p.move(tmp, b);
        }
      },
    }, { Zo: Zb, T, H: [h0, h1], K, Kt });
  }

  bitCount(src, m, val, D, s) {
    const p = this.p, [Za, Zb, T, h0, h1, K, Kt] = s;
    if (m < 32) p.shl(src, Za, 32 - m, [h0, h1]);
    p.peel(m < 32 ? Za : src, {
      m,
      onSet: (j) => { const v = val(j); D.forEach((d, i) => { p.clear(d); if (v[i]) p.add(d, v[i]); }); },
    }, { Zo: m < 32 ? Zb : Za, T, H: [h0, h1], K, Kt });
  }

  // Y = (X + addend) >> k, clamped to n bits from lo; rqSplit puts the top bit apart in TOP.
  rqN(X, Y, { k, n, lo = -(2 ** (n - 1)), addend = k > 0 ? 2 ** (k - 1) : 0, clamp = true, offset = false }, s, ex) {
    const p = this.p, hop = [s[4], s[5]], outs = [], cells = [Y, ex[0], ex[1]];
    for (let i = 0, left = n; left > 0; i++) { const b = Math.min(8, left); outs.push({ cell: cells[i], bits: b }); left -= b; }
    p.addBig(X, addend - lo * 2 ** k, hop);
    p.requantCore(X, outs, k, n, clamp, s);
    for (let i = 1; i < outs.length; i++) p.shl(outs[i].cell, Y, 8 * i, hop);
    if (!offset && lo) p.addBig(Y, lo, hop);
  }

  rqSplit(X, LOW, TOP, { k, n, lo = -(2 ** (n - 1)), addend = k > 0 ? 2 ** (k - 1) : 0, clamp = true }, s, ex) {
    const p = this.p, hop = [s[4], s[5]], outs = [], cells = [LOW, ex[0], ex[1]];
    for (let i = 0, left = n - 1; left > 0; i++) { const b = Math.min(8, left); outs.push({ cell: cells[i], bits: b }); left -= b; }
    outs.push({ cell: TOP, bits: 1 });
    p.addBig(X, addend - lo * 2 ** k, hop);
    p.requantCore(X, outs, k, n, clamp, s);
    for (let i = 1; i < outs.length - 1; i++) p.shl(outs[i].cell, LOW, 8 * i, hop);
  }

  // Run leaf(v) for v = x mod 2^n (a decision tree on the bits of x). s: 9 cells.
  switchTree(x, n, leaf, s, keepX = true) {
    const p = this.p, [Za, Zb, T, h0, h1, K, Kt, E, tmp] = s, H = [h0, h1], kStep = 4;
    p.shl(x, Za, 32 - n, H, 1, keepX ? tmp : null);
    if (keepX) p.move(tmp, x);
    if (n > 1) p.pow2(K, 32 - n, H);
    let kEnd = K;
    const node = (j, idx, zc, zo, k, kt, kexp) => {
      if (j === n) { kEnd = k; leaf(idx); return; }
      const e = 32 - n + j, last = j === n - 1, sh = n - 1 - j;
      if (!last && e - kexp >= kStep) { p.scatter(k, [[kt, 2 ** (e - kexp)]]); [k, kt] = [kt, k]; kexp = e; }
      if (last) p.move(zc, T);
      else {
        if (sh <= p.L) p.scatter(zc, [[zo, 1], [T, 2 ** sh]]);
        else { p.scatter(zc, [[zo, 1], [h0, 2 ** p.L]]); p.shl(h0, T, sh - p.L, [h1, h0]); }
        [zc, zo] = [zo, zc];
      }
      p.add(E, 1);
      p.loop(T, () => {
        p.clear(T).add(E, -1);
        if (!last) { p.scatter(k, [[zc, -(2 ** (e - kexp))], [kt, 1]]); p.move(kt, k); }
        node(j + 1, idx | (1 << j), zc, zo, k, kt, kexp);
      });
      p.loop(E, () => { p.add(E, -1); node(j + 1, idx, zc, zo, k, kt, kexp); });
    };
    node(0, 0, Za, Zb, K, Kt, 32 - n);
    if (n > 1) p.clear(kEnd);
  }

  // y += table[x]; x is used up. y2: one more empty cell; s: 9 cells.
  lookupBig(x, y, y2, table, s) {
    const p = this.p;
    this.switchTree(x, Math.log2(table.length), (i) => {
      let lo = table[i] % 64; if (lo > 32) lo -= 64; else if (lo < -32) lo += 64;
      p.add(y, lo).add(y2, (table[i] - lo) / 64);
    }, s, false);
    p.scatter(y2, [[y, 64]]);
  }

  // if (flag) then() else els(). flag is 0 or 1 and is used up; E: empty cell.
  ifElse(flag, E, then, els) {
    const p = this.p;
    p.add(E, 1);
    p.loop(flag, () => { p.add(flag, -1).add(E, -1); then(); });
    p.loop(E, () => { p.add(E, -1); els(); });
  }

  // The same for a flag that may be any number (non-zero = true).
  ifElseNZ(flag, E, then, els) {
    const p = this.p;
    p.add(E, 1);
    p.loop(flag, () => { p.clear(flag).add(E, -1); then(); });
    p.loop(E, () => { p.add(E, -1); els(); });
  }

  // Runs body n times while its window (counter, NC carried cells, scratch) moves stride cells per round.
  slide(n, base, dir, stride, body, NC = 4) {
    const p = this.p, w = (k) => base + dir * k, s1 = stride + 1, step = dir * stride;
    const sc = (k) => { if (s1 * (NC + 1) + k >= ZW) throw new Error('slide window too small'); return w(s1 * (NC + 1) + k); };
    const c = {
      car: (j) => w(s1 * (j + 1)), sc, ss: (from, cnt) => range(cnt, (i) => sc(from + i)),
      carry: (j) => p.move(c.car(j), c.car(j) + step), end: (cell) => cell + step * n,
    };
    p.addBig(w(0), n, [sc(0), sc(1)]);
    p.to(w(0)).raw('[').add(w(0), -1);
    body(c);
    p.move(w(0), w(0) + step);
    p.to(w(0) + step).raw(']');
    p.ptr = w(0) + step * n;
    return c;
  }

  // Moves the run of non-zero cells that starts at l dist cells on (stripRight4: four cells per round).
  stripRight(l, dist) {
    const p = this.p;
    p.to(l).raw('[>]<[[-' + '>'.repeat(dist) + '+' + '<'.repeat(dist) + ']<]');
    p.ptr = l - 1;
  }

  stripRight4(l, dist) {
    const p = this.p;
    p.to(l).raw('[>>>>]<<<<[');
    p.ptr = l;                             // stands for "the first cell of the current group of four"
    for (let u = 0; u < 4; u++) p.move(l + u, l + u + dist);
    p.to(l - 4).raw(']');
    p.ptr = l - 4;
  }

  encode(LOW, TOP, out, SX, E, tmp, n) {
    const p = this.p, half = 2 ** (n - 1);
    p.copy(LOW, SX, tmp);
    this.ifElse(TOP, E,
      () => { p.scatter(LOW, [[out, 2]]); p.add(out, 1); },
      () => { p.scatter(LOW, [[out, -2]]); p.addConst(out, 2 * half + 2, tmp); p.addConst(SX, -half, tmp); });
  }

  // A named step (tools/map-data/instrument.js notes where each one ends up).
  S(name, fn) { fn(); }

  // ---- y = W x: the gap crosses one matrix ----------------------------------------

  sweep(org, M) {
    const p = this.p, { R, C, G, nb } = M, c = (k) => org + M.ctrl + k;
    const S0 = org + G + 1, D0 = org + M.dst, M0 = org + M.m, A1 = org + M.a1;
    const walk = (start, body) => {
      p.to(start).raw('[');
      body(0);
      p.to(start + 1).raw(']');
      p.ptr = start + R;
    };
    // The first walk of a column also moves the sums one column on (m -> a1).
    const firstToM = (f) => walk(S0, (i) => { p.move(M0 + i, A1 + i); p.scatter(S0 + i, [[M0 + i, 1], [A1 + i, f]]); });
    const firstToDst = (f) => walk(S0, (i) => { p.move(M0 + i, A1 + i); p.scatter(S0 + i, [[D0 + i, 1], [A1 + i, f]]); });
    const plain = () => walk(S0, (i) => { p.move(M0 + i, A1 + i); p.move(S0 + i, D0 + i); });
    const mToDst = (f) => walk(M0, (i) => p.scatter(M0 + i, [[D0 + i, 1], [A1 + i, f]]));
    const dstToM = (f) => walk(D0, (i) => p.scatter(D0 + i, [[M0 + i, 1], [A1 + i, f]]));
    const bitPass = (f) => {
      p.copy(c(FIRST), c(TB), c(TT));
      this.ifElse(c(TB), c(EB), () => {
        p.add(c(FIRST), -1);
        p.copy(c(PAR), c(TC), c(TT));
        this.ifElse(c(TC), c(EC), () => firstToDst(f), () => { firstToM(f); p.add(c(LOC), 1); });
      }, () => {
        p.copy(c(LOC), c(TC), c(TT));
        this.ifElse(c(TC), c(EC), () => { mToDst(f); p.add(c(LOC), -1); }, () => { dstToM(f); p.add(c(LOC), 1); });
      });
    };

    p.to(c(CN)).raw('[').add(c(CN), -1);
    // Take the next input and split its code into: sign, bits of |x|, parity of the bit count.
    p.move(org + M.q, c(XC)).add(c(XC), -1).add(c(FIRST), 1);
    p.shl(c(XC), c(ZA), 32 - (nb + 1), [c(H0), c(H1)]);
    p.peel(c(ZA), {
      m: nb + 1,
      onSet: (j) => {
        if (j === 0) return p.add(c(NEG), 1);
        p.add(c(B0 + j - 1), 1);
        p.move(c(PAR), c(TT)).add(c(PAR), 1).scatter(c(TT), [[c(PAR), -1]]);   // PAR = 1 - PAR
      },
    }, { Zo: c(ZB), T: c(TP), H: [c(H0), c(H1)], K: c(KK), Kt: c(KT) });
    for (let j = 0; j < nb; j++) {
      p.loop(c(B0 + j), () => {
        p.add(c(B0 + j), -1);
        p.copy(c(NEG), c(TA), c(TT));
        this.ifElse(c(TA), c(EA), () => bitPass(-(2 ** j)), () => bitPass(2 ** j));
      });
    }
    p.loop(c(FIRST), () => { p.add(c(FIRST), -1); plain(); });   // x = 0: only move the column
    p.clear(c(NEG)).clear(c(PAR));
    // Everything in the gap moves one column on.
    if (M.Ylen) {       // fixed length, never zero: four cells per round, from its last cell down
      const last = org + M.y + M.Ylen - 1;
      p.to(last).raw('[');
      for (let u = 0; u < 4; u++) p.move(last - u, last - u + R + 1);
      p.to(last - 4).raw(']');
      p.ptr = last - 4 * Math.ceil(M.Ylen / 4);
    }
    this.stripRight4(org + M.q + 1, R);
    for (const k of M.carry) p.move(c(k), c(k) + R + 1);
    p.to(c(CN) + R + 1).raw(']');
    p.ptr = c(CN) + C * (R + 1);
  }

  unsweep(a, M, carried) {
    const p = this.p, { R, C, G } = M;
    p.addBig(a + 1, C, [a + 6, a + 7]);
    p.to(a + 1).raw('[').add(a + 1, -1);
    // the walk, U cells per round (fewer loop tests); the first R mod U cells without a loop
    const U = 4, rem = R % U, s = a - R + rem;
    for (let i = 0; i < rem; i++) p.move(a - R + i, a - R + i + G);
    p.to(s).raw('[');
    for (let u = 0; u < U; u++) p.move(s + u, s + u + G);
    p.to(s + U).raw(']'); p.ptr = a;
    for (const k of [...carried, 1]) p.move(a + k, a + k - (R + 1));
    p.to(a + 1 - (R + 1)).raw(']');
    p.ptr = a + 1 - C * (R + 1);
  }

  // ---- embedding: x = row TOKEN of the table ---------------------------------------

  sweepEmb() {
    const p = this.p, M = this.M.emb, { R: V, G } = M, org = this.E, c = (k) => org + M.ctrl + k;
    const S0 = org + G + 1, D0 = org + 1, L0 = org + M.lane;
    p.to(c(0)).raw('[').add(c(0), -1);
    p.copy(c(2), L0, c(5));
    p.to(L0).raw('['); p.move(S0, D0); p.add(L0, -1); p.move(L0, L0 + 1); p.to(L0 + 1).raw(']'); p.ptr = L0;
    p.scatter(S0, [[D0, 1], [L0 + 1, 1]]);
    p.to(S0 + 1).raw('['); p.move(S0 + 1, D0 + 1); p.move(L0 + 1, L0 + 2); p.to(S0 + 2).raw(']'); p.ptr = S0 + V;
    this.stripRight(org + M.y, V + 2);
    p.move(L0 + V, org + M.y + V + 1);
    for (const k of [2, 1, 0]) p.move(c(k), c(k) + V + 1);
    p.to(c(0) + V + 1).raw(']');
    p.ptr = c(0) + M.C * (V + 1);
  }

  // ---- reading the weights ------------------------------------------------------------

  free(addr) {
    for (const [lo, hi] of this.busy) if (addr >= lo && addr <= hi) throw new Error(`reader: cell ${addr} is not free`);
    return addr;
  }

  readMat(name, layer, org, M, bytes, lcr) {
    const p = this.p, { R, C, G } = M, m0 = org + G + 1, top = m0 + C * (R + 1) - 1;
    this.plan.push({ type: 'mat', name, layer, R, C, bytes });
    if (lcr != null) p.move(lcr, this.free(top + R + 1));
    this.busy.push([m0, top]);
    p.addBig(top, C, [top - 2, top - 3]);
    p.to(top).raw('[').add(top, -1);
    p.addBig(top - 1, R, [top - 2, top - 3]);
    p.to(top - 1).raw('[').add(top - 1, -1);
    p.move(top - 1, top - 2);
    p.read(top - 1);
    if (bytes >= 2) { p.read(top - 3); p.scatter(top - 3, [[top - 1, 256]]); }
    if (bytes === 3) { p.read(top - 3); p.shl(top - 3, top - 1, 16, [top - 4, top - 3]); }
    p.to(top - 2).raw(']');
    p.ptr = top - 1 - R;
    p.move(top, top - (R + 1));
    if (lcr != null) p.move(top + R + 1, top);
    p.to(top - (R + 1)).raw(']');
    p.ptr = m0 - 1;
    return m0 + R;
  }

  readCell(name, layer, addr) { this.plan.push({ type: 'cell', name, layer }); this.p.read(this.free(addr)); this.busy.push([addr, addr]); }

  readStrip(name, layer, addr, n, bytes, offset, base) {
    const p = this.p;
    this.plan.push({ type: 'strip', name, layer, n, bytes, offset });
    for (const a of [addr, addr + n - 1, base, base + n + ZW - 1]) this.free(a);
    this.busy.push([addr, addr + n - 1]);
    this.slide(n, base, 1, 1, (c) => {
      const b = c.sc(0), hop = [c.sc(1), c.sc(2)];
      p.read(addr);
      for (let i = 1; i < bytes; i++) { p.read(b); p.shl(b, addr, 8 * i, hop); }
      if (offset) p.addBig(addr, -offset, hop);
    });
  }

  readSlots(layer, P) {
    const p = this.p, { so, SS, kv } = this, s1 = P + this.Lo.dock + SS, cn = s1 + so.cn, U = s1 + so.U;
    this.plan.push({ type: 'slots', layer });
    this.busy.push([s1, s1 + (this.a.maxTokens + 1) * SS]);
    p.read(cn);
    p.to(cn).raw('[').add(cn, -1);
    p.add(U, 1);
    this.slide(kv, s1 + so.scr, 1, 1, (c) => {
      for (const cell of [s1 + so.KS, s1 + so.VS]) {
        p.read(cell); p.read(c.sc(0)); p.scatter(c.sc(0), [[cell, 256]]);
        p.addBig(cell, -32768, [c.sc(0), c.sc(1)]);
      }
    });
    p.move(cn, cn + SS);
    p.to(cn + SS).raw(']');
    // back to the dock over the used slots
    p.ptr = cn; p.to(U).raw('<'.repeat(SS) + '[' + '<'.repeat(SS) + ']');
    p.ptr = P + this.Lo.dock + so.U;
  }

  emitReader() {
    const p = this.p, { M, Lo, stride, CST, pre, kv } = this, nL = this.a.layers, { dim, hidden } = this.a;
    this.busy = [];
    p.ptr = this.N;
    // The chunks of the output matrix, last first: one copy of the code in a loop.
    {
      const Q = this.PL + (this.nC - 1) * CST, hc = (q) => q - 3;
      const start = this.plan.length;
      p.add(hc(Q + CST), this.nC);
      p.to(hc(Q + CST)).raw('[').add(hc(Q + CST), -1);
      const lcr = this.readMat('wcls', 0, Q, M.cls, this.eBytes, hc(Q + CST));
      p.move(lcr, hc(Q));
      p.to(hc(Q)).raw(']');
      p.ptr = hc(this.PL);
      const one = this.plan.splice(start);
      for (let c = this.nC - 1; c >= 0; c--) for (const e of one) this.plan.push({ ...e, layer: c });
    }
    // One copy of the code for a layer, written for the last layer.
    this.busy = [];
    const P = this.PL - stride, home = (Q) => Q - this.PRE + pre.t + 37;
    const start = this.plan.length;
    p.add(home(P + stride), nL);
    p.to(home(P + stride)).raw('[').add(home(P + stride), -1);
    let lcr = home(P + stride);
    const gainOff = 2 ** (this.a.cfg.gainBits - 1), gBytes = Math.ceil((this.a.cfg.gainBits + 1) / 8);
    this.readStrip('gainNext', 0, P + Lo.preD + pre.g, dim, gBytes, gainOff, P + Lo.preD + pre.scr);
    this.readStrip('dr2', 0, P + Lo.preD + pre.dr, dim, 1, 0, P + Lo.preD + pre.scr);
    lcr = this.readMat('w2', 0, P + Lo.o2, M.w2, this.wBytes, lcr);
    this.readStrip('dr1', 0, P + Lo.Cdr, hidden, 1, 0, P + Lo.Cscr);
    this.readStrip('dr3', 0, P + Lo.Cdr + hidden, hidden, 1, 0, P + Lo.Cscr);
    lcr = this.readMat('w13', 0, P + Lo.o13, M.w13, this.wBytes, lcr);
    this.readStrip('gainFfn', 0, P + Lo.preB + pre.g, dim, gBytes, gainOff, P + Lo.preB + pre.scr);
    this.readStrip('drO', 0, P + Lo.preB + pre.dr, dim, 1, 0, P + Lo.preB + pre.scr);
    lcr = this.readMat('o', 0, P + Lo.oO, M.o, this.wBytes, lcr);
    this.readSlots(0, P);
    this.readStrip('bias', 0, P + Lo.Abias, dim + 2 * kv, 4, 0, P + Lo.Ascr);
    this.readStrip('drQkv', 0, P + Lo.Adr, dim + 2 * kv, 1, 0, P + Lo.Ascr);
    lcr = this.readMat('qkv', 0, P, M.qkv, this.wBytes, lcr);
    p.move(lcr, this.free(home(P)));
    p.to(home(P)).raw(']');
    p.ptr = home(this.P0);
    const one = this.plan.splice(start);
    for (let l = nL - 1; l >= 0; l--) for (const e of one) this.plan.push({ ...e, layer: l });
    this.busy = [];
    this.readStrip('gainFirst', 0, this.P0 - this.PRE + pre.g, dim, gBytes, gainOff, this.P0 - this.PRE + pre.scr);
    this.readMat('emb', -1, this.E, M.emb, this.eBytes, null);
    this.readCell('np', -1, this.gl.POS);          // the first position that is run = number of prefix positions
  }

  // ---- prompt and output (compiler/qwen/program/gen.js replaces these with the tokenizer) ----

  emitReadPrompt() {
    const p = this.p, gl = this.gl, PR = gl.PR;
    p.read(gl.REM).read(gl.PN);
    p.copy(gl.PN, PR, gl.T);
    p.to(PR).raw('[').add(PR, -1);
    p.move(PR, PR + 1);
    p.read(PR); p.read(PR + 2); p.scatter(PR + 2, [[PR, 256]]);
    p.read(PR + 2); p.shl(PR + 2, PR, 16, [PR + 3, PR + 2]); p.add(PR, 1);        // 3 bytes; the queue holds id + 1
    p.to(PR + 1).raw(']');
    p.raw('<[<]'); p.ptr = PR - 1;
  }

  // If the queue is not empty: TOKEN = next prompt id.
  emitTakePrompt() {
    const p = this.p, gl = this.gl;
    p.whenNonZero(gl.PN, [gl.T, gl.T + 1], () => {
      p.clear(gl.TOKEN).move(gl.PR, gl.TOKEN).add(gl.TOKEN, -1);
      for (let i = 1; i <= this.a.maxTokens; i++) p.move(gl.PR + i, gl.PR + i - 1);
      p.add(gl.PN, -1);
    });
  }

  emitFeedAndPrint(id) {
    const p = this.p, gl = this.gl, R = (i) => gl.PRT + i, [t0, t1, flag, x, lo, hi, v, e, hit, E2, top] = range(11, R), hop = [R(11), R(12)];
    p.clear(gl.TOKEN).move(id, gl.TOKEN);
    p.whenZero(gl.PN, [t0, t1, flag], () => {
      for (const s of this.a.stops) {          // hit = 1 when the token is a stop token
        p.copy(gl.TOKEN, v, t0); p.addBig(v, -s, hop);
        p.add(e, 1); p.ifNonZero(v, () => p.add(e, -1)); p.move(e, hit);
      }
      this.ifElse(hit, E2, () => p.clear(gl.REM), () => {
        p.copy(gl.TOKEN, x, t0);
        p.splitDigits(x, [{ cell: lo, bits: 8 }, { cell: hi, bits: 8 }, { cell: top, bits: 8 }], range(10, (i) => R(11 + i)));
        p.out(lo).clear(lo).out(hi).clear(hi).out(top).clear(top);
      });
    });
  }

  // ---- the program ------------------------------------------------------------------------

  build() {
    const p = this.p, gl = this.gl;
    this.emitReader();
    this.emitReadPrompt();
    p.loop(gl.REM, () => { p.add(gl.REM, -1); this.token(); });
    const virt = p.toString();
    if (/[^+\-<>[\].,]/.test(virt)) throw new Error('not pure brainfuck');
    // Mirror the tape: swap < and >.
    const src = virt.replace(/[<>]/g, (ch) => (ch === '<' ? '>' : '<'));
    return { src, layout: this.layout() };
  }

  layout() {
    const { N, gl, Lo, so, M, a, pre, CST, kv } = this, T = a.maxTokens, { dim, hidden } = a;
    const real = (v) => N - v;
    const P = (l) => this.P0 + l * this.stride;
    const slot = (l, pos) => P(l) + Lo.dock + (pos + 1) * this.SS;
    const chunkQ = (c) => this.PL + c * CST;
    // Resting places of the weights: [first, last] virtual addresses.
    const weightRanges = [[this.E + M.emb.G + 1, this.E + M.emb.G + a.dim * (a.vocab + 1)]];
    for (let c = 0; c < this.nC; c++) weightRanges.push([chunkQ(c) + M.cls.G + 1, chunkQ(c) + M.cls.G + a.dim * (a.chunk + 1)]);
    for (let l = 0; l < a.layers; l++) {
      for (const [o, m] of [[0, M.qkv], [Lo.oO, M.o], [Lo.o13, M.w13], [Lo.o2, M.w2]]) weightRanges.push([P(l) + o + m.G + 1, P(l) + o + m.G + m.C * (m.R + 1)]);
    }
    // The strips of constants (gains, doublings per row, biases).
    const constRanges = [[this.P0 - this.PRE + pre.g, this.P0 - this.PRE + pre.g + dim - 1]];
    for (let l = 0; l < a.layers; l++) {
      for (const [o, n] of [[Lo.Abias, dim + 2 * kv], [Lo.Adr, dim + 2 * kv], [Lo.Cdr, 2 * hidden], [Lo.preB + pre.g, dim], [Lo.preB + pre.dr, dim], [Lo.preD + pre.g, dim], [Lo.preD + pre.dr, dim]]) constRanges.push([P(l) + o, P(l) + o + n - 1]);
    }
    const allowedRanges = () => {
      const r = [[gl.TOKEN, gl.POS], ...weightRanges, ...constRanges];
      for (let l = 0; l < a.layers; l++) {
        for (let pos = 0; pos < T; pos++) { const s = slot(l, pos); r.push([s + so.U, s + so.U], [s + so.KS, s + so.KS + kv - 1], [s + so.VS, s + so.VS + kv - 1]); }
      }
      return r.sort((x, y) => x[0] - y[0]);
    };
    return {
      tapeSize: N + 1, real, plan: this.plan, chunkRows: a.chunk, chunks: this.nC,
      pos: gl.POS, wBytes: this.wBytes, eBytes: this.eBytes, OFFW: this.OFFW, OFFE: this.OFFE,
      keyCell: (pos, l, i) => slot(l, pos) + so.KS + i, valueCell: (pos, l, i) => slot(l, pos) + so.VS + i, usedCell: (pos, l) => slot(l, pos) + so.U,
      allowedRanges,
      weightCells: weightRanges.reduce((s, [lo, hi]) => s + hi - lo + 1, 0),
    };
  }
}

require('./stations')(Engine, { range, HS, CN, POS, SXT, LC, C4, C5, TT, H0, H1 });

function buildEngine(arch) { return new Engine(arch).build(); }

module.exports = { buildEngine, archOf, Engine };
