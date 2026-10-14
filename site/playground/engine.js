// Everything of the playground that is not page code (the pages and fastworker.js load it).
(function (root, factory) {
  root.PG = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULTS = Object.freeze({
    bits: 8,            // 8 | 16 | 32
    overflow: 'wrap',   // 'wrap' | 'error'   what happens when a cell passes its limit
    size: 30000,        // number of cells
    edge: 'error',      // 'error' | 'wrap'   what happens when the pointer leaves the tape
    eof: 'zero',        // 'zero' | 'minus1' | 'same'   what , stores when the input has ended
    ask: true,          // ask for more input when the box has run out (false: end of input at once)
    newline: 'lf',      // 'lf' | 'crlf'      how a line break in the input box is sent
    bp: '',             // '' | '#' | '!'     a character that pauses a running program
    engine: 'checked',  // 'checked' | 'wasm' what fast mode runs on
  });
  const HISTORY = 200000;        // steps that can be taken back
  const MAX_TAPE = 1 << 24;      // 16,777,216 cells

  function cleanSettings(s) {
    const o = Object.assign({}, DEFAULTS), pick = (k, list) => { if (s && list.indexOf(s[k]) >= 0) o[k] = s[k]; };
    pick('bits', [8, 16, 32]); pick('overflow', ['wrap', 'error']); pick('edge', ['error', 'wrap']);
    pick('eof', ['zero', 'minus1', 'same']); pick('newline', ['lf', 'crlf']); pick('bp', ['', '#', '!']); pick('engine', ['checked', 'wasm']);
    if (s && typeof s.ask === 'boolean') o.ask = s.ask;
    if (s && Number.isFinite(+s.size)) o.size = Math.min(MAX_TAPE, Math.max(1, Math.floor(+s.size)));
    return o;
  }
  // one line that says which interpreter is selected
  function describeSettings(s) {
    const n = (x) => x.toLocaleString('en-US');
    return [s.bits + '-bit cells that ' + (s.overflow === 'wrap' ? 'wrap round' : 'stop the program when they pass their limit'),
      n(s.size) + ' cells', 'leaving the tape ' + (s.edge === 'wrap' ? 'wraps to the other end' : 'is an error'),
      'end of input ' + (s.eof === 'zero' ? 'stores 0' : s.eof === 'minus1' ? 'stores −1 (' + n(2 ** s.bits - 1) + ')' : 'leaves the cell unchanged')].join(' · ');
  }
  const isClassic = (s) => s.bits === 8 && s.overflow === 'wrap' && s.size === 30000 && s.edge === 'error' && s.eof === 'zero';

  // ------------------------------------------------------------------ text and bytes
  const CODE = new Uint8Array(128);
  '+-><.,[]'.split('').forEach((c, i) => { CODE[c.charCodeAt(0)] = i + 1; });
  const SYM = ' +-><.,[]';
  const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  const utf8 = (s) => enc.encode(String(s));
  function fromUtf8(bytes) { return new TextDecoder('utf-8').decode(bytes); }
  // the text of the input box -> the bytes the program reads
  function inputBytes(text, newline, escapes) {
    let t = String(text).replace(/\r\n?/g, '\n');
    if (!escapes) { if (newline === 'crlf') t = t.replace(/\n/g, '\r\n'); return utf8(t); }
    const out = [];
    const push = (s) => { for (const b of utf8(newline === 'crlf' ? s.replace(/\n/g, '\r\n') : s)) out.push(b); };
    const re = /\\(x[0-9a-fA-F]{2}|n|r|t|0|\\)/g;
    let last = 0, m;
    while ((m = re.exec(t))) {
      push(t.slice(last, m.index)); last = re.lastIndex;
      const e = m[1];
      out.push(e === 'n' ? 10 : e === 'r' ? 13 : e === 't' ? 9 : e === '0' ? 0 : e === '\\' ? 92 : parseInt(e.slice(1), 16));
    }
    push(t.slice(last));
    return Uint8Array.from(out);
  }
  function lineCol(src, pos) {
    let line = 1, start = 0;
    for (let i = src.indexOf('\n'); i >= 0 && i < pos; i = src.indexOf('\n', i + 1)) { line++; start = i + 1; }
    return { line, col: pos - start + 1 };
  }
  const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : String(n));

  // ------------------------------------------------------------------ parse
  function parse(src, bp) {
    src = String(src);
    const len = src.length, bpc = bp ? bp.charCodeAt(0) : -1;
    let n = 0;
    for (let i = 0; i < len; i++) { const c = src.charCodeAt(i); if ((c < 128 && CODE[c] !== 0) || c === bpc) n++; }
    const op = new Uint8Array(n + 1), pos = new Int32Array(n + 1), jump = new Int32Array(n + 1), line = new Int32Array(n + 1);
    const stack = [], errors = [];
    let k = 0, ln = 0;
    for (let i = 0; i < len; i++) {
      const c = src.charCodeAt(i);
      if (c === 10) { ln++; continue; }
      const t = c === bpc ? 9 : c < 128 ? CODE[c] : 0;
      if (t === 0) continue;
      op[k] = t; pos[k] = i; line[k] = ln;
      if (t === 7) stack.push(k);
      else if (t === 8) {
        if (stack.length === 0) errors.push({ pos: i, ch: ']' });
        else { const j = stack.pop(); jump[k] = j; jump[j] = k; }
      }
      k++;
    }
    for (const j of stack) errors.push({ pos: pos[j], ch: '[' });
    errors.sort((a, b) => a.pos - b.pos);
    for (const e of errors.slice(0, 50)) {
      Object.assign(e, lineCol(src, e.pos));
      e.message = 'Line ' + e.line + ', column ' + e.col + ': this ' + e.ch + (e.ch === '[' ? ' is never closed by a ]' : ' has no [ before it to close');
    }
    pos[n] = len; line[n] = ln;
    return { src, n, op, pos, jump, line, errors, bp: bp || '' };
  }
  // the command at or after a place in the text (for "run to cursor")
  function opAt(prog, textPos) {
    let lo = 0, hi = prog.n;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (prog.pos[mid] < textPos) lo = mid + 1; else hi = mid; }
    return lo;
  }

  // ------------------------------------------------------------------ the debugger's machine
  class Machine {
    constructor(prog, settings, input) {
      this.prog = prog; this.set = cleanSettings(settings);
      this.size = this.set.size; this.max = 2 ** this.set.bits - 1;
      const T = this.set.bits === 8 ? Uint8Array : this.set.bits === 16 ? Uint16Array : Uint32Array;
      this.tape = new T(this.size);
      this.hPc = new Int32Array(HISTORY); this.hP = new Int32Array(HISTORY); this.hV = new Uint32Array(HISTORY); this.hF = new Uint8Array(HISTORY);
      this.inp = new Uint8Array(0); this.out = new Uint8Array(256);
      this.reset(input);
    }
    reset(input) {
      this.tape.fill(0);
      this.p = 0; this.pc = 0; this.steps = 0; this.hi = 0; this.wrapped = false;
      this.hHead = 0; this.hLen = 0;
      if (input) { this.inp = Uint8Array.from(input); this.inLen0 = this.inp.length; }
      else if (this.inLen0 === undefined) this.inLen0 = 0;
      this.inLen = this.inLen0; this.inPos = 0; this.eofSent = false;
      this.outLen = 0; this.error = null;
      this.state = this.prog.errors.length ? 'error' : this.prog.n === 0 ? 'done' : 'ready';
      if (this.prog.errors.length) this.error = { kind: 'bracket', message: this.prog.errors[0].message };
    }
    // more input, typed while the program was waiting
    provide(bytes) {
      if (this.inLen + bytes.length > this.inp.length) { const b = new Uint8Array(Math.max(64, (this.inLen + bytes.length) * 2)); b.set(this.inp.subarray(0, this.inLen)); this.inp = b; }
      this.inp.set(bytes, this.inLen); this.inLen += bytes.length;
      if (this.state === 'input') this.state = 'ready';
    }
    endInput() { this.eofSent = true; if (this.state === 'input') this.state = 'ready'; }
    output() { return this.out.subarray(0, this.outLen); }
    _fail(kind, message) { this.state = 'error'; this.error = { kind, message }; }
    run(limit, stopPc, bps) {
      if (this.state === 'input' && (this.inPos < this.inLen || this.eofSent || !this.set.ask)) this.state = 'ready';
      if (this.state !== 'ready') return this.state;
      if (stopPc === undefined) stopPc = -1;
      if (!bps) bps = null;
      const prog = this.prog, op = prog.op, jump = prog.jump, line = prog.line, n = prog.n, tape = this.tape, size = this.size, max = this.max;
      const wrapCell = this.set.overflow === 'wrap', wrapEdge = this.set.edge === 'wrap', eof = this.set.eof, ask = this.set.ask;
      const hPc = this.hPc, hP = this.hP, hV = this.hV, hF = this.hF;
      let pc = this.pc, p = this.p, steps = this.steps, hHead = this.hHead, hLen = this.hLen, hi = this.hi, res = 'limit', count = 0;
      loop: while (count < limit) {
        if (pc >= n) { this.state = 'done'; res = 'done'; break; }
        const c = op[pc], v = tape[p], pc0 = pc, p0 = p;
        let f = 0;
        switch (c) {
          case 1:
            if (v === max && !wrapCell) { this._fail('over', 'Cell ' + p + ' holds ' + fmt(max) + ', the largest value, and + would go past it. With wrapping off the program stops here.'); res = 'error'; break loop; }
            tape[p] = v + 1; pc++; break;
          case 2:
            if (v === 0 && !wrapCell) { this._fail('under', 'Cell ' + p + ' holds 0 and − would go below it. With wrapping off the program stops here.'); res = 'error'; break loop; }
            tape[p] = v - 1; pc++; break;
          case 3:
            if (p === size - 1) {
              if (!wrapEdge) { this._fail('right', 'The pointer is on the last cell (' + fmt(p) + ') and > would move it off the right end of the tape.'); res = 'error'; break loop; }
              p = 0; this.wrapped = true;
            } else p++;
            if (p > hi) hi = p;
            pc++; break;
          case 4:
            if (p === 0) {
              if (!wrapEdge) { this._fail('left', 'The pointer is on cell 0 and < would move it off the left end of the tape.'); res = 'error'; break loop; }
              p = size - 1; this.wrapped = true;
            } else p--;
            pc++; break;
          case 5:
            if (this.outLen === this.out.length) { const b = new Uint8Array(this.out.length * 2); b.set(this.out); this.out = b; }
            this.out[this.outLen++] = v & 255; pc++; break;
          case 6:
            if (this.inPos < this.inLen) { tape[p] = this.inp[this.inPos++]; f = 1; }
            else if (ask && !this.eofSent) { this.state = 'input'; res = 'input'; break loop; }
            else { if (eof === 'zero') tape[p] = 0; else if (eof === 'minus1') tape[p] = max; f = 2; }
            pc++; break;
          case 7: pc = v === 0 ? jump[pc] + 1 : pc + 1; break;
          case 8: pc = v !== 0 ? jump[pc] + 1 : pc + 1; break;
          default: pc++; f = 3;
        }
        hPc[hHead] = pc0; hP[hHead] = p0; hV[hHead] = v; hF[hHead] = f;
        if (++hHead === HISTORY) hHead = 0;
        if (hLen < HISTORY) hLen++;
        count++;
        if (c === 9) { res = 'break'; break; }
        steps++;
        if (pc === stopPc) { res = 'cursor'; break; }
        if (bps !== null && bps[pc] === 1 && line[pc] !== line[pc0]) { res = 'bp'; break; }
      }
      this.pc = pc; this.p = p; this.steps = steps; this.hHead = hHead; this.hLen = hLen; this.hi = hi;
      if (res !== 'error' && res !== 'input' && pc >= n) { this.state = 'done'; if (res === 'limit') res = 'done'; }
      return res;
    }
    // take back one step; false when there is no history left
    back() {
      if (this.hLen === 0) return false;
      const h = this.hHead === 0 ? HISTORY - 1 : this.hHead - 1;
      this.hHead = h; this.hLen--;
      const pc = this.hPc[h], p = this.hP[h], c = this.prog.op[pc], f = this.hF[h];
      if (c === 1 || c === 2 || c === 6) this.tape[p] = this.hV[h];
      else if (c === 5) this.outLen--;
      if (c === 6 && f === 1) this.inPos--;
      if (c !== 9) this.steps--;
      this.pc = pc; this.p = p; this.state = 'ready'; this.error = null;
      return true;
    }
    // the step that was done last: { pc, p, old, flag } or null
    last() {
      if (this.hLen === 0) return null;
      const h = this.hHead === 0 ? HISTORY - 1 : this.hHead - 1;
      return { pc: this.hPc[h], p: this.hP[h], old: this.hV[h], flag: this.hF[h] };
    }
    // the position after the loop this command is in (-1: not in a loop)
    loopExit(pc) {
      const op = this.prog.op, jump = this.prog.jump;
      for (let i = pc - 1; i >= 0; i--) { if (op[i] === 8) i = jump[i]; else if (op[i] === 7) return jump[i] + 1; }
      return -1;
    }
    load(st) {
      this.tape.fill(0); this.tape.set(st.tape.subarray(0, Math.min(st.tape.length, this.size)));
      this.p = st.p; this.pc = st.done ? this.prog.n : opAt(this.prog, st.textPos); this.steps = st.steps;
      this.hHead = 0; this.hLen = 0; this.hi = Math.max(st.p, st.tape.length - 1, 0); this.wrapped = false;
      if (st.input) { this.inp = Uint8Array.from(st.input); this.inLen = this.inp.length; }
      this.inPos = st.inPos || 0; this.eofSent = !!st.eofSent;
      this.out = st.out.length ? Uint8Array.from(st.out) : new Uint8Array(256); this.outLen = st.out.length;
      this.error = st.error ? { kind: 'fast', message: st.error } : null;
      this.state = st.error ? 'error' : this.pc >= this.prog.n ? 'done' : 'ready';
    }
  }

  // ------------------------------------------------------------------ the explanation line
  function charName(v) {
    const b = v & 255;
    if (b > 32 && b < 127) return 'the character ' + String.fromCharCode(b);
    return b === 32 ? 'a space' : b === 10 ? 'a line break' : b === 9 ? 'a tab' : 'byte ' + b + ', which is not a visible character';
  }
  const defaultName = (i) => 'cell ' + fmt(i);
  // What the command under the marker is about to do. name(i) -> "cell 3" or "cell 3 (total)".
  function explainNext(m, name) {
    name = name || defaultName;
    if (m.state === 'done') return '';
    const prog = m.prog, pc = m.pc, c = prog.op[pc], p = m.p, v = m.tape[p], max = m.max, here = name(p);
    const wrapCell = m.set.overflow === 'wrap', wrapEdge = m.set.edge === 'wrap';
    const where = (k) => { const lc = lineCol(prog.src, prog.pos[k]); return 'line ' + lc.line + ', column ' + lc.col; };
    switch (c) {
      case 1:
        if (v === max) return wrapCell ? '+ adds 1 to ' + here + ': ' + fmt(v) + ' is the largest value, so it goes round to 0.' : '+ would push ' + here + ' past ' + fmt(max) + ', its largest value. With wrapping off the program stops here.';
        return '+ adds 1 to ' + here + ': ' + fmt(v) + ' becomes ' + fmt(v + 1) + '.';
      case 2:
        if (v === 0) return wrapCell ? '− takes 1 from ' + here + ': it holds 0, so it goes round to ' + fmt(max) + '.' : '− would push ' + here + ' below 0. With wrapping off the program stops here.';
        return '− takes 1 from ' + here + ': ' + fmt(v) + ' becomes ' + fmt(v - 1) + '.';
      case 3:
        if (p === m.size - 1) return wrapEdge ? '> moves the pointer off the right end of the tape, so it wraps round to ' + name(0) + '.' : '> would move the pointer off the right end of the tape. The program stops here.';
        return '> moves the pointer right, to ' + name(p + 1) + '.';
      case 4:
        if (p === 0) return wrapEdge ? '< moves the pointer left of cell 0, so it wraps round to ' + name(m.size - 1) + '.' : '< would move the pointer left of cell 0, off the tape. The program stops here.';
        return '< moves the pointer left, to ' + name(p - 1) + '.';
      case 5:
        return '. prints ' + here + (v > 255 ? ' (' + fmt(v) + ', of which only the low 8 bits count: ' + (v & 255) + ')' : ' (' + fmt(v) + ')') + ' as ' + charName(v) + '.';
      case 6:
        if (m.inPos < m.inLen) { const b = m.inp[m.inPos]; return ', reads the next byte of the input (' + b + ', ' + charName(b) + ') into ' + here + '.'; }
        if (m.set.ask && !m.eofSent) return ', wants to read a byte, but the input has run out: it will ask you for one.';
        return ', finds no input left, so ' + (m.set.eof === 'zero' ? 'it puts 0 into ' + here : m.set.eof === 'minus1' ? 'it puts −1 (' + fmt(max) + ') into ' + here : 'it leaves ' + here + ' as it is (' + fmt(v) + ')') + '.';
      case 7:
        return '[ asks: is ' + here + ' zero? ' + (v === 0 ? 'Yes, so it jumps past the matching ] (' + where(prog.jump[pc]) + ').' : 'No, it holds ' + fmt(v) + ', so the loop starts.');
      case 8:
        return '] asks: is ' + here + ' zero? ' + (v === 0 ? 'Yes, so the loop is over.' : 'No, it holds ' + fmt(v) + ', so back to the matching [ (' + where(prog.jump[pc]) + ') for another round.');
      default:
        return prog.bp + ' is a breakpoint mark: a running program pauses here. Nothing on the tape changes.';
    }
  }
  // What the last step did (from the history), or '' when there is none.
  function explainLast(m, name) {
    name = name || defaultName;
    const l = m.last();
    if (!l) return '';
    const c = m.prog.op[l.pc], here = name(l.p), now = m.tape[l.p];
    switch (c) {
      case 1: return '+ added 1 to ' + here + ': ' + fmt(l.old) + ' became ' + fmt(now) + '.';
      case 2: return '− took 1 from ' + here + ': ' + fmt(l.old) + ' became ' + fmt(now) + '.';
      case 3: return '> moved the pointer from ' + name(l.p) + ' to ' + name(m.p) + '.';
      case 4: return '< moved the pointer from ' + name(l.p) + ' to ' + name(m.p) + '.';
      case 5: return '. printed ' + here + ' (' + fmt(l.old) + ') as ' + charName(l.old) + '.';
      case 6: return l.flag === 1 ? ', read byte ' + now + ' (' + charName(now) + ') into ' + here + '.' : ', found no input left' + (now === l.old ? ' and left ' + here + ' at ' + fmt(now) : ' and put ' + fmt(now) + ' into ' + here) + '.';
      case 7: return '[ found ' + here + (l.old === 0 ? ' at zero and skipped the loop.' : ' at ' + fmt(l.old) + ', not zero, and went into the loop.');
      case 8: return '] found ' + here + (l.old === 0 ? ' at zero and left the loop.' : ' at ' + fmt(l.old) + ', not zero, and went back to the start of the loop.');
      default: return 'The breakpoint mark ' + m.prog.bp + ' paused the program.';
    }
  }
  // The tape in words, for screen readers and for the "tape in words" box.
  function describeTape(m, name, most) {
    name = name || defaultName; most = most || 12;
    const parts = [], t = m.tape, end = m.wrapped ? m.size : Math.min(m.size, m.hi + 1);
    let more = 0;
    for (let i = 0; i < end; i++) if (t[i] !== 0) { if (parts.length < most) parts.push(name(i) + ' = ' + fmt(t[i])); else more++; }
    const v = t[m.p];
    return 'The pointer is on ' + name(m.p) + ', which holds ' + fmt(v) + (v > 31 && v < 127 ? ' (' + charName(v) + ')' : '') + '. ' +
      (parts.length ? 'Cells that are not zero: ' + parts.join(', ') + (more ? ' and ' + fmt(more) + ' more' : '') + '.' : 'Every cell is zero.');
  }

  // ------------------------------------------------------------------ fast mode
  const ADD = 0, OUT = 1, IN = 2, JZ = 3, JNZ = 4, CLEAR = 5, MUL = 6, NOP = 9;
  function compileFast(src, opts) {
    opts = opts || {};
    const isStr = typeof src === 'string', len = src.length, exact = !!opts.exact, wrapEdge = !!opts.wrapEdge, size = opts.size || 30000;
    let cap = 1024, n = 0;
    let T = new Uint8Array(cap), N = new Int32Array(cap), M = new Int32Array(cap), Lo = new Int32Array(cap), Hi = new Int32Array(cap), C = new Int32Array(cap), S = new Int32Array(cap);
    const grow = () => {
      cap *= 2;
      const g = (a) => { const b = new a.constructor(cap); b.set(a); return b; };
      T = g(T); N = g(N); M = g(M); Lo = g(Lo); Hi = g(Hi); C = g(C); S = g(S);
    };
    const X = [];
    const stack = [];
    let mv = 0, lo = 0, hi = 0, mvc = 0, start = -1;      // the pointer movement waiting for the next op
    const push = (t, nn, at, cost) => {
      if (n === cap) grow();
      T[n] = t; N[n] = nn; M[n] = mv; Lo[n] = lo; Hi[n] = hi; C[n] = mvc + cost; S[n] = start >= 0 ? start : at;
      mv = lo = hi = mvc = 0; start = -1; n++;
    };
    let i = 0;
    while (i < len) {
      const ch = isStr ? src.charCodeAt(i) : src[i], c = ch < 128 ? CODE[ch] : 0;
      if (c === 0) { i++; continue; }
      if (c === 1 || c === 2) {
        const at = i; let k = 0, cnt = 0;
        for (; i < len; i++) {
          const dh = isStr ? src.charCodeAt(i) : src[i], d = dh < 128 ? CODE[dh] : 0;
          if (d === 0) continue;
          if (d !== 1 && d !== 2) break;
          if (exact && d !== c) break;
          k += d === 1 ? 1 : -1; cnt++;
        }
        push(ADD, k, at, cnt);
        continue;
      }
      if (c === 3 || c === 4) {
        if (start < 0) start = i;
        mv += c === 3 ? 1 : -1; mvc++;
        if (mv < lo) lo = mv; if (mv > hi) hi = mv;
      } else if (c === 5) push(OUT, 0, i, 1);
      else if (c === 6) push(IN, i, i, 1);
      else if (c === 7) { stack.push(n); push(JZ, 0, i, 1); }
      else {
        if (!stack.length) throw new Error('unmatched ]');
        const s = stack.pop();
        // is the body only adds and moves, back where it started, taking exactly 1 from its own cell?
        let ok = true, off = 0, blo = 0, bhi = 0, body = mvc;
        const delta = new Map();
        for (let j = s + 1; j < n && ok; j++) {
          if (T[j] !== ADD) { ok = false; break; }
          if (off + Lo[j] < blo) blo = off + Lo[j];
          if (off + Hi[j] > bhi) bhi = off + Hi[j];
          off += M[j]; body += C[j];
          delta.set(off, (delta.get(off) || 0) + N[j]);
        }
        if (ok) {
          if (off + lo < blo) blo = off + lo;
          if (off + hi > bhi) bhi = off + hi;
          if (off + mv !== 0 || delta.get(0) !== -1) ok = false;
          else if (exact && !(n === s + 2 && body === 1)) ok = false;       // cells that do not wrap: only [-] itself
          else if (wrapEdge && bhi - blo >= size) ok = false;                // a tiny round tape: a target could be the cell itself
        }
        if (ok) {
          delta.delete(0);
          const pairs = [...delta].filter((e) => e[1] !== 0);
          // the loop becomes one op that keeps the moves folded into its [
          const at = S[s], m0 = M[s], l0 = Lo[s], h0 = Hi[s], c0 = C[s] - 1;
          n = s; mv = m0; lo = l0; hi = h0; mvc = c0; start = at;
          if (pairs.length === 0 && blo === 0 && bhi === 0) push(CLEAR, body, at, 0);
          else { const k = X.length; X.push(pairs.length, blo, bhi, body); for (const e of pairs) X.push(e[0], e[1]); push(MUL, k, at, 0); }
        } else {
          push(JNZ, s + 1, i, 1);
          N[s] = n;
        }
      }
      i++;
    }
    if (stack.length) throw new Error('unmatched [');
    if (mvc) push(NOP, 0, len, 0);
    return { T: T.subarray(0, n), N: N.subarray(0, n), M: M.subarray(0, n), Lo: Lo.subarray(0, n), Hi: Hi.subarray(0, n), C: C.subarray(0, n), S: S.subarray(0, n), X: Int32Array.from(X), length: n, srcLength: len };
  }

  class Fast {
    constructor(src, settings, input) {
      this.set = cleanSettings(settings);
      this.size = this.set.size; this.max = 2 ** this.set.bits - 1;
      this.code = compileFast(src, { exact: this.set.overflow === 'error', wrapEdge: this.set.edge === 'wrap', size: this.size });
      const T = this.set.bits === 8 ? Uint8Array : this.set.bits === 16 ? Uint16Array : Uint32Array;
      this.tape = new T(this.size);
      this.p = 0; this.pc = 0; this.steps = 0; this.state = 'ready'; this.error = null; this.errorPos = -1;
      this.inp = input ? Uint8Array.from(input) : new Uint8Array(0); this.inLen = this.inp.length; this.inPos = 0; this.eofSent = false;
      this.out = new Uint8Array(4096); this.outLen = 0; this.pend = false;
    }
    provide(bytes) { const b = new Uint8Array(this.inLen + bytes.length); b.set(this.inp.subarray(0, this.inLen)); b.set(bytes, this.inLen); this.inp = b; this.inLen = b.length; if (this.state === 'input') this.state = 'ready'; }
    endInput() { this.eofSent = true; if (this.state === 'input') this.state = 'ready'; }
    takeOutput() { const o = this.out.slice(0, this.outLen); this.outLen = 0; return o; }
    // where in the program text the run stands (for handing over to the debugger)
    textPos() { const c = this.code; return this.pc >= c.length ? c.srcLength : this.pend ? c.N[this.pc] : c.S[this.pc]; }
    _fail(msg, pos) { this.state = 'error'; this.error = msg; this.errorPos = pos; return 'error'; }
    // Run at most `budget` ops. Returns 'limit' | 'done' | 'error' | 'input'.
    run(budget) {
      if (this.state === 'input' && (this.inPos < this.inLen || this.eofSent || !this.set.ask)) this.state = 'ready';
      if (this.state !== 'ready') return this.state;
      const { T, N, M, Lo, Hi, C, S, X, length } = this.code;
      const tape = this.tape, size = this.size, max = this.max, exact = this.set.overflow === 'error', wrapEdge = this.set.edge === 'wrap', eof = this.set.eof, ask = this.set.ask;
      let p = this.p, pc = this.pc, steps = this.steps, pend = this.pend, v = 0, k = 0, t = 0;
      let res = 'limit';
      while (budget-- > 0) {
        if (pc >= length) { res = 'done'; this.state = 'done'; break; }
        if (pend) { pend = false; steps++; }
        else {
          if (wrapEdge) { if (M[pc] !== 0) { p = (p + M[pc]) % size; if (p < 0) p += size; } }
          else {
            if (p + Lo[pc] < 0) { res = this._fail('The pointer moved off the left end of the tape (left of cell 0).', S[pc]); break; }
            if (p + Hi[pc] >= size) { res = this._fail('The pointer moved off the right end of the tape (past cell ' + fmt(size - 1) + ').', S[pc]); break; }
            p += M[pc];
          }
          steps += C[pc];
        }
        switch (T[pc]) {
          case ADD:
            if (exact) {
              v = tape[p] + N[pc];
              if (v < 0 || v > max) { res = this._fail('Cell ' + fmt(p) + ' would pass its limit (' + (v < 0 ? 'below 0' : 'above ' + fmt(max)) + '). With wrapping off the program stops.', S[pc]); break; }
              tape[p] = v;
            } else tape[p] += N[pc];
            pc++; break;
          case JZ: pc = tape[p] === 0 ? N[pc] : pc + 1; break;
          case JNZ: pc = tape[p] !== 0 ? N[pc] : pc + 1; break;
          case CLEAR: v = tape[p]; steps += 1 + v * (N[pc] + 1); tape[p] = 0; pc++; break;
          case MUL:
            v = tape[p]; steps++;
            if (v !== 0) {
              k = N[pc];
              if (!wrapEdge) {
                if (p + X[k + 1] < 0) { res = this._fail('The pointer moved off the left end of the tape (left of cell 0) inside a loop.', S[pc]); break; }
                if (p + X[k + 2] >= size) { res = this._fail('The pointer moved off the right end of the tape inside a loop.', S[pc]); break; }
                for (let q = k + 4, end = q + 2 * X[k]; q < end; q += 2) { t = p + X[q]; tape[t] = tape[t] + Math.imul(v, X[q + 1]); }
              } else {
                for (let q = k + 4, end = q + 2 * X[k]; q < end; q += 2) { t = (p + X[q]) % size; if (t < 0) t += size; tape[t] = tape[t] + Math.imul(v, X[q + 1]); }
              }
              tape[p] = 0; steps += v * (X[k + 3] + 1);
            }
            pc++; break;
          case OUT:
            if (this.outLen === this.out.length) { const b = new Uint8Array(this.out.length * 2); b.set(this.out); this.out = b; }
            this.out[this.outLen++] = tape[p] & 255; pc++; break;
          case IN:
            if (this.inPos < this.inLen) tape[p] = this.inp[this.inPos++];
            else if (ask && !this.eofSent) { pend = true; steps--; res = 'input'; this.state = 'input'; break; }
            else if (eof === 'zero') tape[p] = 0; else if (eof === 'minus1') tape[p] = max;
            pc++; break;
          default: pc++;
        }
        if (res !== 'limit') break;
      }
      this.p = p; this.pc = pc; this.steps = steps; this.pend = pend;
      if (res === 'limit' && pc >= length) { res = 'done'; this.state = 'done'; }
      return res;
    }
  }

  // ------------------------------------------------------------------ analysis without running
  function analyse(prog, settings) {
    const set = cleanSettings(settings), src = prog.src, op = prog.op, n = prog.n;
    const counts = { '+': 0, '-': 0, '>': 0, '<': 0, '.': 0, ',': 0, '[': 0, ']': 0 };
    let depth = 0, maxDepth = 0, bps = 0;
    for (let k = 0; k < n; k++) {
      if (op[k] === 9) { bps++; continue; }
      counts[SYM[op[k]]]++;
      if (op[k] === 7) { depth++; if (depth > maxDepth) maxDepth = depth; } else if (op[k] === 8) depth--;
    }
    let comment = 0;
    for (let i = 0; i < src.length; i++) { const c = src.charCodeAt(i); if (c > 32 && !(c < 128 && CODE[c])) comment++; }
    const res = { counts, commands: n - bps, comment, depth: maxDepth, errors: prog.errors, warnings: [], idioms: [], idiomCount: 0, optimised: 0, breakpoints: bps };
    if (prog.errors.length) return res;
    const CAP = 60;
    const at = (k) => lineCol(src, prog.pos[k]);
    const snippet = (a, b) => { let s = ''; for (let k = a; k <= b && s.length < 25; k++) if (op[k] !== 9) s += SYM[op[k]]; return b - a + 1 > 24 ? s.slice(0, 22) + '…' : s; };
    const warn = (a, b, text) => { if (res.warnings.length < CAP) res.warnings.push(Object.assign({ pos: prog.pos[a], end: prog.pos[b] + 1, text }, at(a))); };

    const balanced = new Uint8Array(n + 1), where = new Int32Array(n + 1).fill(-0x7fffffff);
    { const st = [];
      let net = 0, ok = 1;
      for (let k = 0; k < n; k++) {
        const c = op[k];
        if (c === 3) net++; else if (c === 4) net--;
        else if (c === 7) { st.push(net, ok); net = 0; ok = 1; }
        else if (c === 8) { const b = net === 0 && ok ? 1 : 0; balanced[prog.jump[k]] = b; ok = st.pop(); net = st.pop(); if (!b) ok = 0; }
      } }
    { let p = 0, d = 0, warned = false;
      for (let k = 0; k < n; k++) {
        const c = op[k];
        if (c === 7) { if (!balanced[k]) break; where[k] = p; d++; }
        else if (c === 8) d--;
        else if (c === 3) p++;
        else if (c === 4) {
          p--;
          if (p < 0 && !warned) {
            warned = true;
            warn(k, k, (d ? 'If this loop runs, the pointer moves left of cell 0 here' : 'The pointer moves left of cell 0 here') + (set.edge === 'wrap' ? ': with the tape set to wrap it lands on the last cell (' + fmt(set.size - 1) + ').' : ': the program stops with an error.'));
            break;
          }
        }
      } }

    // -- the innermost loops
    const cell = (base, off) => (base > -0x7fffffff ? 'cell ' + fmt(base + off) : off === 0 ? 'the current cell' : 'the cell ' + Math.abs(off) + (off > 0 ? ' to the right' : ' to the left'));
    const idiom = (a, b, text, opt) => {
      res.idiomCount++; if (opt) res.optimised++;
      if (res.idioms.length < CAP) res.idioms.push(Object.assign({ pos: prog.pos[a], end: prog.pos[b] + 1, code: snippet(a, b), text, optimised: !!opt }, at(a)));
    };
    let open = -1;
    for (let k = 0; k < n; k++) {
      const c = op[k];
      if (c === 7) { open = k; continue; }
      if (c !== 8 || open < 0) continue;
      const a = open, base = where[a]; open = -1;
      let pure = true, off = 0, cmds = 0;
      const delta = new Map();
      for (let j = a + 1; j < k; j++) {
        const o = op[j];
        if (o === 9) continue;
        cmds++;
        if (o === 1 || o === 2) delta.set(off, (delta.get(off) || 0) + (o === 1 ? 1 : -1));
        else if (o === 3) off++; else if (o === 4) off--;
        else pure = false;
      }
      if (cmds === 0) { warn(a, k, '[] is an empty loop: if the cell is not zero when the program gets here, it never ends.'); continue; }
      if (!pure) continue;
      const d0 = delta.get(0) || 0, self = cell(base, 0);
      if (off !== 0) {
        if (delta.size === 0) idiom(a, k, 'walks ' + (off > 0 ? 'right' : 'left') + (Math.abs(off) === 1 ? '' : ', ' + Math.abs(off) + ' cells at a time,') + ' until it stands on a cell that is zero', false);
        continue;
      }
      const others = [...delta].filter((e) => e[0] !== 0 && e[1] !== 0);
      if (d0 === 0) { warn(a, k, 'This loop never changes the cell it tests (' + self + '): once it starts it never ends.'); continue; }
      if (d0 === -1) {
        const to = others.map((e) => cell(base, e[0]));
        let text;
        if (others.length === 0) text = 'sets ' + self + ' to zero';
        else if (others.every((e) => e[1] === 1)) text = others.length === 1 ? 'moves ' + self + ' into ' + to[0] + ' (adds it there and leaves ' + self + ' at zero)' : 'copies ' + self + ' into ' + to.slice(0, -1).join(', ') + ' and ' + to[to.length - 1] + ' (adds it to each; ' + self + ' ends at zero)';
        else if (others.length === 1) {
          const f = others[0][1];
          text = f > 0 ? 'multiplies ' + self + ' by ' + f + ' into ' + to[0] + ' (adds ' + f + ' × ' + self + ' there; ' + self + ' ends at zero)'
            : 'subtracts ' + (f === -1 ? '' : -f + ' × ') + self + ' from ' + to[0] + ' (' + self + ' ends at zero)';
        } else text = 'adds multiples of ' + self + ' to ' + others.length + ' cells (' + others.slice(0, 4).map((e, i) => String(e[1]).replace('-', '−') + ' × into ' + to[i]).join(', ') + (others.length > 4 ? ' and more' : '') + '; ' + self + ' ends at zero)';
        idiom(a, k, text, true);
        continue;
      }
      if (d0 === 1 && others.length === 0) {
        if (set.overflow === 'wrap') idiom(a, k, 'sets ' + self + ' to zero by counting up until it wraps round (the usual way is [-])', false);
        else warn(a, k, 'This loop counts ' + self + ' up to its largest value: with wrapping off the program stops with an error there. Use [-] to set a cell to zero.');
        continue;
      }
      const step = Math.abs(d0);
      if (step >= 2) {
        if (set.overflow === 'error') warn(a, k, 'This loop changes the cell it tests by ' + step + ' each round: unless the value is a multiple of ' + step + ' it passes zero without stopping, and with wrapping off that is an error.');
        else if (step % 2 === 0) { let g = step & -step; warn(a, k, 'This loop changes the cell it tests by ' + step + ' each round: it only ends when the cell holds a multiple of ' + g + ', otherwise it runs for ever.'); }
      }
    }
    return res;
  }

  // ------------------------------------------------------------------ format and minify
  const isCmd = (ch, bp) => { const c = ch.charCodeAt(0); return (c < 128 && CODE[c] !== 0) || ch === bp; };
  // strip everything that is not a command; lines of 80
  function minify(src, bp, width) {
    let s = '';
    for (let i = 0; i < src.length; i++) if (isCmd(src[i], bp || '')) s += src[i];
    width = width === undefined ? 80 : width;
    if (!width) return s;
    const lines = [];
    for (let i = 0; i < s.length; i += width) lines.push(s.slice(i, i + width));
    return lines.join('\n');
  }
  function format(src, bp, indent) {
    bp = bp || ''; indent = indent || 2;
    src = String(src).replace(/\r\n?/g, '\n');
    const prog = parse(src, bp);
    if (prog.errors.length) return { ok: false, text: src, message: prog.errors[0].message };
    // which [ start a loop that stays on one line: maps text position of [ -> position of ]
    const inline = new Map();
    for (let k = 0; k < prog.n; k++) {
      if (prog.op[k] !== 7) continue;
      const j = prog.jump[k], a = prog.pos[k], b = prog.pos[j];
      let simple = b - a <= 80;
      for (let q = k + 1; q < j && simple; q++) if (prog.op[q] === 7) simple = false;
      let cnt = 0;
      for (let q = a; q <= b && simple; q++) { if (isCmd(src[q], bp)) cnt++; else if (src[q] !== ' ' && src[q] !== '\t') simple = false; }
      if (simple && cnt <= 32) inline.set(a, b);
    }
    const out = [];
    let depth = 0, code = '', note = '';
    const flush = () => {
      if (code || note) out.push((' '.repeat(depth * indent) + code + (code && note ? '  ' : '') + note).replace(/\s+$/, ''));
      code = ''; note = '';
    };
    const lines = src.split('\n');
    let base = 0;
    for (const ln of lines) {
      if (/^\s*$/.test(ln)) { flush(); if (out.length && out[out.length - 1] !== '') out.push(''); base += ln.length + 1; continue; }
      for (let i = 0; i < ln.length; i++) {
        const ch = ln[i];
        if (isCmd(ch, bp)) {
          if (note) flush();                               // code after a comment starts a new line
          if (ch === '[' && inline.has(base + i)) {
            if (code === ']') flush();
            const end = inline.get(base + i) - base;
            for (; i <= end; i++) if (isCmd(ln[i], bp)) code += ln[i];
            i--;
          } else if (ch === '[') { flush(); code = '['; flush(); depth++; }
          else if (ch === ']') { flush(); depth--; code = ']'; }
          else { if (code === ']') flush(); code += ch; }
        } else if (note || !/\s/.test(ch)) note += ch;
      }
      note = note.replace(/\s+$/, '');
      flush();
      base += ln.length + 1;
    }
    while (out.length && out[out.length - 1] === '') out.pop();
    return { ok: true, text: out.join('\n') + '\n' };
  }

  // ------------------------------------------------------------------ text to brainfuck
  const NAMES = { 43: 'plus sign', 45: 'hyphen', 60: 'less than sign', 62: 'greater than sign', 91: 'left square bracket', 93: 'right square bracket', 46: 'full stop', 44: 'comma', 35: 'hash sign', 33: 'exclamation mark', 32: 'space', 10: 'line break', 13: 'carriage return', 9: 'tab' };
  // the cheapest way to add d (any sign) to cell 0 with cell 1 as a counter
  function addTo(d, loops) {
    const size = Math.abs(d), sign = d > 0 ? '+' : '-';
    let best = sign.repeat(size);
    if (!loops || size < 12) return best;
    for (let a = 2; a <= 20; a++) {
      for (const b of [Math.floor(size / a), Math.ceil(size / a)]) {
        if (b < 2) continue;
        const r = size - a * b;
        const s = '>' + '+'.repeat(a) + '[<' + sign.repeat(b) + '>-]<' + (r >= 0 ? sign : sign === '+' ? '-' : '+').repeat(Math.abs(r));
        if (s.length < best.length) best = s;
      }
    }
    return best;
  }
  function textToBf(text, o) {
    o = Object.assign({ loops: true, comments: true }, o);
    const bytes = utf8(String(text).replace(/\r\n?/g, '\n'));
    const lines = [];
    let cur = 0, flat = '';
    for (const b of bytes) {
      const code = addTo(b - cur, o.loops) + '.';
      cur = b; flat += code;
      const label = NAMES[b] || (b > 32 && b < 127 ? String.fromCharCode(b) : 'byte ' + b);
      lines.push(code + (code.length < 28 ? ' '.repeat(28 - code.length) : '  ') + label + ' ' + b);
    }
    let code;
    if (o.comments) code = lines.join('\n') + (lines.length ? '\n' : '');
    else code = minify(flat, '', 72) + (flat ? '\n' : '');
    const explain = [
      'Cell 0 always holds the character that was printed last. For the next character the program adds or takes off the difference and prints again with a full stop.',
      o.loops
        ? 'A big difference is made by a small multiplication: cell 1 counts a number of rounds, and every round adds a fixed amount to cell 0. For example 72 is 8 rounds of 9. What is left over is added one at a time.'
        : 'Every difference is written out as that many plus or minus signs. That is the longest way and the easiest to read.',
      'The program has ' + fmt(flat.length) + ' commands for ' + fmt(bytes.length) + (bytes.length === 1 ? ' byte' : ' bytes') + ' of text. It needs no input, never moves left of cell 0 and never lets a cell go below 0 or above 255, so it runs the same on every interpreter.',
    ];
    if (bytes.some((b) => b > 127)) explain.push('Letters outside plain ASCII are printed as their UTF-8 bytes, two to four bytes for one letter.');
    return { code, bytes, commands: flat.length, explain };
  }

  // ------------------------------------------------------------------ the link
  const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const unb64 = (s) => { const t = atob(s.replace(/-/g, '+').replace(/_/g, '/')); const b = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) b[i] = t.charCodeAt(i); return b; };
  async function pipe(bytes, stream) {
    const w = stream.writable.getWriter(); w.write(bytes); w.close();
    return new Uint8Array(await new Response(stream.readable).arrayBuffer());
  }
  function packState(st) {
    const o = { c: st.code || '' };
    if (st.input) o.i = st.input;
    if (st.escapes) o.e = 1;
    const s = {}, set = cleanSettings(st.settings);
    for (const k of Object.keys(DEFAULTS)) if (set[k] !== DEFAULTS[k]) s[k] = set[k];
    if (Object.keys(s).length) o.s = s;
    if (st.names && Object.keys(st.names).length) o.n = st.names;
    if (st.breakpoints && st.breakpoints.length) o.b = st.breakpoints;
    return o;
  }
  function unpackState(o) {
    if (!o || typeof o.c !== 'string') throw new Error('not a playground link');
    const names = {};
    if (o.n && typeof o.n === 'object') for (const k of Object.keys(o.n)) if (/^\d+$/.test(k)) names[k] = String(o.n[k]).slice(0, 40);
    return { code: o.c, input: typeof o.i === 'string' ? o.i : '', escapes: !!o.e, settings: cleanSettings(o.s), names, breakpoints: Array.isArray(o.b) ? o.b.filter((x) => Number.isInteger(x) && x >= 0) : [] };
  }
  // -> "z=..." (deflate) or "u=..." (plain) for after the '#'
  async function encodeShare(st) {
    const raw = utf8(JSON.stringify(packState(st)));
    if (typeof CompressionStream !== 'undefined') {
      try { const z = await pipe(raw, new CompressionStream('deflate-raw')); if (z.length < raw.length) return 'z=' + b64(z); } catch (e) { }
    }
    return 'u=' + b64(raw);
  }
  async function decodeShare(hash) {
    const h = String(hash).replace(/^#/, ''), kind = h.slice(0, 2), body = h.slice(2);
    if (kind !== 'z=' && kind !== 'u=') throw new Error('not a playground link');
    let raw = unb64(body);
    if (kind === 'z=') {
      if (typeof DecompressionStream === 'undefined') throw new Error('this browser cannot open compressed links');
      raw = await pipe(raw, new DecompressionStream('deflate-raw'));
    }
    return unpackState(JSON.parse(fromUtf8(raw)));
  }

  return { DEFAULTS, HISTORY, cleanSettings, describeSettings, isClassic, parse, opAt, lineCol, Machine, explainNext, explainLast, describeTape, charName,
    Fast, analyse, minify, format, textToBf, inputBytes, fromUtf8, encodeShare, decodeShare, packState, unpackState };
});
