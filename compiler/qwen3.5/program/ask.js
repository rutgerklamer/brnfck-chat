'use strict';

// Ask brnfck-qwen3.5-0.8b a question: the single file of build_pure.js, the question its only input.
//   node compiler/qwen3.5/program/ask.js [--max N] "What is the capital of France?"

const fs = require('fs');
const { session, runPure, pieceTimes } = require('../../qwen/program/run');
const { questionBytes } = require('./build');
const { PURE } = require('./build_pure');

const num = (n) => Math.round(n).toLocaleString('en-US'), gib = (n) => (n / 2 ** 30).toFixed(2) + ' GiB';

function main() {
  const a = process.argv.slice(2), i = a.indexOf('--max'), max = i < 0 ? 0 : +a.splice(i, 2)[1];
  const question = a.join(' ') || 'What is the capital of France?';
  if (!fs.existsSync(PURE.program) || !fs.existsSync(PURE.meta)) throw new Error(`${PURE.program} is missing: build it first (node tools/build.js 0.8b)`);
  const meta = JSON.parse(fs.readFileSync(PURE.meta, 'utf8')), input = questionBytes(question);
  const tty = process.stderr.isTTY, dec = new TextDecoder('utf-8'), S = session(meta.tapeSize);
  console.error(`Q: ${question}`);
  console.error(`[Qwen3.5-0.8B as ${num(meta.programBytes)} characters of brainfuck; tape ${gib(meta.tapeSize * 4)}, ${S.bits}-bit memory]`);
  const r = runPure(S, PURE.program, input, {
    stopAfterPieces: max,
    onOutput: (bytes) => { const s = dec.decode(bytes, { stream: true }); if (s) fs.writeSync(1, s); },
    onProgress: (at, total) => { if (tty) process.stderr.write(`\rrunning the program text: ${(at / 2 ** 30).toFixed(2)} of ${(total / 2 ** 30).toFixed(2)} GiB `); },
    onStart: (s) => { if (tty) process.stderr.write('\r' + ' '.repeat(60) + '\r'); console.error(`[start-up ${(s.stream + s.compile).toFixed(1)} s: the program wrote its own weights (${s.stream.toFixed(1)} s of brainfuck executed from disk), its last part was compiled in ${s.compile.toFixed(1)} s]`); fs.writeSync(1, 'A: '); },
  });
  fs.writeSync(1, '\n');
  const pt = pieceTimes(r.marks);
  console.error(`[input: the ${input.length} bytes of the question and its newline, nothing else]`);
  console.error(`[first word piece after ${r.marks.length ? r.marks[0].toFixed(1) : '-'} s (the question's tokens pass through the model first); ${r.marks.length} word pieces, ` +
    `${pt ? pt.median.toFixed(2) : '-'} s per word piece (median); whole run ${r.seconds.total.toFixed(1)} s${r.aborted ? `; stopped by --max ${max}` : ''}]`);
}

try { main(); } catch (e) { console.error(String(e.message || e)); process.exit(1); }
