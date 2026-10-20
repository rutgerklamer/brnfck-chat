'use strict';

// A brainfuck ENGINE for Qwen3.5 (spec.js), for 32-bit wrapping cells.
//
// The building blocks are those of the Qwen2.5 engine (compiler/qwen/engine/gen.js and stations.js): the
// sweep of a gap through a matrix, the residual norm, the feed-forward layer, the output layer and the walk home
// are used as they are. What is new is the layout of a model whose layers are of two kinds, and the two token
// mixers: the Gated DeltaNet (mixers/deltanet.js) and the gated full attention (mixers/attention.js).
//
// The layers come in groups (lin lin lin att for Qwen3.5); the code of one group is written once and runs in a loop.

const fs = require('fs');
const { Engine: Engine25 } = require('../../qwen/engine/gen');
const Spec = require('./spec');

const range = (n, f = (i) => i) => Array.from({ length: n }, (_, i) => f(i));
const ZW = 80;            // width of the scratch window of a slide loop (gen.js of Qwen2.5)
const CT = 46;            // control cells of a matrix gap, and their names (the same numbers as Qwen2.5's gen.js)
const CN = 0, POS = 1, SXT = 2, LC = 3, C4 = 4, C5 = 5, TT = 11, H0 = 21, H1 = 22;
const K = { range, ZW, CT, CN, POS, SXT, LC, C4, C5, TT, H0, H1, car1: (base, j) => base + 2 * (j + 1) };

// The token mixers: layout, code, reader, walk home and stream values per layer kind.
const MIXERS = { lin: require('./mixers/deltanet'), att: require('./mixers/attention'), none: require('./mixers/none') };

function archOf(shape, options = {}, extra = {}) {
  const S = Spec.settings(shape, options);
  const { dim, layers, types, heads, kvHeads, headSize, hidden, vocab } = shape;
  // the repeating unit of layer kinds
  let period = 1;
  while (period < layers && types.some((t, l) => t !== types[l % period])) period++;
  if (layers % period) throw new Error('the layer kinds do not repeat in whole groups');
  return {
    ...shape, dim, layers, types, heads, kvHeads, headSize, hidden, vocab,
    qDim: heads * headSize, unit: types.slice(0, period), groups: layers / period,
    chunk: extra.chunk || defaultChunk(vocab, 2 * hidden),
    maxTokens: S.cfg.maxTokens, cfg: S.cfg, R: S.R, settings: S, eout: S.eout, eo: S.eo, e2: S.e2, K3: S.K3, xUpBits: S.xUpBits, xDown: S.xDown,
    tables: S.tables, stops: (extra.stops || Spec.STOP).slice(), noMixer: !!options.noMixer, skip: options.skip || [],
    embRoom: extra.embRoom, vision: extra.vision,
  };
}
// The largest divisor of the vocabulary that is not above `limit`.
function defaultChunk(vocab, limit) {
  for (let c = Math.min(vocab, limit); c >= 1; c--) if (vocab % c === 0) return c;
  return vocab;
}

class Engine {
  constructor(arch) {
    const { Patterns } = require('../../../site/runtime/patterns');
    this.a = arch;
    this.p = new Patterns(32);
    // the program text with its length kept: S() notes where every named step starts and ends
    // (in pieces of 1 M characters: an array of every small piece would pass the largest array V8 allows)
    const code = [];
    code.chars = 0; code.cur = '';
    code.push = function (...s) {
      for (const x of s) { this.chars += x.length; this.cur += x; }
      if (this.cur.length >= 1 << 20) { Array.prototype.push.call(this, this.cur); this.cur = ''; }
      return this.length;
    };
    code.flush = function () { if (this.cur) { Array.prototype.push.call(this, this.cur); this.cur = ''; } };
    code.join = function (sep) { this.flush(); return Array.prototype.join.call(this, sep); };
    this.p.code = code;
    this.marks = [];
    const a = arch, c = a.cfg;
    if (a.vocab % a.chunk) throw new Error('vocab must be a multiple of chunk');
    if (Math.max(c.ngBits, c.hBits) > CT - 25) throw new Error(`matrix inputs wider than ${CT - 25} bits`);
    if (Math.max(...a.stops, a.vocab) >= 2 ** 24) throw new Error('token ids must fit 3 bytes');
    this.nC = a.vocab / a.chunk;
    this.OFFW = 2 ** (c.weightBits - 1);       // weights are stored as w + OFFW (1 .. 2^weightBits - 1)
    this.OFFE = 2 ** (c.embBits - 1) + 1;      // values of the embedding table are stored as e + OFFE (1 .. 2^embBits)
    this.wBytes = Math.ceil(c.weightBits / 8); this.eBytes = Math.ceil((c.embBits + 1) / 8);
    this.OFFX = 2 ** (c.xBits - 1) + 1;        // residual values travel and rest as x + OFFX (never zero)
    this.plan = [];
    this.kinds = {};
    for (const kind of ['lin', 'att']) this.kinds[kind] = a.noMixer || a.skip.includes(kind) ? MIXERS.none : MIXERS[kind];
    this.prepareLayout();
  }

  // A named step; its place in the program text is noted (tests stop the program there).
  S(name, fn) {
    const start = this.p.code.chars;
    fn();
    this.marks.push({ name, kind: this.kind || null, u: this.u ?? null, start, end: this.p.code.chars, ptr: this.p.ptr });
  }

  // ---- layout ----------------------------------------------------------------

  prepareLayout() {
    const a = this.a, { dim, hidden, vocab: V, chunk: CH } = a, { ngBits, hBits } = a.cfg;
    const M = this.M = {
      w13: this.mat(2 * hidden, dim, dim, ngBits), w2: this.mat(dim, hidden, dim, hBits),
      cls: this.mat(CH, dim, dim, ngBits, [LC, SXT, POS, CN, C4, C5]),
    };
    const ectrl = 2 * V + 4, ey = ectrl + CT + 1;
    M.emb = { R: V, C: dim, dst: 1, lane: V + 2, ctrl: ectrl, y: ey, G: ey + dim };
    if (a.embRoom) a.embRoom(M.emb);            // more room in the gap of the embedding table (../vision/program.js)

    let at;
    const take = (n) => { const x = at; at += n + 1; return x; };
    // The station before a normalised matrix: the residual, the gains, the doublings of the matrix before it.
    const pre = this.pre = {};
    at = 1;
    pre.scr = take(dim + ZW + 2); pre.x = take(dim); pre.g = take(dim); pre.dr = take(dim); pre.pos = take(1); pre.lc = take(1); pre.t = take(40); pre.h = take(4);
    this.PRE = at + 1;

    // One layer of each kind, as offsets from P (where its token mixer starts, right after the station before it).
    this.Lt = {};
    for (const kind of new Set(a.unit)) {
      const Lo = { kind, ...this.kinds[kind].layout(this, K) };     // the mixer takes [0, Lo.mix)
      Lo.preB = Lo.mix; Lo.o13 = Lo.preB + this.PRE;
      Lo.a13 = Lo.o13 + dim * (M.w13.R + 1);
      at = Lo.a13 + M.w13.G + 2;
      Lo.Cscr = take(Math.max(2 * hidden, dim) + ZW + 4); Lo.Cdr = take(2 * hidden);   // doublings per row of w1, then of w3
      Lo.o2 = at; Lo.a2 = Lo.o2 + hidden * (dim + 1);
      Lo.preD = Lo.a2 + M.w2.G + 1;
      Lo.stride = Lo.preD + this.PRE;
      this.Lt[kind] = Lo;
    }
    // the layers of a group, as offsets from the group's start
    this.unitAt = [];
    let g = 0;
    for (const kind of a.unit) { this.unitAt.push(g); g += this.Lt[kind].stride; }
    this.GS = g;

    // The station after a chunk of the output matrix (offsets from its first cell).
    const W = this.W = {};
    at = 1;
    W.scr = take(Math.max(CH, dim) + ZW + 4); W.d = take(8); W.log = take(CH); W.h = take(6);
    this.WS = at + 1;
    this.CST = dim * (CH + 1) + M.cls.G + 1 + this.WS;

    // The whole tape.
    let G = 2;
    const alloc = (n = 1) => { const x = G; G += n; return x; };
    const gl = this.gl = {};
    gl.TOKEN = alloc(); gl.POS = alloc(); gl.REM = alloc(); gl.PN = alloc();
    alloc(2); gl.PR = alloc(a.maxTokens + 4);   // prompt queue (ids + 1), next one first
    gl.T = alloc(8); gl.PRT = alloc(24);
    alloc(2);
    this.E = G;
    this.aE = this.E + dim * (V + 1);
    this.P0 = this.aE + M.emb.G + 1 + this.PRE;
    this.PL = this.P0 + a.groups * this.GS;
    this.N = this.PL + this.nC * this.CST + M.cls.G + 16;   // last virtual address; real cell = N - v
  }
  // where layer l starts
  Pof(l) { const u = l % this.a.unit.length; return this.P0 + Math.floor(l / this.a.unit.length) * this.GS + this.unitAt[u]; }

  // ---- reading the weights ------------------------------------------------------------

  emitReader() {
    const p = this.p, { M, CST, pre, a } = this, { dim, hidden } = a, nU = a.unit.length;
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
    // One copy of the code for a group of layers, written for the last group; its layers last first.
    this.busy = [];
    const G0 = this.PL - this.GS, home = (Q) => Q - this.PRE + pre.t + 37;
    const start = this.plan.length;
    p.add(home(G0 + this.GS), a.groups);
    p.to(home(G0 + this.GS)).raw('[').add(home(G0 + this.GS), -1);
    let lcr = home(G0 + this.GS);
    const gainOff = 2 ** (a.cfg.gainBits - 1), gBytes = Math.ceil((a.cfg.gainBits + 1) / 8);
    for (let u = nU - 1; u >= 0; u--) {
      const P = G0 + this.unitAt[u], Lo = this.Lt[a.unit[u]];
      this.kind = a.unit[u]; this.u = u; this.P = P; this.Lo = Lo;
      this.readStrip('gainNext', u, P + Lo.preD + pre.g, dim, gBytes, gainOff, P + Lo.preD + pre.scr);
      this.readStrip('dr2', u, P + Lo.preD + pre.dr, dim, 1, 0, P + Lo.preD + pre.scr);
      lcr = this.readMat('w2', u, P + Lo.o2, M.w2, this.wBytes, lcr);
      this.readStrip('dr1', u, P + Lo.Cdr, hidden, 1, 0, P + Lo.Cscr);
      this.readStrip('dr3', u, P + Lo.Cdr + hidden, hidden, 1, 0, P + Lo.Cscr);
      lcr = this.readMat('w13', u, P + Lo.o13, M.w13, this.wBytes, lcr);
      this.readStrip('gainFfn', u, P + Lo.preB + pre.g, dim, gBytes, gainOff, P + Lo.preB + pre.scr);
      lcr = this.kinds[this.kind].read(this, K, P, Lo, u, lcr);
    }
    p.move(lcr, this.free(home(G0)));
    p.to(home(G0)).raw(']');
    p.ptr = home(this.P0);
    const one = this.plan.splice(start);
    for (let g = a.groups - 1; g >= 0; g--) for (const e of one) this.plan.push({ ...e, layer: g * nU + e.layer });
    this.busy = [];
    this.kind = null; this.u = null;
    this.readStrip('gainFirst', 0, this.P0 - this.PRE + pre.g, dim, gBytes, gainOff, this.P0 - this.PRE + pre.scr);
    this.readMat('emb', -1, this.E, M.emb, this.eBytes, null);
  }

  // ---- one position ----------------------------------------------------------------------

  token() {
    const { p, gl, M, a, pre } = this, { dim } = a, ce = (k) => this.E + M.emb.ctrl + k;
    this.S('take', () => this.emitTakePrompt());
    this.S('emb', () => {
      if (this.beforeEmb) this.beforeEmb();
      p.copy(gl.TOKEN, ce(2), gl.T); p.copy(gl.POS, ce(1), gl.T);
      p.addBig(ce(0), dim, [ce(6), ce(7)]);
      this.sweepEmb();
      const aE = this.aE, ca = (k) => aE + M.emb.ctrl + k, s0 = this.P0 - this.PRE, X = s0 + pre.x;
      p.clear(ca(2));
      this.slide(dim, s0 + pre.scr, 1, 1, (c) => {
        const V = c.sc(0), hop = [c.sc(1), c.sc(2)];
        p.move(aE + M.emb.y, V); p.addBig(V, -this.OFFE, hop);
        if (a.xDown) this.rqN(V, X, this.rq(a.xDown, a.cfg.xBits), c.ss(3, 10), [c.sc(13), c.sc(14)]);
        else p.shl(V, X, a.xUpBits, hop);
      });
      if (this.afterEmb) this.afterEmb();
      p.move(ca(1), s0 + pre.pos);
    });

    // The groups of layers: one copy of the code in a loop; the counter travels with the residual.
    const lc0 = this.P0 - this.PRE + pre.lc;
    p.add(lc0, a.groups);
    p.to(lc0).raw('[').add(lc0, -1);
    a.unit.forEach((kind, u) => {
      this.kind = kind; this.u = u; this.P = this.P0 + this.unitAt[u]; this.Lo = this.Lt[kind];
      this.layer();
    });
    this.kind = null; this.u = null;
    p.to(lc0 + this.GS).raw(']');
    p.ptr = lc0 + a.groups * this.GS;
    this.S('xnf', () => { this.normEmit(this.PL, M.cls, true); p.clear(this.PL - this.PRE + pre.pos); });
    this.S('cls', () => this.clsLoop());
    this.S('return', () => this.goHome());
    this.S('print', () => { this.emitFeedAndPrint(gl.T); p.add(gl.POS, 1); });
  }

  // One layer at this.P: the token mixer (it ends with the residual in the station before the feed-forward layer),
  // then the feed-forward layer of compiler/qwen/engine/stations.js.
  layer() {
    const { P, Lo, M, p } = this, { R, e2 } = this.a;
    this.kinds[this.kind].emit(this, K, P, Lo);
    this.S('xn2', () => this.normEmit(P + Lo.o13, M.w13, false));
    this.S('sweep3', () => this.sweep(P + Lo.o13, M.w13));
    this.S('hid', () => this.hiddenStage());
    this.S('sweep4', () => this.sweep(P + Lo.o2, M.w2));
    this.S('xout', () => this.residual(P + Lo.a2, M.w2, R.f[0], e2, P + Lo.preD));
  }

  // From the winner of the output layer back to the start: every matrix is moved back where it rests.
  goHome() {
    const { p, M, a, pre, PL, gl, CST, nC } = this, T0 = (Q) => Q - this.PRE + pre.t + 34, nU = a.unit.length;
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
    // two cells travel: the chosen id (2) and the count of groups to go (3)
    p.move(PL + 2, T0(PL)).add(T0(PL) + 1, a.groups);
    const G0 = PL - this.GS;
    p.to(T0(PL) + 1).raw('[').add(T0(PL) + 1, -1);
    let from = T0(PL);
    for (let u = nU - 1; u >= 0; u--) {
      const P = G0 + this.unitAt[u], Lo = this.Lt[a.unit[u]];
      this.kind = a.unit[u]; this.u = u; this.P = P; this.Lo = Lo;
      const hop = (f, t) => { p.move(f + 2, t + 2).move(f + 3, t + 3); };
      p.move(from, P + Lo.a2 + 2).move(from + 1, P + Lo.a2 + 3);
      this.unsweep(P + Lo.a2, M.w2, [2, 3]); hop(P + Lo.o2, P + Lo.a13);
      this.unsweep(P + Lo.a13, M.w13, [2, 3]);
      // the mixer takes the two cells from P + Lo.o13 + 2, 3 and leaves them at P + 2, 3
      this.kinds[this.kind].home(this, K, P, Lo);
      p.move(P + 2, T0(P)).move(P + 3, T0(P) + 1);
      from = T0(P);
    }
    this.kind = null; this.u = null;
    p.to(T0(G0) + 1).raw(']');
    p.ptr = T0(this.P0) + 1;
    p.move(T0(this.P0), this.aE + 2);
    this.unsweep(this.aE, M.emb, [2]);
    p.move(this.E + 2, gl.T);
  }

  // ---- the program ------------------------------------------------------------------------

  build() {
    const p = this.p, gl = this.gl;
    this.emitReader();
    this.readEnd = p.code.chars;
    this.emitReadPrompt();
    p.loop(gl.REM, () => { p.add(gl.REM, -1); this.token(); });
    // The program in pieces (the whole text can be longer than the longest string V8 holds); the tape mirrored: < and > swapped.
    p.code.flush();
    const chunks = Array.from(p.code, (virt) => {
      if (/[^+\-<>[\].,]/.test(virt)) throw new Error('not pure brainfuck');
      return virt.replace(/[<>]/g, (ch) => (ch === '<' ? '>' : '<'));
    });
    const length = chunks.reduce((n, c) => n + c.length, 0);
    return { src: length < 2 ** 28 ? chunks.join('') : null, chunks, length, layout: this.layout() };
  }

  layout() {
    const { N, gl, M, a, pre, CST } = this, { dim } = a;
    const real = (v) => N - v;
    const chunkQ = (c) => this.PL + c * CST;
    const ranges = [[gl.TOKEN, gl.POS], [this.E + M.emb.G + 1, this.E + M.emb.G + dim * (a.vocab + 1)]];
    for (let c = 0; c < this.nC; c++) ranges.push([chunkQ(c) + M.cls.G + 1, chunkQ(c) + M.cls.G + dim * (a.chunk + 1)]);
    ranges.push([this.P0 - this.PRE + pre.g, this.P0 - this.PRE + pre.g + dim - 1]);
    for (let l = 0; l < a.layers; l++) {
      const P = this.Pof(l), Lo = this.Lt[a.types[l]];
      for (const [o, m] of [[Lo.o13, M.w13], [Lo.o2, M.w2]]) ranges.push([P + o + m.G + 1, P + o + m.G + m.C * (m.R + 1)]);
      for (const [o, n] of [[Lo.Cdr, 2 * a.hidden], [Lo.preB + pre.g, dim], [Lo.preD + pre.g, dim], [Lo.preD + pre.dr, dim]]) ranges.push([P + o, P + o + n - 1]);
      for (const r of this.kinds[a.types[l]].resting(this, K, P, Lo)) ranges.push(r);   // weights, constants and state of the mixer
    }
    return {
      tapeSize: N + 1, real, plan: this.plan, chunkRows: a.chunk, chunks: this.nC, marks: this.marks, readEnd: this.readEnd,
      pos: gl.POS, wBytes: this.wBytes, eBytes: this.eBytes, OFFW: this.OFFW, OFFE: this.OFFE, OFFX: this.OFFX,
      Pof: (l) => this.Pof(l), Lt: this.Lt, pre: this.pre, PRE: this.PRE, P0: this.P0, PL: this.PL, M: this.M, W: this.W, CST,
      allowedRanges: () => ranges.slice().sort((x, y) => x[0] - y[0]),
    };
  }
}

// The building blocks of the Qwen2.5 engine, used as they are.
for (const name of Object.getOwnPropertyNames(Engine25.prototype)) {
  if (name === 'constructor' || Object.prototype.hasOwnProperty.call(Engine.prototype, name)) continue;
  Engine.prototype[name] = Engine25.prototype[name];
}

require('./normvec')(Engine, K);

function buildEngine(arch) { return new Engine(arch).build(); }

// The first n characters of a program in pieces, and the rest.
function splitChunks(chunks, n) {
  const a = [], b = [];
  for (const c of chunks) {
    if (n >= c.length) { a.push(c); n -= c.length; } else if (n > 0) { a.push(c.slice(0, n)); b.push(c.slice(n)); n = 0; } else b.push(c);
  }
  return [a, b];
}
function writeChunks(file, chunks) {
  const fd = fs.openSync(file, 'w');
  for (const c of chunks) fs.writeSync(fd, Buffer.from(c, 'latin1'));
  fs.closeSync(fd);
}
// Does the file hold exactly these pieces?
function sameAsFile(file, chunks) {
  if (!fs.existsSync(file) || fs.statSync(file).size !== chunks.reduce((n, c) => n + c.length, 0)) return false;
  const fd = fs.openSync(file, 'r');
  try {
    for (const c of chunks) {
      const want = Buffer.from(c, 'latin1'), got = Buffer.alloc(want.length);
      fs.readSync(fd, got, 0, got.length, null);
      if (!got.equals(want)) return false;
    }
    return true;
  } finally { fs.closeSync(fd); }
}

module.exports = { buildEngine, archOf, Engine, K, splitChunks, writeChunks, sameAsFile };
