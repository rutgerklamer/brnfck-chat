'use strict';

// The text-to-text program of Qwen3.5-0.8B and what it reads, into compiler/qwen3.5/program/out/:
// the program, the tokenizer stream and a meta file (the weight stream is the engine's: engine/build_real.js stream).
//   node compiler/qwen3.5/program/build.js

const fs = require('fs');
const path = require('path');
const { packTokenizer } = require('../tokenizer/pack');
const { streamBytes } = require('../engine/pack');
const Build = require('../engine/build_real');
const { buildChat } = require('./gen');
const { writeChunks } = require('../engine/gen');

const TOK = { maxChars: 200 };
const OUT = path.join(__dirname, 'out');
// The question as the program reads it: one line of at most maxChars bytes, then a newline.
function questionBytes(text) {
  let b = Buffer.from(String(text).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().normalize('NFC'), 'utf8');
  if (b.length > TOK.maxChars) { let end = TOK.maxChars; while (end > 0 && (b[end] & 0xc0) === 0x80) end--; b = b.subarray(0, end); }
  return Buffer.concat([b, Buffer.from([10])]);
}

const FILES = {
  program: path.join(OUT, `chat-${path.basename(Build.FILES.program)}`), meta: path.join(OUT, `chat-${path.basename(Build.FILES.meta)}`),
  tokenizer: path.join(OUT, 'tokenizer.bin'), weights: Build.FILES.weights, ref: Build.FILES.ref,
};
const num = (n) => Math.round(n).toLocaleString('en-US'), gib = (n) => (n / 2 ** 30).toFixed(2) + ' GiB';

const generate = () => buildChat(Build.realArch(), TOK);

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { bytes, info } = packTokenizer(TOK);
  if (info.fixed.join() !== '248045,846,198') throw new Error('the prompt does not start with <|im_start|>user and a newline');
  const { chunks, length, loadSrc, pointer, layout } = generate();
  writeChunks(FILES.program, chunks);
  fs.writeFileSync(FILES.tokenizer, bytes);
  const weightBytes = streamBytes(layout), bits = layout.tapeSize * 4 + 2 ** 21 > 2 ** 32 - 65536 ? 64 : 32;
  if (fs.existsSync(FILES.weights) && fs.statSync(FILES.weights).size !== weightBytes) throw new Error(`${FILES.weights} has another length than the program reads`);
  const meta = {
    model: Build.NAME, program: path.basename(FILES.program), programBytes: length, loadBytes: loadSrc.length, pointerAfterLoad: pointer,
    cellBits: 32, tapeSize: layout.tapeSize, engineCells: layout.engineCells, memoryBits: bits,
    weightBytes, tokenizerBytes: bytes.length, maxQuestionBytes: TOK.maxChars, maxPositions: 256,
  };
  fs.writeFileSync(FILES.meta, JSON.stringify(meta, null, 1));
  console.log(`${FILES.program}: ${num(length)} characters (load part ${num(loadSrc.length)}); tape ${num(layout.tapeSize)} cells = ${gib(layout.tapeSize * 4)}, ${bits}-bit memory`);
  console.log(`  reads: weight stream ${num(weightBytes)} bytes (${FILES.weights}), tokenizer stream ${num(bytes.length)} bytes (${FILES.tokenizer})`);
}

module.exports = { FILES, TOK, generate, questionBytes };
if (require.main === module) main();
