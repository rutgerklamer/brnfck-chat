'use strict';
// The instructions of an engine text as compiler/core/bf.js compiles them, with the place in the text of every
// instruction kept (trace.js and lens.js run them in JavaScript and note where each section starts and ends).

const ADD = 0, OUT = 1, IN = 2, JZ = 3, JNZ = 4, CLEAR = 5, MUL1 = 6, MUL2 = 7, MULN = 8, NOP = 9;

// `compile` of compiler/core/bf.js, keeping the position in the text of every instruction.
function compile(code) {
  const ops = [], stack = [];
  let mv = 0;
  const push = (op, at) => { op.mv = mv; op.at = at; mv = 0; ops.push(op); };
  // a loop of adds only that ends where it started and takes 1 from its start cell: a multiply (no targets: a clear)
  const mulOf = (body, trailing) => {
    const delta = new Map(); let off = 0;
    for (const op of body) { if (op.t !== ADD) return null; off += op.mv; delta.set(off, (delta.get(off) || 0) + op.n); }
    if (off + trailing !== 0 || delta.get(0) !== -1) return null;
    delta.delete(0);
    return [...delta].filter(([, f]) => f !== 0);
  };
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === 43 || c === 45) { const at = i; let n = 0; for (; code[i] === 43 || code[i] === 45; i++) n += code[i] === 43 ? 1 : -1; i--; if (n) push({ t: ADD, n }, at); }
    else if (c === 62 || c === 60) { for (; code[i] === 62 || code[i] === 60; i++) mv += code[i] === 62 ? 1 : -1; i--; }
    else if (c === 46) push({ t: OUT, n: 0 }, i);
    else if (c === 44) push({ t: IN, n: 0 }, i);
    else if (c === 91) { stack.push(ops.length); push({ t: JZ, n: 0 }, i); }
    else {
      const start = stack.pop(), mul = mulOf(ops.slice(start + 1), mv);
      if (mul) { mv = ops[start].mv; const at = ops[start].at; ops.length = start; push({ t: [CLEAR, MUL1, MUL2][mul.length] ?? MULN, n: 0, mul }, at); }
      else { push({ t: JNZ, n: start + 1 }, i); ops[start].n = ops.length; }
    }
  }
  if (mv) push({ t: NOP, n: 0 }, code.length - 1);
  const T = new Uint8Array(ops.length), N = new Int32Array(ops.length), M = new Int32Array(ops.length), AT = new Int32Array(ops.length), table = [];
  ops.forEach((op, i) => {
    T[i] = op.t; M[i] = op.mv; N[i] = op.n; AT[i] = op.at;
    if (op.mul && op.mul.length) { N[i] = table.length; if (op.t === MULN) table.push(op.mul.length); for (const [off, f] of op.mul) table.push(off, f); }
  });
  return { T, N, M, AT, X: Int32Array.from(table), length: ops.length };
}

module.exports = { ADD, OUT, IN, JZ, JNZ, CLEAR, MUL1, MUL2, MULN, NOP, compile };
