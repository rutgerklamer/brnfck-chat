'use strict';

// Ask brnfck-smollm2-135m a question: the single file of build.js, the question its only input.
//   node compiler/smollm/pure/ask.js [--max N] "What is the capital of France?"

const fs = require('fs');
const path = require('path');
const { runFile } = require('./run');
const { questionBytes } = require('../../../site/runtime/question');

const PROGRAMS = path.join(__dirname, '..', '..', '..', 'site', 'programs');
const FILE = path.join(PROGRAMS, 'brnfck-smollm2-135m.bf'), META = path.join(PROGRAMS, 'brnfck-smollm2-135m.meta.json');
const PIECE_GAP_MS = 20;                 // output bytes closer together than this belong to one word piece
const STOP = new Error('stopped by --max');

// max: stop as word piece max + 1 begins (0: let the program finish)
function ask(question, { onText, onProgress, onStart, max = 0 } = {}) {
  if (!fs.existsSync(FILE) || !fs.existsSync(META)) throw new Error(`${FILE} is missing: run  node compiler/smollm/pure/build.js  first`);
  const meta = JSON.parse(fs.readFileSync(META, 'utf8'));
  const input = questionBytes(question, meta.maxQuestionBytes);
  const now = () => Number(process.hrtime.bigint()) / 1e6, t0 = now();
  const dec = new TextDecoder('utf-8');
  const marks = [], out = [];
  let last = -Infinity, start = null, aborted = false;
  try {
    runFile(FILE, {
      tapeSize: meta.tapeSize, input, onProgress,
      onStart: (ms) => { start = ms; if (onStart) onStart(ms); },
      onOutput: (bytes) => {
        const t = now();
        if (t - last > PIECE_GAP_MS) { if (max && marks.length >= max) throw STOP; marks.push(t); }
        last = t;
        out.push(Buffer.from(bytes));
        if (onText) { const s = dec.decode(bytes, { stream: true }); if (s) onText(s); }
      },
    });
  } catch (e) { if (e !== STOP) throw e; aborted = true; }
  const gaps = marks.slice(1).map((m, i) => m - marks[i]).sort((a, b) => a - b);
  return {
    text: Buffer.concat(out).toString('utf8'), inputBytes: input.length, programBytes: meta.programBytes,
    startMs: start.stream + start.compile, firstMs: marks.length ? marks[0] - t0 : null, pieces: marks.length,
    perPieceMs: gaps.length ? gaps[gaps.length >> 1] : null, totalMs: now() - t0, aborted,
  };
}

module.exports = { FILE, META, ask };

if (require.main === module) {
  const a = process.argv.slice(2), i = a.indexOf('--max'), max = i < 0 ? 0 : +a.splice(i, 2)[1];
  const question = a.join(' ') || 'What is the capital of France?';
  const tty = process.stderr.isTTY, s = (ms) => (ms / 1000).toFixed(1);
  console.error(`Q: ${question}`);
  if (fs.existsSync(META)) {
    const meta = JSON.parse(fs.readFileSync(META, 'utf8'));
    console.error(`[SmolLM2-135M-Instruct as ${meta.programBytes.toLocaleString('en-US')} characters of brainfuck; tape ${(meta.tapeSize * 4 / 2 ** 30).toFixed(2)} GiB]`);
  }
  let r;
  try {
    r = ask(question, {
      max,
      onProgress: (at, total) => { if (tty) process.stderr.write(`\rrunning the program text: ${(at / 2 ** 20).toFixed(0)} of ${(total / 2 ** 20).toFixed(0)} MB `); },
      onStart: (ms) => { if (tty) process.stderr.write('\r' + ' '.repeat(60) + '\r'); console.error(`[start-up ${s(ms.stream + ms.compile)} s: the program wrote its own weights (${s(ms.stream)} s of brainfuck read from disk), last part compiled in ${s(ms.compile)} s]`); fs.writeSync(1, 'A: '); },
      onText: (text) => fs.writeSync(1, text),
    });
  } catch (e) { console.error(String(e.message || e)); process.exit(1); }
  fs.writeSync(1, '\n');
  console.error(`[input: the ${r.inputBytes} bytes of the question and its newline, nothing else]`);
  console.error(`[first word piece after ${s(r.firstMs ?? r.totalMs)} s (start-up ${s(r.startMs)} s, then the question's tokens); ${r.pieces} word pieces, ${r.perPieceMs === null ? '-' : (r.perPieceMs / 1000).toFixed(2)} s per word piece (median); whole run ${s(r.totalMs)} s${r.aborted ? `; stopped by --max ${max}` : ''}]`);
}
