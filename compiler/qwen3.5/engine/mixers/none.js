'use strict';

// No token mixer: the residual goes on to the feed-forward layer as it is (spec.js noMixer; tests the rest of the engine).

module.exports = {
  layout: () => ({ mix: 0 }),
  emit(e, K, P) {
    const p = e.p, pre = e.pre, A = P - e.PRE;
    e.S('mixer', () => {
      e.slide(e.a.dim, A + pre.scr, 1, 1, () => p.move(A + pre.x, P + pre.x));
      p.move(A + pre.pos, P + pre.pos).move(A + pre.lc, P + pre.lc);
    });
  },
  read: (e, K, P, Lo, u, lcr) => lcr,
  home(e, K, P, Lo) { e.p.move(P + Lo.o13 + 2, P + 2).move(P + Lo.o13 + 3, P + 3); },
  resting: () => [],
  values: () => ({}),
};
