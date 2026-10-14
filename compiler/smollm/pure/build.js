'use strict';

// Builds site/programs/brnfck-135m.bf: ONE brainfuck program, question in, answer out, no data file.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const BFWasm = require('../../../site/runtime/bfwasm');
const { realArch } = require('../engine/real');
const { TOK, OUTFILES: OLD } = require('../program/build');
const { buildSplit } = require('./gen');
const { encodeTape } = require('./encode');

const OUT = path.join(__dirname, 'out');
const PROGRAMS = path.join(__dirname, '..', '..', '..', 'site', 'programs');
const FILES = { program: path.join(PROGRAMS, 'brnfck-135m.bf'), meta: path.join(PROGRAMS, 'brnfck-135m.meta.json') };
const PIECE = 1 << 20;                  // cells per checksum
const num = (n) => Math.round(n).toLocaleString('en-US');
const now = () => Number(process.hrtime.bigint()) / 1e9;

// SHA-256 of the cells [from, to) as little-endian 32-bit numbers.
function sumOf(tape, from, to) {
  return crypto.createHash('sha256').update(new Uint8Array(tape.buffer, tape.byteOffset + from * 4, (to - from) * 4)).digest('hex');
}
function sumsOf(tape) {
  const sums = [];
  for (let at = 0; at < tape.length; at += PIECE) sums.push(sumOf(tape, at, Math.min(tape.length, at + PIECE)));
  return sums;
}

// Run the old program's load part on the data file: -> { tape, pointer }.
function oldTape(S, dataFile) {
  const exe = BFWasm.compileSync(S.loadSrc, { cellBits: 32, tapeSize: S.layout.tapeSize });
  const fd = fs.openSync(dataFile, 'r'), piece = Buffer.alloc(65536);
  let bytes = 0;
  exe._refill = function () {
    const k = fs.readSync(fd, piece, 0, piece.length, null);
    if (k > 0) { this._mem.set(piece.subarray(0, k), 0); bytes += k; }
    return k;
  };
  const r = exe.run(new Uint8Array(0), { collect: false });
  const more = fs.readSync(fd, piece, 0, 1, null);
  fs.closeSync(fd);
  if (more !== 0 || bytes !== fs.statSync(dataFile).size) throw new Error('the load part did not read exactly the data file');
  if (r.pointer !== S.pointer) throw new Error(`pointer after loading is ${r.pointer}, expected ${S.pointer}`);
  return { tape: exe.tape(), pointer: r.pointer, dataBytes: bytes };
}

function split() {
  if (!fs.existsSync(OLD.data)) throw new Error(`${OLD.data} is missing: run  node compiler/smollm/program/build.js  first`);
  const t = now(), S = buildSplit(realArch(), TOK);
  const old = fs.readFileSync(OLD.program);
  if (old.length !== S.src.length || !old.equals(Buffer.from(S.src, 'latin1'))) throw new Error('compiler/smollm/program/out/chat.bf is not the program gen.js generates');
  console.log(`old program: ${num(S.src.length)} characters = load part ${num(S.loadSrc.length)} + rest ${num(S.restSrc.length)}  [${(now() - t).toFixed(1)} s]`);
  return S;
}

function freeBytes(dir) { try { const s = fs.statfsSync(dir); return s.bavail * s.bsize; } catch (e) { return null; } }

function build() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(PROGRAMS, { recursive: true });
  const S = split();
  let t = now();
  const { tape, pointer, dataBytes } = oldTape(S, OLD.data);
  console.log(`load part run on ${num(dataBytes)} data bytes in ${(now() - t).toFixed(1)} s; tape ${num(tape.length)} cells, pointer on ${pointer}`);

  // room on the disk: a first pass that only counts
  t = now();
  const count = encodeTape(tape, pointer, () => {}), total = count.chars + S.restSrc.length;
  if (fs.existsSync(FILES.program)) fs.unlinkSync(FILES.program);
  const free = freeBytes(PROGRAMS);
  console.log(`the program will be ${num(total)} characters (${(total / 2 ** 30).toFixed(2)} GiB); free on the disk: ${free === null ? 'unknown' : (free / 2 ** 30).toFixed(1) + ' GiB'}  [${(now() - t).toFixed(0)} s]`);
  if (total > 6.5 * 2 ** 30) throw new Error('more than 6.5 GiB: not written');
  if (free !== null && free < total + 3 * 2 ** 30) throw new Error('not enough room on the disk (the program plus 3 GiB must be free): not written');

  t = now();
  const fd = fs.openSync(FILES.program, 'w');
  const hash = crypto.createHash('sha256');
  const sink = (b) => { fs.writeSync(fd, b); hash.update(b); };
  const st = encodeTape(tape, pointer, sink);
  if (st.chars !== count.chars) throw new Error('second pass gave another size');
  const rest = Buffer.from(S.restSrc, 'latin1');
  for (let at = 0; at < rest.length; at += 1 << 22) sink(rest.subarray(at, Math.min(rest.length, at + (1 << 22))));
  fs.closeSync(fd);
  console.log(`${FILES.program}: ${num(total)} characters = writing code ${num(st.chars)} + rest of the old program ${num(rest.length)}  [${(now() - t).toFixed(0)} s]`);
  console.log(`    ${(st.chars / dataBytes).toFixed(3)} characters per data byte (${num(dataBytes)} bytes), ${(st.chars / st.nonZero).toFixed(3)} per non-zero cell (${num(st.nonZero)})`);

  const meta = {
    program: 'brnfck-135m.bf', programBytes: total, writerBytes: st.chars, restBytes: rest.length, sha256: hash.digest('hex'),
    cellBits: 32, tapeSize: tape.length, pointerAfterWriting: pointer, replacesDataBytes: dataBytes,
    maxQuestionBytes: TOK.maxChars, encoder: st, pieceCells: PIECE, tapeSums: sumsOf(tape),
  };
  fs.writeFileSync(FILES.meta, JSON.stringify(meta, null, 1));
  console.log(`${FILES.meta} written`);
}

module.exports = { sumsOf, oldTape, split };
if (require.main === module) build();
