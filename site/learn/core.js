// Logic of the tutorials, without any page code.
self.LearnCore = (function () {
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

  // ---- fast mode: the compile step of compiler/core/bf.js, keeping source positions ----
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

  // Every op gets s, e: the piece of the program text it stands for.
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
    if (mv) push({ t: NOP, n: 0 }, code.length, code.length);
    return ops;
  }

  class Machine {
    constructor(src, o = {}) {
      this.code = strip(src);
      this.bits = o.bits || 32;
      this.size = o.size || 2048;
      this.fast = !!o.fast;
      this.init = o.init || null;
      this.input = o.input || [];
      this.jump = matchBrackets(this.code);
      this.ops = compileFast(this.code);
      this.reset();
    }

    reset() {
      const A = this.bits === 8 ? Uint8Array : this.bits === 16 ? Uint16Array : Uint32Array;
      this.tape = new A(this.size);
      if (this.init) for (const k of Object.keys(this.init)) this.tape[+k] = this.init[k];
      this.p = 0; this.pc = 0; this.steps = 0; this.inPos = 0; this.out = [];
      this.error = null;       // 'left' | 'right': the pointer left the tape
      this.last = null;        // what the last step did, for the explanation line
      return this;
    }

    get length() { return this.fast ? this.ops.length : this.code.length; }
    get done() { return this.error !== null || this.pc >= this.length; }

    // The piece of program text that the next step will carry out.
    span() {
      if (this.done) return null;
      if (!this.fast) return [this.pc, this.pc + 1];
      const op = this.ops[this.pc];
      return [op.s, op.e];
    }

    signed(v) { return v >= 2 ** (this.bits - 1) ? v - 2 ** this.bits : v; }

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
        else if (c === ',') t[this.p] = this.inPos < this.input.length ? this.input[this.inPos++] : 0;
        else if (c === '[') { info.zero = t[this.p] === 0; if (info.zero) this.pc = this.jump[this.pc]; }
        else if (c === ']') { info.zero = t[this.p] === 0; if (!info.zero) this.pc = this.jump[this.pc]; }
        this.pc++;
      } else {
        const op = this.ops[this.pc];
        const q = this.p + op.mv;
        info = { op };
        if (q < 0 || q >= this.size) { this.error = q < 0 ? 'left' : 'right'; this.last = info; return info; }
        this.p = q;
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
          case IN: t[q] = this.inPos < this.input.length ? this.input[this.inPos++] : 0; this.pc++; break;
          default: this.pc++;
        }
      }
      this.steps++;
      this.last = info;
      return info;
    }

    // Run until the program ends or `max` steps have been taken in total.
    run(max = 2e7) {
      if (this.fast) { while (!this.done && this.steps < max) this.step(); return this; }
      const t = this.tape, code = this.code, jump = this.jump, n = code.length, size = this.size, input = this.input;
      let p = this.p, pc = this.pc, steps = this.steps;
      for (; pc < n && steps < max && this.error === null; pc++, steps++) {
        switch (code.charCodeAt(pc)) {
          case 43: t[p]++; break;
          case 45: t[p]--; break;
          case 62: if (p + 1 >= size) { this.error = 'right'; pc--; steps--; } else p++; break;
          case 60: if (p - 1 < 0) { this.error = 'left'; pc--; steps--; } else p--; break;
          case 46: this.out.push(t[p] & 255); break;
          case 44: t[p] = this.inPos < input.length ? input[this.inPos++] : 0; break;
          case 91: if (t[p] === 0) pc = jump[pc]; break;
          case 93: if (t[p] !== 0) pc = jump[pc]; break;
        }
      }
      this.p = p; this.pc = pc; this.steps = steps; this.last = null;
      return this;
    }
  }

  // Run a program to the end and report. mode: 'plain' | 'fast'.
  function run(src, o = {}) {
    const m = new Machine(src, { ...o, fast: o.mode !== 'plain' });
    m.run(o.max || 5e7);
    return { tape: m.tape, p: m.p, steps: m.steps, out: m.out, finished: m.pc >= m.length && !m.error, error: m.error, machine: m };
  }
  // Steps in both modes at once.
  function count(src, o = {}) {
    const fast = run(src, { ...o, mode: 'fast' });
    const plain = o.plainMax === 0 ? null : run(src, { ...o, mode: 'plain', max: o.plainMax || 5e7 });
    return { fast, plain, tape: fast.tape };
  }

  // ---- plain JavaScript versions of the arithmetic (to check the brainfuck) ----
  const ref = {
    // the rounding rule of the whole-number models (compiler/smollm/engine/spec.js)
    rq(S, k, n, lo = -(2 ** (n - 1)), addend = k > 0 ? 2 ** (k - 1) : 0) {
      const y = Math.floor((S + addend) / 2 ** k), hi = lo + 2 ** n - 1;
      return y < lo ? lo : y > hi ? hi : y;
    },
    expTable: Array.from({ length: 64 }, (_, e) => Math.round(15 * Math.exp((-e * 8) / (16 * Math.sqrt(8))))),
    recipTable: Array.from({ length: 64 }, (_, t) => (t ? Math.round(4096 / t) : 0)),
    attention(scores, values) {
      const best = Math.max(...scores);
      const weights = scores.map((s) => ref.expTable[ref.rq(best - s, 3, 6, 0, 0)]);
      const total = weights.reduce((a, b) => a + b, 0);
      const sum = weights.reduce((a, w, i) => a + w * values[i], 0);
      return { best, weights, total, sum, recip: ref.recipTable[total], out: ref.rq(sum * ref.recipTable[total], 12, 8) };
    },
    neuron(xs, ws, k) {
      const sum = xs.reduce((a, x, i) => a + x * ws[i], 0);
      return { sum, shifted: Math.floor((sum + (k > 0 ? 2 ** (k - 1) : 0)) / 2 ** k), out: ref.rq(sum, k, 8) };
    },
  };

  // ---- the brainfuck of every lesson -----------------------------------------
  function makeDemos(Emitter, Patterns) {
    const range = (n, f = (i) => i) => Array.from({ length: n }, (_, i) => f(i));
    const P = (bits = 32) => { const p = new Patterns(bits === 32 ? 32 : 16); p.B = bits; return p; };
    const D = {};

    // -- lesson 2
    D.move = () => ({ code: new Emitter().move(0, 1).toString() });
    D.copy = () => ({ code: new Emitter().copy(0, 1, 2).toString() });

    // -- lesson 3
    D.timesConst = (f) => ({ code: new Emitter().scatter(0, [[1, f]]).toString() });
    D.dot = (ws) => {
      const p = P(32), n = ws.length;
      p.matVec(range(n), [ws], [n], n + 1);
      return { code: p.toString(), X: 0, SUM: n, n };
    };

    D.compareCount = () => ({ code: P(32).dotPosNeg([], [], [], 0, 2, [1, 3, 4, 5]).toString(), A: 0, B: 1, R: 2 });
    // X in cell 0. After: cell 1 = floor(X / 2^k).
    D.divideCount = (k, round = false) => {
      const p = P(32);
      if (round) p.addConst(0, 2 ** (k - 1), 2);
      p.requantCount(0, 1, k, [2, 3, 4, 5]);
      return { code: p.toString(), X: 0, Y: 1 };
    };

    D.peelBits = (bits = 8) => {
      const p = P(bits);
      p.peel(0, { m: bits, onSet: (j) => p.add(7 + j, 1) }, { Zo: 1, T: 2, H: [3, 4], K: 5, Kt: 6 });
      return { code: p.toString(), Z: 0, out: 7, m: bits };
    };
    // X in cell 0. After: cell 1 = clamp(floor((X + 2^(k-1)) / 2^k), 0, 2^n - 1).
    D.dividePeel = (k, n = 16) => {
      const p = P(32);
      p.requant(0, 1, { k, n, lo: 0, addend: 2 ** (k - 1), outs: [{ cell: 1, bits: 8 }, { cell: 12, bits: n - 8 }] }, range(10, (i) => 2 + i));
      p.shl(12, 1, 8, [13, 14]);
      return { code: p.toString(), X: 0, Y: 1 };
    };

    // X in cell 0 (signed). After: cell 1 = clamp(floor((X + 2^(k-1)) / 2^k), -128, 127).
    D.roundClamp = (k) => {
      const p = P(32);
      p.requant(0, 1, { k, n: 8, addend: k > 0 ? 2 ** (k - 1) : 0 }, range(10, (i) => 2 + i));
      return { code: p.toString(), X: 0, Y: 1 };
    };

    D.mulNaive = () => ({ code: new Emitter().addMul(0, 1, 2, [3, 4]).toString(), A: 0, B: 1, ACC: 2 });
    D.mulPeel = (bits = 32, nb = 8) => {
      const p = P(bits);
      p.mulAcc(0, nb, [[1, 2]], range(8, (i) => 3 + i));
      return { code: p.toString(), A: 0, B: 1, ACC: 2 };
    };

    D.framesRound = (n, loop = true, k = 7) => {
      const p = P(32), S = 14, m0 = 2, opts = { k, n: 8, addend: k > 0 ? 2 ** (k - 1) : 0 };
      const job = (b) => p.requant(b + 1, b + 2, opts, range(10, (i) => b + 3 + i));
      if (loop) p.eachFrame(m0, S, n, 0, () => job(m0));
      else for (let i = 0; i < n; i++) job(m0 + i * S);
      return { code: p.toString(), base: m0, stride: S, n, size: m0 + (n + 1) * S + 4 };
    };
    // Frames [marker, x, sum, tmp]: the running total travels from frame to frame.
    D.carry = (n) => {
      const p = P(32), S = 4, m0 = 2;
      p.eachFrame(m0, S, n, 0, () => { p.copy(m0 + 1, m0 + 2, m0 + 3); p.move(m0 + 2, m0 + 2 + S); });
      return { code: p.toString(), base: m0, stride: S, n, total: m0 + 2 + n * S };
    };
    D.table = (long = true, N = 64, U = 8) => {
      const p = P(32), SS = 6, base = 16, LN = base, SH = base + 1, HI = base + 2, LO = base + 3, V = base + 4, Dc = base + 5;
      const sc = range(10, (i) => 2 + i);
      if (long) {
        const b = Math.log2(U), hb = Math.log2(N / U);
        p.splitDigits(0, [{ cell: LO, bits: b }, { cell: HI, bits: hb }], sc);
        p.to(HI).raw('[').add(HI, -1).move(HI, HI + U * SS).move(LO, LO + U * SS).to(HI + U * SS).raw(']');
        p.ptr = HI;                                   // from here on: addresses in the record the pointer is in
      } else p.move(0, LO);
      p.to(LO).raw('[').add(LO, -1).move(LO, LO + SS).to(LO + SS).raw(']');
      p.ptr = LO;
      p.copy(Dc, V, LO);                              // read the data (LO is empty now: scratch)
      p.to(SH).raw('[').move(V, V - SS).to(SH - SS).raw(']');
      p.ptr = SH;
      if (long) { p.to(LN).raw('[').move(V, V - U * SS).to(LN - U * SS).raw(']'); p.ptr = LN; }
      p.move(V, 1);
      const init = (data) => {
        const t = {};
        for (let r = 1; r < N; r++) {
          const a = base + r * SS;
          if (long) { if (r % U === 0) t[a] = 1; else t[a + 1] = 1; } else t[a + 1] = 1;
          t[a + 5] = data[r];
        }
        return t;
      };
      return { code: p.toString(), base, SS, N, U, I: 0, RES: 1, init, size: base + (N + 1) * SS + 8 };
    };

    D.writePlain = (values) => {
      const p = new Emitter();
      values.forEach((v, i) => p.add(1 + i, v));
      return { code: p.toString(), base: 1, n: values.length };
    };
    D.writeDigits = (values) => {
      const p = P(32), K = values.length, T = 1, planes = 3;
      const digits = values.map((v) => {
        if (!(v >= 13 && v <= 262)) throw new Error('writeDigits: value out of range: ' + v);
        const d0 = ((v + 2) % 5) - 2, r = (v - d0) / 5, d1 = ((r + 2) % 5) - 2, top = (r - d1) / 5;
        return [top - 1, d1, d0];
      });
      for (let i = 0; i < K; i++) p.add(T + planes + i, 1);                 // the start value
      for (let pl = 0; pl < planes; pl++) {
        const s0 = T + planes - pl;                                         // where the row lies now
        for (let i = K - 1; i >= 0; i--) p.add(s0 + i, digits[i][pl]);
        p.to(s0).raw('[[-<' + (pl < planes - 1 ? '+++++' : '+') + '>]>]');
        p.ptr = s0 + K;
      }
      return { code: p.toString(), base: T, n: K, planes, digits };
    };

    D.columnData = (R = 4) => {
      const p = P(32);
      const X = 0, XK = 1, Za = 2, Zb = 3, T = 4, H0 = 5, H1 = 6, K = 7, Kt = 8, B0 = 9, tmp = 13;
      const SRC = 15, DST = SRC + R + 1, SUM = DST + R + 1;
      for (let i = 0; i < R; i++) p.read(SRC + i);
      p.read(X);
      p.copy(X, XK, tmp);
      p.shl(X, Za, 32 - 4, [H0, H1]);
      p.peel(Za, { m: 4, onSet: (j) => p.add(B0 + j, 1) }, { Zo: Zb, T, H: [H0, H1], K, Kt });
      for (let j = 0; j < 4; j++) {
        p.loop(B0 + j, () => {
          p.add(B0 + j, -1);
          // one walk along the column: every cell moves on and is added, times 2^j, to its sum
          p.to(SRC).raw('[').scatter(SRC, [[DST, 1], [SUM, 2 ** j]]).to(SRC + 1).raw(']');
          p.ptr = SRC + R;
          // and the column walks back
          p.to(DST).raw('[').move(DST, SRC).to(DST + 1).raw(']');
          p.ptr = DST + R;
        });
      }
      // the sums are too large by 128 * x: take that off, in one loop
      p.scatter(XK, range(R, (r) => [SUM + r, -128]));
      return { code: p.toString(), R, X, SRC, DST, SUM, B0 };
    };

    D.neuron = (ws, k) => {
      const p = P(32), n = ws.length;
      p.dotRequant(range(n), ws, n, { k, n: 8, addend: k > 0 ? 2 ** (k - 1) : 0 }, range(11, (i) => n + 1 + i));
      return { code: p.toString(), X: 0, Y: n, ACC: n + 1 };
    };
    // inputs in cells 0..n-1; results in cells n..n+rows-1.
    D.layer = (W, k) => {
      const p = P(32), n = W[0].length, rows = W.length;
      const Y = n, ACC = n + rows, tmp = ACC + rows, sc = range(10, (i) => tmp + 1 + i);
      p.matVec(range(n), W, range(rows, (o) => ACC + o), tmp);
      for (let o = 0; o < rows; o++) p.requant(ACC + o, Y + o, { k, n: 8, addend: k > 0 ? 2 ** (k - 1) : 0 }, sc);
      return { code: p.toString(), X: 0, Y, rows };
    };

    D.attention = (N = 4) => {
      const p = P(32), S = 24, F = 16;
      const C = 0, RC = 1, ACC = 2, OUT = 3, G = range(12, (i) => 4 + i);
      const M = F, SC = F + 1, V = F + 2, BEST = F + 3, TOT = F + 4, SUM = F + 5, W = F + 6, DD = F + 7, EE = F + 8;
      const hsc = range(13, (i) => F + 9 + i);
      p.addBig(BEST, -256, [hsc[0], hsc[1]]);
      // pass 1: best = max(best, score), carried from frame to frame
      p.eachFrame(M, S, N, C, () => {
        p.scatter(SC, [[DD, 1], [W, 1]]).move(W, SC);
        p.scatter(BEST, [[DD, -1], [BEST + S, 1]]);
        p.requant(DD, W, { k: 0, n: 9, lo: 0, addend: 0 }, hsc);          // max(score - best, 0)
        p.move(W, BEST + S);
      });
      p.move(BEST + N * S, BEST);
      // pass 2: weight = table[(best - score) / 8]; total and weighted sum travel along
      p.eachFrame(M, S, N, C, () => {
        p.scatter(BEST, [[DD, 1], [BEST + S, 1]]);
        p.scatter(SC, [[DD, -1], [EE, 1]]).move(EE, SC);
        p.requant(DD, EE, { k: 3, n: 6, lo: 0, addend: 0 }, hsc);
        p.lookup(EE, W, ref.expTable, hsc.slice(0, 9), { keepX: false });
        p.move(TOT, TOT + S);
        p.scatter(W, [[TOT + S, 1], [DD, 1]]).move(DD, W);
        p.mulAcc(W, 5, [[V, SUM]], hsc.slice(0, 8));
        p.move(SUM, SUM + S);
      });
      // divide the sum by the total: multiply by 4096 / total from a table, shift 12 back
      p.lookup(TOT + N * S, RC, ref.recipTable, G.slice(0, 9));
      p.mulAcc(RC, 10, [[SUM + N * S, ACC]], G.slice(0, 8));
      p.requant(ACC, OUT, { k: 12, n: 8, addend: 2 ** 11 }, G.slice(0, 10));
      return {
        code: p.toString(), N, S, F, OUT, RC,
        score: (t) => SC + t * S, value: (t) => V + t * S, weight: (t) => W + t * S,
        best: BEST + N * S, total: TOT + N * S, sum: SUM + N * S, size: F + (N + 1) * S + 8,
      };
    };

    const pickBody = (p, words, fr) => {
      const N = words.length, C = 0, sc = range(10, (i) => 1 + i), CH = 11, T2 = 12, SCORE = 13;
      for (let i = 0; i < N; i++) {
        p.copy(SCORE + i, CH, T2);
        p.splitDigits(CH, [{ cell: fr.X(i, 1), bits: 4 }, { cell: fr.X(i, 0), bits: 4 }], sc);
      }
      p.argmax(fr, [{ top: 16, span: 16 }, { top: 16, span: 16 }], C);
      for (let i = 0; i < N; i++) {
        p.ifNonZero(fr.OH(i), () => {
          let prev = 0;
          for (const ch of words[i]) { const c = ch.charCodeAt(0); p.add(CH, c - prev); p.out(CH); prev = c; }
          p.clear(CH);
        });
      }
    };
    D.pick = (words) => {
      const p = P(32), N = words.length, SCORE = 13;
      const fr = Patterns.frames(SCORE + N, N, 2);
      pickBody(p, words, fr);
      return { code: p.toString(), N, SCORE, fr, size: fr.end + 8 };
    };
    D.oneWord = (W, k, words) => {
      const p = P(32), N = words.length, n = W[0].length, SCORE = 13, sc = range(10, (i) => 1 + i);
      const fr = Patterns.frames(SCORE + N, N, 2);
      const X = fr.end + 1, ACC = X + n, tmp = ACC + N;
      p.matVec(range(n, (i) => X + i), W, range(N, (o) => ACC + o), tmp);
      for (let o = 0; o < N; o++) {
        p.requant(ACC + o, SCORE + o, { k, n: 8, addend: k > 0 ? 2 ** (k - 1) : 0 }, sc);
        p.add(SCORE + o, 128);
      }
      pickBody(p, words, fr);
      return { code: p.toString(), N, n, SCORE, X, ACC, fr, size: tmp + 8 };
    };

    return D;
  }

  // ---- challenge checkers ------------------------------------------------------
  const commands = (src) => strip(src).length;
  const tryRun = (src, o) => {
    try { return run(src, { mode: 'plain', max: 2e6, size: 300, ...o }); } catch (e) { return { bad: e.kind || 'error' }; }
  };
  const checks = {
    cell2is12(src, limit = 0) {
      const r = tryRun(src, { bits: 8 });
      if (r.bad) return { ok: false, why: 'brackets' };
      if (r.error) return { ok: false, why: 'offtape' };
      if (!r.finished) return { ok: false, why: 'endless' };
      if (r.tape[2] !== 12) return { ok: false, why: 'value', got: r.tape[2] };
      if (limit && commands(src) > limit) return { ok: false, why: 'long', got: commands(src) };
      return { ok: true, got: commands(src) };
    },
    // lesson 2: cells 0, 1 and 2 must all hold the start value of cell 0; other cells zero
    copyTwice(src) {
      for (const v of [5, 9]) {
        const r = tryRun(src, { bits: 8, init: { 0: v } });
        if (r.bad) return { ok: false, why: 'brackets' };
        if (r.error) return { ok: false, why: 'offtape' };
        if (!r.finished) return { ok: false, why: 'endless' };
        if (r.tape[0] !== v) return { ok: false, why: 'lost', v, got: r.tape[0] };
        if (r.tape[1] !== v || r.tape[2] !== v) return { ok: false, why: 'value', v, got: [r.tape[1], r.tape[2]] };
        for (let i = 3; i < 300; i++) if (r.tape[i] !== 0) return { ok: false, why: 'scratch', v, cell: i };
      }
      return { ok: true };
    },
    // lesson 3: cell 1 = 100 with at most `limit` commands
    hundred(src, limit = 30) {
      const r = tryRun(src, { bits: 32 });
      if (r.bad) return { ok: false, why: 'brackets' };
      if (r.error) return { ok: false, why: 'offtape' };
      if (!r.finished) return { ok: false, why: 'endless' };
      if (r.tape[1] !== 100) return { ok: false, why: 'value', got: r.tape[1] };
      if (commands(src) > limit) return { ok: false, why: 'long', got: commands(src) };
      return { ok: true, got: commands(src) };
    },
    // lesson 4: a guess within 15 % of the measured number
    guess(guess, real) { return { ok: Number.isFinite(guess) && Math.abs(guess - real) <= 0.15 * real, real }; },
    // lesson 5: an 8-bit number that becomes zero after exactly three doublings
    threeDoublings(x) { return { ok: x !== 0 && ((x * 4) & 255) !== 0 && ((x * 8) & 255) === 0 }; },
  };

  return { Machine, run, count, ref, makeDemos, checks };
})();
