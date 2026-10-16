'use strict';

// A fast brainfuck runner for the engine's tests: 32-bit wrapping cells, the compile step of
// compiler/core/bf.js (runs merged, multiply loops as one op), and a breakpoint by source position.
//   run(src, { input, tapeSize, breakAt: { charIndex, hit }, maxSteps, eof })
//     -> { tape, pointer, output, steps, stopped, reason ('break' or 'steps'), ops, hits }
// breakAt stops the run the hit-th time (1-based) execution reaches the op that starts at or after
// character charIndex of src: at that moment every character before charIndex that ran has run,
// and none after it. No op is merged across charIndex, and a loop around it stays a loop.

const { asMulLoop, flatten, ADD, OUT, IN, JZ, JNZ, CLEAR, MUL1, MUL2, MULN, NOP } = require('../../core/bf');
const BRK = NOP + 1;

const PLUS = 43, MINUS = 45, LEFT = 60, RIGHT = 62, OPEN = 91, CLOSE = 93, DOT = 46, COMMA = 44;

// The compile of core/bf.js, with a cut at brk: a character index of src, or -1.
// Every op keeps the index of its first character in src (F).
function compile(src, brk = -1) {
  // the brainfuck characters and where they are in src
  let code = new Uint8Array(1024), at = new Int32Array(1024), n = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    if (c === PLUS || c === MINUS || c === LEFT || c === RIGHT || c === OPEN || c === CLOSE || c === DOT || c === COMMA) {
      if (n === code.length) { const c2 = new Uint8Array(2 * n), a2 = new Int32Array(2 * n); c2.set(code); a2.set(at); code = c2; at = a2; }
      code[n] = c; at[n++] = i;
    }
  }
  // the first character at or after brk; no run reaches over it
  let cut = -1;
  if (brk >= 0) for (let i = 0; i < n; i++) if (at[i] >= brk) { cut = i; break; }
  const ops = [], stack = [];
  let mv = 0, mvFrom = -1; // pointer movement waiting to be attached to the next op, and where it began
  const push = (op, from) => { op.mv = mv; op.from = mvFrom >= 0 ? mvFrom : from; mv = 0; mvFrom = -1; ops.push(op); };
  for (let i = 0; i < n; i++) {
    if (i === cut) {
      if (mv) push({ t: NOP, n: 0 }, at[i]);
      mvFrom = -1;
      push({ t: BRK, n: 0 }, at[i]);
    }
    const c = code[i];
    if (c === PLUS || c === MINUS) {
      let k = 0;
      const first = i;
      for (; i < n && (code[i] === PLUS || code[i] === MINUS) && (i === first || i !== cut); i++) k += code[i] === PLUS ? 1 : -1;
      i--;
      if (k) push({ t: ADD, n: k }, at[first]);
    } else if (c === RIGHT || c === LEFT) {
      if (mvFrom < 0) mvFrom = at[i];
      const first = i;
      for (; i < n && (code[i] === RIGHT || code[i] === LEFT) && (i === first || i !== cut); i++) mv += code[i] === RIGHT ? 1 : -1;
      i--;
    } else if (c === DOT) {
      push({ t: OUT, n: 0 }, at[i]);
    } else if (c === COMMA) {
      push({ t: IN, n: 0 }, at[i]);
    } else if (c === OPEN) {
      stack.push([ops.length, at[i]]);
      push({ t: JZ, n: 0 }, at[i]);
    } else {
      if (!stack.length) throw new Error('unmatched ] at character ' + at[i]);
      const [start] = stack.pop();
      const mul = asMulLoop(ops, start + 1, mv);
      if (mul) {
        mv = ops[start].mv; mvFrom = -1;
        const from = ops[start].from;
        ops.length = start;
        const t = [CLEAR, MUL1, MUL2][mul.length] ?? MULN;
        push({ t, n: 0, mul }, from);
      } else {
        push({ t: JNZ, n: start + 1 }, at[i]);
        ops[start].n = ops.length;
      }
    }
  }
  if (stack.length) throw new Error('unmatched [ at character ' + stack.pop()[1]);
  if (mv) push({ t: NOP, n: 0 }, src.length);
  return { ...flatten(ops), F: Int32Array.from(ops, (op) => op.from) };
}

function run(src, { input = new Uint8Array(0), tapeSize = 1 << 16, breakAt = null, maxSteps = Infinity, eof = 0 } = {}) {
  const prog = compile(src, breakAt ? breakAt.charIndex : -1);
  const { T, N, M, X, length } = prog;
  const tape = new Int32Array(tapeSize), size = tapeSize;
  const hit = breakAt ? (breakAt.hit ?? 1) : 0;
  let out = new Uint8Array(256), nOut = 0, inPos = 0;
  let p = 0, i = 0, steps = 0, hits = 0, stopped = false, reason = null;
  const off = (q, o) => {
    const r = q + o;
    if (r < 0 || r >= size) throw new Error(`pointer left the tape: cell ${r} (op ${i}, character ${prog.F[i]})`);
    return r;
  };
  main: while (i < length) {
    p += M[i];
    if (p < 0 || p >= size) throw new Error(`pointer left the tape: cell ${p} (op ${i}, character ${prog.F[i]})`);
    steps++;
    switch (T[i]) {
      case ADD: tape[p] = (tape[p] + N[i]) | 0; i++; break;
      case JZ: i = tape[p] === 0 ? N[i] : i + 1; break;
      case JNZ:
        if (tape[p] !== 0) {
          i = N[i];
          if (steps > maxSteps) { stopped = true; reason = 'steps'; break main; }
        } else i++;
        break;
      case CLEAR: tape[p] = 0; i++; break;
      case MUL1: {
        const v = tape[p];
        if (v !== 0) { const j = N[i], q = off(p, X[j]); tape[q] = (tape[q] + Math.imul(v, X[j + 1])) | 0; tape[p] = 0; }
        i++; break;
      }
      case MUL2: {
        const v = tape[p];
        if (v !== 0) {
          const j = N[i], q = off(p, X[j]), r = off(p, X[j + 2]);
          tape[q] = (tape[q] + Math.imul(v, X[j + 1])) | 0;
          tape[r] = (tape[r] + Math.imul(v, X[j + 3])) | 0;
          tape[p] = 0;
        }
        i++; break;
      }
      case MULN: {
        const v = tape[p];
        if (v !== 0) {
          const j = N[i], k = X[j];
          for (let e = j + 1; e < j + 1 + 2 * k; e += 2) { const q = off(p, X[e]); tape[q] = (tape[q] + Math.imul(v, X[e + 1])) | 0; }
          tape[p] = 0;
        }
        i++; break;
      }
      case OUT:
        if (nOut === out.length) { const o = new Uint8Array(out.length * 2); o.set(out); out = o; }
        out[nOut++] = tape[p] & 255; i++; break;
      case IN: tape[p] = inPos < input.length ? input[inPos++] : eof; i++; break;
      case NOP: i++; break;
      case BRK:
        steps--;
        if (++hits === hit) { stopped = true; reason = 'break'; break main; }
        i++; break;
    }
  }
  return { tape, pointer: p, output: out.slice(0, nOut), steps, stopped, reason, ops: length, hits };
}

module.exports = { run, compile };
