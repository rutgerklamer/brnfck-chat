'use strict';

// Run a brainfuck program of any size from a file: the whole text is executed, in order.

const fs = require('fs');
const BFWasm = require('../../../site/runtime/bfwasm');
const RunCore = require('../../../site/runtime/runcore');

const now = () => Number(process.hrtime.bigint()) / 1e6;

function runFile(file, options = {}) {
  const { onProgress, ...rest } = options;
  const total = fs.statSync(file).size, t0 = now();
  const ex = RunCore.create(BFWasm, { cellBits: 32, ...rest });
  const fd = fs.openSync(file, 'r'), piece = Buffer.allocUnsafe(1 << 22);
  let at = 0, told = 0;
  try {
    for (let k; (k = fs.readSync(fd, piece, 0, piece.length, null)) > 0;) {
      ex.feed(piece.subarray(0, k)); at += k;
      if (onProgress && now() - told > 200) { told = now(); onProgress(at, total); }
      if (options.stopAt !== undefined && at >= options.stopAt) break;
    }
  } finally { fs.closeSync(fd); }
  if (onProgress) onProgress(at, total);
  const t1 = now();
  ex.compileTail();
  const t2 = now();
  if (options.onStart) options.onStart({ stream: t1 - t0, compile: t2 - t1 });
  const r = ex.finish();
  return { ...r, tape: ex.tape, ms: { stream: t1 - t0, compile: t2 - t1, run: now() - t2 } };
}

module.exports = { runFile };
