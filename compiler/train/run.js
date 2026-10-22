'use strict';

// Run a brainfuck program through the site's brainfuck-to-WebAssembly runtime, with 32-bit cells.

const BFWasm = require('../../site/runtime/bfwasm');

const now = () => Number(process.hrtime.bigint()) / 1e6;

// input: bytes or a string; onOutput(bytes) sees the output as it comes (flushEvery bytes at a time)
function runBF(src, { input = '', tapeSize = 1 << 16, onOutput = null, flushEvery = 1 } = {}) {
  const t0 = now();
  const exe = BFWasm.compileSync(src, { cellBits: 32, tapeSize });
  const t1 = now();
  const r = exe.run(input, { onOutput, flushEvery });
  const t2 = now();
  return { output: r.output, text: r.text, pointer: r.pointer, tape: Int32Array.from(exe.tape()), ms: { compile: t1 - t0, run: t2 - t1 } };
}

module.exports = { runBF };

// node compiler/train/run.js <program.bf> [input file]: run it and print what it prints
if (require.main === module) {
  const fs = require('fs');
  const [file, inputFile] = process.argv.slice(2);
  if (!file) { console.error('node compiler/train/run.js <program.bf> [input file]'); process.exit(2); }
  const input = inputFile ? fs.readFileSync(inputFile) : '';
  const r = runBF(fs.readFileSync(file, 'latin1'), { input, tapeSize: 1 << 23, flushEvery: 64, onOutput: (b) => process.stdout.write(Buffer.from(b)) });
  console.error(`\n[${(r.ms.compile / 1000).toFixed(1)} s to compile, ${(r.ms.run / 1000).toFixed(1)} s to run]`);
}
