'use strict';

// Text front and back end for the Qwen2.5 chat models: tokenizer, chat template and printing.
// compiler/qwen3.5/tokenizer/gen.js uses it with other options (a table of 2^19 slots).

const { switchOn } = require('../../core/switch');

const DEFAULTS = {
  maxChars: 200,            // longest question in bytes; the rest of a longer line is read and dropped
  eol: 10,
  lead: 10,                 // the byte the template puts before the question (null: none; the question then starts the text)
  hiBits: 7, midBits: 6, loBits: 5,   // record number = (hi, mid, lo); together slotBits bits
  slotBits: 18,             // records of the table
  mult: [251, 239],         // hash of the pair (a, b) = ((a + 1) * 251 + (b + 1) * 239) mod 2^slotBits
  maxPre: 24,               // room for the template tokens before the question
  maxSuf: 8,                // ... and after it
  subTables: 192,           // room for the class tables of multi-byte characters (64 entries each)
  stackCap: 16,             // PRINT's stack (pack.js checks the deepest token against it)
  subBytes: 1,              // bytes of a class table number in the stream
};

const ID_BITS = 18;                    // token ids (and the keys of the merge table)
const NONE = (1 << ID_BITS) - 1;       // "this pair does not merge": larger than every token id
// flags of the stream (pack.js); S_BYTE and S_PAIR sit right above the 18 bits of a record number (Qwen3.5 has its own)
const S_BYTE = 1 << 18, S_PAIR = 1 << 19, C2_FAKE = 1 << 18, C2_VALID = 1 << 23;

const CLASS = { L: 1, O: 2, D: 3, SP: 4, WS: 5, NL: 6, APOS: 7, L1: 8, LRV: 9, LE: 10, LL: 11, CB: 12, X: 13, NLI: 14, SPL: 15, WSL: 16 };

const range = (n, f = (i) => i) => Array.from({ length: n }, (_, i) => f(i));

// ---- tape layout -----------------------------------------------------------------

const S = 10;             // work record: ID, CO, RK and seven scratch cells
const BS = 8;             // byte table record: ID, CLS, SUB and G, P0, P1, P2, T (scratch)
const HD = 8;             // block header
const RC = 3;             // cells of a table record

function layout(base = 0, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  if (o.hiBits + o.midBits + o.loBits !== o.slotBits) throw new Error(`hiBits + midBits + loBits must be ${o.slotBits}`);
  if (o.midBits + o.loBits < 8) throw new Error('midBits + loBits must be at least 8');
  if (o.eol < 0 || o.eol > 255 || o.maxChars < 1) throw new Error('bad eol or maxChars');
  const U = 1 << o.loBits, BSZ = HD + RC * U, SB = BSZ << o.midBits;
  if (BSZ < HD + 6 + 20) throw new Error('loBits too small for the home cells');
  const blocks = (1 << (o.hiBits + o.midBits)) + 1;          // one spare, always empty: every probe ends there at the latest
  const byteRecs = 256 + 64 * o.subTables;
  const outCap = o.maxPre + o.maxChars + 1 + o.maxSuf;
  let at = base;
  const take = (n) => { const x = at; at += n; return x; };
  take(BS);                                                  // where the loader's pointer ends up
  take((byteRecs - 1) * BS);
  const BH = take(BS), RD = take(16);
  take(2);
  const PRE = take(2 * (o.maxPre + 1)), SUF = take(2 * (o.maxSuf + 1) + 2);
  const OUTG = take(3), OUT = take(3 * (outCap + 2));
  const WSENT = take(S), WORK = take(S * (o.maxChars + 1 + 4));
  take(2);
  const STK = take(o.stackCap + 2);
  const HS = take(24);                                       // (right next to the table's home: they work together)
  const T0 = take(BSZ);
  const end = T0 + (blocks + 4) * BSZ;                       // three more headers' worth of zero cells: scratch of the last blocks
  const PR = T0 + HD;                                        // PRINT's six cells
  return {
    ...o, base, size: end - base, tapeSize: end,
    U, BSZ, SB, blocks, byteRecs, outCap, BH, RD, PRE, SUF, OUTG, OUT, STK, HS, WSENT, WORK, T0, PR,
    slots: 1 << o.slotBits,
    pairA: WORK + 4, pairB: WORK + 5,       // hand-in cells of emitPairLookup: a + 1 and b + 1
    count: OUTG + 2,                        // number of tokens in the output after emitEncode
    // cells that hold data after emitLoad: every other cell is 0 between calls
    isData: (addr) => (addr >= base && addr < BH) || (addr >= PRE && addr < OUTG) || addr >= T0 + BSZ,
  };
}

function bitField(p, X, dst, k, n, hs, d) {
  const outs = [];
  for (let i = 0; 6 * i < n; i++) outs.push({ cell: d[i], bits: Math.min(6, n - 6 * i) });
  if (outs.length > 3) throw new Error('bitField: at most 18 bits');
  p.requantCore(X, outs, k, n, false, hs);
  outs.forEach((o, i) => { if (i) p.shl(o.cell, dst, 6 * i, [d[3], d[4]]); else p.move(o.cell, dst); });
}

// ---- the table walk (shared by encode and print) ----------------------------------

function tableCells(L) {
  const T0 = L.T0;
  return { LANE: T0, G: T0 + 1, M: T0 + 2, RO: T0 + 3, R: T0 + 4, QA: T0 + 5, QB: T0 + 6, E: T0 + 7 };
}

function walker(p, L) {
  const c = tableCells(L), { BSZ, SB, U } = L, raw = (s) => p.code.push(s);
  const recAt = (r, f) => c.LANE + HD + RC * r + f;
  return {
    c,
    // The three numbers of a record index, low slotBits bits of X (X ends as 0), into R, M, G.
    split(X, hs, more = []) {
      const outs = [{ cell: c.R, bits: L.loBits }, { cell: c.M, bits: L.midBits }, { cell: c.G, bits: L.hiBits }, ...more];
      p.requantCore(X, outs, 0, outs.reduce((n, x) => n + x.bits, 0), false, hs);
    },
    out(carry) {
      p.to(c.G); raw('['); p.add(c.G, -1);
      for (const x of [c.G, c.M, c.R, ...carry]) p.move(x, x + SB);
      p.to(c.G + SB); raw(']'); p.ptr = c.G;
      p.to(c.M); raw('['); p.add(c.M, -1); p.add(c.RO, 1);
      for (const x of [c.M, c.RO, c.R, ...carry]) p.move(x, x + BSZ);
      p.to(c.M + BSZ); raw(']'); p.ptr = c.M;
    },
    fetch(fields, t, F, tmp) {
      p.copy(c.R, t, tmp);
      switchOn(p, t, F, range(U, (r) => [r, () => { for (const [f, dst] of fields) p.copy(recAt(r, f), dst, tmp); }]), tmp);
    },
    // Back home, taking the cells in `carry` along.
    back(carry) {
      p.to(c.RO); raw('['); p.add(c.RO, -1);
      for (const x of [c.RO, ...carry]) p.move(x, x - BSZ);
      p.to(c.RO - BSZ); raw(']'); p.ptr = c.RO;
      p.to(c.LANE); raw('['); for (const x of carry) p.move(x, x - SB); p.to(c.LANE - SB); raw(']'); p.ptr = c.LANE;
    },
  };
}

// ---- LOAD -------------------------------------------------------------------------

function emitLoad(p, L) {
  const { U, BSZ } = L, raw = (s) => p.code.push(s);

  // cell = the next n bytes read as one number, high byte first. t: a zero cell.
  const readN = (cell, n, t) => {
    let cur = n % 2 ? cell : t, other = n % 2 ? t : cell;
    p.read(cur);
    for (let i = 1; i < n; i++) { p.scatter(cur, [[other, 256]]); p.read(cur); p.move(cur, other); [cur, other] = [other, cur]; }
  };

  const readList = (addr, n) => {
    const C = addr + 2;
    p.addConst(C, n, addr + 1);
    p.to(C); raw('['); p.add(C, -1);
    readN(addr, 3, addr + 1);
    p.move(C, C + 2);
    p.to(C + 2); raw(']');
    p.ptr = C + 2 * n;
  };
  if (p.ptr < L.BH - 4096) {
    const G = L.base + 3;
    p.addBig(G, L.byteRecs, [G + 1, G + 2]);
    p.to(G); raw('['); p.add(G, -1); p.move(G, G + BS); p.to(G + BS); raw(']');
    p.ptr = L.BH + 3;
  }
  readList(L.PRE, L.maxPre);
  readList(L.SUF, L.maxSuf);

  // Byte table: records 1, 2, ..., each one record further left.
  {
    // G counts the records to go, BK the records done (for the way back).
    const B = L.BH - BS, ID = B, CLS = B + 1, SUB = B + 2, G = B + 3, BK = B + 4, T = B + 7;
    p.addBig(G, L.byteRecs - 1, [T, B + 6]);
    p.to(G); raw('['); p.add(G, -1);
    readN(ID, 2, T); p.read(CLS); readN(SUB, L.subBytes, T);
    p.add(BK, 1); p.move(BK, BK - BS);
    p.move(G, G - BS);
    p.to(G - BS); raw(']'); p.ptr = G;
    p.to(BK); raw('['); p.add(BK, -1); p.move(BK, BK + BS); p.to(BK + BS); raw(']'); p.ptr = BK;   // (in the frame of the first record again)
  }

  {
    const c = tableCells(L), f = (x) => x + BSZ;            // the frame of block 0
    const NB = f(c.RO), BK = f(c.R), r0 = f(c.LANE) + HD;   // r0: record 0 of the block
    p.addBig(NB, L.blocks, [f(c.QA), f(c.QB)]);
    p.to(NB); raw('['); p.add(NB, -1);
    p.read(f(c.LANE));
    p.addConst(r0 + RC, U, r0 + RC + 1);
    p.to(r0 + RC); raw('['); p.add(r0 + RC, -1);
    readN(r0, 4, r0 + 1); readN(r0 + 1, 3, r0 + 2); readN(r0 + 2, 3, r0 + RC + 1);
    p.move(r0 + RC, r0 + 2 * RC);
    p.to(r0 + 2 * RC); raw(']');
    p.ptr = r0 + RC + RC * U;                               // (= LANE of the next header)
    p.add(BK, 1);
    p.move(NB, NB + BSZ); p.move(BK, BK + BSZ);
    p.to(NB + BSZ); raw(']'); p.ptr = NB;
    // The pointer is in the header after the last block: BK blocks back.
    p.to(BK); raw('['); p.add(BK, -1); p.move(BK, BK - BSZ); p.to(BK - BSZ); raw(']'); p.ptr = BK;
    p.to(c.LANE);
  }
  return p;
}

// ---- the merge table -----------------------------------------------------------------

function emitPairLookup(p, L) {
  const { BSZ, U } = L, raw = (s) => p.code.push(s);
  const tw = walker(p, L), c = tw.c, hs = range(10, (i) => L.HS + i);
  const [X, VH, FOUND, NF, h0, h1, V, ...d] = range(12, (i) => L.HS + 10 + i);
  // the keys travel in QA, QB; X = their hash, whose low slotBits bits are the slot
  p.scatter(L.pairA, [[c.QA, 1], [X, L.mult[0]]]);
  p.scatter(L.pairB, [[c.QB, 1], [X, L.mult[1]]]);
  tw.split(X, hs);
  p.add(c.M, 1);
  tw.out([c.QA, c.QB]);

  // At the block. Scratch: the headers of the next two blocks (not their LANE).
  const T = (i) => c.LANE + BSZ + i, TT = (i) => c.LANE + 2 * BSZ + i;
  const GO = T(1), t = T(2), F = T(3), X1 = T(4), X2 = T(5), tmp = T(6), EMP = T(7);
  const Z = TT(1), g0 = TT(2), g1 = TT(3), K1 = TT(4), K2 = TT(5), MIS = TT(6), HIT = TT(7), FND = c.E;
  p.add(GO, 1);
  p.loop(GO, () => {
    p.add(GO, -1);
    tw.fetch([[0, X1], [1, X2]], t, F, tmp);
    p.add(EMP, 1);
    p.loop(X2, () => {                                       // the slot is in use (runs once: X2 is used up)
      p.add(EMP, -1);
      p.scatter(c.QA, [[X1, -1], [tmp, 1]]); p.move(tmp, c.QA);
      p.shl(X1, Z, 32 - ID_BITS, [g0, g1], 1, K1);
      p.loop(Z, () => { p.clear(Z); p.add(MIS, 1); });
      // the same for b, with one bit more: a "fake" slot never matches
      p.scatter(c.QB, [[X2, -1], [tmp, 1]]); p.move(tmp, c.QB);
      p.shl(X2, Z, 31 - ID_BITS, [g0, g1], 1, K2);
      p.loop(Z, () => { p.clear(Z); p.clear(MIS); p.add(MIS, 1); });
      p.add(HIT, 1);
    });
    p.clear(EMP);                                            // an empty slot: nothing found, nothing more to do
    p.loop(HIT, () => {
      p.add(HIT, -1); p.add(FND, 1);
      p.loop(MIS, () => {                                    // other keys: the next slot
        p.add(MIS, -1); p.add(FND, -1); p.clear(K1); p.clear(K2);
        p.add(c.R, 1);
        p.copy(c.R, t, tmp); p.addConst(t, -U, tmp); p.add(F, 1);
        p.loop(t, () => { p.clear(t); p.add(F, -1); });
        p.loop(F, () => {                                    // it is in the next block: move the bundle there
          p.add(F, -1); p.clear(c.R);
          p.add(c.RO, 1);
          for (const x of [c.RO, c.QA, c.QB]) p.move(x, x + BSZ);
          p.to(F); raw('>'.repeat(BSZ));                     // (every address now means the next block)
        });
        p.add(GO, 1);
      });
      p.loop(FND, () => { p.add(FND, -1); p.move(K1, c.G); p.move(K2, c.M); });
    });
  });
  p.clear(c.QA); p.clear(c.QB); p.clear(c.R);
  tw.back([c.G, c.M]);
  // Home. G = 2^18 * (v mod 2^14), M = 2^19 * (v >> 14) + 2^23, or both 0.
  p.loop(c.M, () => { p.requantCore(c.M, [{ cell: VH, bits: 4 }, { cell: FOUND, bits: 1 }], 19, 5, false, hs); });
  p.add(NF, 1);
  p.loop(FOUND, () => {
    p.add(FOUND, -1); p.add(NF, -1);
    bitField(p, c.G, V, 18, 14, hs, d);
    p.shl(VH, V, 14, [h0, h1]);
  });
  p.loop(NF, () => { p.add(NF, -1); p.addBig(V, NONE, [h0, h1]); });
  p.move(V, L.pairA);
  return p;
}

// ---- ENCODE -----------------------------------------------------------------------

function emitEncode(p, L) {
  const raw = (s) => p.code.push(s);

  const R0 = L.WORK, SENT = L.WSENT;
  const w = { ID: R0, CO: R0 + 1, RK: R0 + 2, s0: R0 + 3, s1: R0 + 4, s2: R0 + 5, s3: R0 + 6, s4: R0 + 7, s5: R0 + 8, s6: R0 + 9 };
  const hop = (n) => { p.to(w.ID); raw((n > 0 ? '>' : '<').repeat(Math.abs(n) * S)); };
  // From a record (or from the empty one in front) left to the empty record.
  const home = () => { p.to(w.ID); raw('[' + '<'.repeat(S) + ']'); p.ptr = SENT; };

  // Output: element = [M, ID, C]. C of element 0 is where a new id + 1 is handed in.
  const o = { M: L.OUT, ID: L.OUT + 1, C: L.OUT + 2 };
  const appendOut = () => {
    p.to(o.M); raw('['); p.move(o.C, o.C + 3); p.to(o.M + 3); raw(']'); p.ptr = o.M;
    p.loop(o.C, () => { p.add(o.M, 1); p.add(o.C, -1); p.move(o.C, o.ID); });
    p.to(o.M - 3); raw('[<<<]'); p.ptr = L.OUTG;
  };

  // ---- 1. empty the output, copy the prefix ----
  p.clear(L.count);
  p.to(o.M); raw('[>>>]<<<[[-]>[-]<<<<]'); p.ptr = L.OUTG;
  for (let j = 0; j < L.maxPre; j++) { p.copy(L.PRE + 2 * j, o.C, L.PRE + 2 * j + 1); appendOut(); }

  // ---- 2. read the question into the work array ----
  {
    const B = L.BH, bt = { ID: B, CLS: B + 1, SUB: B + 2, G: B + 3, P0: B + 4, P1: B + 5, P2: B + 6, T: B + 7 };
    const [t, t2, LIM, CH, GO, PEND, DEP, V0, V1, V2, a, ISCB, PD, FIN] = range(14, (i) => L.RD + i);
    const lookup = () => {
      p.to(bt.G); raw('['); p.add(bt.G, -1); p.move(bt.G, bt.G - BS); p.to(bt.G - BS); raw(']'); p.ptr = bt.G;
      p.copy(bt.ID, bt.P0, bt.T).copy(bt.CLS, bt.P1, bt.T).copy(bt.SUB, bt.P2, bt.T);
      p.to(bt.CLS); raw('[');
      for (const x of [bt.P0, bt.P1, bt.P2]) p.move(x, x + BS);
      p.to(bt.CLS + BS); raw(']'); p.ptr = bt.CLS;
    };
    const patch = () => {
      p.move(bt.P1, w.s1); p.add(DEP, -1); p.move(DEP, w.s2);
      p.to(w.ID); raw('['); p.move(w.s1, w.s1 + S); p.move(w.s2, w.s2 + S); p.to(w.ID + S); raw(']'); p.ptr = w.ID;
      p.move(w.s1, w.s1 - S); p.move(w.s2, w.s2 - S); hop(-1);
      p.to(w.s2); raw('['); p.add(w.s2, -1); p.move(w.s2, w.s2 - S); p.move(w.s1, w.s1 - S); p.to(w.s2 - S); raw(']'); p.ptr = w.s2;
      p.clear(w.RK); p.move(w.s1, w.RK);
      home();
    };
    const next = () => {                      // the next byte: go on unless it is 0 or the end-of-line byte
      p.read(t);
      p.loop(t, () => {
        p.add(t, -L.eol);
        p.loop(t, () => { p.add(t, L.eol); p.move(t, CH); p.add(GO, 1); });
      });
    };
    if (L.lead === null) next(); else p.add(CH, L.lead).add(GO, 1);     // the newline that the template puts before the question
    p.addConst(LIM, L.maxChars + 1, t);
    p.loop(GO, () => {
      p.add(GO, -1);
      p.copy(CH, bt.G, t);
      lookup();
      p.move(bt.P0, V0); p.move(bt.P1, V1); p.move(bt.P2, V2);
      p.copy(LIM, t, t2);
      p.loop(t, () => {                       // there is room for this byte
        p.clear(t);
        p.copy(V1, a, t2); p.add(a, -CLASS.CB); p.add(ISCB, 1);
        p.loop(a, () => { p.clear(a); p.add(ISCB, -1); p.clear(DEP); });
        p.move(PEND, PD);
        p.loop(PD, () => {
          p.loop(ISCB, () => {                // a later byte, as expected: entry 256 + 64 * (PD - 1) + (byte - 128)
            p.add(ISCB, -1);
            p.copy(CH, bt.G, t2); p.addConst(bt.G, 64, t2); p.scatter(PD, [[bt.G, 64]]);
            lookup();
            p.clear(bt.P0);
            p.add(FIN, 1);
            p.loop(bt.P2, () => { p.move(bt.P2, PEND); p.add(FIN, -1); p.clear(bt.P1); p.add(DEP, 1); });   // one more table
            p.loop(FIN, () => { p.add(FIN, -1); patch(); });
          });
          p.clear(PD);
        });
        p.clear(ISCB);
        p.loop(V2, () => { p.move(V2, PEND); p.add(DEP, 1); });   // a first byte whose class depends on the next
        p.loop(V0, () => {                    // store it: carry both to the first empty work record
          p.add(LIM, -1);
          p.move(V0, w.s1); p.move(V1, w.s2);
          p.to(w.ID); raw('['); p.move(w.s1, w.s1 + S); p.move(w.s2, w.s2 + S); p.to(w.ID + S); raw(']'); p.ptr = w.ID;
          p.move(w.s1, w.ID); p.move(w.s2, w.RK);
          hop(-1); home();
        });
      });
      p.clear(V0).clear(V1).clear(V2).clear(CH);
      next();
    });
    p.clear(LIM).clear(PEND).clear(DEP);
  }

  // ---- 3a. white space, right to left ----
  {
    const CL = w.s0, RN = w.s1, T = w.s2, F = w.s3, tmp = w.s4;
    const lastBefore = (from, to) => () => { p.move(CL, CL - S); p.loop(RN, () => { p.add(RN, -1); p.add(w.RK, to - from); }); };
    p.to(w.ID); raw('[' + '>'.repeat(S) + ']'); hop(-1);
    p.to(w.ID); raw('[');
    p.copy(w.RK, T, tmp);
    switchOn(p, T, F, [
      [CLASS.SP, lastBefore(CLASS.SP, CLASS.SPL)],
      [CLASS.CB, () => { p.move(CL, CL - S); p.move(RN, RN - S); }],
      [CLASS.NL, () => { p.loop(CL, () => { p.add(CL, -1); p.add(w.RK, CLASS.NLI - CLASS.NL); }); p.clear(RN); p.add(CL - S, 1); }],
      [CLASS.WS, lastBefore(CLASS.WS, CLASS.WSL)],
    ], tmp, { otherwise: () => { p.clear(CL); p.clear(RN); p.add(RN - S, 1); } });
    hop(-1);
    p.to(w.ID); raw(']');
    p.ptr = SENT;
    p.clear(SENT + 3).clear(SENT + 4);
  }

  // ---- 3b. mark the word starts, left to right ----
  {
    const GL = w.s0, GO = w.s1, PW = w.s2, AB = w.s3, T = w.s4, F = w.s5, D = w.s6;
    const nGL = GL + S, nGO = GO + S, nPW = PW + S, nAB = AB + S;
    const a1 = w.s4 + S, b1 = w.s5 + S, c2 = w.s4 + 2 * S;                        // scratch in the next two records
    const x0 = w.s0 + 2 * S, x1 = w.s1 + 2 * S, x2 = w.s2 + 2 * S;
    const next1 = w.RK + S, next2 = w.RK + 2 * S;                                  // classes of the next two characters
    const clearFlags = () => { p.clear(GL).clear(GO).clear(PW).clear(AB); };
    const letter = () => { p.move(GL, w.CO); p.clear(GO).clear(PW).clear(AB); p.add(nGL, 1); };
    const other = (starts) => () => {
      p.add(D, 1);
      p.loop(GO, () => { p.add(GO, -1); p.add(w.CO, 1); p.add(D, -1); });
      p.clear(GL).clear(PW).clear(AB); p.add(nGO, 1).add(nAB, 1);
      p.loop(D, () => { p.add(D, -1); p.add(nGL, 1); starts(); });                 // one such character joins the letters after it
    };
    const apostrophe = () => {
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
    };
    // White space that is not the last before something else.
    const white = () => { p.move(PW, w.CO); p.add(nPW, 1); p.clear(GL).clear(GO).clear(AB); };
    // CR/LF; `more`: another one follows later in this run of white space.
    const newline = (more) => () => {
      p.loop(AB, () => { p.add(AB, -1); p.add(w.CO, 1); p.clear(PW); if (more) p.add(nAB, 1).add(nPW, -1); });
      p.move(PW, w.CO); if (more) p.add(nPW, 1);
      p.clear(GL).clear(GO);
    };
    p.to(w.ID); raw('[');
    p.move(w.RK, T);
    switchOn(p, T, F, [
      [CLASS.L, letter], [CLASS.SPL, () => { clearFlags(); p.add(nGL, 1).add(nGO, 1); }],
      [CLASS.LE, letter], [CLASS.L1, letter], [CLASS.LRV, letter], [CLASS.LL, letter],
      [CLASS.O, other(() => {})], [CLASS.D, clearFlags], [CLASS.APOS, other(apostrophe)],
      [CLASS.X, () => { p.add(w.CO, 1); clearFlags(); }],
      [CLASS.CB, () => { p.add(w.CO, 1); p.move(GL, nGL); p.move(GO, nGO); p.move(PW, nPW); p.move(AB, nAB); }],
      [CLASS.SP, white], [CLASS.WS, white],
      [CLASS.NL, newline(false)], [CLASS.NLI, newline(true)],
      [CLASS.WSL, () => { clearFlags(); p.add(nGL, 1); }],
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
    p.clear(w.ID); p.move(BEST + S, w.ID); p.add(w.ID, 1);  // this record becomes the merged token
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
      // if (RK < BEST) BEST = RK.  GE = bit 18 of (2^18 + RK - BEST) = (RK >= BEST)
      const X = w.s1, GE = w.s2, F = w.s3, tmp = w.s4;
      const sc = [...range(5, (i) => w.s0 + S + i), ...range(5, (i) => w.s0 + 2 * S + i)];   // scratch of the next two records
      p.copy(w.RK, X, tmp);
      p.scatter(BEST, [[X, -1], [tmp, 1]]); p.move(tmp, BEST);
      p.pow2(X, ID_BITS, [GE, F]);
      p.requantCore(X, [{ cell: GE, bits: 1 }], ID_BITS, 1, false, sc);
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
  p.to(o.M); raw('['); p.move(o.C, o.C + 3); p.add(o.C + 3, 1); p.to(o.M + 3); raw(']'); p.ptr = o.M;
  p.move(o.C, o.C - 3);
  p.to(o.M - 3); p.ptr = o.M;                 // (rename: the element under the pointer)
  raw('['); p.move(o.C, o.C - 3); p.to(o.M - 3); raw(']');
  p.ptr = L.OUTG;
  return p;
}

function emitPopId(p, L, dst) {
  const raw = (s) => p.code.push(s), M = L.OUT, ID = L.OUT + 1;
  p.move(ID, dst); p.clear(M);
  p.to(M + 3); raw('['); p.move(M + 3, M); p.move(ID + 3, ID); p.to(M + 6); raw(']'); p.ptr = M + 3;
  p.to(M - 3); raw('[<<<]'); p.ptr = L.OUTG;
  return p;
}

// ---- PRINT ------------------------------------------------------------------------

function emitPrint(p, L, idCell, { tmp }) {
  const raw = (s) => p.code.push(s);
  const tw = walker(p, L), c = tw.c, hs = range(10, (i) => L.HS + i), d = range(5, (i) => L.HS + 10 + i), { BSZ, U } = L;
  const [CUR, SV, ISB, ISP, F, PB] = range(6, (i) => L.PR + i);
  const T = (i) => c.LANE + BSZ + i;          // scratch at a block: the next header
  const STK = L.STK;                          // stack: one cell per entry, the top at STK, a zero cell before it
  p.copy(idCell, CUR, tmp);
  p.add(CUR, 1);                              // CUR = id + 1 (0 ends the loop)
  p.loop(CUR, () => {
    p.add(CUR, -1);
    tw.split(CUR, hs); p.add(c.M, 1);
    tw.out([]);
    tw.fetch([[2, c.G]], T(1), T(2), T(3));
    p.clear(c.R);
    tw.back([c.G]);
    // S: record number or byte in the low slotBits bits, then "is a byte", "is a pair"
    p.move(c.G, SV);
    tw.split(SV, hs, [{ cell: ISB, bits: 1 }, { cell: ISP, bits: 1 }]);
    p.add(F, 1);
    p.loop(ISP, () => {                       // a pair: read its slot, a is next, b waits on the stack
      p.add(ISP, -1); p.add(F, -1);
      p.add(c.M, 1);
      tw.out([]);
      tw.fetch([[0, c.G], [1, c.M]], T(1), T(2), T(3));
      p.clear(c.R);
      tw.back([c.G, c.M]);
      bitField(p, c.G, CUR, 0, ID_BITS, hs, d);         // a + 1
      bitField(p, c.M, PB, 0, ID_BITS, hs, d);          // b + 1
      // push: everything moves one cell up, from the far end
      p.to(STK); raw('[>]<'); p.ptr = STK;
      raw('['); p.move(STK, STK + 1); p.to(STK - 1); raw(']'); p.ptr = STK - 1;
      p.move(PB, STK);
    });
    p.loop(F, () => {                         // a byte or nothing: print, then take the next from the stack
      p.add(F, -1);
      p.loop(ISB, () => { p.add(ISB, -1); p.scatter(c.M, [[c.R, U]]); p.out(c.R); });
      p.clear(c.R).clear(c.M).clear(c.G);
      p.move(STK, CUR);
      p.to(STK + 1); raw('['); p.move(STK + 1, STK); p.to(STK + 2); raw(']'); p.ptr = STK + 1;
      p.to(STK - 1); raw('[<]'); p.ptr = STK - 1;
    });
  });
  p.to(L.T0);
  return p;
}

module.exports = {
  DEFAULTS, CLASS, ID_BITS, NONE, RC, S_BYTE, S_PAIR, C2_FAKE, C2_VALID,
  layout, emitLoad, emitEncode, emitPrint, emitPopId, emitPairLookup,
};
