// The machine and the test bench of the pattern library, without any page code.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PatCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const strip = (src) => String(src).replace(/[^+\-<>\[\].,]/g, '');

  function matchBrackets(code) {
    const jump = new Int32Array(code.length), stack = [];
    for (let i = 0; i < code.length; i++) {
      if (code[i] === '[') stack.push(i);
      else if (code[i] === ']') {
        if (!stack.length) { const e = new Error('unmatched ]'); e.kind = 'close'; throw e; }
        const j = stack.pop(); jump[i] = j; jump[j] = i;
      }
    }
    if (stack.length) { const e = new Error('unmatched ['); e.kind = 'open'; throw e; }
    return jump;
  }

  const ADD = 0, OUT = 1, IN = 2, JZ = 3, JNZ = 4, CLEAR = 5, MUL = 6, NOP = 9;

  function asMulLoop(body, trailingMove) {
    const delta = new Map();
    let off = 0;
    for (const op of body) {
      if (op.t !== ADD) return null;
      off += op.mv;
      delta.set(off, (delta.get(off) || 0) + op.n);
    }
    if (off + trailingMove !== 0 || delta.get(0) !== -1) return null;
    delta.delete(0);
    return [...delta].filter(([, f]) => f !== 0);
  }

  // The compile step of compiler/core/bf.js. Every op keeps s, e: the piece of text it stands for.
  function compileFast(code) {
    const ops = [], stack = [];
    let mv = 0, mvStart = -1;
    const push = (op, s, e) => { op.mv = mv; op.s = mvStart >= 0 ? mvStart : s; op.e = e; mv = 0; mvStart = -1; ops.push(op); };
    for (let i = 0; i < code.length; i++) {
      const c = code[i], s = i;
      if (c === '+' || c === '-') {
        let n = 0;
        for (; code[i] === '+' || code[i] === '-'; i++) n += code[i] === '+' ? 1 : -1;
        i--;
        if (n) push({ t: ADD, n }, s, i + 1);
      } else if (c === '>' || c === '<') {
        if (mvStart < 0) mvStart = i;
        for (; code[i] === '>' || code[i] === '<'; i++) mv += code[i] === '>' ? 1 : -1;
        i--;
      } else if (c === '.') push({ t: OUT, n: 0 }, s, i + 1);
      else if (c === ',') push({ t: IN, n: 0 }, s, i + 1);
      else if (c === '[') { stack.push(ops.length); push({ t: JZ, n: 0 }, s, i + 1); }
      else {
        const start = stack.pop();
        const mul = asMulLoop(ops.slice(start + 1), mv);
        if (mul) {
          const s0 = ops[start].s;
          mv = ops[start].mv; mvStart = -1;
          ops.length = start;
          push({ t: mul.length ? MUL : CLEAR, n: 0, mul }, s0, i + 1);
        } else {
          push({ t: JNZ, n: start + 1 }, s, i + 1);
          ops[start].n = ops.length;
        }
      }
    }
    if (mv) push({ t: NOP, n: 0 }, mvStart >= 0 ? mvStart : code.length, code.length);
    return ops;
  }

  class Machine {
    constructor(src, o = {}) {
      this.code = strip(src);
      this.bits = o.bits || 8;
      this.size = o.size || 1024;
      this.fast = !!o.fast;
      this.init = o.init || null;
      this.input = o.input || [];
      this.start = o.start || 0;
      this.eof = o.eof || 'zero';
      this.jump = matchBrackets(this.code);
      this.ops = compileFast(this.code);
      this.reset();
    }

    reset() {
      const A = this.bits === 8 ? Uint8Array : this.bits === 16 ? Uint16Array : Uint32Array;
      this.tape = new A(this.size);
      if (this.init) for (const k of Object.keys(this.init)) this.tape[+k] = this.init[k];
      this.p = this.start; this.pc = 0; this.steps = 0; this.inPos = 0; this.out = [];
      this.error = null;       // 'left' | 'right': the pointer left the tape
      this.last = null;        // what the last step did
      return this;
    }

    get length() { return this.fast ? this.ops.length : this.code.length; }
    get done() { return this.error !== null || this.pc >= this.length; }
    span() {
      if (this.done) return null;
      if (!this.fast) return [this.pc, this.pc + 1];
      const op = this.ops[this.pc];
      return [op.s, op.e];
    }
    signed(v) { return v >= 2 ** (this.bits - 1) ? v - 2 ** this.bits : v; }

    read(q) {
      if (this.inPos < this.input.length) this.tape[q] = this.input[this.inPos++];
      else if (this.eof === 'zero') this.tape[q] = 0;
      else if (this.eof === 'minus') this.tape[q] = -1;
    }

    step() {
      if (this.done) return null;
      const t = this.tape;
      let info;
      if (!this.fast) {
        const c = this.code[this.pc];
        info = { c };
        if (c === '+') t[this.p]++;
        else if (c === '-') t[this.p]--;
        else if (c === '>' || c === '<') {
          const q = this.p + (c === '>' ? 1 : -1);
          if (q < 0 || q >= this.size) { this.error = q < 0 ? 'left' : 'right'; this.last = info; return info; }
          this.p = q;
        } else if (c === '.') this.out.push(t[this.p] & 255);
        else if (c === ',') this.read(this.p);
        else if (c === '[') { info.zero = t[this.p] === 0; if (info.zero) this.pc = this.jump[this.pc]; }
        else if (c === ']') { info.zero = t[this.p] === 0; if (!info.zero) this.pc = this.jump[this.pc]; }
        this.pc++;
      } else {
        const op = this.ops[this.pc];
        const q = this.p + op.mv;
        info = { op };
        if (q < 0 || q >= this.size) { this.error = q < 0 ? 'left' : 'right'; this.last = info; return info; }
        this.p = q;
        if (this.track) {
          const k = this.track;
          if (op.t === JZ || op.t === JNZ || op.t === OUT || op.t === MUL || op.t === CLEAR) k.read.add(q);
          if (op.t === ADD || op.t === IN || op.t === CLEAR || (op.t === MUL && t[q] !== 0)) k.write.add(q);
          if (op.t === MUL && t[q] !== 0) for (const [off] of op.mul) k.write.add(q + off);
        }
        switch (op.t) {
          case ADD: t[q] += op.n; this.pc++; break;
          case JZ: info.zero = t[q] === 0; this.pc = info.zero ? op.n : this.pc + 1; break;
          case JNZ: info.zero = t[q] === 0; this.pc = info.zero ? this.pc + 1 : op.n; break;
          case CLEAR: info.v = t[q]; t[q] = 0; this.pc++; break;
          case MUL: {
            const v = t[q];
            info.v = v;
            if (v !== 0) {
              for (const [off, f] of op.mul) {
                const a = q + off;
                if (a < 0 || a >= this.size) { this.error = a < 0 ? 'left' : 'right'; this.last = info; return info; }
                t[a] += v * f;
              }
              t[q] = 0;
            }
            this.pc++;
            break;
          }
          case OUT: this.out.push(t[q] & 255); this.pc++; break;
          case IN: this.read(q); this.pc++; break;
          default: this.pc++;
        }
      }
      this.steps++;
      this.last = info;
      return info;
    }

    // Run until the program ends or `max` steps have been taken in total.
    run(max = 2e7) {
      if (this.fast) { while (!this.done && this.steps < max) this.step(); this.last = null; return this; }
      const t = this.tape, code = this.code, jump = this.jump, n = code.length, size = this.size;
      let p = this.p, pc = this.pc, steps = this.steps;
      for (; pc < n && steps < max && this.error === null; pc++, steps++) {
        switch (code.charCodeAt(pc)) {
          case 43: t[p]++; break;
          case 45: t[p]--; break;
          case 62: if (p + 1 >= size) { this.error = 'right'; pc--; steps--; } else p++; break;
          case 60: if (p - 1 < 0) { this.error = 'left'; pc--; steps--; } else p--; break;
          case 46: this.out.push(t[p] & 255); break;
          case 44: this.read(p); break;
          case 91: if (t[p] === 0) pc = jump[pc]; break;
          case 93: if (t[p] !== 0) pc = jump[pc]; break;
        }
      }
      this.p = p; this.pc = pc; this.steps = steps; this.last = null;
      return this;
    }
  }

  // ---- the bench ---------------------------------------------------------------------------
  const mod = (a, m) => ((a % m) + m) % m;
  const bytes = (text) => {
    const out = [];
    for (const ch of unescape(encodeURIComponent(String(text)))) out.push(ch.charCodeAt(0));
    return out;
  };
  const text = (arr) => arr.map((b) => String.fromCharCode(b)).join('');

  // The widths a variant may run on.
  const widths = (v) => v.bits || [8, 16, 32];

  const fields = (v) => [...(v.consts || []), ...(v.vars || [])];
  function defaults(v) { const o = {}; for (const f of fields(v)) o[f.id] = f.def; return o; }
  function parseField(f, raw) {
    if (f.type === 'text') { let s = String(raw); if (f.max && s.length > f.max) s = s.slice(0, f.max); return s; }
    if (f.type === 'list') {
      let a = Array.isArray(raw) ? raw.slice() : String(raw).split(/[^0-9\-]+/).filter((s) => /^-?\d+$/.test(s)).map(Number);
      a = a.map((x) => Math.min(f.max, Math.max(f.min, Math.round(x))));
      if (a.length > f.len[1]) a = a.slice(0, f.len[1]);
      while (a.length < f.len[0]) a.push(f.min > 0 ? f.min : 0);
      return a;
    }
    if (f.type === 'choice') return f.options.some((o) => String(o[0]) === String(raw)) ? (typeof f.def === 'number' ? Number(raw) : raw) : f.def;
    let x = Math.round(Number(raw));
    if (!Number.isFinite(x)) x = f.def;
    return Math.min(f.max, Math.max(f.min, x));
  }

  // The program text of a variant for these constants and this width.
  function program(v, vals, bits, G) {
    if (typeof v.code === 'string') return { code: v.code };
    if (v.gen && !G) throw new Error('this pattern needs the project generators (emit.js, patterns.js)');
    const r = v.code(vals, bits, G);
    return typeof r === 'string' ? { code: r } : r;
  }

  function bench(v, vals, bits, G, o = {}) {
    const prog = program(v, vals, bits, G);
    const size = (typeof v.size === 'function' ? v.size(vals, bits) : v.size) || 256;
    const start = (typeof v.start === 'function' ? v.start(vals, bits) : v.start) || 0;
    const init = v.init ? v.init(vals, bits, prog) : {};
    const input = v.input ? bytes(v.input(vals, bits)) : [];
    const eof = o.eof || v.eof || 'zero';
    const mk = (fast) => new Machine(prog.code, { bits, size, init, input, start, eof, fast });
    const fast = mk(true).run(o.fastMax || 3e7);
    const plainMax = o.plainMax === undefined ? 3e7 : o.plainMax;
    const plain = plainMax ? mk(false).run(plainMax) : null;
    const want = v.expect ? v.expect(vals, bits, prog, eof) : null;
    const problems = [];
    const finished = (m) => m.pc >= m.length && !m.error;
    if (fast.error) problems.push('the pointer left the tape on the ' + fast.error);
    else if (!finished(fast)) problems.push('did not finish in ' + fast.steps + ' optimised steps');
    else if (want) {
      const size2 = 2 ** bits, wt = want.tape || {};
      for (let a = 0; a < size; a++) {
        const w = mod(wt[a] || 0, size2);
        if (fast.tape[a] !== w) { problems.push('cell ' + a + ' holds ' + fast.tape[a] + ', expected ' + w); if (problems.length > 4) break; }
      }
      const wp = want.ptr === undefined ? start : want.ptr;
      if (wp !== null && fast.p !== wp) problems.push('pointer ends on cell ' + fast.p + ', expected ' + wp);
      if (want.out !== undefined) {
        const wo = Array.isArray(want.out) ? want.out : bytes(want.out);      // a text, or bytes
        if (text(fast.out) !== text(wo)) problems.push('printed ' + JSON.stringify(text(fast.out)) + ', expected ' + JSON.stringify(text(wo)));
      }
    }
    let plainDone = false;
    if (plain) {
      plainDone = finished(plain);
      if (plainDone && finished(fast)) {
        if (plain.p !== fast.p) problems.push('plain and optimised runs end on different cells');
        if (text(plain.out) !== text(fast.out)) problems.push('plain and optimised runs print different text');
        for (let a = 0; a < size; a++) if (plain.tape[a] !== fast.tape[a]) { problems.push('plain and optimised runs differ in cell ' + a); break; }
      }
    }
    return {
      code: prog.code, prog, size, start, init, input, eof, want, problems, ok: problems.length === 0,
      fast: fast.steps, plain: plain && plainDone ? plain.steps : null,
      tape: fast.tape, p: fast.p, out: text(fast.out),
    };
  }

  function picture(v, vals, bits, G, o = {}) {
    const r = bench(v, vals, bits, G, Object.assign({ plainMax: 3e6, fastMax: 3e6 }, o));
    const m = new Machine(r.code, { bits, size: r.size, init: r.init, input: r.input, start: r.start, eof: r.eof, fast: true });
    m.track = { read: new Set(), write: new Set() };
    while (!m.done && m.steps < 3e5) m.step();
    const lab = typeof v.labels === 'function' ? v.labels(vals, bits, r.prog) : v.labels || {};
    const before = new (bits === 8 ? Uint8Array : bits === 16 ? Uint16Array : Uint32Array)(r.size);
    for (const k of Object.keys(r.init)) before[+k] = r.init[k];
    const want = new Set([r.start, r.p]);
    for (const k of Object.keys(lab)) want.add(+k);
    for (let a = 0; a < r.size; a++) if (before[a] !== 0 || r.tape[a] !== 0) want.add(a);
    for (const a of m.track.write) want.add(a);
    let list = [...want].filter((a) => a >= 0 && a < r.size).sort((a, b) => a - b);
    const items = [];
    const lo = list[0], hi = list[list.length - 1];
    if (hi - lo < 14) for (let a = lo; a <= hi; a++) items.push(a);
    else { if (list.length > 44) list = list.slice(0, 36).concat(list.slice(-6)); list.forEach((a, i) => { if (i && a !== list[i - 1] + 1) items.push(-1); items.push(a); }); }
    const changed = new Set();
    for (let a = 0; a < r.size; a++) if (before[a] !== r.tape[a]) changed.add(a);
    return { r, items, labels: lab, before, after: r.tape, start: r.start, end: r.p, read: m.track.read, changed, signed: !!v.signed };
  }

  // Is this variant defined for these values on this width? (e.g. a product that must fit)
  const allowed = (v, vals, bits) => widths(v).includes(bits) && (!v.ok || v.ok(vals, bits));

  return { strip, matchBrackets, compileFast, Machine, bench, picture, program, widths, fields, defaults, parseField, allowed, text };
});
