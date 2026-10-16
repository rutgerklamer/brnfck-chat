'use strict';

// e.normVec(X, OUT, NP, base, t): spec.js normVec in brainfuck, for one vector (a head) of NP.n signed values.
// X .. X+n-1 are used up (zero afterwards); OUT .. OUT+n-1 (zero before) get the results.
// base: a scratch window of n + 82 zero cells; t: 40 zero cells. Every address may be frame-relative.

module.exports = (Engine, { range, car1 }) => {
  const E = Engine.prototype;

  E.normVec = function (X, OUT, NP, base, t) {
    const p = this.p, { n, inBits } = NP, half = 2 ** (inBits - 1);
    const T = (k) => t + k, S = range(10, (i) => T(10 + i)), hop = [T(22), T(23)];

    // 1. A = sum |x|: x + 2^(inBits-1) split into its top bit (1 = not negative) and the rest
    let w = this.slide(n, base, 1, 1, (c) => {
      const [V, LOW, TOP, E1, e0, e1] = c.ss(0, 6), s = c.ss(6, 10);
      p.copy(X, V, LOW);
      this.rqSplit(V, LOW, TOP, { k: 0, n: inBits, lo: -half, addend: 0 }, s, [e0, e1]);
      this.ifElse(TOP, E1, () => p.move(LOW, c.car(0)), () => { p.scatter(LOW, [[c.car(0), -1]]); p.addBig(c.car(0), half, [e0, e1]); });
      c.carry(0);
    });
    p.move(w.end(w.car(0)), T(0));

    // 2. by the number of bits of A: the doublings of x (T1) and eps at the scale of the sum (T2)
    p.add(T(1), NP.dbl[0]); p.addBig(T(2), NP.eps[0], hop);
    {
      const [Za, Zb, TT, h0, h1, K, Kt] = S;
      p.shl(T(0), Za, 1, [h0, h1]);
      p.peel(Za, {
        m: 31,
        onSet: (j) => { p.clear(T(1)).add(T(1), NP.dbl[j + 1]); p.clear(T(2)); p.addBig(T(2), NP.eps[j + 1], hop); },
      }, { Zo: Zb, T: TT, H: [h0, h1], K, Kt });
    }

    // 3. w = round(x * 2^D / 2^11), left where x was; ss = eps + sum round(w / 16)^2
    p.move(T(1), car1(base, 0)); p.move(T(2), car1(base, 1));
    w = this.slide(n, base, 1, 1, (c) => {
      const [V, tt, tm, Wc, U, U2, e0, e1] = c.ss(0, 8), s = c.ss(8, 10);
      p.move(X, V);
      this.double(V, c.car(0), tt, tm);
      this.rqN(V, Wc, { ...this.rq(11, 21), clamp: false }, s, [e0, e1]);
      p.copy(Wc, U, tt); p.move(Wc, X);
      this.rqN(U, U2, { ...this.rq(4, 17), clamp: false }, s, [e0, e1]);
      this.mul(U2, 17, [[U2, c.car(1), 1]], s.slice(0, 8), true);
      p.clear(U2);
      c.carry(1);
    });
    p.clear(w.end(w.car(0))); p.move(w.end(w.car(1)), T(0));

    // 4. D2 = the even shift that brings ss to 30 or 31 bits, D3 = D2 / 2; T = table[bits 19 .. 30 of ss * 2^D2]
    p.copy(T(0), T(2), T(3));
    this.bitCount(T(2), 32, (j) => { const D2 = (31 - (j + 1)) & ~1; return [D2, D2 / 2]; }, [T(3), T(4)], S);
    this.doubleBy(T(0), T(3), T(2));
    p.requantCore(T(0), [{ cell: T(5), bits: 8 }, { cell: T(8), bits: 4 }], 19, 12, false, S);
    p.shl(T(8), T(5), 8, hop);
    this.lookupBig(T(5), T(6), T(7), NP.T, S.slice(0, 9));

    // 5. out = round(w * T * 2^D3 / 2^K)
    p.move(T(6), car1(base, 0)); p.move(T(4), car1(base, 1));
    w = this.slide(n, base, 1, 1, (c) => {
      const [V, P, tt, tm, e0, e1] = c.ss(0, 6), s = c.ss(6, 10);
      p.move(X, V);
      this.mul(V, 21, [[c.car(0), P, 1]], s.slice(0, 8), false);
      this.double(P, c.car(1), tt, tm);
      this.rqN(P, OUT, { ...this.rq(NP.K, NP.outBits), clamp: false }, s, [e0, e1]);
      c.carry(0);
    });
    p.clear(w.end(w.car(0))).clear(w.end(w.car(1)));
  };
};
