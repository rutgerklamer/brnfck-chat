'use strict';

// Building blocks for training in brainfuck, on 32-bit wrapping cells: walks over regular blocks of
// cells, multiplication of two cells, shifts, table look-ups, random numbers and printing.

const { Patterns } = require('../../site/runtime/patterns');
const { switchOn } = require('../core/switch');

class Kernels extends Patterns {
  constructor() { super(32); }

  // ---- walks -------------------------------------------------------------------------------

  // Runs body (written for the first block) once per block of `stride` cells while the cell at `marker` is not zero;
  // dir -1 walks to lower addresses. `count`: how many blocks there are (for the pointer).
  walk(marker, stride, count, body, dir = 1) {
    this.to(marker).raw('[');
    body();
    this.to(marker).raw((dir > 0 ? '>' : '<').repeat(stride) + ']');
    this.ptr = marker + dir * count * stride;
    return this;
  }

  // ---- arithmetic --------------------------------------------------------------------------

  // cell += sign * 2^e
  addPow(cell, e, sign, [h0, h1]) {
    if (e <= this.L) return this.add(cell, sign * 2 ** e);
    this.add(h0, 1);
    return this.shl(h0, cell, e, [h1, h0], sign);
  }

  // acc += a * b for every [b, acc, tmp] of pairs; a is an nb-bit signed number. a is kept when
  // keepA (s[7] holds it meanwhile), b is kept through its own tmp. s: Za Zb T H0 H1 K Kt keep.
  mulAcc(a, nb, pairs, s, { keepA = true } = {}) {
    const [Za, Zb, T, H0, H1, K, Kt, keep] = s;
    this.shl(a, Za, this.B - nb, [H0, H1], 1, keepA ? keep : null);
    if (keepA) this.move(keep, a);
    this.peel(Za, {
      m: nb,
      onSet: (j) => {
        const sg = j === nb - 1 ? -1 : 1;
        for (const [b, acc, tmp] of pairs) {
          if (j <= this.L) this.scatter(b, [[acc, sg * 2 ** j], [tmp, 1]]);
          else this.shl(b, acc, j, [H0, H1], sg, tmp);
          this.move(tmp, b);
        }
      },
    }, { Zo: Zb, T, H: [H0, H1], K, Kt });
    return this;
  }

  // Y (0 before) = lo + (floor((X + addend) / 2^k) - lo, clamped to 0..2^n-1 or kept modulo 2^n); X ends 0.
  // Bits are peeled from the lowest on. s: X2 Za Zb T H0 H1 K Kt F tmp
  shift(X, Y, k, n, { lo = 0, addend = k ? 2 ** (k - 1) : 0, clamp = false } = {}, s) {
    const [X2, Za, Zb, T, H0, H1, K, Kt, F, tmp] = s, H = [H0, H1], sc = { T, H, K, Kt };
    const J = k + n - 1, s0 = this.B - 1 - J;
    if (s0 < (clamp ? 1 : 0)) throw new Error(`shift: k + n = ${k + n} too wide`);
    this.addBig(X, addend - lo * 2 ** k, H);
    const outBit = (i) => this.addPow(Y, i, 1, H);
    if (!clamp) {
      let z = X, zo = Za;
      if (s0 > 0) { this.shl(X, Za, s0, H); z = Za; zo = Zb; }
      this.peel(z, { m: J + 1, onSet: (j) => { if (j >= k) outBit(j - k); } }, { Zo: zo, ...sc });
      return this.addBig(Y, lo, H);
    }
    this.shl(X, Za, s0, H, 1, X2);
    this.peel(Za, { m: J + 1, onSet: (j) => (j < k ? this.addPow(X2, j, -1, H) : outBit(j - k)) }, { Zo: Zb, ...sc });
    this.shl(Y, X2, k, H, -1, tmp).move(tmp, Y);
    // X2 is now the part of X above bit J: not zero means out of range, below 0 or above the top
    this.loop(X2, () => {
      this.clear(Y);
      const r = this.peel(X2, { m: this.B, from: J + 1, to: this.B - 1 }, { Zo: Zb, ...sc });
      this.add(F, 1);
      this.loop(r, () => { this.clear(r).add(F, -1); });
      this.loop(F, () => { this.add(F, -1); this.addBig(Y, 2 ** n - 1, H); });
      this.to(X2);
    });
    return this.addBig(Y, lo, H);
  }

  // Every outs [y, table] gets y += table[x mod 2^n]; one tree of tests for all of them.
  // s: Za Zb T H0 H1 K Kt E tmp
  lookupAll(x, outs, s, { keepX = true, kStep = 4 } = {}) {
    const n = Math.log2(outs[0][1].length);
    if (!Number.isInteger(n) || n < 1) throw new Error('table length must be a power of two');
    const [Za, Zb, T, H0, H1, K, Kt, E, tmp] = s, H = [H0, H1];
    this.shl(x, Za, this.B - n, H, 1, keepX ? tmp : null);
    if (keepX) this.move(tmp, x);
    if (n > 1) this.pow2(K, this.B - n, H);
    let kEnd = K;
    const node = (j, idx, zc, zo, k, kt, kexp) => {
      if (j === n) {
        kEnd = k;
        for (const [y, table] of outs) { const v = table[idx]; if (Math.abs(v) < 24) this.add(y, v); else this.addBig(y, v, H); }
        return;
      }
      const e = this.B - n + j, last = j === n - 1, a = n - 1 - j;
      if (!last && e - kexp >= kStep) { this.scatter(k, [[kt, 2 ** (e - kexp)]]); [k, kt] = [kt, k]; kexp = e; }
      if (last) this.move(zc, T);
      else {
        if (a <= this.L) this.scatter(zc, [[zo, 1], [T, 2 ** a]]);
        else { this.scatter(zc, [[zo, 1], [H0, 2 ** this.L]]); this.shl(H0, T, a - this.L, [H1, H0]); }
        [zc, zo] = [zo, zc];
      }
      this.add(E, 1);
      this.loop(T, () => {
        this.clear(T).add(E, -1);
        if (!last) { this.scatter(k, [[zc, -(2 ** (e - kexp))], [kt, 1]]); this.move(kt, k); }
        node(j + 1, idx | (1 << j), zc, zo, k, kt, kexp);
      });
      this.loop(E, () => { this.add(E, -1); node(j + 1, idx, zc, zo, k, kt, kexp); });
    };
    node(0, 0, Za, Zb, K, Kt, this.B - n);
    if (n > 1) this.clear(kEnd);
    return this;
  }

  // Every outs [y, table] gets y += table[x], x in from..length-1: a switch on (x - from) / 64, then nested loops count
  // down the rest (cheap when the table changes in small steps). s: c tmp H0 H1 HI F and 10 cells for a shift
  chainAll(x, outs, from, s, { keepX = true } = {}) {
    const [c, tmp, H0, H1, HI, F, ...s10] = s, N = outs[0][1].length, G = 64;
    if (keepX) this.copy(x, c, tmp); else this.move(x, c);
    this.addBig(c, -from, [H0, H1]);
    this.copy(c, s10[0], tmp);
    this.shift(s10[0], HI, 6, 8, { addend: 0 }, s10.slice(1).concat(tmp));
    this.scatter(HI, [[c, -G], [tmp, 1]]).move(tmp, HI);
    const add = (y, d) => (Math.abs(d) < 24 ? this.add(y, d) : this.addBig(y, d, [H0, H1]));
    const cases = [];
    for (let b0 = from, h = 0; b0 < N; b0 += G, h++) {
      cases.push([h, () => {
        const end = Math.min(N, b0 + G);
        for (const [y, t] of outs) add(y, t[b0]);
        for (let i = b0 + 1; i < end; i++) {
          this.to(c).raw('[').add(c, -1);
          for (const [y, t] of outs) if (t[i] !== t[i - 1]) add(y, t[i] - t[i - 1]);
        }
        this.clear(c);
        this.to(c).raw(']'.repeat(end - 1 - b0));
      }]);
    }
    this.switchOn(HI, F, cases, tmp);
    return this.clear(c);
  }

  // x <- 69069 x + 1 (mod 2^32); 69069 = 263 * 262 + 163
  lcg(x, [t1, t2]) {
    this.scatter(x, [[t1, 263], [t2, 163]]);
    this.scatter(t1, [[t2, 262]]);
    return this.move(t2, x).add(x, 1);
  }

  switchOn(t, F, cases, tmp) { switchOn(this, t, F, cases, tmp); return this; }

  // ---- printing ----------------------------------------------------------------------------

  // Print a fixed text; O (0 before and after) holds the character, N counts long runs.
  printText(text, O, N, tmp) {
    let last = 0;
    for (let i = 0; i < text.length;) {
      const c = text.charCodeAt(i);
      let j = i;
      while (j < text.length && text.charCodeAt(j) === c) j++;
      const run = j - i;
      this.add(O, c - last);
      last = c;
      if (run <= 6) { this.to(O); this.raw('.'.repeat(run)); }
      else { this.addConst(N, run, tmp); this.loop(N, () => { this.add(N, -1); this.out(O); }); }
      i = j;
    }
    return this.add(O, -last);
  }

  // n % 10 and n / 10 of a non-negative n: the cells base..base+5 are n 0 0 0 0 0 and become
  // 0 (10 - n%10) (n%10) (n/10) 0 0
  divmod10(base) {
    this.add(base + 1, 10);
    this.to(base).raw('[->-[>+>>]>[+[-<+>]>+>>]<<<<<]');
    return this;
  }

  // Print a non-negative number in base (base..base+7 free, base ends 0) as `digits` digits, leading zeros blank unless
  // keepZeros; `point`: a '.' before the last 3 digits. D: `digits` free cells for the digits; t: 3 free cells.
  printNumber(base, digits, D, t, { point = false, keepZeros = false } = {}) {
    for (let i = 0; i < digits; i++) {
      this.divmod10(base);
      this.clear(base + 1).move(base + 2, D[i]).move(base + 3, base);
    }
    this.clear(base);
    const [started, t0, t1] = t;
    if (keepZeros) this.add(started, 1);
    for (let i = digits - 1; i >= 0; i--) {
      if (i === 0 || (point && i === 3)) { this.clear(started); this.add(started, 1); }
      this.whenNonZero(D[i], [t0, t1], () => { this.clear(started); this.add(started, 1); });
      this.loop(started, () => {
        this.add(D[i], 48).out(D[i]);
        this.move(started, t0);
      });
      this.move(t0, started);
      this.clear(D[i]);
      if (point && i === 3) {
        // the integer part is printed: a '.' (the started flag is 1 here)
        this.add(t1, 46).out(t1).clear(t1);
      }
    }
    return this.clear(started);
  }
}

module.exports = { Kernels };
