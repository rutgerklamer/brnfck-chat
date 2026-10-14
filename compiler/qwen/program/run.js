'use strict';

// Running the programs of compiler/qwen/program/.

const fs = require('fs');
const { backendFor, needMemory, now } = require('./common');

const PIECE_GAP = 0.02;                  // output bytes closer together than this (seconds) belong to one word piece
const ABORT = Symbol('enough output');

function session(tapeSize) {
  const B = backendFor(tapeSize);
  needMemory(tapeSize);
  const memory = B.BFWasm.newMemory(tapeSize, 32, B.bits);
  return { ...B, tapeSize, memory, used: false, tape: () => B.BFWasm.tapeOf(memory, tapeSize, 32) };
}

function compileProgram(S, src) {
  return S.BFWasm.compileSync(src, { cellBits: 32, tapeSize: S.tapeSize, memory: 'imported', address: S.bits }, S.memory);
}

// Collects the output and notes when each word piece started.
function collector(opt, t0) {
  const chunks = [], marks = [];
  let total = 0, last = -Infinity;
  return {
    marks,
    onOutput(b) {
      const t = now();
      if (t - last > PIECE_GAP) {
        if (opt.stopAfterPieces && marks.length >= opt.stopAfterPieces) throw ABORT;     // one piece too many: not shown
        marks.push(t - t0);
      }
      last = t;
      chunks.push(Buffer.from(b)); total += b.length;
      if (opt.onOutput) opt.onOutput(b);
      if (opt.stopAfterBytes !== undefined && total >= opt.stopAfterBytes) throw ABORT;
    },
    output: () => Buffer.concat(chunks),
  };
}
const fixPointer = (S, p) => (S.bits === 32 && p < 0 ? p + 2 ** 30 : p);

function runWithData(S, exe, dataFiles, question, opt = {}) {
  const fds = dataFiles.map((f) => fs.openSync(f, 'r')), piece = Buffer.alloc(65536), t0 = now(), out = collector(opt, t0);
  let file = 0, at = 0, tLoaded = null, dataBytes = 0;
  exe._refill = function () {
    while (file < fds.length) {
      const k = fs.readSync(fds[file], piece, 0, piece.length, null);
      if (k > 0) { this._mem.set(piece.subarray(0, k), 0); dataBytes += k; return k; }
      file++;
    }
    if (tLoaded === null) tLoaded = now() - t0;
    const k = Math.min(65536, question.length - at);
    if (k <= 0) return 0;
    this._mem.set(question.subarray(at, at + k), 0); at += k;
    return k;
  };
  let pointer = null, aborted = false;
  try {
    S.used = true;
    pointer = fixPointer(S, exe.run(new Uint8Array(0), { onOutput: out.onOutput, flushEvery: 1, collect: false }).pointer);
  } catch (e) { if (e !== ABORT) throw e; aborted = true; } finally { for (const fd of fds) fs.closeSync(fd); }
  return { output: out.output(), pointer, aborted, marks: out.marks, dataBytes, seconds: { load: tLoaded, total: now() - t0 } };
}

function runPure(S, file, question, opt = {}) {
  const total = fs.statSync(file).size, t0 = now(), out = collector(opt, t0);
  if (S.used) S.tape().fill(0);
  S.used = true;
  const ex = S.RunCore.create(S.BFWasm, { cellBits: 32, tapeSize: S.tapeSize, memory: S.memory, address: S.bits, input: question, stopAt: opt.stopAt, onOutput: out.onOutput, collect: false });
  const fd = fs.openSync(file, 'r'), piece = Buffer.allocUnsafe(1 << 22);
  let at = 0, told = 0;
  try {
    for (let k; (k = fs.readSync(fd, piece, 0, piece.length, null)) > 0;) {
      ex.feed(piece.subarray(0, k)); at += k;
      if (opt.onProgress && now() - told > 0.2) { told = now(); opt.onProgress(at, total); }
      if (opt.stopAt !== undefined && at >= opt.stopAt) break;
    }
  } finally { fs.closeSync(fd); }
  const t1 = now();
  ex.compileTail();
  const t2 = now();
  if (opt.onStart) opt.onStart({ stream: t1 - t0, compile: t2 - t1 });
  let r = null, aborted = false;
  try { r = ex.finish(); } catch (e) { if (e !== ABORT) throw e; aborted = true; }
  return {
    output: out.output(), pointer: r ? fixPointer(S, r.pointer) : null, aborted, marks: out.marks,
    handoverAt: ex.handoverAt, stats: ex.stats,
    seconds: { stream: t1 - t0, compile: t2 - t1, startup: t2 - t0, total: now() - t0 },
  };
}

// Seconds per word piece: the gaps between the pieces (median and mean).
function pieceTimes(marks) {
  const gaps = marks.slice(1).map((m, i) => m - marks[i]).sort((a, b) => a - b);
  return gaps.length ? { median: gaps[gaps.length >> 1], mean: gaps.reduce((a, b) => a + b, 0) / gaps.length, slowest: gaps[gaps.length - 1] } : null;
}

module.exports = { session, compileProgram, runWithData, runPure, pieceTimes };
