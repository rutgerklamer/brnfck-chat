// The Web Worker of "Trained in brainfuck": builds a training program (lib.js), runs it on the names and then the
// child program it prints; or builds and runs a child of the Shakespeare run from its weights.
'use strict';
importScripts('../runtime/bfwasm.js?v=r8', 'lib.js?v=r5');

(function () {
  const BFWasm = self.BFWasm, T = self.Train, SL = 13;
  const now = () => performance.now();
  const built = {};

  function build(key) {
    if (built[key]) return built[key];
    const m = T.spec.MODELS[key], t = now();
    const engine = new T.gen.Gen(m, { child: true }).childEngine();
    const tr = new T.gen.Gen(m).trainer(engine);
    return (built[key] = { m, src: tr.src, parts: tr.parts, writer: tr.writerChars, engine: engine.length, ms: now() - t, L: T.layout.layout(m) });
  }

  const compile = (src, tapeSize) => BFWasm.compileSync(src, { cellBits: 32, tapeSize });

  const latin1 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)); return s; };
  const bytesOf = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));

  // the W cell (+1 in a slot of SL cells) of every slot, as the page draws it: w / 256, rounded, clamped to ±127
  function weights(tape, L) {
    let n = 0;
    for (const R of L.regions) n += R.regionSlots;
    const out = new Int8Array(n);
    let k = 0;
    for (const R of L.regions) {
      for (let r = 0; r < R.regionSlots; r++) {
        const w = tape[R.R0 + r * SL + 1] | 0;
        out[k++] = Math.max(-127, Math.min(127, Math.round(w / 256)));
      }
    }
    return out;
  }

  // The training program prints one loss line per step, then the child program as its last line.
  async function train(key) {
    const b = build(key);
    self.postMessage({ type: 'built', chars: b.src.length, parts: b.parts, writer: b.writer, engine: b.engine, ms: b.ms });
    let t = now();
    const exe = compile(b.src, b.L.tapeSize);
    self.postMessage({ type: 'compiled', ms: now() - t });
    const input = T.data.trainingText(b.m), steps = input.length / b.m.batch;
    let buf = '', step = 0, lastTape = 0, lines = [];
    const sendTape = () => { const w = weights(exe.tape(), b.L); self.postMessage({ type: 'tape', step, w }, [w.buffer]); };
    sendTape();
    t = now();
    let lastPost = t;
    const r = exe.run(input, {
      flushEvery: 64,
      onOutput: (bytes) => {
        if (step >= steps) return;
        buf += latin1(bytes);
        let nl;
        while (step < steps && (nl = buf.indexOf('\n')) >= 0) { lines.push(buf.slice(0, nl)); buf = buf.slice(nl + 1); step++; }
        const tt = now();
        if (lines.length && (tt - lastPost > 40 || step >= steps)) { self.postMessage({ type: 'lines', lines, ms: tt - t }); lines = []; lastPost = tt; }
        if (tt - lastTape > 150 || step >= steps) { lastTape = tt; sendTape(); }
      },
    });
    const runMs = now() - t;
    if (lines.length) self.postMessage({ type: 'lines', lines, ms: runMs });
    const text = r.text, child = text.slice(text.lastIndexOf('\n') + 1);
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytesOf(child))), (x) => x.toString(16).padStart(2, '0')).join('');
    self.postMessage({ type: 'trained', ms: runMs, child: child.length, sha256: hash });
    t = now();
    const c = compile(child, b.L.tapeSize).run('');
    self.postMessage({ type: 'names', names: c.text, ms: now() - t });
  }

  // A child from its weights (w: every slot at the child's scale, region after region), seed and number of lines:
  // built, compiled and run here, its text sent as it comes.
  function child(msg) {
    const m = T.spec.MODELS[msg.key], L = T.layout.layout(m), t0 = now();
    let off = 0;
    const vals = L.regions.map((Rg) => { const v = msg.w.subarray(off, off + Rg.regionSlots); off += Rg.regionSlots; return v; });
    const src = T.gen.childWritingOf(L, vals) + new T.gen.Gen(m, { child: true }).childEngine({ seed: msg.seed, lines: msg.lines });
    const t1 = now();
    self.postMessage({ type: 'child-built', chars: src.length, ms: t1 - t0 });
    const exe = compile(src, L.tapeSize);
    const t2 = now();
    self.postMessage({ type: 'child-compiled', ms: t2 - t1 });
    let buf = '', last = t2;
    exe.run('', {
      flushEvery: 1,
      onOutput: (bytes) => {
        buf += latin1(bytes);
        const t = now();
        if (t - last > 25) { self.postMessage({ type: 'child-text', text: buf, ms: t - t2 }); buf = ''; last = t; }
      },
    });
    self.postMessage({ type: 'child-done', text: buf, ms: now() - t2 });
  }

  self.onmessage = (ev) => {
    const msg = ev.data;
    try {
      if (msg.type === 'train') train(msg.key).catch((e) => self.postMessage({ type: 'error', message: String(e && e.message || e) }));
      else if (msg.type === 'child') child(msg);
      else if (msg.type === 'text') {
        const b = build(msg.key);
        self.postMessage({ type: 'text', key: msg.key, src: b.src, parts: b.parts, ms: b.ms });
      }
    } catch (e) { self.postMessage({ type: 'error', message: String(e && e.message || e) }); }
  };
})();
