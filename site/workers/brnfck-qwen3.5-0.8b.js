// The Web Worker of brnfck-qwen3.5-0.8b. Its tape (3.98 GiB) fits a 32-bit memory, as that of brnfck-qwen2.5-0.5b.
// Without restore ranges in its meta file, a second question loads the program again (home.js).
'use strict';
importScripts('../runtime/bfwasm.js?v=r9', '../runtime/runcore.js?v=r8', '../runtime/question.js?v=r7', '../runtime/peek.js?v=r10', '../program-source.js?v=r6');

(function () {
  const BFWasm = self.BFWasm, RunCore = self.RunCore, Question = self.Question, ProgramSource = self.ProgramSource;
  const now = () => performance.now();
  const PIECE_GAP_MS = 20;                                      // output after a pause this long starts a new word piece
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

  // Runs the writing part as it downloads (it puts the model on the tape), then compiles the engine to WebAssembly.
  async function load(m) {
    meta = m.meta;
    let stage = 'memory';
    try {
      self.postMessage({ type: 'progress', stage });
      const mib = Math.round(meta.tapeSize * 4 / 2 ** 20);
      try {
        ex = RunCore.create(BFWasm, { tapeSize: meta.tapeSize, cellBits: 32, collect: false, input: new Uint8Array(0), stopAt: meta.writerBytes, tailOnInput: false });
      } catch (e) { throw new Error(`could not get the ${mib} MiB of memory the program's tape needs (${(e && e.message) || e})`); }

      stage = 'program';
      const total = meta.programBytes;
      if (m.manifest && (m.manifest.totalBytes !== total || m.manifest.sha256 !== meta.sha256)) throw new Error('the chunks on this host are not of the program its meta file describes: make the chunks again (node tools/make-chunks.js 0.8b --chunk 16777216)');
      const reader = await ProgramSource.open({ manifest: m.manifest, manifestUrl: m.manifestUrl, fileUrl: m.fileUrl, store: m.store });
      const writer = meta.writerBytes;
      const tell = (at) => self.postMessage({ type: 'progress', stage, loaded: at, total, net: reader.netBytes, source: reader.source, pointer: ex.pointer, fill: filled() });
      let rest = new Uint8Array(total - writer);              // the program text after the writing part
      let at = 0, told = 0, sampled = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (at + value.length > total) throw new Error(`the program text is longer than the ${total} characters ${meta.program.replace('.bf', '.meta.json')} says: build the files again`);
        if (!sampled && at + value.length > total / 2 && value.length >= 3000) { sampled = true; self.postMessage({ type: 'sample', text: BFWasm.latin1(value.subarray(0, 3000)) }); }
        if (at < writer) ex.feed(value);                       // runs it, up to the end of the writing part
        if (at + value.length > writer) { const from = Math.max(0, writer - at); rest.set(value.subarray(from), at + from - writer); }
        at += value.length;
        if (now() - told > 100) { told = now(); tell(at); }
      }
      if (at !== total) throw new Error(`got ${at} of ${total} characters of the program (the download broke off)`);
      tell(at);
      if (ex.fed !== writer) throw new Error('unexpected program: the writing part was not run to its end');
      if (ex.pointer !== meta.pointerAfterWriting) throw new Error('unexpected program: the pointer is not where the build noted it');

      stage = 'compile';
      self.postMessage({ type: 'progress', stage });
      const g = BFWasm.generate(BFWasm.parse(rest), { cellBits: 32, tapeSize: meta.tapeSize, memory: 'imported' });
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
        if (fresh) sendSlots(m.id);                               // this position is stored: in the 6 attention layers and 18 DeltaNet tables
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
