'use strict';

// The real model: site/programs/brnfck-smollm2-135m.bf, checked.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const BFWasm = require('../../../site/runtime/bfwasm');
const { runFile } = require('./run');
const { FILE, META } = require('./ask');
const { sumsOf, oldTape, split } = require('./build');

if (process.argv[2] === '--old-sums') {       // the second process of step 2
  const S = split(), t = oldTape(S, require('../program/build').OUTFILES.data);
  fs.writeFileSync(process.argv[3], JSON.stringify({ pointer: t.pointer, sums: sumsOf(t.tape) }));
  process.exit(0);
}

let failed = 0, passed = 0;
const ok = (good, name, extra = '') => { console.log(`${good ? 'ok  ' : 'FAIL'}  ${name} ${extra}`); if (good) passed++; else { failed++; process.exitCode = 1; } };
const num = (n) => Math.round(n).toLocaleString('en-US');
const now = () => Number(process.hrtime.bigint()) / 1e9;
const args = process.argv.slice(2), want = (s) => !args.length || args[0] === s;
const meta = JSON.parse(fs.readFileSync(META, 'utf8'));

if (want('scan')) {
  const t = now(), fd = fs.openSync(FILE, 'r'), piece = Buffer.allocUnsafe(1 << 22), hash = crypto.createHash('sha256');
  const count = new Float64Array(256);
  let at = 0, depth = 0, minDepth = 0, firstIn = -1, firstOut = -1, maxLoop = 0, loopStart = 0;
  for (let k; (k = fs.readSync(fd, piece, 0, piece.length, null)) > 0;) {
    hash.update(piece.subarray(0, k));
    for (let i = 0; i < k; i++) {
      const c = piece[i];
      count[c]++;
      if (c === 91) { if (depth++ === 0) loopStart = at + i; } else if (c === 93) { if (--depth < minDepth) minDepth = depth; if (depth === 0 && at + i < meta.writerBytes) maxLoop = Math.max(maxLoop, at + i + 1 - loopStart); }
      else if (c === 44) { if (firstIn < 0) firstIn = at + i; } else if (c === 46) { if (firstOut < 0) firstOut = at + i; }
    }
    at += k;
  }
  fs.closeSync(fd);
  let other = at;
  for (const ch of '+-<>[].,') other -= count[ch.charCodeAt(0)];
  ok(at === meta.programBytes && fs.statSync(FILE).size === at, `1  ${FILE}: ${num(at)} characters (${(at / 2 ** 30).toFixed(3)} GiB)`, `[scanned in ${(now() - t).toFixed(0)} s]`);
  ok(other === 0, `1  only the 8 brainfuck commands`, `(${[...'+-<>[].,'].map((ch) => `${ch} ${num(count[ch.charCodeAt(0)])}`).join('   ')}${other ? `; ${other} other characters` : ''})`);
  ok(depth === 0 && minDepth === 0, '1  the brackets match');
  ok(firstIn >= meta.writerBytes && firstOut >= meta.writerBytes, `1  the writing part (the first ${num(meta.writerBytes)} characters) has no ',' and no '.'`, `(first ',' at ${num(firstIn)}, first '.' at ${num(firstOut)}; ${num(count[44])} ',' in all; longest loop of the writing part: ${num(maxLoop)} characters)`);
  ok(hash.digest('hex') === meta.sha256, '1  SHA-256 of the file is the one build.js noted');
}

let memory = null;
const freshMemory = () => {
  if (!memory) memory = BFWasm.newMemory(meta.tapeSize, 32);
  else BFWasm.tapeOf(memory, meta.tapeSize, 32).fill(0);
  return memory;
};

if (want('tape')) {
  let t = now();
  const r = runFile(FILE, { tapeSize: meta.tapeSize, memory: freshMemory(), stopAt: meta.writerBytes, input: new Uint8Array(0) });
  const mine = sumsOf(r.tape);
  console.log(`      writing part run in ${(now() - t).toFixed(1)} s without any input: ${num(r.stats.loops)} loops (${num(r.stats.loopTexts)} different texts), pointer on cell ${r.pointer}`);
  t = now();
  const tmp = path.join(__dirname, 'out', 'old-sums.json');
  execFileSync(process.execPath, [__filename, '--old-sums', tmp], { stdio: ['ignore', 'ignore', 'inherit'] });
  const old = JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.unlinkSync(tmp);
  console.log(`      old load part run on chat.dat in a second process  [${(now() - t).toFixed(1)} s]`);
  const bad = mine.map((s, i) => (s === old.sums[i] ? -1 : i)).filter((i) => i >= 0);
  ok(mine.length === old.sums.length && bad.length === 0, `2  the tape after the writing part equals the tape after the old load part: ${mine.length} SHA-256 sums over ${num(meta.tapeSize)} cells (pieces of ${num(meta.pieceCells)} cells)`, bad.length ? `(pieces that differ: ${bad.slice(0, 10)})` : '');
  ok(r.pointer === old.pointer, `2  the pointer is on the same cell (${r.pointer})`, r.pointer === old.pointer ? '' : `(old: ${old.pointer})`);
  ok(mine.join() === meta.tapeSums.join(), '2  and both equal the sums build.js noted');
}

if (want('ask')) {
  const ref = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'program', 'out', 'ref.json'), 'utf8'));
  const { realArch } = require('../engine/real');
  const { TOK } = require('../program/build');
  const { buildChat } = require('../program/gen');
  const { layout } = buildChat(realArch(), TOK);
  const dirtyCells = (tape, limit = 5) => {
    const N = layout.engineCells - 1, dirty = [];
    let v = 0;
    for (const [lo, hi] of [...layout.allowedRanges(), [N + 1, N + 1]]) {
      for (; v < lo && dirty.length < limit; v++) if (tape[N - v] !== 0) dirty.push(N - v);
      v = Math.max(v, hi + 1);
    }
    for (let cell = N + 1; cell < layout.tapeSize && dirty.length < limit; cell++) if (tape[cell] !== 0 && !layout.tokData(cell)) dirty.push(cell);
    return dirty;
  };
  const pick = args.slice(1).map(Number), seen = { 'end token': 0, 'position limit': 0 };
  for (const [i, e] of ref.cases.entries()) {
    if (pick.length && !pick.includes(i)) continue;
    console.log(`\n> [${i}] ${JSON.stringify(e.question)}   (the spec generates ${e.ids.length} ids, ends by ${e.end})`);
    // exactly the bytes of the question and a newline (as the program reads them)
    const input = Buffer.from(e.question + '\n', 'utf8');
    const t0 = now(), marks = [];
    let last = -1, start = null;
    const r = runFile(FILE, {
      tapeSize: meta.tapeSize, memory: freshMemory(), input,
      onStart: (ms) => { start = ms; },
      onOutput: () => { const t = now(); if (t - last > 0.02) marks.push(t); last = t; },
    });
    const text = Buffer.from(r.output).toString('utf8');
    ok(text === e.text, `3  input = the ${input.length} bytes of the question; the printed text equals the spec's (${r.output.length} bytes)`, text === e.text ? '' : `\n      got  ${JSON.stringify(text)}\n      want ${JSON.stringify(e.text)}`);
    ok(marks.length === e.printing, `3  ${marks.length} word pieces arrived one by one`, marks.length === e.printing ? '' : `(the spec has ${e.printing} ids that print something)`);
    const d = dirtyCells(r.tape);
    ok(d.length === 0, '3  every scratch cell is zero at the end', d.length ? `(dirty real cells ${d})` : '');
    ok(r.pointer >= 0 && r.pointer < meta.tapeSize, '3  pointer on the tape at the end');
    seen[e.end]++;
    const gaps = marks.slice(1).map((m, j) => m - marks[j]).sort((a, b) => a - b);
    console.log(`      start-up ${((start.stream + start.compile) / 1000).toFixed(1)} s (program text streamed ${(start.stream / 1000).toFixed(1)} s, rest compiled ${(start.compile / 1000).toFixed(1)} s; switch at character ${num(r.handoverAt)}); first piece after ${marks.length ? (marks[0] - t0).toFixed(1) : '-'} s; ` +
      `${gaps.length ? gaps[gaps.length >> 1].toFixed(2) : '-'} s per piece (median); whole run ${(now() - t0).toFixed(1)} s`);
    console.log(`      ${JSON.stringify(text.length > 240 ? text.slice(0, 240) + ' ...' : text)}`);
  }
  if (!pick.length) ok(seen['end token'] > 0 && seen['position limit'] > 0, `3  both endings were tested: ${seen['end token']} by the end-of-turn token, ${seen['position limit']} by the limit of ${ref.maxTokens} positions`);
}
console.log(failed ? `\n${failed} FAILED, ${passed} ok` : `\nall ${passed} ok`);
