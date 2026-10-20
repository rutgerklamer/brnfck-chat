'use strict';

// The self-contained program of build_pure.js, checked three ways (as ../program/verify_pure.js):
//   1 the file holds only the eight commands (and the brackets match; three input commands, after the writing part:
//     one reads the picture, two the question: its first character, then the others in a loop)
//   2 the tape its writing part leaves equals the tape the load part leaves after reading its three streams
//   3 given a picture and a question, it prints the spec's answer
//   node compiler/qwen3.5/vision/verify_pure.js [scan] [tape] [ask [question numbers...]]

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { session, runPure, pieceTimes } = require('../../qwen/program/run');
const { loadTokenizer } = require('../tokenizer/ref');
const { sumsOf } = require('../program/build_pure');
const { FILES, inputBytes } = require('./build');
const { PURE } = require('./build_pure');

const args = process.argv.slice(2).filter((a) => !a.startsWith('--')), want = (s) => !args.length || args[0] === s;
let failed = 0, passed = 0;
const ok = (good, name, extra = '') => { console.log(`${good ? 'ok  ' : 'FAIL'}  ${name} ${extra}`); if (good) passed++; else { failed++; process.exitCode = 1; } };
const num = (n) => Math.round(n).toLocaleString('en-US'), gib = (n) => (n / 2 ** 30).toFixed(2) + ' GiB';
const now = () => Number(process.hrtime.bigint()) / 1e9;
const meta = JSON.parse(fs.readFileSync(PURE.meta, 'utf8'));
console.log(`${PURE.program}; free memory ${gib(os.freemem())}`);

if (want('scan')) {
  const t = now(), fd = fs.openSync(PURE.program, 'r'), piece = Buffer.allocUnsafe(1 << 22), hash = crypto.createHash('sha256');
  const count = new Float64Array(256);
  let at = 0, depth = 0, minDepth = 0, firstIn = -1, firstOut = -1;
  for (let k; (k = fs.readSync(fd, piece, 0, piece.length, null)) > 0;) {
    hash.update(piece.subarray(0, k));
    for (let i = 0; i < k; i++) {
      const c = piece[i];
      count[c]++;
      if (c === 91) depth++; else if (c === 93) { if (--depth < minDepth) minDepth = depth; }
      else if (c === 44) { if (firstIn < 0) firstIn = at + i; } else if (c === 46) { if (firstOut < 0) firstOut = at + i; }
    }
    at += k;
  }
  fs.closeSync(fd);
  let other = at;
  for (const ch of '+-<>[].,') other -= count[ch.charCodeAt(0)];
  ok(at === meta.programBytes, `1  ${num(at)} characters (${gib(at)})`, `[scanned in ${(now() - t).toFixed(0)} s]`);
  ok(other === 0, '1  only the 8 brainfuck commands', `(${[...'+-<>[].,'].map((ch) => `${ch} ${num(count[ch.charCodeAt(0)])}`).join('   ')}${other ? `; ${other} other characters` : ''})`);
  ok(depth === 0 && minDepth === 0, '1  the brackets match');
  ok(firstIn >= meta.writerBytes && firstOut >= meta.writerBytes, `1  the writing part (the first ${num(meta.writerBytes)} characters) has no ',' and no '.'`, `(first ',' at ${num(firstIn)}, first '.' at ${num(firstOut)})`);
  ok(count[44] === 3 && count[46] === 1, '1  three input commands (one reads the squares of the picture byte by byte in a loop; two the question: its first character, then the others in a loop) and one output command', `(${num(count[44])} ',' and ${num(count[46])} '.')`);
  ok(hash.digest('hex') === meta.sha256, '1  SHA-256 of the file is the one build_pure.js noted');
}

let old = null;
if (want('tape')) {
  const t = now(), tmp = path.join(path.dirname(PURE.program), 'load-sums-vision.json');
  execFileSync(process.execPath, ['--max-old-space-size=16000', path.join(__dirname, 'build_pure.js'), 'sums', tmp], { stdio: ['ignore', 'ignore', 'inherit'] });
  old = JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.unlinkSync(tmp);
  console.log(`      load part run on the three streams in a second process: ${old.sums.length} sums  [${(now() - t).toFixed(1)} s]`);
}

const S = (want('tape') || want('ask')) ? session(meta.tapeSize) : null;

if (want('tape')) {
  const t = now(), r = runPure(S, PURE.program, Buffer.alloc(0), { stopAt: meta.writerBytes }), mine = sumsOf(S.tape());
  console.log(`      writing part run in ${r.seconds.stream.toFixed(1)} s without any input (${S.bits}-bit memory), pointer on cell ${r.pointer}  [with the sums ${(now() - t).toFixed(1)} s]`);
  const bad = mine.map((s, i) => (s === old.sums[i] ? -1 : i)).filter((i) => i >= 0);
  ok(mine.length === old.sums.length && bad.length === 0, `2  the tape after the writing part equals the tape after the load part: ${mine.length} SHA-256 sums over ${num(meta.tapeSize)} cells`, bad.length ? `(pieces that differ: ${bad.slice(0, 10)})` : '');
  ok(r.pointer === old.pointer, `2  the pointer is on the same cell (${r.pointer})`);
  ok(mine.join() === meta.tapeSums.join() && r.pointer === meta.pointerAfterWriting, '2  and both equal what build_pure.js noted');
}

if (want('ask')) {
  const ref = JSON.parse(fs.readFileSync(FILES.ref, 'utf8')), tok = loadTokenizer();
  const pick = args.length > 1 ? args.slice(1).map(Number) : [0];
  for (const i of pick) {
    const e = ref.questions[i], wantBytes = Buffer.from(e.newIds.flatMap((id) => tok.tokenBytes(id)));
    const input = inputBytes(path.join(__dirname, 'pictures', e.picture + '.png'), e.question);
    console.log(`\n> [${i}] ${e.picture}: ${JSON.stringify(e.question)}   (the spec: ${e.newIds.length} new ids${e.ended ? ', then end of turn' : ', not finished'})`);
    const r = runPure(S, PURE.program, input, { stopAfterBytes: wantBytes.length + (e.ended ? 1 : 0) });
    const good = r.output.equals(wantBytes) && r.aborted === !e.ended;
    ok(good, `3  input = the ${num(input.length)} bytes of the picture's squares, the question and its newline; the printed text equals the spec's (${wantBytes.length} bytes${r.aborted ? '; run broken off there' : '; the program ended by itself'})`,
      good ? '' : `\n      got  ${JSON.stringify(r.output.toString('utf8'))}\n      want ${JSON.stringify(wantBytes.toString('utf8'))}`);
    ok(r.handoverAt >= meta.writerBytes, `3  the writing part was executed from the file as plain brainfuck (WebAssembly from character ${num(r.handoverAt)})`);
    const pt = pieceTimes(r.marks);
    console.log(`      start-up ${r.seconds.startup.toFixed(1)} s (program text streamed ${r.seconds.stream.toFixed(1)} s, rest compiled ${r.seconds.compile.toFixed(1)} s); first piece after ${r.marks.length ? r.marks[0].toFixed(1) : '-'} s; ` +
      `${pt ? pt.median.toFixed(2) : '-'} s per word piece (median); whole run ${r.seconds.total.toFixed(1)} s`);
    console.log(`      ${JSON.stringify(r.output.toString('utf8'))}`);
    // the run, for the page site/vision/ (answers.js)
    fs.writeFileSync(path.join(path.dirname(FILES.ref), `run-${i}.json`), JSON.stringify({
      picture: e.picture, question: e.question, same: good, text: r.output.toString('utf8'), pieces: r.marks.length, ended: !r.aborted, promptIds: e.ids.length,
      seconds: { startup: r.seconds.startup, first: r.marks.length ? r.marks[0] : null, perPiece: pt ? pt.median : null, total: r.seconds.total },
      freeMemory: os.freemem(), date: new Date().toISOString().slice(0, 10),
    }, null, 1));
  }
}
console.log(failed ? `\n${failed} FAILED, ${passed} ok` : `\nall ${passed} ok`);
console.log(`peak memory of this process: ${gib(process.resourceUsage().maxRSS * 1024)}`);
