'use strict';

// Cheap arithmetic building blocks for a quantised transformer in brainfuck.

const { Emitter } = require('./emit');

class Patterns extends Emitter {
  constructor(cellBits = 32, { maxShift = 8 } = {}) {
    super();
    if (cellBits !== 16 && cellBits !== 32) throw new Error('cellBits must be 16 or 32');
    this.B = cellBits;
    this.L = maxShift;
  }

  raw(s) { this.code.push(s); return this; }

  // ---- code size: one copy of the code for many cells ----------------------

  eachFrame(m0, stride, n, C, body) {
    this.add(C, 1).scatter(C, [...Array(n)].map((_, i) => [m0 + i * stride, 1]));
    this.to(m0).raw("[").add(m0, -1);
    body();
    this.to(m0).raw(">".repeat(stride) + "]");
    this.ptr = m0 + n * stride;
    return this;
  }

  // ---- shifting helpers ---------------------------------------------------

  shl(src, dst, sh, hop, sign = 1, keep = null) {
    let cur = src, i = 0, first = true;
    for (;;) {
      const final = sh <= this.L;
      const step = final ? sh : this.L;
      const tgt = final ? dst : hop[i++ & 1];
      const targets = [[tgt, (final ? sign : 1) * 2 ** step]];
      if (first && keep !== null) targets.push([keep, 1]);
      this.scatter(cur, targets);
      if (final) return this;
      first = false; cur = tgt; sh -= step;
    }
  }

  // cell += 2^e.
  pow2(cell, e, hop) {
    if (e <= this.L) return this.add(cell, 2 ** e);
    this.add(hop[0], 2 ** this.L);
    return this.shl(hop[0], cell, e - this.L, [hop[1], hop[0]]);
  }

  // cell += v for a large constant v (base-256 digits; a few steps).
  addBig(cell, v, hop) {
    const sign = v < 0 ? -1 : 1;
    let mag = Math.abs(v);
    for (let i = 0; mag > 0; i++, mag = Math.floor(mag / 256)) {
      const byte = mag % 256;
      if (!byte) continue;
      if (i === 0) this.add(cell, sign * byte);
      else { this.add(hop[0], byte); this.shl(hop[0], cell, 8 * i, [hop[1], hop[0]], sign); }
    }
    return this;
  }

  // ---- the bit peel -------------------------------------------------------

  peel(Z, { m, from = 0, to = m, onSet = null, kStep = 8, ext = null }, sc) {
    const { Zo, T, H } = sc;
    let zc = Z, zo = Zo;
    let k = ext ? ext.k : sc.K, kt = ext ? ext.kt : sc.Kt, kexp = ext ? ext.exp : -1;
    let consumed = false;
    for (let j = from; j < to; j++) {
      const e = this.B - m + j;      // where bit j sits inside Z
      const last = j === m - 1;      // top bit: nothing above it to keep
      const a = m - 1 - j;           // shift that brings bit j to the top
      if (!last) {
        if (kexp < 0) { this.pow2(k, e, H); kexp = e; }
        else if (!ext && e - kexp >= kStep) {
          this.scatter(k, [[kt, 2 ** (e - kexp)]]);
          [k, kt] = [kt, k]; kexp = e;
        }
      }
      if (last) { this.move(zc, T); consumed = true; }
      else {
        if (a <= this.L) this.scatter(zc, [[zo, 1], [T, 2 ** a]]);
        else {
          this.scatter(zc, [[zo, 1], [H[0], 2 ** this.L]]);
          this.shl(H[0], T, a - this.L, [H[1], H[0]]);
        }
        [zc, zo] = [zo, zc];
      }
      const f = last ? 0 : 2 ** (e - kexp);
      this.loop(T, () => {
        this.clear(T);
        if (!last) { this.scatter(k, [[zc, -f], [kt, 1]]); this.move(kt, k); }
        if (onSet) onSet(j);
      });
    }
    if (!ext && kexp >= 0) this.clear(k);
    return consumed ? null : zc;
  }

  matVec(xs, W, accs, tmp) {
    xs.forEach((x, i) => {
      this.scatter(x, [...accs.map((a, o) => [a, W[o][i]]), [tmp, 1]]);
      this.move(tmp, x);
    });
    return this;
  }

  requantCore(X, outs, k, n, clamp, s) {
    const [X2, Za, Zb, T, H0, H1, K, Kt, F, tmp] = s;
    const H = [H0, H1], sc = { T, H, K, Kt };
    const J = k + n - 1, s0 = this.B - 1 - J;
    if (s0 < (clamp ? 1 : 0)) throw new Error(`k + n = ${k + n} too wide for ${this.B}-bit cells`);
    if (outs.reduce((a, o) => a + o.bits, 0) !== n) throw new Error('outs must total n bits');
    const outBit = (i) => {
      for (const o of outs) { if (i < o.bits) return this.add(o.cell, 2 ** i); i -= o.bits; }
    };
    if (!clamp) {
      let z = X, zo = Za;
      if (s0 > 0) { this.shl(X, Za, s0, H); z = Za; zo = Zb; }
      this.peel(z, { m: J + 1, onSet: (j) => { if (j >= k) outBit(j - k); } }, { Zo: zo, ...sc });
      return this;
    }
    this.shl(X, Za, s0, H, 1, X2);
    this.peel(Za, { m: J + 1, onSet: (j) => (j < k ? this.add(X2, -(2 ** j)) : outBit(j - k)) }, { Zo: Zb, ...sc });
    let pos = k;
    for (const o of outs) {
      this.shl(o.cell, X2, pos, H, -1, tmp).move(tmp, o.cell);
      pos += o.bits;
    }
    // Rare path: X2 is a nonzero multiple of 2^(J+1).
    this.loop(X2, () => {
      for (const o of outs) this.clear(o.cell);
      const r = this.peel(X2, { m: this.B, from: J + 1, to: this.B - 1 }, { Zo: Zb, ...sc });
      this.add(F, 1);
      this.loop(r, () => { this.clear(r).add(F, -1); });               // sign bit set: negative, stay 0
      this.loop(F, () => { this.add(F, -1); for (const o of outs) this.add(o.cell, 2 ** o.bits - 1); });
      this.to(X2);
    });
    return this;
  }

  // Y (from 0) = clamp(floor((X + addend) / 2^k), lo, lo + 2^n - 1), read off bits k..k+n-1 by the bit peel.
  requant(X, Y, { k, n = 8, lo = -(2 ** (n - 1)), addend = 0, clamp = true, outs = null }, s) {
    this.addBig(X, addend - lo * 2 ** k, [s[4], s[5]]);
    this.requantCore(X, outs || [{ cell: Y, bits: n }], k, n, clamp, s);
    if (!outs) this.add(Y, lo);
    return this;
  }

  dotRequant(xs, ws, Y, opts, s) {
    this.matVec(xs, [ws], [s[0]], s[1]);
    return this.requant(s[0], Y, opts, s.slice(1));
  }

  dotRequantDigits(xs, ws, Y, { k, n = 8, lo = -(2 ** (n - 1)), addend = 0, xmax }, s) {
    const c = addend - lo * 2 ** k;
    const plan = Patterns.digitPlan(ws, c, k, n, xmax, this.B);
    if (!plan) throw new Error('no digit split fits');
    const { h, D, digits, cLow, cTop } = plan;
    const A = s.slice(0, D), rest = s.slice(D);
    const [, , Zb, T, H0, H1, K, Kt] = rest, tmp = rest[9], H = [H0, H1];
    xs.forEach((x, i) => {
      this.scatter(x, [...A.map((a, d) => [a, digits[i][d]]), [tmp, 1]]);
      this.move(tmp, x);
    });
    if (D > 1) this.addBig(A[0], cLow, H);
    this.addBig(A[D - 1], cTop, H);
    const addPow = (cell, e, sign) => {
      if (e <= this.L) return this.add(cell, sign * 2 ** e);
      this.add(H0, 1);
      return this.shl(H0, cell, e, [H1, H0], sign);
    };
    for (let d = 0; d < D - 1; d++) {
      const r = this.peel(A[d], {
        m: this.B, to: this.B - 1,
        onSet: (j) => { if (j >= h) addPow(A[d + 1], j - h, 1); },
      }, { Zo: Zb, T, H, K, Kt });
      this.loop(r, () => { this.clear(r); addPow(A[d + 1], this.B - 1 - h, -1); });
    }
    this.requantCore(A[D - 1], [{ cell: Y, bits: n }], k - h * (D - 1), n, true, rest);
    return this.add(Y, lo);
  }

  // Choose digit width h and cell count D for dotRequantDigits.
  static digitPlan(ws, c, k, n, xmax, B) {
    const lim = 2 ** (B - 1);
    for (let D = 1; D <= 8; D++) {
      for (let h = D === 1 ? 0 : Math.floor(k / (D - 1)); h >= (D === 1 ? 0 : 1); h--) {
        if (k - h * (D - 1) + n > B - 1) continue;   // top cell must still have room to clamp
        const half = 2 ** (h - 1), base = 2 ** h;
        const digits = ws.map((w) => {
          const ds = [];
          for (let d = 0; d < D - 1; d++) {
            const dig = ((((w + half) % base) + base) % base) - half; // in [-half, half)
            ds.push(dig); w = (w - dig) / base;
          }
          ds.push(w);
          return ds;
        });
        const top = 2 ** (h * (D - 1));
        const cTop = Math.floor(c / top), cLow = c - cTop * top;
        let ok = true, carry = 0;
        for (let d = 0; d < D && ok; d++) {
          let bound = xmax * digits.reduce((a, ds) => a + Math.abs(ds[d]), 0) + carry;
          if (d === 0 && D > 1) bound += cLow;
          if (d === D - 1) bound += Math.abs(cTop);
          if (bound >= lim) ok = false;
          carry = Math.floor(bound / base) + 1;
        }
        if (ok) return { h, D, digits, cLow, cTop };
        if (D === 1) break;
      }
    }
    return null;
  }

  // ---- baselines, kept only to measure against ----------------------------

  requantCount(X, Y, k, s) {
    const [cnt, t0, t1, flag] = s;
    this.addConst(cnt, 2 ** k, t0);
    this.loop(X, () => {
      this.add(X, -1).add(cnt, -1);
      this.whenZero(cnt, [t0, t1, flag], () => { this.add(Y, 1); this.addConst(cnt, 2 ** k, t0); });
    });
    return this.clear(cnt);
  }

  dotPosNeg(xps, xns, ws, P, RN, s) {
    const [Ng, t0, t1, f] = s;
    ws.forEach((w, i) => {
      const a = Math.abs(w);
      this.scatter(xps[i], [[w > 0 ? P : Ng, a], [t0, 1]]).move(t0, xps[i]);
      this.scatter(xns[i], [[w > 0 ? Ng : P, a], [t0, 1]]).move(t0, xns[i]);
    });
    return this.loop(Ng, () => {
      this.add(Ng, -1).add(f, 1);
      this.whenNonZero(P, [t0, t1], () => this.add(P, -1).add(f, -1));
      this.ifNonZero(f, () => this.add(RN, 1));
    });
  }

  mulAcc(a, nb, pairs, s, { keepA = true, ext = null } = {}) {
    const [Za, Zb, T, H0, H1, K, Kt, tmp] = s;
    this.shl(a, Za, this.B - nb, [H0, H1], 1, keepA ? tmp : null);
    if (keepA) this.move(tmp, a);
    this.peel(Za, {
      m: nb, ext,
      onSet: (j) => {
        const f = (j === nb - 1 ? -1 : 1) * 2 ** j;
        for (const [b, acc] of pairs) this.scatter(b, [[acc, f], [tmp, 1]]).move(tmp, b);
      },
    }, { Zo: Zb, T, H: [H0, H1], K, Kt });
    return this;
  }

  dotVar(as, bs, acc, nb, s) {
    const [, , , H0, H1, K, Kt] = s;
    const ext = nb > 1 ? { k: K, kt: Kt, exp: this.B - nb } : null;
    if (ext) this.pow2(K, ext.exp, [H0, H1]);
    as.forEach((a, i) => this.mulAcc(a, nb, [[bs[i], acc]], s, { ext }));
    if (ext) this.clear(K);
    return this;
  }

  // y += table[low n bits of x] (table length 2^n): a tree of bit tests with one leaf per entry.
  lookup(x, y, table, s, { keepX = true, kStep = 4 } = {}) {
    const n = Math.log2(table.length);
    if (!Number.isInteger(n) || n < 1 || n > this.B) throw new Error('table length must be a power of two');
    const [Za, Zb, T, H0, H1, K, Kt, E, tmp] = s;
    const H = [H0, H1];
    this.shl(x, Za, this.B - n, H, 1, keepX ? tmp : null);
    if (keepX) this.move(tmp, x);
    if (n > 1) this.pow2(K, this.B - n, H);
    let kEnd = K;
    const node = (j, idx, zc, zo, k, kt, kexp) => {
      if (j === n) {
        kEnd = k;
        const v = table[idx];
        if (Math.abs(v) < 24) this.add(y, v); else this.addBig(y, v, H);
        return;
      }
      const e = this.B - n + j, last = j === n - 1, a = n - 1 - j;
      if (!last && e - kexp >= kStep) {
        this.scatter(k, [[kt, 2 ** (e - kexp)]]);
        [k, kt] = [kt, k]; kexp = e;
      }
      if (last) this.move(zc, T);
      else {
        if (a <= this.L) this.scatter(zc, [[zo, 1], [T, 2 ** a]]);
        else { this.scatter(zc, [[zo, 1], [H0, 2 ** this.L]]); this.shl(H0, T, a - this.L, [H1, H0]); }
        [zc, zo] = [zo, zc];
      }
      this.add(E, 1);
      this.loop(T, () => {                       // bit j = 1
        this.clear(T).add(E, -1);
        if (!last) { this.scatter(k, [[zc, -(2 ** (e - kexp))], [kt, 1]]); this.move(kt, k); }
        node(j + 1, idx | (1 << j), zc, zo, k, kt, kexp);
      });
      this.loop(E, () => {                       // bit j = 0
        this.add(E, -1);
        node(j + 1, idx, zc, zo, k, kt, kexp);
      });
    };
    node(0, 0, Za, Zb, K, Kt, this.B - n);
    if (n > 1) this.clear(kEnd);
    return this;
  }

  lookupChain(x, y, table, s) {
    const [c, tmp, t2] = s;
    this.copy(x, c, tmp);
    this.addBig(y, table[0], [tmp, t2]);
    for (let i = 1; i < table.length; i++) {
      this.to(c).raw('[').add(c, -1);
      const d = table[i] - table[i - 1];
      if (d) this.add(y, d);
    }
    this.clear(c);
    for (let i = 1; i < table.length; i++) this.to(c).raw(']');
    return this;
  }

  static frames(base, N, D) {
    const S = D + 3, at = (i, off) => base + (i + 1) * S + off;
    return {
      base, N, D, S, end: base + (N + 2) * S,
      M: (i) => at(i, 0), SN: (i) => at(i, 1), OH: (i) => at(i, 2), X: (i, l) => at(i, 3 + l),
    };
  }

  argmax(fr, levels, C, { clearInputs = true } = {}) {
    const { N, D, S } = fr, R = N;
    if (levels.length !== D) throw new Error('levels must have one entry per digit');
    const each = (fn) => { const t = []; for (let i = 0; i < N; i++) fn(i, t); return t; };
    const right = `[${'>'.repeat(S)}]`, left = `[${'<'.repeat(S)}]`;
    this.add(C, 1).scatter(C, each((i, t) => {
      t.push([fr.M(i), 1]);
      levels.forEach((lv, l) => t.push([fr.X(i, l), -(lv.top + (l ? lv.span : 0))]));
    }));
    this.add(fr.SN(R), 1);
    for (let l = 0; l < D; l++) {
      this.loop(fr.SN(R), () => {
        this.add(C, 1).scatter(C, each((i, t) => t.push([fr.X(i, l), 1])));
        this.to(fr.X(0, l)).raw(right);
        this.ptr = fr.X(R, l);
      });
      if (l < D - 1) {
        // Walk over every candidate that is zero in this round.
        this.loop(fr.M(R), () => {
          this.add(fr.X(R, l + 1), levels[l + 1].span);
          this.to(fr.X(R, l)).raw('>'.repeat(S)).raw(right);
        });                                   // really in the sentinel again
      } else {
        this.add(fr.OH(R), 1);
        this.to(fr.M(R)).raw(left);           // slide home over the markers
        this.ptr = fr.M(-1);
      }
    }
    this.add(fr.SN(R), -1);
    this.add(C, 1).scatter(C, each((i, t) => t.push([fr.M(i), -1])));
    if (clearInputs) for (let i = 0; i < N; i++) for (let l = 0; l < D; l++) this.clear(fr.X(i, l));
    return this;
  }

  onehotIndex(ohs, idx, s) {
    ohs.forEach((c, i) => { if (i) this.scatter(c, [[s[0], i % 32], [s[1], i >> 5]]); else this.clear(c); });
    return this.move(s[0], idx).scatter(s[1], [[idx, 32]]);
  }

  splitDigits(X, outs, s) {
    const n = outs.reduce((a, o) => a + o.bits, 0);
    return this.requantCore(X, outs, 0, n, false, s);
  }

  argmaxRaceNaive(us, ohs, s) {
    const [NF, T0, T1, FLAG] = s;
    this.add(NF, 1).loop(NF, () => {
      us.forEach((u, o) => {
        this.whenZero(u, [T0, T1, FLAG], () => {
          this.whenNonZero(NF, [T0, T1], () => this.add(NF, -1).add(ohs[o], 1));
        });
      });
      us.forEach((u) => this.add(u, -1));
    });
    us.forEach((u) => this.clear(u));
    return this;
  }
}

module.exports = { Patterns };
