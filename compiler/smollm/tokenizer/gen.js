'use strict';

// Text front and back end for SmolLM2-135M-Instruct in pure brainfuck (32-bit wrapping cells).

const { switchOn } = require('../../core/switch');

const DEFAULTS = {
  maxChars: 256,          // longest question in bytes; the rest of a longer line is read and dropped
  W: 12,                  // bytes of token text in one table record
  topBits: 7,             // U = 2^topBits records per long hop
  hashBits: 16,           // hash table size (token ids must fit 16 bits)
  mult: [251, 241, 239],  // hash of the pair (a, b) = (a * 251 * 241 + b * 239) mod 2^hashBits
  maxPre: 32,             // room for the template tokens before the question
  maxSuf: 8,              // ... and after it
};

const NONE = 65535;       // "this pair does not merge": larger than every token id

// Character classes (third byte of a byte table entry, see pack.js).
const CLASS = { L: 1, O: 2, D: 3, SP: 4, WS: 5, APOS: 6, L1: 7, LRV: 8, LE: 9, LL: 10, X: 11, CB: 12 };

const range = (n, f = (i) => i) => Array.from({ length: n }, (_, i) => f(i));

// ---- tape layout ---------------------------------------------------------------

const S = 8;              // work record: ID, CO, RK and five scratch cells
const BS = 7;             // byte table record: M, ID, CLS, G, P0, P1, T

function layout(base = 0, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const SS = 12 + o.W, U = 1 << o.topBits, H = SS * U;
  const outCap = o.maxPre + o.maxChars + 1 + o.maxSuf;
  let at = base;
  const take = (n) => { const x = at; at += n; return x; };
  take(BS);                                 // where the loader's pointer ends up
  take(255 * BS);
  const BH = take(BS), RD = take(6);
  take(2);                                  // a zero before the prefix list
  const PRE = take(2 * (o.maxPre + 1)), SUF = take(2 * (o.maxSuf + 1));
  const OUTG = take(2), OUT = take(2 * (outCap + 1));
  const HS = take(16), T0 = take(SS), WSENT = take(S), WORK = take(S * (o.maxChars + 1 + 4));
  if (at > T0 + H) throw new Error('the work array does not fit before the first table record: raise topBits or lower maxChars');
  const records = (1 << o.hashBits) + U, blocks = records / U;
  const end = T0 + (blocks + 1) * H + SS;   // the loader's pointer rests one block past the table
  return {
    ...o, base, size: end - base, tapeSize: end,
    SS, U, H, BH, RD, PRE, SUF, OUTG, OUT, HS, T0, WSENT, WORK, records, blocks, outCap,
    // for a caller:
    pairA: WORK + 4, pairB: WORK + 5,       // hand-in cells of emitPairLookup (scratch of work record 0)
    count: OUTG + 1,                        // number of prompt tokens after emitEncode
    // cells that hold data after emitLoad: every other cell is 0 between calls
    isData: (addr) => (addr >= base && addr < RD) || (addr >= PRE && addr < OUTG) || addr >= T0 + H,
  };
}

// ---- the table walk (shared by encode and print) ----------------------------------

function tableCells(L) {
  const T0 = L.T0;
  return {
    LANE: T0, G: T0 + 1, R: T0 + 2, RO: T0 + 3, KQ: T0 + 4, c4: T0 + 5, c5: T0 + 6,
    K: T0 + 7, V: T0 + 8, Z: T0 + 9, S1: T0 + 10, E: T0 + 10 + L.W, LINK: T0 + 11 + L.W,
  };
}

// The walk to a table record: G long hops of H cells, then R hops of SS, carrying cells along.
function walker(p, L) {
  const c = tableCells(L), { SS, H } = L, raw = (s) => p.code.push(s);
  return {
    c,
    out(carry) {
      p.to(c.G); raw('['); p.add(c.G, -1);
      for (const x of [c.G, c.R, ...carry]) p.move(x, x + H);
      p.to(c.G + H); raw(']'); p.ptr = c.G;
      p.copy(c.R, c.RO, c.c4);
      p.to(c.R); raw('['); p.add(c.R, -1);
      for (const x of [c.R, c.RO, ...carry]) p.move(x, x + SS);
      p.to(c.R + SS); raw(']'); p.ptr = c.R;
    },
    // Back home from RO records behind a block start, taking cell G along.
    back() {
      p.to(c.RO); raw('['); p.add(c.RO, -1); p.move(c.RO, c.RO - SS); p.move(c.G, c.G - SS);
      p.to(c.RO - SS); raw(']'); p.ptr = c.RO;
      p.to(c.LANE); raw('['); p.move(c.G, c.G - H); p.to(c.LANE - H); raw(']'); p.ptr = c.LANE;
    },
  };
}

// ---- LOAD -------------------------------------------------------------------------

function emitLoad(p, L) {
  const { SS, U, H, W } = L, raw = (s) => p.code.push(s);

  // cell = 256 * (first byte) + (second byte); t: scratch.
  const readTwo = (cell, t) => { p.read(t); p.scatter(t, [[cell, 256]]); p.read(t); p.move(t, cell); };

  const readList = (addr, n) => {
    const C = addr + 2;
    p.addConst(C, n, addr + 1);
    p.to(C); raw('['); p.add(C, -1);
    readTwo(addr, addr + 1);
    p.move(C, C + 2);
    p.to(C + 2); raw(']');
    p.ptr = C + 2 * n;
  };
  readList(L.PRE, L.maxPre);
  readList(L.SUF, L.maxSuf);

  {
    const B = L.BH - BS, M = B, ID = B + 1, CLS = B + 2, G = B + 3, T = B + 6;
    p.addConst(G, 255, T);
    p.to(G); raw('['); p.add(G, -1);
    p.add(M, 1); readTwo(ID, T); p.read(CLS);
    p.move(G, G - BS);
    p.to(G - BS); raw(']');
    p.ptr = G - 255 * BS;
  }

  {
    const c = tableCells(L), f = (x) => x + H;          // the frame of the first real record
    const NB = f(c.G), IC = f(c.R), t1 = f(c.RO), t2 = f(c.KQ), K = f(c.K);
    p.addBig(NB, L.blocks, [t1, t2]);
    p.to(NB); raw('['); p.add(NB, -1);
    p.add(f(c.LANE), 1);
    p.addConst(IC, U, t1);
    p.to(IC); raw('['); p.add(IC, -1);
    // K = ((a_high * 256 + a_low) * 256 + b_high) * 256 + b_low
    p.read(K); p.scatter(K, [[t1, 256]]); p.read(K); p.move(K, t1);
    p.scatter(t1, [[t2, 256]]); p.read(K); p.move(K, t2);
    p.scatter(t2, [[K, 256]]); p.read(t1); p.move(t1, K);
    readTwo(f(c.V), t1);
    for (let i = 0; i < W; i++) p.read(f(c.S1) + i);
    readTwo(f(c.LINK), t1);
    p.move(IC, IC + SS); p.move(NB, NB + SS);
    p.to(IC + SS); raw(']'); p.ptr = IC;
    p.to(NB); raw(']');
    p.to(f(c.LANE) - H); raw('[' + '<'.repeat(H) + ']');
    p.ptr = c.LANE;
  }
}

// ---- the merge table -----------------------------------------------------------------

function emitPairLookup(p, L) {
  const { SS } = L, raw = (s) => p.code.push(s);
  const tw = walker(p, L), c = tw.c, hs = range(10, (i) => L.HS + i);
  const [m0, m1, m2] = L.mult, t = L.topBits;
  // KQ = a * 65536 + b (the key, to compare with what is stored); c4 = a * m0 * m1 + b * m2
  p.scatter(L.pairA, [[c.c4, 256], [c.c5, m0]]); p.scatter(c.c4, [[c.KQ, 256]]); p.scatter(c.c5, [[c.c4, m1]]);
  p.scatter(L.pairB, [[c.KQ, 1], [c.c4, m2]]);
  // its low 16 bits are the slot: low topBits -> R, the rest -> G
  p.requantCore(c.c4, [{ cell: c.R, bits: t }, { cell: c.G, bits: L.hashBits - t }], 0, L.hashBits, false, hs);
  p.add(c.G, 1);                                                                          // indices start at U
  tw.out([c.KQ]);
  const GO = c.c4, T = c.c5, F = c.R, RES = c.G;
  p.add(GO, 1);
  p.loop(GO, () => {
    p.add(GO, -1);
    p.copy(c.K, T, RES); p.scatter(c.KQ, [[T, -1], [RES, 1]]); p.move(RES, c.KQ);         // T = stored key - key
    p.add(F, 1);
    p.loop(T, () => {
      p.clear(T); p.add(F, -1);
      p.copy(c.K, T, RES);
      p.loop(T, () => {                       // taken by another pair: one record on
        p.clear(T);
        p.add(c.RO, 1); p.move(c.RO, c.RO + SS); p.move(c.KQ, c.KQ + SS); p.add(GO + SS, 1);
        p.to(T); raw('>'.repeat(SS));
      });
    });
    p.loop(F, () => { p.add(F, -1); p.copy(c.V, RES, T); });
  });
  p.clear(c.KQ);
  tw.back();
  p.add(F, 1);
  p.loop(RES, () => { p.add(F, -1); p.move(RES, L.pairA); });
  p.loop(F, () => { p.add(F, -1); p.addBig(L.pairA, NONE, [c.c4, c.c5]); });
}

// ---- ENCODE -----------------------------------------------------------------------

function emitEncode(p, L) {
  const raw = (s) => p.code.push(s);
  const nop = () => {};

  const R0 = L.WORK, SENT = L.WSENT;
  const w = { ID: R0, CO: R0 + 1, RK: R0 + 2, s0: R0 + 3, s1: R0 + 4, s2: R0 + 5, s3: R0 + 6, s4: R0 + 7 };
  const hop = (n) => { p.to(w.ID); raw((n > 0 ? '>' : '<').repeat(Math.abs(n) * S)); };
  // From a record (or from the empty one in front) left to the empty record.
  const home = () => { p.to(w.ID); raw('[' + '<'.repeat(S) + ']'); p.ptr = SENT; };

  // Output: element = [ID, C]. C of element 0 is where a new id is handed in.
  const o = { ID: L.OUT, C: L.OUT + 1 };
  const appendOut = () => {
    p.to(o.ID); raw('['); p.move(o.C, o.C + 2); p.to(o.ID + 2); raw(']'); p.ptr = o.ID;
    p.move(o.C, o.ID);
    p.to(o.ID - 2); raw('[<<]'); p.ptr = L.OUTG;
  };

  // ---- 1. empty the output, copy the prefix ----
  p.clear(L.count);
  p.to(o.ID); raw('[>>]<<[[-]<<]'); p.ptr = L.OUTG;
  {
    const V = L.PRE, D = L.OUT - L.PRE;       // same spacing, so "D cells to the right" is the same element
    p.to(V); raw('[');
    p.scatter(V, [[V + 1, 1], [V + D, 1]]); p.move(V + 1, V);
    p.to(V + 2); raw(']'); p.ptr = V;
    p.to(V - 2); raw('[<<]'); p.ptr = L.PRE - 2;
  }

  // ---- 2. read the line into the work array ----
  {
    const B = L.BH, M = B, ID = B + 1, CLS = B + 2, G = B + 3, P0 = B + 4, P1 = B + 5, T = B + 6;
    const [t, t2, LIM, CH, GO] = range(5, (i) => L.RD + i);
    p.add(CH, 10).add(GO, 1);                 // the newline that the template puts before the question
    p.addConst(LIM, L.maxChars + 1, t);
    p.loop(GO, () => {
      p.add(GO, -1);
      // (id, class) of byte CH: walk CH records left, copy, run back right.
      p.move(CH, G);
      p.to(G); raw('['); p.add(G, -1); p.move(G, G - BS); p.to(G - BS); raw(']'); p.ptr = G;
      p.copy(ID, P0, T).copy(CLS, P1, T);
      p.to(M); raw('['); p.move(P0, P0 + BS); p.move(P1, P1 + BS); p.to(M + BS); raw(']'); p.ptr = M;
      // Keep it if the byte has a token and there is room.
      p.copy(LIM, t, t2);
      p.loop(t, () => {
        p.clear(t);
        p.loop(P0, () => {
          p.add(LIM, -1);
          p.move(P0, w.s1); p.move(P1, w.s2);
          // carry both to the first empty work record
          p.to(w.ID); raw('['); p.move(w.s1, w.s1 + S); p.move(w.s2, w.s2 + S); p.to(w.ID + S); raw(']'); p.ptr = w.ID;
          p.move(w.s1, w.ID); p.move(w.s2, w.RK);
          hop(-1); home();
        });
      });
      p.clear(P0).clear(P1);
      // Next byte: go on unless it is 0 or 10.
      p.read(t);
      p.loop(t, () => {
        p.add(t, -10);
        p.loop(t, () => { p.add(t, 10); p.move(t, CH); p.add(GO, 1); });
      });
    });
    p.clear(LIM);
  }

  // ---- 3. mark the word starts ----
  {
    const GL = w.s0, GO = w.s1, PW = w.s2, T = w.s3, F = w.s4;
    const nGL = GL + S, nGO = GO + S, nPW = PW + S;
    const a1 = w.s3 + S, b1 = w.s4 + S, c2 = w.s3 + 2 * S, d2 = w.s4 + 2 * S;     // scratch in the next two records
    const x0 = w.s0 + 2 * S, x1 = w.s1 + 2 * S, x2 = w.s2 + 2 * S;
    const next1 = w.RK + S, next2 = w.RK + 2 * S;                                  // classes of the next two characters
    const clearFlags = () => { p.clear(GL).clear(GO).clear(PW); };
    const letter = () => { p.move(GL, w.CO); p.clear(GO).clear(PW); p.add(nGL, 1); };
    const other = () => { p.move(GO, w.CO); p.clear(GL).clear(PW); p.add(nGO, 1); };
    const white = (isSpace) => () => {
      p.copy(next1, a1, b1);
      switchOn(p, a1, b1, [[CLASS.SP, nop], [CLASS.WS, nop], [CLASS.D, nop], [0, nop]], c2, { otherwise: () => p.add(d2, 1) });
      p.loop(d2, () => { p.add(d2, -1); p.clear(PW); });
      p.move(PW, w.CO); p.clear(GL).clear(GO);
      p.add(nPW, 1);
      if (isSpace) p.add(nGL, 1).add(nGO, 1);
    };
    const apos = () => {
      p.add(d2, 1);
      p.loop(GO, () => { p.add(GO, -1); p.add(w.CO, 1); p.add(d2, -1); });
      p.clear(GL).clear(PW); p.add(nGO, 1);
      p.loop(d2, () => {
        p.add(d2, -1);
        const two = (second, add1, add2) => () => {          // only if the letter after it is `second`
          p.copy(next2, x0, x1); p.add(x0, -second); p.add(x2, 1);
          p.loop(x0, () => { p.clear(x0); p.add(x2, -1); });
          p.loop(x2, () => { p.add(x2, -1); p.add(next1, add1); p.add(next2, add2); });
        };
        p.copy(next1, a1, b1);
        switchOn(p, a1, b1, [
          [CLASS.L1, () => p.add(next1, CLASS.X - CLASS.L1)],
          [CLASS.LRV, two(CLASS.LE, CLASS.X - CLASS.LRV, CLASS.X - CLASS.LE)],
          [CLASS.LL, two(CLASS.LL, CLASS.X - CLASS.LL, CLASS.X - CLASS.LL)],
        ], c2);
      });
    };
    p.to(w.ID); raw('[');
    p.move(w.RK, T);
    switchOn(p, T, F, [
      [CLASS.L, letter], [CLASS.SP, white(true)], [CLASS.LE, letter], [CLASS.L1, letter], [CLASS.LRV, letter], [CLASS.LL, letter],
      [CLASS.O, other], [CLASS.D, clearFlags], [CLASS.APOS, apos],
      [CLASS.X, () => { p.add(w.CO, 1); clearFlags(); }],
      [CLASS.CB, () => { p.add(w.CO, 1); p.move(GL, nGL); p.move(GO, nGO); p.move(PW, nPW); }],
      [CLASS.WS, white(false)],
    ], c2, { otherwise: clearFlags });
    hop(1);
    p.to(w.ID); raw(']');
    clearFlags();
    hop(-1); home();
  }

  // ---- 4. merge the word at the front, hand it over, repeat ----
  const BEST = w.s0, A = w.s1, Bv = w.s2, P = w.s3;

  const lookupHere = () => {
    p.copy(w.ID, A, w.s4); p.copy(w.ID + S, Bv, w.s4);
    hop(-1);
    p.to(w.ID); raw('['); p.add(P, 1); p.move(A + S, A); p.move(Bv + S, Bv); hop(-1); p.to(w.ID); raw(']');
    p.ptr = SENT;
    emitPairLookup(p, L);
    p.to(P); raw('['); p.add(P, -1); p.move(A, A + S); p.to(P + S); raw(']'); p.ptr = P;
    p.move(A, w.RK);
  };

  const merge = () => {
    // X = RK - BEST; BEST moves on to the next record at the same time.
    const calc = () => { p.copy(w.RK, w.s1, w.s4); p.scatter(BEST, [[w.s1, -1], [BEST + S, 1]]); };
    calc();
    p.to(w.s1); raw('['); p.clear(w.s1); hop(1); calc(); p.to(w.s1); raw(']');
    p.clear(w.ID); p.move(BEST + S, w.ID);                  // this record becomes the merged token
    p.clear(w.RK); p.clear(w.RK - S);                       // its pairs with both neighbours are unknown again
    p.clear(w.ID + S).clear(w.CO + S).clear(w.RK + S);      // the next record disappears ...
    p.to(w.ID + 2 * S); raw('[');                           // ... and the ones behind it move up
    for (const f of [0, 1, 2]) p.move(w.ID + 2 * S + f, w.ID + S + f);
    p.to(w.ID + 3 * S); raw(']'); p.ptr = w.ID + 2 * S;
    home();                                                 // (starts two records back: that is the last record now)
  };

  // Move the tokens of the front word to the output.
  const popWord = () => {
    p.add(w.s1, 1);
    p.loop(w.s1, () => {
      p.add(w.s1, -1);
      p.move(w.ID, o.C);
      appendOut();
      p.clear(w.CO).clear(w.RK);
      p.to(w.ID + S); raw('[');
      for (const f of [0, 1, 2]) p.move(w.ID + S + f, w.ID + f);
      p.to(w.ID + 2 * S); raw(']'); p.ptr = w.ID + S;
      hop(-1); home();
      p.copy(w.CO, w.s1, w.s4);                             // the new front record continues the word: once more
    });
  };

  p.loop(w.ID, () => {
    p.addBig(BEST, NONE, [w.s1, w.s2]);
    p.to(w.CO + S); raw('[');
    {
      p.copy(w.RK, w.s1, w.s2); p.add(w.s4, 1);
      p.loop(w.s1, () => { p.clear(w.s1); p.add(w.s4, -1); });
      p.loop(w.s4, () => { p.add(w.s4, -1); lookupHere(); });
      // if (RK < BEST) BEST = RK.  GE = bit 16 of (65536 + RK - BEST) = (RK >= BEST)
      const X = w.s1, GE = w.s2, F = w.s3, tmp = w.s4;
      const sc = [...range(5, (i) => w.s0 + S + i), ...range(5, (i) => w.s0 + 2 * S + i)];   // scratch of the next two records
      p.copy(w.RK, X, tmp);
      p.scatter(BEST, [[X, -1], [tmp, 1]]); p.move(tmp, BEST);
      p.pow2(X, 16, [GE, F]);
      p.requantCore(X, [{ cell: GE, bits: 1 }], 16, 1, false, sc);
      p.add(F, 1);
      p.loop(GE, () => { p.add(GE, -1); p.add(F, -1); });
      p.loop(F, () => { p.add(F, -1); p.clear(BEST); p.copy(w.RK, BEST, tmp); });
      p.move(BEST, BEST + S);
      hop(1);
    }
    p.to(w.CO + S); raw(']');
    // Carry BEST back to record 0.
    hop(-1);
    p.to(w.ID); raw('['); p.move(BEST + S, BEST); hop(-1); p.to(w.ID); raw(']');
    p.ptr = SENT;
    // Something merges (BEST != NONE)? Then merge, else the word is done.
    p.copy(BEST, w.s2, w.s4); p.addBig(w.s2, -NONE, [w.s1, w.s4]); p.add(w.s3, 1);
    p.loop(w.s2, () => { p.clear(w.s2); p.add(w.s3, -1); merge(); });
    p.loop(w.s3, () => { p.add(w.s3, -1); p.clear(BEST); popWord(); });
  });

  // ---- 5. the suffix, and the count ----
  for (let j = 0; j < L.maxSuf; j++) { p.copy(L.SUF + 2 * j, o.C, L.SUF + 2 * j + 1); appendOut(); }
  // A counter runs to the end of the output and comes back.
  p.to(o.ID); raw('['); p.move(o.C, o.C + 2); p.add(o.C + 2, 1); p.to(o.ID + 2); raw(']'); p.ptr = o.ID;
  p.move(o.C, o.C - 2);
  p.to(o.ID - 2); p.ptr = o.ID;               // (rename: the element under the pointer)
  raw('['); p.move(o.C, o.C - 2); p.to(o.ID - 2); raw(']');
  p.ptr = L.OUTG;
}

function emitPopId(p, L, dst) {
  const raw = (s) => p.code.push(s), ID = L.OUT;
  p.move(ID, dst);
  p.to(ID + 2); raw('['); p.move(ID + 2, ID); p.to(ID + 4); raw(']'); p.ptr = ID + 2;
  p.to(ID - 2); raw('[<<]'); p.ptr = L.OUTG;
}

// ---- PRINT ------------------------------------------------------------------------

function emitPrint(p, L, idCell, tmp) {
  const raw = (s) => p.code.push(s);
  const tw = walker(p, L), c = tw.c, hs = range(10, (i) => L.HS + i), t = L.topBits;
  const IDX = c.c5;
  p.copy(idCell, IDX, tmp);
  p.add(IDX, 1);                              // IDX = record number + 1 (0 ends the loop)
  p.loop(IDX, () => {
    p.add(IDX, -1);
    p.requantCore(IDX, [{ cell: c.R, bits: t }, { cell: c.G, bits: L.hashBits - t }], 0, L.hashBits, false, hs);
    p.add(c.G, 1);                            // table indices start at U
    tw.out([]);
    // The text: cells hold byte + 1 and end with a 0. Print, run back to Z.
    p.to(c.S1); raw('[-.+>]<[<]'); p.ptr = c.Z;
    p.copy(c.LINK, c.G, c.c4);                // 0, or 1 + the number of the record with the rest of the text
    tw.back();
    p.move(c.G, IDX);
  });
}

module.exports = { DEFAULTS, CLASS, layout, emitLoad, emitEncode, emitPrint, emitPopId };
