'use strict';

// The program of build_real.js under the WebAssembly backend, against the spec's answers.
//   node compiler/qwen3.5/engine/run_real.js [question numbers...]

const fs = require('fs');
const os = require('os');
const BFWasm = require('../../../site/runtime/bfwasm');
const { FILES } = require('./build_real');
const { packPrompt, unpackIds } = require('./pack');

const now = () => Number(process.hrtime.bigint()) / 1e9, gib = (n) => (n / 2 ** 30).toFixed(2) + ' GiB';
const meta = JSON.parse(fs.readFileSync(FILES.meta, 'utf8')), ref = JSON.parse(fs.readFileSync(FILES.ref, 'utf8'));
const pick = process.argv.slice(2).filter((a) => /^\d+$/.test(a)).map(Number);
let failed = 0, passed = 0;
const ok = (good, title, extra = '') => { console.log(`${good ? 'ok  ' : 'FAIL'}  ${title} ${extra}`); if (good) passed++; else { failed++; process.exitCode = 1; } };
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

const need = meta.tapeSize * 4 + 2 ** 21;
if (os.freemem() < need + 2 ** 30) throw new Error(`not enough free memory: the tape needs ${gib(need)}, ${gib(os.freemem())} is free`);
let t = now();
const src = fs.readFileSync(FILES.program);
const memory = BFWasm.newMemory(meta.tapeSize, 32, meta.memoryBits);
const exe = BFWasm.compileSync(src, { cellBits: 32, tapeSize: meta.tapeSize, memory: 'imported', address: meta.memoryBits }, memory);
const tape = () => BFWasm.tapeOf(memory, meta.tapeSize, 32);
console.log(`program ${meta.programBytes.toLocaleString('en-US')} characters compiled in ${(now() - t).toFixed(1)} s; tape ${gib(meta.tapeSize * 4)} (${meta.memoryBits}-bit memory)`);

let used = false;
for (const [i, e] of ref.questions.entries()) {
  if (pick.length && !pick.includes(i)) continue;
  if (used) tape().fill(0);
  used = true;
  const prompt = Buffer.from(packPrompt(e.ids, e.ids.length + ref.maxNew - 1)), fd = fs.openSync(FILES.weights, 'r'), piece = Buffer.alloc(1 << 16);
  let fileDone = false, at = 0, tLoaded = null;
  const marks = [], bytes = [], t0 = now();
  exe._refill = function () {
    if (!fileDone) {
      const k = fs.readSync(fd, piece, 0, piece.length, null);
      if (k > 0) { this._mem.set(piece.subarray(0, k), 0); return k; }
      fileDone = true; tLoaded = now();
    }
    const k = Math.min(1 << 16, prompt.length - at);
    if (k <= 0) return 0;
    this._mem.set(prompt.subarray(at, at + k), 0); at += k;
    return k;
  };
  exe.run(new Uint8Array(0), { onOutput: (b) => { for (const x of b) { bytes.push(x); if (bytes.length % 3 === 0) marks.push(now()); } }, flushEvery: 3, collect: false });
  fs.closeSync(fd);
  const got = unpackIds(bytes), first = marks.length ? marks[0] - tLoaded : null;
  const gaps = marks.slice(1).map((m, j) => m - marks[j]).sort((x, y) => x - y);
  console.log(`\n> [${i}] ${e.question}  (${e.ids.length} prompt ids)`);
  console.log(`  weights read in ${(tLoaded - t0).toFixed(1)} s; first new id after ${first?.toFixed(1)} s (${(first / e.ids.length).toFixed(2)} s per prompt position); ${gaps.length ? gaps[gaps.length >> 1].toFixed(2) : '-'} s per new id (median)`);
  ok(same(got, e.newIds), `${got.length} ids equal the spec's ${e.newIds.length}`, same(got, e.newIds) ? JSON.stringify(e.text) : `got ${JSON.stringify(got)}, want ${JSON.stringify(e.newIds)}`);
}
console.log(failed ? `\n${failed} FAILED, ${passed} ok` : `\nall ${passed} ok`);
