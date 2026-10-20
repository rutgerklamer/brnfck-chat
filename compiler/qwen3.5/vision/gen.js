'use strict';

// The vision part of Qwen3.5 in brainfuck: the squares of a picture in, one vector per four squares out; spec.js
// computes the same numbers. It lives on the tape of the text engine (../engine/gen.js), before its global cells, is
// read in with the weights, and runs once: after the weights, before the question.
//
// Its layers are built from the parts of the Qwen2.5 engine (compiler/qwen/engine/stations.js): the stations, the
// sweeps, the rounding of q, k and v with their biases, the rotation, the slots and the attention. What is new:
// - The attention looks both ways. In round l every square stores its key and value in the slots of layer l, and parks
//   its query and its residual in its slot. In round l + 1 every square takes them back, reads all the slots, and goes
//   on through the rest of layer l into the first half of layer l + 1. So the code of a round is the end of one layer
//   and the start of the next, and every round has its own code: every layer has its own widths (spec.js).
// - The output matrix and the second matrix of the feed-forward layer add a bias; the feed-forward layer is
//   gelu(a) = a Phi(a) with a = fc1 x + b, Phi from a table.
// - The patch embedding reads the bytes of a square from the input, with its own comma; the residual it starts from
//   is that square's position (and bias), one vector per square, read into a queue with the weights.
// - The merger: four squares normalised into one queue, two matrices with gelu between them, and the vector into the
//   queue of pictures that the text model reads at the word pieces <|image_pad|>.
//
// Layout (virtual addresses, left to right): the queue of positions, the patch embedding, 12 layers, the merger, the
// queue of pictures. One layer, from P, as in the Qwen2.5 engine: the station before it at P - PRE (the residual,
// the gain of the first norm, the doublings and bias of the matrix before it), the matrix of q, k and v, the area
// where their sums are rounded and turned, the slots (a dock, one per square, one more), the output matrix, the
// station of the second norm, the first matrix of the feed-forward layer and its area, the second matrix.

const Spec = require('./spec');
const { K } = require('../engine/gen');

const { range, ZW, CN, POS, SXT, LC, H0, H1 } = K;
const car1 = (base, j) => base + 2 * (j + 1);   // carried cell j of a slide with stride 1, direction +1
const HS = 32;                                  // cells per attention head frame (compiler/qwen/engine/gen.js)
const BEST = 2, TOT = 3, WW = 4, DD = 5, HSC = 7; // fields of a head frame (stations.js)

class VisionPart {
  // host: the engine whose tape and text this part shares; V: the shapes and weights (reference/vision.js loadVision,
  // synth.js); sq: the layout of the squares of the pictures it reads (squares() of reference/vision.js).
  constructor(host, V, sq, options = {}) {
    this.h = host; this.V = V; this.sq = sq;
    const S = this.S = Spec.settings(V, options), T = Spec.trigTables(V, sq, S.RB), cfg = S.cfg;
    const { dim, hidden, heads, headSize: hs, depth, out } = V, N = sq.n;
    if (2 ** Math.round(Math.log2(N)) !== N) throw new Error('the number of squares must be a power of two (the rotation picks its table by a switch on the bits of the square)');
    if (cfg.qBits !== cfg.kBits) throw new Error('the slots hold queries and keys of one width');
    this.N = N; this.G = V.merge * V.merge; this.wide = this.G * dim; this.inN = 3 * V.P * V.P; this.out = out; this.depth = depth;
    this.va = {
      dim, hidden, heads, kvHeads: heads, headSize: hs, maxTokens: N, layers: depth,
      cfg: { ...cfg }, K3: S.K3, tables: { inv: S.tables.inv, exp: S.tables.exp, recip: S.tables.recip, cos: T.cos, sin: T.sin },
    };
    // the context in which the parts of the Qwen2.5 engine run: the host's tape and text, the vision part's sizes
    const x = this.x = Object.create(host);
    x.a = this.va; x.kv = dim; x.share = 1;
    x.OFFX = 2 ** (cfg.xBits - 1) + 1;
    x.wBytes = Math.ceil(cfg.weightBits / 8);
    x.kind = 'vision';
  }

  // ---- layout ---------------------------------------------------------------------

  // The region from virtual address v0; returns the first address after it.
  layout(v0) {
    const x = this.x, a = this.va, { dim, hidden, heads } = a, N = this.N, { ngBits, vBits, gBits, mgBits } = this.S.cfg;
    let at;
    const take = (n) => { const r = at; at += n + 1; return r; };
    // a station (compiler/qwen/engine/gen.js pre), with the bias of the matrix before it
    const pre = x.pre = {};
    at = 1;
    pre.scr = take(dim + ZW + 2); pre.x = take(dim); pre.g = take(dim); pre.dr = take(dim); pre.b = take(dim); pre.pos = take(1); pre.lc = take(1); pre.t = take(40); pre.h = take(4); pre.m = take(4);
    x.PRE = at + 1;
    // the matrices
    const M = x.M = {
      qkv: x.mat(3 * dim, dim, dim, ngBits), o: x.mat(dim, dim, dim, vBits),
      w13: x.mat(hidden, dim, dim, ngBits), w2: x.mat(dim, hidden, dim, gBits),
    };
    this.Mp = x.mat(dim, this.inN, dim, 8);                                   // the bytes of a square: 8 bits, not negative
    this.Mm1 = x.mat(this.wide, this.wide, 0, ngBits); this.Mm2 = x.mat(this.out, this.wide, 0, mgBits);
    // a slot (the dock is slot 0, square s is slot s + 1): as in stations.js, with the parked query and residual
    const so = x.so = {};
    at = 0;
    so.U = take(1); so.DN = take(1); so.cn = take(1);
    so.scr = take(dim + ZW + 2);
    so.KS = take(dim); so.VS = take(dim);
    so.QS = take(dim); so.WS = take(dim); so.SM = take(dim);
    so.FL = take(dim); so.Hc = take(1); so.H = take(heads * HS);
    so.XT = take(dim);              // the residual on its way to its slot
    so.QP = take(dim); so.XP = take(dim);   // the query and the residual of this square, parked for the next round
    so.PC = take(1); so.NP = take(1); so.t = take(4);    // (the dock only) the square of this trip, the squares to go
    so.WC = take(3);                // the counter of a walk over the slots
    // what crosses the slots after the attention (the queue of the output matrix, the residual, its control cells),
    // slot by slot: in the fields of the query, the weights and the sums, free by then; the scratch of its moves behind
    const HL = M.o.y - M.o.q + dim + 1 + 8;
    so.HB = so.QS; so.HW = take(HL + ZW + 4);
    if (so.SM + dim - so.HB < HL) throw new Error('the block that crosses the slots does not fit');
    x.SS = at + 1;
    // one layer, as offsets from P
    const L = x.Lo = {};
    L.HL = HL;
    L.aQ = dim * (M.qkv.R + 1);
    at = L.aQ + M.qkv.G + 2;
    L.Ascr = take(Math.max(M.qkv.R, L.HL) + ZW + 4);
    L.Abias = take(M.qkv.R); L.Adr = take(M.qkv.R);
    L.Aqk = take(2 * dim); L.Apt = take(2 * dim); L.Atrig = take(2 * a.headSize); L.Asw = take(9); L.At = take(6); L.Ahop = take(L.HL);
    L.dock = at; at += (N + 2) * x.SS + 1;
    L.oO = at; L.aO = L.oO + dim * (dim + 1);
    L.preB = L.aO + M.o.G + 1; L.o13 = L.preB + x.PRE;
    L.a13 = L.o13 + dim * (M.w13.R + 1);
    at = L.a13 + M.w13.G + 2;
    L.Cscr = take(Math.max(hidden, dim) + ZW + 4); L.Cdr = take(hidden); L.Cb = take(hidden);
    L.o2 = at; L.a2 = L.o2 + hidden * (dim + 1);
    L.preD = L.a2 + M.w2.G + 1;
    x.stride = L.preD + x.PRE;

    // the queue of positions: entry 0 a dock, entry s + 1 the vector of square s, with room for its walk
    const qe = this.qe = {};
    at = 0;
    qe.U = take(1); qe.DN = take(1); qe.scr = take(dim + ZW + 2); qe.V = take(dim);
    this.QS = at + 1;
    // the queue of pictures: entry 0 a dock, entry g + 1 the vector of block g, one more at the end
    const ie = this.ie = {};
    at = 0;
    ie.U = take(1); ie.DN = take(1); ie.scr = take(this.out + ZW + 2); ie.V = take(this.out); ie.T = take(this.out);
    this.IS = at + 1;

    // the whole region
    let g = v0;
    const alloc = (n) => { const r = g; g += n + 1; return r; };
    this.SQ = alloc((N + 2) * this.QS);                                     // the queue of positions
    this.H0 = alloc(this.inN + ZW + 8);                                      // the home of round 0: its counters, the reading of a square
    this.org = alloc(0);                                                     // the gap of the patch embedding
    this.arrP = this.org + this.inN * (this.Mp.R + 1);
    this.P0 = this.arrP + this.Mp.G + 1 + x.PRE;                             // layer 0 (its station at P0 - PRE)
    this.PM = this.P0 + this.depth * x.stride;                               // the merger's first matrix (its station: the norm at PM - PRE)
    this.arrM1 = this.PM + this.wide * (this.Mm1.R + 1);
    g = this.arrM1 + this.Mm1.G + 2;
    this.A1 = { scr: alloc(this.wide + ZW + 4), dr: alloc(this.wide), b: alloc(this.wide), t: alloc(6) };
    this.orgM2 = alloc(0);
    this.arrM2 = this.orgM2 + this.wide * (this.Mm2.R + 1);
    g = this.arrM2 + this.Mm2.G + 2;
    this.A2 = { scr: alloc(this.out + ZW + 4), dr: alloc(this.out), b: alloc(this.out), t: alloc(6) };
    this.IQ = alloc((this.N / this.G + 2) * this.IS);                        // the queue of pictures
    this.end = g + 2;
    return this.end;
  }
  Pof(l) { return this.P0 + l * this.x.stride; }
  // what one layer's code reads: its place, and its roundings (spec.js settings)
  at(l) { const x = this.x; x.P = this.Pof(l); x.u = l; x.a = { ...this.va, R: this.S.L[l] }; return x; }
  slot(l, k) { return this.Pof(l) + this.x.Lo.dock + k * this.x.SS; }

  // ---- reading the weights (right to left, after the host's) ---------------------------------

  emitReader() {
    const x = this.x, p = x.p, { pre, PRE, Lo, M } = x, a = this.va, { dim, hidden } = a, cfg = this.S.cfg;
    const gainOff = 2 ** (cfg.gainBits - 1), gBytes = Math.ceil((cfg.gainBits + 1) / 8), sBytes = Math.ceil((cfg.xBits + 1) / 8);
    x.busy = [];
    x.u = null;
    // the merger, last first
    x.readStrip('vBm2', 0, this.A2.b, this.out, 4, 0, this.A2.scr);
    x.readStrip('vDrM2', 0, this.A2.dr, this.out, 1, 0, this.A2.scr);
    x.readMat('vM2', 0, this.orgM2, this.Mm2, x.wBytes, null);
    x.readStrip('vBm1', 0, this.A1.b, this.wide, 4, 0, this.A1.scr);
    x.readStrip('vDrM1', 0, this.A1.dr, this.wide, 1, 0, this.A1.scr);
    x.readMat('vM1', 0, this.PM, this.Mm1, x.wBytes, null);
    // the layers, last first; the station after layer l holds the gain of the norm after it and fc2's doublings and bias
    for (let l = this.depth - 1; l >= 0; l--) {
      const P = this.Pof(l), sD = P + Lo.preD, sB = P + Lo.preB;
      x.u = l;
      x.readStrip(l + 1 < this.depth ? 'vG1' : 'vGm', l + 1, sD + pre.g, dim, gBytes, gainOff, sD + pre.scr);
      x.readStrip('vDrF2', l, sD + pre.dr, dim, 1, 0, sD + pre.scr);
      x.readStrip('vBf2', l, sD + pre.b, dim, 4, 0, sD + pre.scr);
      x.readMat('vF2', l, P + Lo.o2, M.w2, x.wBytes, null);
      x.readStrip('vBf1', l, P + Lo.Cb, hidden, 4, 0, P + Lo.Cscr);
      x.readStrip('vDrF1', l, P + Lo.Cdr, hidden, 1, 0, P + Lo.Cscr);
      x.readMat('vF1', l, P + Lo.o13, M.w13, x.wBytes, null);
      x.readStrip('vG2', l, sB + pre.g, dim, gBytes, gainOff, sB + pre.scr);
      x.readStrip('vDrO', l, sB + pre.dr, dim, 1, 0, sB + pre.scr);
      x.readStrip('vBo', l, sB + pre.b, dim, 4, 0, sB + pre.scr);
      x.readMat('vO', l, P + Lo.oO, M.o, x.wBytes, null);
      x.readStrip('vBqkv', l, P + Lo.Abias, M.qkv.R, 4, 0, P + Lo.Ascr);
      x.readStrip('vDrQkv', l, P + Lo.Adr, M.qkv.R, 1, 0, P + Lo.Ascr);
      x.readMat('vQkv', l, P, M.qkv, x.wBytes, null);
    }
    // the station before layer 0: the gain of its first norm and the doublings of the patch embedding
    const s0 = this.P0 - PRE;
    x.u = null;
    x.readStrip('vG1', 0, s0 + pre.g, dim, gBytes, gainOff, s0 + pre.scr);
    x.readStrip('vDrP', 0, s0 + pre.dr, dim, 1, 0, s0 + pre.scr);
    x.readMat('vPatch', 0, this.org, this.Mp, x.wBytes, null);
    // the positions, one entry per square, last first
    for (let s = this.N - 1; s >= 0; s--) {
      const e = this.SQ + (s + 1) * this.QS;
      x.readStrip('vStart', s, e + this.qe.V, dim, sBytes, 2 ** (cfg.xBits - 1), e + this.qe.scr);
    }
    x.busy = [];
    void p;
  }

  // The value of every entry of the plan (../engine/pack.js valuesOf): net = spec.js build().
  values(net) {
    const { OFFW } = this.x, { dim, hidden } = this.va, L = net.layers, depth = this.depth, wide = this.wide;
    const g = (l) => (l < depth ? L[l].g1 : net.merger.g);
    return {
      mats: {
        vPatch: (l, r, c) => OFFW + net.patch.w[r * this.inN + c],
        vQkv: (l, r, c) => OFFW + L[l].qkv.w[r * dim + c], vO: (l, r, c) => OFFW + L[l].o.w[r * dim + c],
        vF1: (l, r, c) => OFFW + L[l].fc1.w[r * dim + c], vF2: (l, r, c) => OFFW + L[l].fc2.w[r * hidden + c],
        vM1: (l, r, c) => OFFW + net.merger.m1.w[r * wide + c],
        vM2: (l, r, c) => OFFW + net.merger.m2.w[r * wide + c],
      },
      strips: {
        vStart: (s) => (i) => net.start[s][i],
        vDrP: () => (i) => net.patch.d[i],
        vG1: (l) => (i) => g(l)[i], vGm: () => (i) => net.merger.g[i], vG2: (l) => (i) => L[l].g2[i],
        vDrQkv: (l) => (i) => L[l].qkv.d[i], vBqkv: (l) => (i) => L[l].bqkv[i],
        vDrO: (l) => (i) => L[l].o.d[i], vBo: (l) => (i) => L[l].bo[i],
        vDrF1: (l) => (i) => L[l].fc1.d[i], vBf1: (l) => (i) => L[l].b1[i],
        vDrF2: (l) => (i) => L[l].fc2.d[i], vBf2: (l) => (i) => L[l].b2[i],
        vDrM1: () => (i) => net.merger.m1.d[i], vBm1: () => (i) => net.merger.b1[i],
        vDrM2: () => (i) => net.merger.m2.d[i], vBm2: () => (i) => net.merger.b2[i],
      },
    };
  }

  // ---- the run: the squares from the input through every round into the queue of pictures ------------------

  emitRun() {
    const x = this.x, p = x.p, N = this.N, { so, Lo } = x;
    // round 0: the patch embedding and the first half of layer 0
    const h = this.H0, NP = h + this.inN + ZW + 4, PC = NP + 1, ht = [NP + 2, NP + 3];
    this.flags(this.SQ, this.QS, this.qe.U, N, 1, this.qe.scr);
    p.addBig(NP, N, ht);
    p.loop(NP, () => {
      p.add(NP, -1);
      this.embed(PC);
      this.half1(0);
      this.back(-1);
      p.add(PC, 1);
    });
    p.clear(PC);
    this.flags(this.SQ, this.QS, this.qe.U, N, -1, this.qe.scr);
    this.flags(this.SQ, this.QS, this.qe.DN, N, -1, this.qe.scr);
    // rounds 1 .. depth - 1: the second half of layer r - 1, the first half of layer r
    for (let r = 1; r < this.depth; r++) {
      const d0 = this.slot(r - 1, 0);
      p.addBig(d0 + so.NP, N, [d0 + so.t, d0 + so.t + 1]);
      p.loop(d0 + so.NP, () => {
        p.add(d0 + so.NP, -1);
        this.half2(r - 1);
        this.half1(r);
        this.back(r - 1);
        p.add(d0 + so.PC, 1);
      });
      p.clear(d0 + so.PC);
      this.clearSlots(r - 1);
    }
    // the last round: the second half of the last layer, square by square normalised into the queue of the merger,
    // which runs after every G-th square (gc counts them down)
    const l = this.depth - 1, d0 = this.slot(l, 0), gc = this.PM - x.PRE + x.pre.m;
    p.add(gc, this.G);
    p.addBig(d0 + so.NP, N, [d0 + so.t, d0 + so.t + 1]);
    p.loop(d0 + so.NP, () => {
      p.add(d0 + so.NP, -1);
      this.half2(l);
      this.mergeNorm();
      p.add(gc, -1);
      p.whenZero(gc, [gc + 1, gc + 2, gc + 3], () => {
        p.add(gc, this.G);
        this.merger();
        x.S('mback', () => { p.to(this.arrM2 + 1); x.unsweep(this.arrM2, this.Mm2, []); p.to(this.arrM1 + 1); x.unsweep(this.arrM1, this.Mm1, []); });
      });
      this.back(l, false);
      p.add(d0 + so.PC, 1);
    });
    p.add(gc, -this.G);
    p.clear(d0 + so.PC);
    this.clearSlots(l);
    void Lo;
  }

  // The next square: its bytes from the input, coded into the queue of the patch embedding (2 v + 1, their sum to
  // SXT), its position from the queue of positions into the residual of the gap; then the patch embedding.
  embed(PC) {
    const x = this.x, p = x.p, M = this.Mp, org = this.org, c = (k) => org + M.ctrl + k, base = this.H0;
    x.S('read', () => {
      p.copy(PC, c(POS), PC + 2);
      const w = x.slide(this.inN, base, 1, 1, (cc) => {
        const T = cc.sc(0);
        p.read(T);
        p.scatter(T, [[org + M.q, 2], [cc.car(0), 1]]);
        p.add(org + M.q, 1);
        cc.carry(0);
      });
      p.move(w.end(w.car(0)), c(SXT));
      p.addBig(c(CN), this.inN, [c(H0), c(H1)]);
    });
    x.S('position', () => {
      this.takeFirst(this.SQ, this.QS, this.qe, [[this.qe.V, this.va.dim]]);
      const e0 = this.SQ;
      x.slide(this.va.dim, e0 + this.qe.scr, 1, 1, (cc) => { p.move(e0 + this.qe.V, org + M.y); p.addBig(org + M.y, x.OFFX, [cc.sc(0), cc.sc(1)]); });
    });
    x.S('patch', () => x.sweep(org, M));
    x.S('x0', () => x.residual(this.arrP, M, this.S.P.k, this.S.P.k, this.P0 - x.PRE));
  }

  // The first entry of a queue whose DN is not set: DN set, and the fields [offset, n] carried back to entry 0 (the
  // dock, whose U is 0) over the entries before it (whose U is set).
  takeFirst(q0, stride, f, fields) {
    const x = this.x, p = x.p, e1 = q0 + stride;
    p.to(e1 + f.DN).raw('[' + '>'.repeat(stride) + ']'); p.ptr = e1 + f.DN;
    p.add(e1 + f.DN, 1);
    p.to(e1 + f.U).raw('[');
    for (const [o, n] of fields) x.slide(n, e1 + f.scr, 1, 1, () => p.move(e1 + o, e1 + o - stride));
    p.to(e1 + f.U - stride).raw(']');
    p.ptr = q0 + f.U;
  }

  // ---- the first half of a layer: norm, q k v, turned, into the slot of this square ----------------------------

  half1(l) {
    const x = this.at(l), p = x.p, { P, M, Lo } = x, c = (k) => P + Lo.aQ + M.qkv.ctrl + k;
    x.S('xn1', () => x.normEmit(P, M.qkv, false));
    x.S('sweep1', () => x.sweep(P, M.qkv));
    x.S('qkv', () => x.qkvRound());
    x.S('rot', () => x.rotate());
    x.S('store', () => { x.markSlot(); this.store(x); p.clear(c(POS)).clear(c(LC)); });
  }

  // The key and value, the query and the residual from slot 1 to the slot just claimed (stations.js storeKeyValue).
  store(x) {
    const p = x.p, { P, Lo, so, SS, M } = x, s1 = P + Lo.dock + SS, U = s1 + so.U, dim = x.a.dim, arr = P + Lo.aQ;
    const F = [[so.WS, so.KS], [so.SM, so.VS], [so.QS, so.QP], [so.XT, so.XP]];
    x.slide(dim, s1 + so.scr, 1, 1, () => p.move(arr + M.qkv.y, s1 + so.XT));
    p.to(U + SS).raw('[');
    x.slide(dim, s1 + so.scr, 1, 1, () => { for (const [f] of F) p.move(s1 + f, s1 + f + SS); });
    p.to(U + 2 * SS).raw(']');
    p.ptr = U + SS;
    x.slide(dim, s1 + so.scr, 1, 1, () => { for (const [f, t] of F) p.move(s1 + f, s1 + t); });
    p.to(U).raw('[' + '<'.repeat(SS) + ']');
    p.ptr = P + Lo.dock + so.U;
  }

  // ---- the second half: the attention over all slots, the output matrix, the feed-forward layer ----------------

  half2(l) {
    const x = this.at(l), p = x.p, { P, M, Lo, so, SS } = x, R = x.a.R, d0 = P + Lo.dock, s1 = d0 + SS, dim = x.a.dim;
    x.S('fetch', () => {
      this.takeFirst(d0, SS, so, [[so.QP, dim], [so.XP, dim]]);
      x.slide(dim, s1 + so.scr, 1, 1, () => p.move(d0 + so.QP, s1 + so.QS));
    });
    x.S('att', () => x.attention());
    x.S('mixed', () => this.mixed(x));
    x.S('hop', () => {
      // into the dock, over the slots one at a time, into the queue of the output matrix (stations.js layer: in one long move)
      const land = P + Lo.oO + M.o.q, at = P + Lo.oO + M.o.m, sl = this.slot(l, this.N + 1);
      x.slide(Lo.HL, P + Lo.Ascr, 1, 1, () => p.move(P + Lo.Ahop, d0 + so.HB));
      this.walk(x, d0, this.N + 1, SS, (s, d) => x.slide(Lo.HL, s + so.HW, 1, 1, () => p.move(s + so.HB, s + so.HB + d)));
      x.slide(Lo.HL, sl + so.HW, 1, 1, () => p.move(sl + so.HB, land));
      for (const k of [LC, SXT, POS, CN]) p.move(at + k, P + Lo.oO + M.o.ctrl + k);
    });
    x.S('sweep2', () => x.sweep(P + Lo.oO, M.o));
    x.S('xatt', () => this.residual(x, P + Lo.aO, M.o, R.o[0], R.eo, P + Lo.preB));
    x.S('xn2', () => x.normEmit(P + Lo.o13, M.w13, false));
    x.S('sweep3', () => x.sweep(P + Lo.o13, M.w13));
    x.S('hid', () => this.gelu(x));
    x.S('sweep4', () => x.sweep(P + Lo.o2, M.w2));
    x.S('xout', () => this.residual(x, P + Lo.a2, M.w2, R.f[0], R.e2, P + Lo.preD));
  }

  // mixed = sums / total, coded into the queue of the output matrix (stations.js mixed); the residual comes from the
  // dock, where it was carried with the query, and the square's number from the dock's counter.
  mixed(x) {
    const p = x.p, { P, Lo, so, M, kv, share, a } = x, { heads, kvHeads, headSize: hs, dim } = a, { vBits } = a.cfg;
    const dk = P + Lo.dock, hd = (h, f) => dk + so.H + h * HS + f, base = P + Lo.Ascr, Mo = M.o;
    const QI = P + Lo.Ahop, YI = QI + Mo.y - Mo.q, hc = (k) => YI + dim + 1 + k;
    p.eachFrame(hd(0, 0), HS, heads, dk + so.Hc, () => {
      const f = (k) => hd(0, k), S = range(10, (i) => f(HSC + i)), t1 = f(HSC + 10), t2 = f(HSC + 11), MANT = f(HSC + 12), y2 = f(HSC + 13), ex = f(HSC + 14);
      p.clear(f(BEST));
      p.copy(f(TOT), t1, t2);
      x.bitCount(t1, 16, (j) => [15 - j], [f(DD)], S);            // D = 16 - bits of the total
      p.copy(f(DD), t1, t2);
      x.doubleBy(f(TOT), t1, t2);
      p.requantCore(f(TOT), [{ cell: MANT, bits: 8 }, { cell: ex, bits: 2 }], 6, 10, false, S);
      p.shl(ex, MANT, 8, [t1, t2]);
      x.lookupBig(MANT, f(WW), y2, a.tables.recip, S.slice(0, 9));
    });
    const RC = dk + so.WS, DC = dk + so.QS, SM = dk + so.SM;
    for (let g = 0; g < kvHeads; g++) {
      for (let s = 0; s < share; s++) {
        const at = s * kv + g * hs;
        p.scatter(hd(g * share + s, WW), range(hs, (i) => [RC + at + i, 1]));
        p.scatter(hd(g * share + s, DD), range(hs, (i) => [DC + at + i, 1]));
      }
    }
    const w = x.slide(dim, base, 1, 1, (c) => {
      const [Sv, R1, Dn, tm, Nn, PR, LOW, TOP, CODE, E1, E2, e0, e1] = c.ss(0, 13), s = c.ss(13, 10);
      p.move(SM, Sv).move(RC, R1).move(DC, Dn);
      x.doubleBy(Sv, Dn, tm);
      x.rqN(Sv, Nn, x.rq(11, 17), s, [e0, e1]);
      x.mul(Nn, 17, [[R1, PR, 1]], s.slice(0, 8), false);
      p.clear(R1);
      x.rqSplit(PR, LOW, TOP, x.rq(14, vBits), s, [e0, e1]);
      x.encode(LOW, TOP, CODE, c.car(0), E1, E2, vBits);
      p.move(CODE, QI);
      p.move(dk + so.XP, YI);
      c.carry(0);
    });
    p.move(w.end(w.car(0)), hc(SXT));
    p.copy(dk + so.PC, hc(POS), dk + so.t);
    p.addBig(hc(CN), dim, [P + Lo.At, P + Lo.At + 1]);
  }

  // x = round(W h 2^d + bias + residual 2^e) into the station at s0 (stations.js residual, with the bias of the station)
  residual(x, arr, Mx, k, e, s0) {
    const p = x.p, { pre } = x, dim = x.a.dim, c = (i) => arr + Mx.ctrl + i, X = s0 + pre.x, base = s0 + pre.scr;
    p.move(c(SXT), car1(base, 0));
    const w = x.slide(dim, base, 1, 1, (cc) => {
      const S = cc.sc(0), t = cc.sc(1), tm = cc.sc(2), hop = [cc.sc(14), cc.sc(15)];
      x.fixSum(arr + Mx.m, S, cc.car(0), x.OFFW);
      x.doubleRow(S, s0 + pre.dr, t, tm);
      p.copy(s0 + pre.b, S, tm);
      p.move(arr + Mx.y, t); p.addBig(t, -x.OFFX, hop); p.shl(t, S, e, hop);
      x.rqN(S, cc.sc(13), x.rq(k, x.a.cfg.xBits), cc.ss(3, 10), hop);
      p.move(cc.sc(13), X);
    });
    p.clear(w.end(w.car(0)));
    p.move(c(POS), s0 + pre.pos).move(c(LC), s0 + pre.lc);
  }

  // One row of a matrix through gelu: a = round(sum 2^d + bias), Phi(a) from the table (its index clamped), the code
  // of round(a Phi / 2^PHB) to dst. A part of the slide body of gelu() and of the merger.
  geluRow(x, cc, sum, dr, bias, R, frac, table, bits, dst) {
    const p = x.p, cfg = this.S.cfg, [X, t, tm, A, A2, IX, PH, PRD, LOW, TOP, CODE, y2, e0, e1] = cc.ss(0, 14), s = cc.ss(14, 10);
    const pin = Math.min(frac, cfg.phiIn), tab = table[pin], k = frac - pin;
    const idx = { k, n: Math.log2(tab.length), lo: 0, addend: (k > 0 ? 2 ** (k - 1) : 0) + cfg.phiRange * 2 ** frac };
    x.fixSum(sum, X, cc.car(0), x.OFFW);
    x.doubleRow(X, dr, t, tm);
    p.copy(bias, X, tm);
    x.rqN(X, A, x.rq(R[0], bits), s, [e0, e1]);
    p.copy(A, A2, tm);
    x.rqN(A2, IX, idx, s, [e0, e1]);
    x.lookupBig(IX, PH, y2, tab, s.slice(0, 9));
    x.mul(A, bits, [[PH, PRD, 1]], s.slice(0, 8), false);
    p.clear(PH);
    x.rqSplit(PRD, LOW, TOP, x.rq(cfg.PHB, bits), s, [e0, e1]);
    x.encode(LOW, TOP, CODE, cc.car(1), s[0], s[1], bits);
    p.move(CODE, dst);
    cc.carry(1);
  }

  // The feed-forward layer between its two matrices (stations.js hiddenStage, with gelu and a bias).
  gelu(x) {
    const p = x.p, { P, Lo, M, a } = x, { dim, hidden: h, R } = a, gBits = a.cfg.gBits;
    const arr = P + Lo.a13, Mx = M.w13, c = (k) => arr + Mx.ctrl + k, base = P + Lo.Cscr, o2 = P + Lo.o2, M2 = M.w2, c2 = (k) => o2 + M2.ctrl + k;
    p.move(c(SXT), car1(base, 0));
    const w = x.slide(h, base, 1, 1, (cc) => this.geluRow(x, cc, arr + Mx.m, P + Lo.Cdr, P + Lo.Cb, R.g, R.GB, this.S.tables.phiTanh, gBits, o2 + M2.q));
    p.clear(w.end(w.car(0)));
    p.move(w.end(w.car(1)), c2(SXT));
    x.slide(dim, base, 1, 1, () => p.move(arr + Mx.y, o2 + M2.y));            // the residual goes along with the next matrix
    p.move(c(POS), c2(POS)).move(c(LC), c2(LC));
    p.addBig(c2(CN), h, [c2(H0), c2(H1)]);
  }

  // ---- the merger ----------------------------------------------------------------------------------------

  // The residual of the last layer, normalised times the merger's gain, coded into the last part of the queue of its
  // first matrix (stations.js normEmit: the residual is used up, the codes go to dst, the count of inputs grows by dim).
  mergeNorm() {
    const x = this.at(this.depth - 1), p = x.p, { pre } = x, a = this.va, { dim } = a, { xBits, nBits, gainB, ngBits } = this.S.cfg;
    const o = this.PM, Mx = this.Mm1, s0 = o - x.PRE, X = s0 + pre.x, base = s0 + pre.scr, t = (k) => s0 + pre.t + k, c = (k) => o + Mx.ctrl + k;
    const S = range(10, (i) => t(10 + i)), hop = [t(20), t(21)], half = 2 ** (xBits - 1), K3 = a.K3, dst = o + Mx.q + (this.G - 1) * dim;
    x.S('mnorm', () => {
      // the squares before it in this block one place on in the queue (the sums of the gap, empty now, are the scratch)
      x.slide((this.G - 1) * dim, o + Mx.a1, 1, 1, () => p.move(o + Mx.q + dim, o + Mx.q));
      let w = x.slide(dim, base, 1, 1, (c) => {
        const [V, LOW, TOP, E1, e0, e1] = c.ss(0, 6), s = c.ss(6, 10);
        p.copy(X, V, LOW);
        x.rqSplit(V, LOW, TOP, { k: 0, n: xBits, lo: -half, addend: 0 }, s, [e0, e1]);
        x.ifElse(TOP, E1, () => p.move(LOW, c.car(0)), () => { p.scatter(LOW, [[c.car(0), -1]]); p.addBig(c.car(0), half, [e0, e1]); });
        c.carry(0);
      });
      p.move(w.end(w.car(0)), t(0));
      x.bitCount(t(0), 31, (jj) => [Math.max(0, 29 - jj)], [t(1)], S);
      p.move(t(1), car1(base, 0));
      w = x.slide(dim, base, 1, 1, (c) => {
        const [V, tt, tm, Wc, U, U2, e0, e1] = c.ss(0, 8), s = c.ss(8, 10);
        p.move(X, V);
        x.double(V, c.car(0), tt, tm);
        x.rqN(V, Wc, { ...x.rq(11, 21), clamp: false }, s, [e0, e1]);
        p.copy(Wc, U, tt); p.move(Wc, X);
        x.rqN(U, U2, x.rq(4, 17), s, [e0, e1]);
        x.mul(U2, 17, [[U2, c.car(1), 1]], s.slice(0, 8), true);
        p.clear(U2);
        c.carry(1);
      });
      p.clear(w.end(w.car(0))); p.move(w.end(w.car(1)), t(0));
      p.copy(t(0), t(2), t(3));
      x.bitCount(t(2), 32, (jj) => { const b = jj + 1, D2 = b % 2 ? 31 - b : 32 - b; return [D2, D2 / 2]; }, [t(3), t(4)], S);
      x.doubleBy(t(0), t(3), t(2));
      p.requantCore(t(0), [{ cell: t(5), bits: 8 }, { cell: t(8), bits: 4 }], 20, 12, false, S);
      p.shl(t(8), t(5), 8, hop);
      x.lookupBig(t(5), t(6), t(7), a.tables.inv, S.slice(0, 9));
      p.move(t(6), car1(base, 0)); p.move(t(4), car1(base, 1));
      w = x.slide(dim, base, 1, 1, (c) => {
        const [V, Pp, tt, tm, LOW, TOP, CODE, E1, E2, e0, e1, XN, PG] = c.ss(0, 13), s = c.ss(13, 10);
        p.move(X, V);
        x.mul(V, 21, [[c.car(0), Pp, 1]], s.slice(0, 8), false);
        x.double(Pp, c.car(1), tt, tm);
        x.rqN(Pp, XN, { ...x.rq(K3, nBits), clamp: false }, s, [e0, e1]);
        x.mul(XN, nBits, [[s0 + pre.g, PG, 1]], s.slice(0, 8), false);
        x.rqSplit(PG, LOW, TOP, x.rq(gainB, ngBits), s, [e0, e1]);
        x.encode(LOW, TOP, CODE, c.car(2), E1, E2, ngBits);
        p.move(CODE, dst);
        c.carry(0); c.carry(2);
      });
      p.clear(w.end(w.car(0))).clear(w.end(w.car(1))).move(w.end(w.car(2)), c(SXT));
      p.addBig(c(CN), dim, [c(H0), c(H1)]);
      p.clear(s0 + pre.pos).clear(s0 + pre.lc);
    });
  }

  // The two matrices of the merger with gelu between them; the vector, rounded, into the queue of pictures.
  merger() {
    const x = this.x, p = x.p, M1 = this.Mm1, M2 = this.Mm2, A1 = this.A1, A2 = this.A2, cfg = this.S.cfg, Mr = this.S.M;
    const c1 = (k) => this.arrM1 + M1.ctrl + k, c2 = (k) => this.orgM2 + M2.ctrl + k, c3 = (k) => this.arrM2 + M2.ctrl + k;
    x.u = null;
    x.S('msweep1', () => x.sweep(this.PM, M1));
    x.S('mgelu', () => {
      p.move(c1(SXT), car1(A1.scr, 0));
      const w = x.slide(this.wide, A1.scr, 1, 1, (cc) => this.geluRow(x, cc, this.arrM1 + M1.m, A1.dr, A1.b, Mr.u, cfg.MGB, this.S.tables.phiErf, cfg.mgBits, this.orgM2 + M2.q));
      p.clear(w.end(w.car(0)));
      p.move(w.end(w.car(1)), c2(SXT));
      p.addBig(c2(CN), this.wide, [c2(H0), c2(H1)]);
      p.clear(c1(POS)).clear(c1(LC));
    });
    x.S('msweep2', () => x.sweep(this.orgM2, M2));
    x.S('mout', () => {
      const e1 = this.IQ + this.IS, ie = this.ie;
      p.move(c3(SXT), car1(A2.scr, 0));
      const w = x.slide(this.out, A2.scr, 1, 1, (cc) => {
        const S = cc.sc(0), t = cc.sc(1), tm = cc.sc(2), V = cc.sc(13);
        x.fixSum(this.arrM2 + M2.m, S, cc.car(0), x.OFFW);
        x.doubleRow(S, A2.dr, t, tm);
        p.copy(A2.b, S, tm);
        x.rqN(S, V, x.rq(Mr.e[0], cfg.eBits), cc.ss(3, 10), [cc.sc(14), cc.sc(15)]);
        p.move(V, e1 + ie.T);
      });
      p.clear(w.end(w.car(0)));
      p.clear(c3(POS)).clear(c3(LC));
      // claim the first free entry of the queue of pictures and carry the vector there (stations.js storeKeyValue)
      const U = e1 + ie.U, IS = this.IS;
      p.to(U).raw('[' + '>'.repeat(IS) + ']');
      p.add(U, 1);
      p.raw('[' + '<'.repeat(IS) + ']');
      p.ptr = this.IQ + ie.U;
      p.to(U + IS).raw('[');
      x.slide(this.out, e1 + ie.scr, 1, 1, () => p.move(e1 + ie.T, e1 + ie.T + IS));
      p.to(U + 2 * IS).raw(']');
      p.ptr = U + IS;
      x.slide(this.out, e1 + ie.scr, 1, 1, () => p.move(e1 + ie.T, e1 + ie.V));
      p.to(U).raw('[' + '<'.repeat(IS) + ']');
      p.ptr = this.IQ + ie.U;
    });
  }

  // ---- the walk home of a trip -----------------------------------------------------------------------------

  // From the end of a trip back to where it started: the first matrix of layer l + 1 (if the trip went into it), the
  // matrices of layer l and its slots; or, for l = -1, the first matrix of layer 0 and the patch embedding.
  back(l, next = true) {
    const x = this.x, p = x.p, { Lo, M, so } = x;
    x.S('back', () => {
      if (next) { const P1 = this.Pof(l + 1); p.to(P1 + Lo.aQ + 1); x.unsweep(P1 + Lo.aQ, M.qkv, []); }
      if (l < 0) { p.to(this.arrP + 1); x.unsweep(this.arrP, this.Mp, []); p.to(this.H0); return; }
      const P = this.Pof(l);
      for (const [arr, Mx] of [[P + Lo.a2, M.w2], [P + Lo.a13, M.w13], [P + Lo.aO, M.o]]) { p.to(arr + 1); x.unsweep(arr, Mx, []); }
      this.walk(x, this.slot(l, this.N + 1), this.N + 1, -x.SS);       // over the slots back to the dock
      p.to(P + Lo.dock + so.U);
    });
  }

  // A walk over n slots from the slot at s0, d cells a step: a counter in field WC carried along; body(s, d) runs in
  // every step with s the slot it starts from (attention.js walk).
  walk(x, s0, n, d, body) {
    const p = x.p, c = s0 + x.so.WC;
    p.addBig(c, n, [c + 1, c + 2]);
    p.to(c).raw('[').add(c, -1);
    if (body) body(s0, d);
    p.move(c, c + d);
    p.to(c + d).raw(']');
    p.ptr = c + n * d;
  }

  // After the last round of a layer: its slots empty again.
  clearSlots(l) {
    const x = this.x, p = x.p, { so, SS } = x, s1 = this.slot(l, 1), dim = this.va.dim, c = s1 + so.cn;
    p.addBig(c, this.N, [c + 1, c + 2]);
    p.to(c).raw('[').add(c, -1);
    p.clear(s1 + so.U).clear(s1 + so.DN);
    x.slide(dim, s1 + so.scr, 1, 1, () => { p.clear(s1 + so.KS).clear(s1 + so.VS); });
    p.move(c, c + SS);
    p.to(c + SS).raw(']');
    p.ptr = c + this.N * SS;
  }

  // The cells that hold something after a run: the weights and constants, and the queue of pictures (its flags and vectors).
  resting() {
    const x = this.x, { Lo, M, pre, PRE } = x, { dim, hidden } = this.va, r = [];
    const mat = (org, Mx) => r.push([org + Mx.G + 1, org + Mx.G + Mx.C * (Mx.R + 1)]);
    const strip = (at, n) => r.push([at, at + n - 1]);
    mat(this.org, this.Mp); strip(this.P0 - PRE + pre.g, dim); strip(this.P0 - PRE + pre.dr, dim);
    for (let l = 0; l < this.depth; l++) {
      const P = this.Pof(l);
      mat(P, M.qkv); mat(P + Lo.oO, M.o); mat(P + Lo.o13, M.w13); mat(P + Lo.o2, M.w2);
      strip(P + Lo.Abias, M.qkv.R); strip(P + Lo.Adr, M.qkv.R); strip(P + Lo.Cdr, hidden); strip(P + Lo.Cb, hidden);
      for (const s of [P + Lo.preB, P + Lo.preD]) for (const f of [pre.g, pre.dr, pre.b]) strip(s + f, dim);
    }
    mat(this.PM, this.Mm1); mat(this.orgM2, this.Mm2);
    for (const A of [this.A1, this.A2]) { strip(A.dr, A === this.A1 ? this.wide : this.out); strip(A.b, A === this.A1 ? this.wide : this.out); }
    for (let g = 1; g <= this.N / this.G; g++) { const e = this.IQ + g * this.IS; strip(e + this.ie.U, 1); strip(e + this.ie.V, this.out); }
    return r.sort((u, w) => u[0] - w[0]);
  }

  // flags: add v to field f of entries 1 .. n of a queue (entry k at q0 + k * stride), with a counter that walks.
  // The counter is the cell after the flag, free in every entry; a count of 256 or more is built in two cells of the
  // scratch of entry 1 at offset scr (the cells after the counter are the other flag, set or not).
  flags(q0, stride, f, n, v, scr) {
    const p = this.x.p, e1 = q0 + stride, c = e1 + f + 1;
    p.addBig(c, n, [e1 + scr, e1 + scr + 1]);
    p.to(c).raw('[').add(c, -1);
    p.add(e1 + f, v);
    p.move(c, c + stride);
    p.to(c + stride).raw(']');
    p.ptr = c + n * stride;
  }
}

module.exports = { VisionPart, HS };
