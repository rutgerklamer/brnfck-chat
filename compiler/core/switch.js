'use strict';

// The "switch" building block: run the branch whose value equals the cell, with one pass over the cases.
function switchOn(e, t, F, cases, tmp, { otherwise, direct = 0 } = {}) {
  e.add(F, 1);
  let prev = 0;
  cases.forEach(([v], i) => {
    if (i < direct) e.add(t, prev - v); else e.addConst(t, prev - v, tmp);
    prev = v;
    e.to(t);
    e.code.push('[');
  });
  e.add(F, -1);
  if (otherwise) otherwise(prev);
  e.clear(t);
  for (let i = cases.length - 1; i >= 0; i--) {
    e.to(t);
    e.code.push(']');
    e.loop(F, () => { e.add(F, -1); cases[i][1](); });
  }
  return e;
}

module.exports = { switchOn };
