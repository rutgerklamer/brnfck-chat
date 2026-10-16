'use strict';

// Self-test of bfrun.js and synth.js: hand-written programs, random programs against a plain
// one-character-at-a-time interpreter (with breakpoints), the speed, and the synth model through float.js.
//   node compiler/qwen3.5/engine/bfrun_check.js

const { run } = require('./bfrun');
const { synthModel, bf16, fromBf16 } = require('./synth');
const F = require('../reference/float');
const DN = require('../reference/deltanet');

let fails = 0;
const check = (ok, what) => { if (!ok) { fails++; console.log('FAIL ' + what); } };
const text = (u8) => Buffer.from(u8).toString('latin1');
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// The plain interpreter: one source character per step. ']' goes back to just after its '[', so a '['
// is reached once per entry into its loop, as in bfrun. brk: stop the hit-th time it reaches character pc >= at.
function plain(src, { input = new Uint8Array(0), tapeSize = 1 << 12, brk = null, maxSteps = 1e6 } = {}) {
  const jump = new Int32Array(src.length), stack = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '[') stack.push(i);
    else if (src[i] === ']') { const j = stack.pop(); jump[i] = j + 1; jump[j] = i + 1; }
  }
  const tape = new Int32Array(tapeSize), out = [];
  let p = 0, pc = 0, inPos = 0, steps = 0, hits = 0, at = -1;
  if (brk) { at = src.length; for (let i = brk.charIndex; i < src.length; i++) if ('+-<>[].,'.includes(src[i])) { at = i; break; } }
  while (pc < src.length) {
    if (pc === at && ++hits === brk.hit) return { tape, pointer: p, output: Uint8Array.from(out), stopped: true };
    if (++steps > maxSteps) return null;
    switch (src[pc]) {
      case '+': tape[p] = (tape[p] + 1) | 0; break;
      case '-': tape[p] = (tape[p] - 1) | 0; break;
      case '>': if (++p >= tapeSize) throw new Error('right'); break;
      case '<': if (--p < 0) throw new Error('left'); break;
      case '.': out.push(tape[p] & 255); break;
      case ',': tape[p] = inPos < input.length ? input[inPos++] : 0; break;
      case '[': if (tape[p] === 0) { pc = jump[pc]; continue; } break;
      case ']': if (tape[p] !== 0) { pc = jump[pc]; continue; } break;
    }
    pc++;
  }
  return { tape, pointer: p, output: Uint8Array.from(out), stopped: false };
}

// ------------------------------------------------------------ by hand
{
  const hello = '++++++++[>++++[>++>+++>+++>+<<<<-]>+>+>->>+[<]<-]>>.>---.+++++++..+++.>>.<-.<.+++.------.--------.>>+.>++.';
  check(text(run(hello).output) === 'Hello World!\n', 'hello world');

  // multiply loops: 7 * 6 into two cells, and a loop that moves away and back
  let r = run('+++++++[->++++++>>+++<<<]');
  check(r.tape[0] === 0 && r.tape[1] === 42 && r.tape[3] === 21 && r.pointer === 0, 'multiply loop');
  check(r.steps === 2, 'multiply loop is one op (' + r.steps + ' steps)');
  r = run('+++[>+++[>++<-]<-]>>');
  check(r.tape[2] === 18 && r.pointer === 2, 'nested multiply loop');

  // wrap-around: 0 - 1, and doubling 1 thirty-one and thirty-two times
  r = run('-.');
  check(r.tape[0] === -1 && r.output[0] === 255, 'minus one');
  r = run('+' + '[->++<]>'.repeat(31));
  check(r.tape[31] === -(2 ** 31) && r.pointer === 31, 'two to the 31st wraps (' + r.tape[31] + ')');
  r = run('+' + '[->++<]>'.repeat(32));
  check(r.tape[32] === 0, 'two to the 32nd is zero');
  r = run('+' + '[->+++<]>'.repeat(25)); // 3^25 in 32 bits
  check(r.tape[25] === Number(3n ** 25n % 2n ** 32n) - 2 ** 32 * (Number(3n ** 25n % 2n ** 32n) >= 2 ** 31), '3^25 wraps');

  // input and output, end of input reads 0
  r = run(',[.,]', { input: Uint8Array.from(Buffer.from('cells')) });
  check(text(r.output) === 'cells', 'echo');
  r = run(',>,', { input: Uint8Array.of(9), eof: -1 });
  check(r.tape[0] === 9 && r.tape[1] === -1, 'eof value');

  // the pointer leaving the tape throws
  let threw = false;
  try { run('<'); } catch (e) { threw = true; }
  check(threw, 'pointer left of the tape');
  threw = false;
  try { run('+[->+<]>>>>', { tapeSize: 4 }); } catch (e) { threw = true; }
  check(threw, 'pointer right of the tape');
  threw = false;
  try { run('+[->>>>+<<<<]', { tapeSize: 4 }); } catch (e) { threw = true; }
  check(threw, 'multiply loop writing beyond the tape');

  // breakpoints: the inner body of ++[>+++[>+<-]<-] is reached 3 times per outer pass
  const src = '++[>+++[ >+<- ]<-]';
  const body = src.indexOf(' ') + 1;
  r = run(src, { breakAt: { charIndex: body, hit: 4 } });
  check(r.stopped && r.reason === 'break' && r.pointer === 1 && same([...r.tape.slice(0, 3)], [1, 3, 3]), 'break in the inner loop, 4th time');
  r = run(src, { breakAt: { charIndex: body, hit: 7 } });
  check(!r.stopped && r.hits === 6 && r.tape[2] === 6, 'break never reached a 7th time');
  r = run(src, { breakAt: { charIndex: src.indexOf('[', 3), hit: 2 } });
  check(r.stopped && same([...r.tape.slice(0, 3)], [1, 3, 3]), 'break at an inner [ counts entries');
  r = run(src, { breakAt: { charIndex: src.length - 1, hit: 2 } });
  check(r.stopped && r.pointer === 0 && r.tape[0] === 0 && r.tape[2] === 6, 'break at the last ]');
  r = run('+++[->+<]#>>', { breakAt: { charIndex: 9 } });
  check(r.stopped && r.pointer === 0 && r.tape[1] === 3, 'break after a multiply loop, inside a comment');
  r = run('>>>><<', { breakAt: { charIndex: 3 } });
  check(r.stopped && r.pointer === 3, 'break inside a run of moves');
  r = run('++++++', { breakAt: { charIndex: 2 } });
  check(r.stopped && r.tape[0] === 2, 'break inside a run of adds');
  r = run('+++++', { maxSteps: 3, breakAt: null });
  check(!r.stopped && r.tape[0] === 5, 'no loop, no step limit');
  r = run('+[]', { maxSteps: 1000 });
  check(r.stopped && r.reason === 'steps', 'step limit');
}

// ------------------------------------------------------------ random programs against the plain interpreter
{
  let s = 7;
  const rnd = (n) => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return (s >>> 8) % n; };
  const piece = (depth) => {
    let out = '';
    const n = 1 + rnd(8);
    for (let i = 0; i < n; i++) {
      const k = rnd(20);
      if (k < 4) out += '+'.repeat(1 + rnd(5));
      else if (k < 6) out += '-'.repeat(1 + rnd(3));
      else if (k < 9) out += '>'.repeat(1 + rnd(3));
      else if (k < 11) out += '<'.repeat(1 + rnd(2));
      else if (k === 11) out += '.';
      else if (k === 12) out += ',';
      else if (k === 13) out += ' x ';
      else if (k < 16 && depth < 3) { // a multiply loop, maybe with large factors
        const a = 1 + rnd(3), f = rnd(3) ? 1 + rnd(4) : 200 + rnd(5000);
        out += '[-' + '>'.repeat(a) + '+'.repeat(f % 50) + '<'.repeat(a) + ']';
        if (f > 50) out = '+'.repeat(f % 7 + 1) + '[->' + '+'.repeat(f % 97) + '<]>' + out;
      } else if (depth < 3) out += '[' + piece(depth + 1) + '-]';
    }
    return out;
  };
  let tried = 0, compared = 0, breaks = 0;
  for (let t = 0; t < 3000; t++) {
    const src = '>>>>' + piece(0), input = Uint8Array.from({ length: 6 }, () => rnd(256));
    tried++;
    let ref;
    try { ref = plain(src, { input, maxSteps: 200000 }); } catch (e) { continue; }
    if (!ref) continue;
    const r = run(src, { input, tapeSize: 1 << 12 });
    compared++;
    if (!same(r.tape, ref.tape) || r.pointer !== ref.pointer || !same(r.output, ref.output)) { check(false, 'random program ' + JSON.stringify(src)); continue; }
    // a breakpoint at a random place, for a random hit
    for (let b = 0; b < 3; b++) {
      const brk = { charIndex: rnd(src.length + 1), hit: 1 + rnd(4) };
      const rb = plain(src, { input, maxSteps: 200000, brk }), qb = run(src, { input, tapeSize: 1 << 12, breakAt: brk });
      breaks++;
      if (rb.stopped !== qb.stopped || !same(qb.tape, rb.tape) || qb.pointer !== rb.pointer || !same(qb.output, rb.output)) {
        check(false, `breakpoint ${JSON.stringify(brk)} in ${JSON.stringify(src)}: ${qb.stopped}/${rb.stopped} pointer ${qb.pointer}/${rb.pointer}`);
        break;
      }
    }
  }
  console.log(`random programs: ${compared} of ${tried} compared, ${breaks} breakpoints`);
}

// ------------------------------------------------------------ speed
{
  // four nested counting loops, none of them a multiply loop: 10 * 200 * 200 * 50 passes of [->+>[-]<<]
  const src = '+'.repeat(10) + '[>' + '+'.repeat(200) + '[>' + '+'.repeat(200) + '[>' + '+'.repeat(50) + '[->+>[-]<<]<-]<-]<-]';
  run(src);
  const t = process.hrtime.bigint(), r = run(src), sec = Number(process.hrtime.bigint() - t) / 1e9;
  console.log(`speed: ${(r.steps / 1e6).toFixed(1)} M ops in ${sec.toFixed(3)} s = ${(r.steps / sec / 1e6).toFixed(0)} M ops/s`);
}

// ------------------------------------------------------------ synth through float.js
{
  for (const v of [0, 1, -1, 0.15, 1e-8, 82.5, 1 / 3, -2.75]) check(Math.abs(fromBf16(bf16(v)) - v) <= Math.abs(v) / 256, 'bf16 of ' + v);
  check(bf16(1 + 1 / 256) === bf16(1) && bf16(1 + 3 / 256) === bf16(1 + 4 / 256), 'bf16 ties to even');
  for (const size of [{}, { layers: 8, nv: 4 }, { tied: false }]) {
    const src = synthModel(3, size);
    const kinds = ['emb', 'rmsFinal', 'rmsAtt', 'rmsFfn', 'w1', 'w3', 'w2'];
    for (const k of kinds) { const l = k === 'emb' || k === 'rmsFinal' ? undefined : 0; check(same(F.toFloat(src.raw(k, l)), src.tensor(k, l)), 'raw and tensor agree: ' + k); }
    check(src.tensor('conv', 0).length === src.convDim * src.kernel && src.tensor('wq', 3).length === 2 * src.heads * src.headSize * src.dim, 'tensor sizes');
    const m = F.modelFrom(src), prompt = [1, 5, 9, 2, 33];
    const ids = F.generateIds(m, prompt, 20, []);
    check(ids.length === 20 && ids.every((i) => i >= 0 && i < src.vocab), 'generateIds on ' + JSON.stringify(size));
    // the whole-number DeltaNet layers of ../deltanet.js build on it and mostly agree with the floats
    const mixers = src.types.map((t, l) => (t === 'lin' ? DN.build(src, l).mixer : null));
    const ints = F.generateIds(m, prompt, 20, [], mixers);
    const agree = ids.filter((t, i) => t === ints[i]).length;
    console.log(`synth ${JSON.stringify(size)}: ${src.layers} layers ${src.types.join(' ')}, next tokens ${ids.slice(0, 10).join(' ')} ..., whole-number DeltaNet agrees on ${agree} of 20`);
  }
}

console.log(fails ? `${fails} FAILED` : 'all checks pass');
process.exit(fails ? 1 : 0);
