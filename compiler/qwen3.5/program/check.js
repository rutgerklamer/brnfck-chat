'use strict';

// The text program of build.js under the WebAssembly backend: question in, answer out, against the spec's answers.
//   node compiler/qwen3.5/program/check.js [question numbers...]

const fs = require('fs');
const os = require('os');
const BFWasm = require('../../../site/runtime/bfwasm');
const { loadTokenizer } = require('../tokenizer/ref');
const { FILES, TOK, questionBytes } = require('./build');

const now = () => Number(process.hrtime.bigint()) / 1e9, gib = (n) => (n / 2 ** 30).toFixed(2) + ' GiB';
const meta = JSON.parse(fs.readFileSync(FILES.meta, 'utf8')), ref = JSON.parse(fs.readFileSync(FILES.ref, 'utf8')), tok = loadTokenizer();
const pick = process.argv.slice(2).filter((a) => /^\d+$/.test(a)).map(Number);
let failed = 0, passed = 0;
const ok = (good, title, extra = '') => { console.log(`${good ? 'ok  ' : 'FAIL'}  ${title} ${extra}`); if (good) passed++; else { failed++; process.exitCode = 1; } };


const need = meta.tapeSize * 4 + 2 ** 21;
if (os.freemem() < need + 2 ** 30) throw new Error(`not enough free memory: the tape needs ${gib(need)}, ${gib(os.freemem())} is free`);
let t = now();
const memory = BFWasm.newMemory(meta.tapeSize, 32, meta.memoryBits);
const exe = BFWasm.compileSync(fs.readFileSync(FILES.program), { cellBits: 32, tapeSize: meta.tapeSize, memory: 'imported', address: meta.memoryBits }, memory);
console.log(`program ${meta.programBytes.toLocaleString('en-US')} characters compiled in ${(now() - t).toFixed(1)} s; tape ${gib(meta.tapeSize * 4)}`);
const ENOUGH = Symbol('enough');

let used = false;
for (const [i, e] of ref.questions.entries()) {
  if (pick.length && !pick.includes(i)) continue;
  if (used) BFWasm.tapeOf(memory, meta.tapeSize, 32).fill(0);
  used = true;
  const q = questionBytes(e.question), ids = tok.encode(tok.chatPrompt(e.question));
  ok(ids.join() === e.ids.join(), `[${i}] the reference tokenizer gives the prompt ids of the spec's answer`);
  const want = Buffer.from(e.newIds.flatMap((id) => tok.tokenBytes(id)));
  const files = [FILES.weights, FILES.tokenizer].map((f) => fs.openSync(f, 'r')), piece = Buffer.alloc(1 << 16), out = [], marks = [];
  let f = 0, at = 0, tLoaded = null, last = 0;
  const t0 = now();
  exe._refill = function () {
    while (f < files.length) {
      const k = fs.readSync(files[f], piece, 0, piece.length, null);
      if (k > 0) { this._mem.set(piece.subarray(0, k), 0); return k; }
      f++;
    }
    if (tLoaded === null) tLoaded = now();
    const k = Math.min(1 << 16, q.length - at);
    if (k <= 0) return 0;
    this._mem.set(q.subarray(at, at + k), 0); at += k;
    return k;
  };
  let aborted = false;
  try {
    exe.run(new Uint8Array(0), {
      flushEvery: 1, collect: false,
      onOutput: (b) => { const tt = now(); if (tt - last > 0.02) marks.push(tt); last = tt; for (const x of b) out.push(x); if (out.length >= want.length + (e.ended ? 1 : 0)) throw ENOUGH; },
    });
  } catch (err) { if (err !== ENOUGH) throw err; aborted = true; }
  for (const fd of files) fs.closeSync(fd);
  const got = Buffer.from(out), gaps = marks.slice(1).map((m, j) => m - marks[j]).sort((x, y) => x - y);
  console.log(`> ${e.question}\n  data read in ${(tLoaded - t0).toFixed(1)} s; first word piece after ${marks.length ? (marks[0] - tLoaded).toFixed(1) : '-'} s; ${gaps.length ? gaps[gaps.length >> 1].toFixed(2) : '-'} s per word piece (median)`);
  ok(got.equals(want) && aborted === !e.ended, `[${i}] the printed text equals the spec's (${want.length} bytes${e.ended ? ', then the program ended by itself' : ''})`,
    got.equals(want) ? JSON.stringify(got.toString('utf8')) : `\n      got  ${JSON.stringify(got.toString('utf8'))}\n      want ${JSON.stringify(want.toString('utf8'))}`);
}
console.log(failed ? `\n${failed} FAILED, ${passed} ok` : `\nall ${passed} ok`);
