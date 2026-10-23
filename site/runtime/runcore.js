// Run a brainfuck program that is far too large to hold in memory, on a tape of any size.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RunCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ADD = 0, OUT = 1, IN = 2, JZ = 3, JNZ = 4, CLEAR = 5, MUL1 = 6, MUL2 = 7, MULN = 8;
  const TOP = 0, SKIP = 1, GATHER = 2, TAIL = 3, STOPPED = 4;

  // o.memory: the tape's WebAssembly.Memory (made here when missing); o.address: 64 for a 64-bit memory
  function create(BFWasm, o) {
    const tapeSize = o.tapeSize, bits = o.cellBits || 32, address = o.address || 32, loopLimit = o.loopLimit === undefined ? 65536 : o.loopLimit;
    if (bits !== 32) throw new Error('runcore: 32-bit cells only');
    const memory = o.memory || BFWasm.newMemory(tapeSize, bits, address);
    const tape = BFWasm.tapeOf(memory, tapeSize, bits);
    let input = o.input || new Uint8Array(0), inPos = 0;
    const outChunks = [];
    let outBuf = new Uint8Array(256), outN = 0, outTotal = 0;
    const flushOut = () => {
      if (!outN) return;
      const b = outBuf.slice(0, outN); outN = 0; outTotal += b.length;
      if (o.onOutput) o.onOutput(b);
      if (o.collect !== false) outChunks.push(b);
    };
    const putOut = (v) => { if (outN === outBuf.length) flushOut(); outBuf[outN++] = v & 255; if (o.onOutput) flushOut(); };

    let p = 0, mode = TOP, depth = 0, fed = 0;
    let gbuf = new Uint8Array(4096), glen = 0;
    const tail = [];
    let tailBytes = 0, tailAt = -1;
    const cache = new Map();
    const st = { loops: 0, loopTexts: 0, loopOps: 0, fast: 0, skipped: 0 };
    const stopAt = o.stopAt === undefined ? Infinity : o.stopAt;
    const tailOnInput = o.tailOnInput !== false;
    const dec = typeof TextDecoder !== 'undefined' ? new TextDecoder('latin1') : null;
    const keyOf = (bytes) => (dec ? dec.decode(bytes) : String.fromCharCode.apply(null, bytes));
    const off = (q) => { throw new Error(`pointer out of range: ${q} (program byte ${fed})`); };

    // ---- a loop: compiled once per text ----
    function compileLoop(bytes) {
      const key = keyOf(bytes);
      let c = cache.get(key);
      if (c) return c;
      c = BFWasm.parse(bytes);
      c.shape = 0;
      // shapes that are run by a loop of their own (same steps as the general interpreter below)
      if (c.length === 3 && c.T[0] === JZ && c.T[1] === MUL1 && c.M[1] === 0 && c.T[2] === JNZ) c.shape = 1;          // [[-<+++++>]>]
      else if (c.length === 4 && c.T[0] === JZ && c.T[1] === MUL1 && c.M[1] === 0 && c.T[2] === ADD && c.T[3] === JNZ) c.shape = 2;   // [[-<+>]<--->>]
      cache.set(key, c); st.loopTexts++;
      return c;
    }

    function runLoop(c) {
      const { T, N, M, X, length } = c;
      st.loops++;
      if (c.shape === 1) {
        const d = X[N[1]], f = X[N[1] + 1], step = M[2];
        p += M[0]; if (p < 0 || p >= tapeSize) off(p);
        let v = tape[p];
        while (v !== 0) {
          tape[p + d] += Math.imul(v, f); tape[p] = 0;
          p += step; if (p < 0 || p >= tapeSize) off(p);
          v = tape[p];
        }
        st.fast++;
        return;
      }
      if (c.shape === 2) {
        const d = X[N[1]], f = X[N[1] + 1], m2 = M[2], k = N[2], step = M[3];
        p += M[0]; if (p < 0 || p >= tapeSize) off(p);
        let v = tape[p];
        while (v !== 0) {
          tape[p + d] += Math.imul(v, f); tape[p] = 0;
          p += m2; if (p < 0 || p >= tapeSize) off(p);
          tape[p] += k;
          p += step; if (p < 0 || p >= tapeSize) off(p);
          v = tape[p];
        }
        st.fast++;
        return;
      }
      let pc = 0, v = 0, k = 0, ops = 0;
      while (pc < length) {
        p += M[pc];
        if (p < 0 || p >= tapeSize) off(p);
        ops++;
        switch (T[pc]) {
          case ADD: tape[p] += N[pc]; pc++; break;
          case JZ: pc = tape[p] === 0 ? N[pc] : pc + 1; break;
          case JNZ: pc = tape[p] !== 0 ? N[pc] : pc + 1; break;
          case CLEAR: tape[p] = 0; pc++; break;
          case MUL1:
            v = tape[p];
            if (v !== 0) { k = N[pc]; tape[p + X[k]] += Math.imul(v, X[k + 1]); tape[p] = 0; }
            pc++;
            break;
          case MUL2:
            v = tape[p];
            if (v !== 0) { k = N[pc]; tape[p + X[k]] += Math.imul(v, X[k + 1]); tape[p + X[k + 2]] += Math.imul(v, X[k + 3]); tape[p] = 0; }
            pc++;
            break;
          case MULN:
            v = tape[p];
            if (v !== 0) {
              k = N[pc];
              for (let end = k + 1 + 2 * X[k], q = k + 1; q < end; q += 2) tape[p + X[q]] += Math.imul(v, X[q + 1]);
              tape[p] = 0;
            }
            pc++;
            break;
          case OUT: putOut(tape[p]); pc++; break;
          case IN: tape[p] = inPos < input.length ? input[inPos++] : 0; pc++; break;
          default: pc++;
        }
      }
      st.loopOps += ops;
    }

    function gpush(chunk, from, to) {
      const k = to - from;
      if (glen + k > gbuf.length) { let c = gbuf.length * 2; while (c < glen + k) c *= 2; const nb = new Uint8Array(c); nb.set(gbuf.subarray(0, glen)); gbuf = nb; }
      gbuf.set(chunk.subarray(from, to), glen); glen += k;
    }

    // Runs program text as it streams in: top-level commands at once, each loop gathered and run compiled.
    // From a loop over loopLimit or (tailOnInput) a `,` on, the rest is collected as the tail for compileTail.
    function feed(chunk) {
      let i = 0, n = chunk.length;
      if (fed + n > stopAt) n = stopAt - fed;
      const start = fed;
      while (i < n) {
        if (mode === TOP) {
          let q = p;
          for (; i < n; i++) {
            const c = chunk[i];
            if (c === 60) { if (--q < 0) { fed = start + i; off(q); } }
            else if (c === 43) tape[q]++;
            else if (c === 45) tape[q]--;
            else if (c === 62) { if (++q >= tapeSize) { fed = start + i; off(q); } }
            else if (c === 91) {
              depth = 1;
              if (tape[q] === 0) { mode = SKIP; st.skipped++; } else { mode = GATHER; glen = 0; gbuf[glen++] = 91; tailAt = start + i; }
              i++; break;
            } else if (c === 93) { fed = start + i; throw new Error(`unmatched ] at program byte ${fed}`); }
            else if (c === 46) putOut(tape[q]);
            else if (c === 44) {
              if (tailOnInput) { mode = TAIL; tailAt = start + i; tail.push(Uint8Array.prototype.slice.call(chunk, i, n)); tailBytes = n - i; i = n; break; }
              tape[q] = inPos < input.length ? input[inPos++] : 0;
            }
          }
          p = q;
        } else if (mode === SKIP) {
          for (; i < n; i++) {
            const c = chunk[i];
            if (c === 91) depth++; else if (c === 93 && --depth === 0) { i++; mode = TOP; break; }
          }
        } else if (mode === GATHER) {
          const from = i;
          let done = false;
          for (; i < n; i++) {
            const c = chunk[i];
            if (c === 91) depth++; else if (c === 93 && --depth === 0) { i++; done = true; break; }
          }
          gpush(chunk, from, i);
          if (done) {
            mode = TOP;
            if (glen > loopLimit || (tailOnInput && gbuf.subarray(0, glen).indexOf(44) >= 0)) { mode = TAIL; tail.push(gbuf.slice(0, glen)); tailBytes = glen; }
            else { fed = start + i; runLoop(compileLoop(gbuf.subarray(0, glen))); }
          } else if (glen > loopLimit) { mode = TAIL; tail.push(gbuf.slice(0, glen)); tailBytes = glen; }
        } else if (mode === TAIL) {
          tail.push(Uint8Array.prototype.slice.call(chunk, i, n)); tailBytes += n - i; i = n;   // a copy (the caller reuses its buffer)
        } else break;
      }
      fed = start + n;
      if (fed >= stopAt) {
        if (mode !== TOP) throw new Error('stopAt is inside a loop');
        mode = STOPPED;
      }
    }

    // The collected rest of the program as one array (null when everything was streamed).
    function tailProgram() {
      if (mode !== TAIL) return null;
      if (tail.length !== 1) {
        const all = new Uint8Array(tailBytes);
        let at = 0;
        for (const t of tail) { all.set(t, at); at += t.length; }
        tail.length = 0; tail.push(all);
      }
      return tail[0];
    }

    let exe = null;
    // Compile the rest (if any). Returns the WebAssembly module so that a caller can keep it.
    function compileTail(module, wasmMeta) {
      if (mode === GATHER || mode === SKIP) throw new Error('the program ends inside a loop (unmatched [)');
      const t = tailProgram();
      if (!t) return null;
      if (module) { exe = new BFWasm.Program(module, wasmMeta, memory); return { module, wasmMeta }; }
      const g = BFWasm.generate(BFWasm.parse(t), { cellBits: bits, tapeSize, memory: 'imported', address });
      const meta = { cellBits: g.cellBits, tapeSize: g.tapeSize, stats: g.stats, pages: g.pages };
      const mod = new WebAssembly.Module(g.bytes);
      exe = new BFWasm.Program(mod, meta, memory);
      return { module: mod, wasmMeta: meta };
    }

    // Run the rest on the tape as it is now. `more`: input to use instead of what is left.
    function runTail(more, flushEvery) {
      if (!exe) return { pointer: p };
      const rest = more || input.subarray(inPos);
      flushOut();
      const r = exe.run(rest, { keep: true, pointer: p, collect: false, flushEvery: flushEvery || 1, onOutput: (b) => { outTotal += b.length; if (o.onOutput) o.onOutput(b); if (o.collect !== false) outChunks.push(b); } });
      p = r.pointer;
      return r;
    }

    function finish() {
      compileTail();
      runTail();
      flushOut();
      const output = new Uint8Array(outTotal);
      let at = 0;
      for (const c of outChunks) { output.set(c, at); at += c.length; }
      return { pointer: p, output, handoverAt: mode === TAIL ? tailAt : -1, tailBytes: mode === TAIL ? tailBytes : 0, stats: st };
    }

    return {
      tape, memory, feed, finish, compileTail, runTail, tailProgram, stats: st,
      get pointer() { return p; }, set pointer(v) { p = v; },
      get fed() { return fed; }, get inputUsed() { return inPos; }, get streaming() { return mode !== TAIL; },
      get handoverAt() { return mode === TAIL ? tailAt : -1; }, get tailBytes() { return tailBytes; },
      setInput(bytes) { input = bytes; inPos = 0; },
      setOutput(fn) { o.onOutput = fn; },
    };
  }

  return { create };
});
