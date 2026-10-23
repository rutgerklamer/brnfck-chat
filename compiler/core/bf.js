'use strict';

// Compile step of an optimising brainfuck interpreter: runs of + - < > fold, add-and-move loops become multiplications.
// compiler/qwen3.5/engine/bfrun.js builds on it; tools/map-data/trace.js checks its own copy against it.

const ADD = 0, OUT = 1, IN = 2, JZ = 3, JNZ = 4, CLEAR = 5, MUL1 = 6, MUL2 = 7, MULN = 8, NOP = 9;

// ops[from..] is a loop body; its multiplications as [offset, factor] pairs, or null when it is no multiply loop
function asMulLoop(ops, from, trailingMove) {
  const delta = new Map();
  let off = 0;
  for (let i = from; i < ops.length; i++) {
    const op = ops[i];
    if (op.t !== ADD) return null;
    off += op.mv;
    delta.set(off, (delta.get(off) || 0) + op.n);
  }
  if (off + trailingMove !== 0 || delta.get(0) !== -1) return null;
  delta.delete(0);
  return [...delta].filter(([, f]) => f !== 0);
}

function compile(src) {
  const code = src.replace(/[^+\-<>\[\].,]/g, '');
  const ops = [];
  const stack = [];
  let mv = 0; // pointer movement waiting to be attached to the next op
  const push = (op) => { op.mv = mv; mv = 0; ops.push(op); };
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '+' || c === '-') {
      let n = 0;
      for (; code[i] === '+' || code[i] === '-'; i++) n += code[i] === '+' ? 1 : -1;
      i--;
      if (n) push({ t: ADD, n });
    } else if (c === '>' || c === '<') {
      for (; code[i] === '>' || code[i] === '<'; i++) mv += code[i] === '>' ? 1 : -1;
      i--;
    } else if (c === '.') {
      push({ t: OUT, n: 0 });
    } else if (c === ',') {
      push({ t: IN, n: 0 });
    } else if (c === '[') {
      stack.push(ops.length);
      push({ t: JZ, n: 0 });
    } else {
      if (!stack.length) throw new Error('unmatched ]');
      const start = stack.pop();
      const mul = asMulLoop(ops, start + 1, mv);
      if (mul) {
        mv = ops[start].mv;
        ops.length = start;
        const t = [CLEAR, MUL1, MUL2][mul.length] ?? MULN;
        push({ t, n: 0, mul });
      } else {
        push({ t: JNZ, n: start + 1 });
        ops[start].n = ops.length;
      }
    }
  }
  if (stack.length) throw new Error('unmatched [');
  if (mv) push({ t: NOP, n: 0 });
  return flatten(ops);
}

// Typed arrays, far faster than objects: T op, M pointer move before it, N amount, jump target or index into X.
function flatten(ops) {
  const T = new Uint8Array(ops.length), N = new Int32Array(ops.length), M = new Int32Array(ops.length);
  const table = [];
  ops.forEach((op, i) => {
    T[i] = op.t;
    M[i] = op.mv;
    N[i] = op.n;
    if (op.mul && op.mul.length) {
      N[i] = table.length;
      if (op.t === MULN) table.push(op.mul.length);
      for (const [off, f] of op.mul) table.push(off, f);
    }
  });
  return { T, N, M, X: Int32Array.from(table), length: ops.length };
}

module.exports = { compile, asMulLoop, flatten, ADD, OUT, IN, JZ, JNZ, CLEAR, MUL1, MUL2, MULN, NOP };
