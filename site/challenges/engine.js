// The brainfuck interpreter that checks the challenges.
self.BFEngine = (function () {
  'use strict';

  const TAPE = 30000, MAX_STEPS = 5e6, MAX_OUT = 20000;
  // a typographic minus (as printed in the lessons) counts as "-"
  const strip = (src) => String(src).replace(/[−–]/g, '-').replace(/[^+\-<>\[\].,]/g, '');
  const length = (src) => strip(src).length;

  function run(src, o) {
    o = o || {};
    const code = strip(src), n = code.length;
    const jump = new Int32Array(n), stack = [];
    for (let i = 0; i < n; i++) {
      const c = code.charCodeAt(i);
      if (c === 91) stack.push(i);
      else if (c === 93) {
        if (!stack.length) return { status: 'brackets', why: 'close', out: '', steps: 0 };
        const j = stack.pop(); jump[i] = j; jump[j] = i;
      }
    }
    if (stack.length) return { status: 'brackets', why: 'open', out: '', steps: 0 };
    const bits = o.bits || 8, size = o.tape || TAPE, max = o.maxSteps || MAX_STEPS, eof = o.eof === undefined ? 0 : o.eof;
    const t = new (bits === 8 ? Uint8Array : bits === 16 ? Uint16Array : Uint32Array)(size);
    const input = String(o.input || ''), out = [];
    let p = 0, pc = 0, steps = 0, ip = 0, status = 'ok';
    for (; pc < n; pc++, steps++) {
      if (steps >= max) { status = 'limit'; break; }
      switch (code.charCodeAt(pc)) {
        case 43: t[p]++; break;
        case 45: t[p]--; break;
        case 62: p++; if (p >= size) { status = 'right'; p--; } break;
        case 60: p--; if (p < 0) { status = 'left'; p++; } break;
        case 46: out.push(t[p] & 255); if (out.length > MAX_OUT) status = 'flood'; break;
        case 44: if (ip < input.length) t[p] = input.charCodeAt(ip++) & 255; else if (eof !== 'same') t[p] = eof; break;
        case 91: if (t[p] === 0) pc = jump[pc]; break;
        case 93: if (t[p] !== 0) pc = jump[pc]; break;
      }
      if (status !== 'ok') break;
    }
    let s = '';
    for (let i = 0; i < out.length; i += 8192) s += String.fromCharCode.apply(null, out.slice(i, i + 8192));
    return { status, out: s, steps };
  }

  // The settings of one test case: those of the challenge, unless the case has its own.
  const settings = (ch, test) => ({ bits: (test && test.bits) || ch.bits || 8, eof: test && test.eof !== undefined ? test.eof : ch.eof === undefined ? 0 : ch.eof, maxSteps: ch.maxSteps || MAX_STEPS });

  function judge(ch, src) {
    const code = strip(src), res = { length: code.length, cases: [], pass: false, steps: 0, banned: '' };
    if (ch.ban) for (const c of ch.ban) if (code.indexOf(c) >= 0) res.banned += c;
    let all = true;
    for (const test of ch.tests) {
      const r = run(code, Object.assign({ input: test.in }, settings(ch, test)));
      const pass = r.status === 'ok' && r.out === test.out;
      if (!pass) all = false;
      res.steps += r.steps;
      res.cases.push({ pass, status: r.status, why: r.why || '', out: r.out, steps: r.steps });
      if (r.status === 'brackets') { for (let i = res.cases.length; i < ch.tests.length; i++) res.cases.push({ pass: false, status: 'brackets', why: r.why, out: '', steps: 0 }); break; }
    }
    res.pass = all && !res.banned && code.length > 0;
    return res;
  }

  return { strip, length, run, judge, settings, TAPE, MAX_STEPS, MAX_OUT };
})();
