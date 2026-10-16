// The Web Worker of brnfck-qwen2.5-1.5b.
'use strict';
importScripts('../runtime/bfwasm.js?v=r8', '../runtime/runcore.js?v=r7', '../runtime/question.js?v=r7', '../runtime/peek.js?v=r9', '../program-source.js?v=r6');

(function () {
  const BFWasm = self.BFWasm, RunCore = self.RunCore, Question = self.Question, ProgramSource = self.ProgramSource;
  const now = () => performance.now();
  const PIECE_GAP_MS = 20;
  const gib = (bytes) => (bytes / 2 ** 30).toFixed(2);
  const num = (n) => Math.round(n).toLocaleString('en-US');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let view = null, ex = null, exe = null, meta = null, saved = null, startPointer = 0, dirty = false;

  // the memory slots as they are now, for the page (runtime/peek.js); view comes with a 'watch' message
  const filled = () => { try { return view && view.cols ? Peek.fill(ex.tape, meta.tapeSize, view.cols) : null; } catch (e) { return null; } };
  const sendSlots = (id) => {
    if (!view || !view.slots || !ex) return;
    try {
      const s = Peek.slots(ex.tape, view.slots);
      self.postMessage({ type: 'slots', id, used: s.used, shade: s.shade }, [s.used.buffer, s.shade.buffer]);
    } catch (e) { view = null; }                               // a picture never stops the program
  };

  // the cells a finished run leaves changed, as [first cell, number of cells]
  function restoreRanges(info) {
    const out = info.cells.map((r) => r.slice());
    for (let l = 0; l < info.layers; l++) for (let pos = 0; pos < info.positions; pos++) for (const [first, n] of info.slotParts) out.push([first + l * info.layerStep + pos * info.positionStep, n]);
    return out;
  }

  function declaredLimit() {
    const can = (pages) => { try { new WebAssembly.Memory({ address: 'i64', initial: 0n, maximum: BigInt(pages) }); return true; } catch (e) { return false; } };
    if (!can(1)) return 0;
    let lo = 1, hi = 2 ** 37;                                   // (2^37 pages = 2^53 bytes)
    if (can(hi)) return hi;
    while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (can(mid)) lo = mid; else hi = mid; }
    return lo;
  }

  // The memory for the tape: all of it at once. Says exactly what was refused.
  async function getMemory(pages, again) {
    const bytes = pages * 65536;
    const limit = declaredLimit();
    if (limit === 0) throw new Error('this browser has no 64-bit WebAssembly memory (memory64). The tape needs ' + gib(bytes) + ' GiB; a 32-bit memory ends at 4 GiB');
    if (limit < pages) throw new Error(`this browser allows a 64-bit WebAssembly memory of at most ${num(limit)} pages (${gib(limit * 65536)} GiB); the tape needs ${num(pages)} pages (${gib(bytes)} GiB)`);
    let last = null;
    for (let attempt = 0; attempt < (again ? 8 : 1); attempt++) {
      if (attempt) await sleep(2000);                           // (the memory of a worker that was just ended is given back a little later)
      try { return new WebAssembly.Memory({ address: 'i64', initial: BigInt(pages), maximum: BigInt(pages) }); } catch (e) { last = e; }
    }
    throw new Error(`the browser allows a 64-bit memory of up to ${gib(limit * 65536)} GiB, but it did not get the ${gib(bytes)} GiB (${num(pages)} pages, ${num(bytes)} bytes) the tape needs from this computer now (${(last && last.message) || last})`);
  }

  // Typed arrays above byte 2^32: tried on the last cells of the (still empty) tape.
  function checkViews(memory, tape) {
    const size = tape.length, last = size - 1, at = tape.byteOffset + last * 4, v = 0x89ABCDEF;
    const bad = (what) => { throw new Error(`this browser's typed arrays do not work above 4 GB (${what}); the tape is ${gib(size * 4)} GiB`); };
    if (memory.buffer.byteLength < at + 4) bad('the buffer is ' + memory.buffer.byteLength + ' bytes long');
    if (tape[last] !== 0) bad('a new memory is not zero');
    tape[last] = v;
    const b = new Uint8Array(memory.buffer, at, 4);
    if (b[0] !== 0xEF || b[1] !== 0xCD || b[2] !== 0xAB || b[3] !== 0x89) bad('index');
    if (new Uint8Array(memory.buffer)[at + 3] !== 0x89) bad('byte index');
    const sub = tape.subarray(last - 1);
    if (sub.byteOffset !== at - 4 || sub[1] !== v) bad('subarray');
    if (tape.slice(last, last + 1)[0] !== v) bad('slice');
    tape.set(Uint32Array.of(7, 0), last - 1);
    if (tape[last] !== 0 || tape[last - 1] !== 7) bad('set');
    tape[last - 1] = 0;
  }

  async function load(m) {
    meta = m.meta;
    let stage = 'memory';
    try {
      self.postMessage({ type: 'progress', stage });
      const pages = BFWasm.pagesFor(meta.tapeSize, 32);
      const memory = await getMemory(pages, m.again);
      ex = RunCore.create(BFWasm, { memory, address: 64, tapeSize: meta.tapeSize, cellBits: 32, collect: false, input: new Uint8Array(0), stopAt: meta.writerBytes, tailOnInput: false });
      checkViews(memory, ex.tape);

      stage = 'program';
      const total = meta.programBytes;
      if (m.manifest && (m.manifest.totalBytes !== total || m.manifest.sha256 !== meta.sha256)) throw new Error('the chunks on this host are not of the program its meta file describes: make the chunks again (node tools/make-chunks.js 1.5b)');
      const reader = await ProgramSource.open({ manifest: m.manifest, manifestUrl: m.manifestUrl, fileUrl: m.fileUrl, store: m.store, fetchOptions: { cache: 'no-store' } });
      const writer = meta.writerBytes;
      const tell = (at) => self.postMessage({ type: 'progress', stage, loaded: at, total, net: reader.netBytes, source: reader.source, pointer: ex.pointer, fill: filled() });
      let rest = new Uint8Array(total - writer);              // the program text after the writing part
      let at = 0, told = 0, sampled = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (at + value.length > total) throw new Error(`the program text is longer than the ${total} characters ${meta.program.replace('.bf', '.meta.json')} says: build the files again`);
        if (!sampled && at + value.length > total / 2 && value.length >= 3000) { sampled = true; self.postMessage({ type: 'sample', text: BFWasm.latin1(value.subarray(0, 3000)) }); }
        if (at < writer) ex.feed(value);                       // executes this piece of the program (up to the end of the writing part)
        if (at + value.length > writer) { const from = Math.max(0, writer - at); rest.set(value.subarray(from), at + from - writer); }
        at += value.length;
        if (now() - told > 200) { told = now(); tell(at); }
      }
      if (at !== total) throw new Error(`got ${at} of ${total} characters of the program (the download broke off)`);
      tell(at);
      if (ex.fed !== writer) throw new Error('unexpected program: the writing part was not run to its end');
      if (ex.pointer !== meta.pointerAfterWriting) throw new Error('unexpected program: the pointer is not where the build noted it');

      stage = 'compile';
      self.postMessage({ type: 'progress', stage });
      const g = BFWasm.generate(BFWasm.parse(rest), { cellBits: 32, tapeSize: meta.tapeSize, memory: 'imported', address: 64 });
      rest = null;
      exe = new BFWasm.Program(new WebAssembly.Module(g.bytes), { cellBits: g.cellBits, tapeSize: g.tapeSize, stats: g.stats, pages: g.pages }, ex.memory);
      startPointer = ex.pointer;

      // the cells to put back before a second question
      try {
        saved = restoreRanges(meta.restore).map(([first, n]) => ({ first, cells: ex.tape.slice(first, first + n) }));
      } catch (e) { saved = null; }
      dirty = false;
      self.postMessage({ type: 'ready', source: reader.source, storing: reader.storing });
      sendSlots(0);
    } catch (e) {
      ex = exe = null;
      self.postMessage({ type: 'error', stage, message: String((e && e.message) || e) });
    }
  }

  function ask(m) {
    try {
      if (!exe) throw new Error('the program is not loaded');
      if (dirty) {
        if (!saved) throw new Error('the tape has been used and cannot be put back: load the program again');
        for (const s of saved) ex.tape.set(s.cells, s.first);
      }
      dirty = true;
      const q = Question.questionBytes(m.question, meta.maxQuestionBytes);
      let pieces = 0, last = -Infinity;
      const onOutput = (bytes) => {
        const t = now();
        const fresh = t - last > PIECE_GAP_MS;
        if (fresh) pieces++;
        last = t;
        self.postMessage({ type: 'output', id: m.id, bytes, piece: pieces });
        if (fresh) sendSlots(m.id);                               // the key and value of this position are stored by now
      };
      exe.run(q, { keep: true, pointer: startPointer, collect: false, flushEvery: 1, onOutput });
      sendSlots(m.id);
      self.postMessage({ type: 'done', id: m.id, pieces, reusable: !!saved });
    } catch (e) {
      exe = null;                                              // the tape may be in the middle of a step
      self.postMessage({ type: 'error', stage: 'ask', id: m.id, message: String((e && e.message) || e) });
    }
  }

  self.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === 'load') load(m);
    else if (m.type === 'ask') ask(m);
    else if (m.type === 'watch') view = m;
  };
})();
