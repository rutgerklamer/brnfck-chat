'use strict';

// Builds site/programs/brnfck-qwen3.5-0.8b.bf: ONE brainfuck program, question in, answer out, no data file.
// The load part of the text program (build.js) is run on the weight and tokenizer streams; the tape it leaves
// is written as brainfuck that writes it (compiler/smollm/pure/encode.js), and the rest of the program follows.
//   node compiler/qwen3.5/program/build_pure.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { encodeTape } = require('../../smollm/pure/encode');
const { session, compileProgram, runWithData } = require('../../qwen/program/run');
const { FILES, TOK, generate } = require('./build');
const { sameAsFile } = require('../engine/gen');

const PIECE = 1 << 20;                  // cells per checksum
const KEEP_FREE = 8 * 2 ** 30;          // bytes of the disk that must stay free after the build
const PURE = { program: path.join(__dirname, '..', '..', '..', 'site', 'programs', 'brnfck-qwen3.5-0.8b.bf') };
PURE.meta = PURE.program.replace(/\.bf$/, '.meta.json');
const num = (n) => Math.round(n).toLocaleString('en-US'), gib = (n) => (n / 2 ** 30).toFixed(2) + ' GiB';
const now = () => Number(process.hrtime.bigint()) / 1e9;
const freeDisk = () => { const s = fs.statfsSync(path.dirname(PURE.program)); return s.bavail * s.bsize; };

// SHA-256 of every PIECE cells (as little-endian 32-bit numbers).
function sumsOf(tape) {
  const sums = [];
  for (let at = 0; at < tape.length; at += PIECE) {
    const n = Math.min(tape.length, at + PIECE) - at;
    sums.push(crypto.createHash('sha256').update(new Uint8Array(tape.buffer, tape.byteOffset + at * 4, n * 4)).digest('hex'));
  }
  return sums;
}

// The load part of the text program run on the data files: the tape of the loaded model.
function loadedTape(G) {
  const DATA = [FILES.weights, FILES.tokenizer], S = session(G.layout.tapeSize);
  const t = now(), exe = compileProgram(S, G.loadSrc), r = runWithData(S, exe, DATA, Buffer.alloc(0));
  const dataBytes = DATA.reduce((s, f) => s + fs.statSync(f).size, 0);
  if (r.dataBytes !== dataBytes || r.output.length) throw new Error('the load part did not read exactly the data files');
  if (r.pointer !== G.pointer) throw new Error(`pointer after loading is ${r.pointer}, expected ${G.pointer}`);
  console.log(`load part (${num(G.loadSrc.length)} characters) run on ${num(dataBytes)} data bytes in ${(now() - t).toFixed(1)} s; tape ${num(S.tapeSize)} cells, pointer on cell ${r.pointer}; ${S.bits}-bit memory`);
  return { S, pointer: r.pointer, dataBytes };
}

function main() {
  let t = now();
  const G = generate();
  if (!sameAsFile(FILES.program, G.chunks)) throw new Error(`${FILES.program} is not the program gen.js generates: run build.js`);
  console.log(`program ${num(G.length)} characters = load part ${num(G.loadSrc.length)} + rest ${num(G.restLength)}  [${(now() - t).toFixed(1)} s]; free memory ${gib(os.freemem())}`);
  const rest = Buffer.concat(G.restChunks.map((c) => Buffer.from(c, 'latin1')));
  G.src = null; G.chunks = null; G.restChunks = null;
  const { S, pointer, dataBytes } = loadedTape(G), tape = S.tape();

  if (process.argv[2] === 'sums') {      // (the second process of verify_pure.js)
    fs.writeFileSync(process.argv[3], JSON.stringify({ pointer, sums: sumsOf(tape) }));
    return;
  }

  t = now();
  let nonZero = 0;
  for (let i = 0; i < tape.length; i++) if (tape[i] !== 0) nonZero++;
  if (fs.existsSync(PURE.program)) fs.unlinkSync(PURE.program);
  const guess = nonZero * 7 + rest.length, free = freeDisk();
  console.log(`${num(nonZero)} cells are not zero: the program will be at most about ${gib(guess)}; free on the disk ${gib(free)}  [${(now() - t).toFixed(0)} s]`);
  if (free - guess < KEEP_FREE) throw new Error(`not enough room on the disk (${gib(KEEP_FREE)} must stay free): not written`);
  const sums = sumsOf(tape);

  t = now();
  const fd = fs.openSync(PURE.program, 'w'), hash = crypto.createHash('sha256');
  let written = 0, told = now();
  const sink = (b) => {
    fs.writeSync(fd, b); hash.update(b); written += b.length;
    if (now() - told > 30) { told = now(); console.log(`      ... ${gib(written)} written  [${(now() - t).toFixed(0)} s]`); }
  };
  let st;
  try {
    st = encodeTape(tape, pointer, sink);
    for (let at = 0; at < rest.length; at += 1 << 22) sink(rest.subarray(at, Math.min(rest.length, at + (1 << 22))));
  } catch (e) { fs.closeSync(fd); fs.unlinkSync(PURE.program); throw e; }
  fs.closeSync(fd);
  const total = st.chars + rest.length;
  if (written !== total) throw new Error('size mismatch');
  console.log(`${PURE.program}: ${num(total)} characters (${gib(total)}) = writing code ${num(st.chars)} + rest of the program ${num(rest.length)}  [${(now() - t).toFixed(0)} s]`);
  console.log(`    ${(st.chars / dataBytes).toFixed(3)} characters per data byte (${num(dataBytes)} bytes), ${(st.chars / st.nonZero).toFixed(3)} per non-zero cell (${num(st.nonZero)})`);

  const meta = {
    model: 'qwen3.5-0.8b', program: path.basename(PURE.program), programBytes: total, writerBytes: st.chars, restBytes: rest.length, sha256: hash.digest('hex'),
    cellBits: 32, tapeSize: tape.length, memoryBits: S.bits, pointerAfterWriting: pointer, replacesDataBytes: dataBytes,
    maxQuestionBytes: TOK.maxChars, encoder: st, pieceCells: PIECE, tapeSums: sums,
  };
  fs.writeFileSync(PURE.meta, JSON.stringify(meta, null, 1));
  console.log(`${PURE.meta} written; peak memory ${gib(process.resourceUsage().maxRSS * 1024)}; free on the disk now ${gib(freeDisk())}`);
}

module.exports = { PURE, sumsOf };
if (require.main === module) main();
