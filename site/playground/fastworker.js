// Fast mode of the playground: runs a program in a Web Worker, so the page stays alive and Stop always works.
'use strict';
importScripts('engine.js?v=r6');
const PG = self.PG;
let fast = null, pauseAsked = false, waiting = false, t0 = 0, spent = 0;

function usedTape(tape, p) {
  let end = tape.length;
  while (end > 0 && tape[end - 1] === 0) end--;
  return tape.slice(0, Math.max(end, p + 1, 1));
}
function finish(state) {
  const out = fast.takeOutput();
  if (out.length) self.postMessage({ type: 'out', bytes: out });
  const tape = usedTape(fast.tape, fast.p);
  self.postMessage({ type: 'end', state, error: fast.error, ms: spent, steps: fast.steps, p: fast.p, textPos: state === 'error' && fast.errorPos >= 0 ? fast.errorPos : fast.textPos(), done: fast.state === 'done', tape, inPos: fast.inPos, eofSent: fast.eofSent }, [tape.buffer]);
  fast = null;
}
function drive() {
  if (!fast) return;
  if (pauseAsked) { finish('paused'); return; }
  const start = performance.now();
  let r = 'limit';
  while (r === 'limit' && performance.now() - start < 60) r = fast.run(400000);
  spent += performance.now() - start;
  if (fast.outLen) self.postMessage({ type: 'out', bytes: fast.takeOutput() });
  if (r === 'limit') { setTimeout(drive, 0); return; }
  if (r === 'input') { waiting = true; self.postMessage({ type: 'need' }); return; }
  finish(r);
}

self.onmessage = (ev) => {
  const m = ev.data;
  if (m.type === 'run') {
    const set = PG.cleanSettings(m.settings);
    pauseAsked = false; waiting = false; spent = 0;
    try {
      if (m.engine === 'wasm') {
        importScripts('../runtime/bfwasm.js?v=r7');
        t0 = performance.now();
        const exe = self.BFWasm.compileSync(m.src, { cellBits: set.bits, tapeSize: set.size });
        self.postMessage({ type: 'started', engine: 'wasm', compileMs: performance.now() - t0 });
        t0 = performance.now();
        let pending = [], size = 0, last = performance.now();
        const flush = () => { if (!size) return; const b = new Uint8Array(size); let at = 0; for (const c of pending) { b.set(c, at); at += c.length; } pending = []; size = 0; self.postMessage({ type: 'out', bytes: b }); };
        const r = exe.run(m.input, { collect: false, flushEvery: 1, onOutput: (bytes) => { pending.push(bytes.slice()); size += bytes.length; const now = performance.now(); if (now - last > 40 || size > 65536) { last = now; flush(); } } });
        flush();
        const ms = performance.now() - t0, tape = usedTape(exe.tape(), r.pointer);
        self.postMessage({ type: 'end', state: 'done', done: true, error: null, ms, steps: -1, p: r.pointer, textPos: -1, tape, inPos: m.input.length, eofSent: true }, [tape.buffer]);
        return;
      }
      t0 = performance.now();
      fast = new PG.Fast(m.src, set, m.input);
      self.postMessage({ type: 'started', engine: 'checked', compileMs: performance.now() - t0 });
      drive();
    } catch (e) {
      fast = null;
      self.postMessage({ type: 'end', state: 'error', done: false, error: String((e && e.message) || e), ms: 0, steps: 0, p: 0, textPos: 0, tape: new Uint8Array(1), inPos: 0, eofSent: false, crashed: true });
    }
  } else if (m.type === 'input' && fast) { fast.provide(m.bytes); if (waiting) { waiting = false; drive(); } }
  else if (m.type === 'eof' && fast) { fast.endInput(); if (waiting) { waiting = false; drive(); } }
  else if (m.type === 'pause' && fast) { pauseAsked = true; if (waiting) finish('paused'); }
};
