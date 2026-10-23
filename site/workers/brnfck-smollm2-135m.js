// The Web Worker of brnfck-smollm2-135m.
'use strict';
importScripts('../runtime/bfwasm.js?v=r9', '../runtime/runcore.js?v=r8', '../runtime/question.js?v=r7', '../runtime/peek.js?v=r10', '../program-source.js?v=r6');

(function () {
  const BFWasm = self.BFWasm, RunCore = self.RunCore, Question = self.Question, ProgramSource = self.ProgramSource;
  const now = () => performance.now();
  const PIECE_GAP_MS = 20;                                      // output after a pause this long starts a new word piece
  let view = null, ex = null, exe = null, meta = null, backup = null, startPointer = 0, dirty = false;

  // the memory slots as they are now, for the page (runtime/peek.js); view comes with a 'watch' message
  const filled = () => { try { return view && view.cols ? Peek.fill(ex.tape, meta.tapeSize, view.cols) : null; } catch (e) { return null; } };
  const sendSlots = (id) => {
    if (!view || !view.slots || !ex) return;
    try {
      const s = Peek.slots(ex.tape, view.slots);
      self.postMessage({ type: 'slots', id, used: s.used, shade: s.shade }, [s.used.buffer, s.shade.buffer]);
    } catch (e) { view = null; }                               // a picture never stops the program
  };

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
      const total = meta.programBytes, writer = meta.writerBytes;
      if (m.manifest && (m.manifest.totalBytes !== total || m.manifest.sha256 !== meta.sha256)) throw new Error('the chunks on this host are not of the program its meta file describes: make the chunks again (node tools/make-chunks.js small)');
      const src = await ProgramSource.open({ manifest: m.manifest, manifestUrl: m.manifestUrl, fileUrl: m.fileUrl, store: m.store });
      const tell = (at) => self.postMessage({ type: 'progress', stage, loaded: at, total, net: src.netBytes, source: src.source, pointer: ex.pointer, fill: filled() });
      let rest = new Uint8Array(total - writer);              // the program text after the writing part
      let at = 0, told = 0, sampled = false;
      for (;;) {
        const { done, value } = await src.read();
        if (done) break;
        if (at + value.length > total) throw new Error(`the program text is longer than the ${total} characters its meta file says: build the files again`);
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

      // a copy of the whole tape, put back before a second question
      self.postMessage({ type: 'progress', stage: 'copy' });
      try { backup = new Uint32Array(meta.tapeSize); backup.set(ex.tape); } catch (e) { backup = null; }
      dirty = false;
      self.postMessage({ type: 'ready', source: src.source, storing: src.storing });
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
        if (!backup) throw new Error('the tape has been used and there is no copy: load the program again');
        ex.tape.set(backup);
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
      self.postMessage({ type: 'done', id: m.id, pieces, reusable: !!backup });
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
