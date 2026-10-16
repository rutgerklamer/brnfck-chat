'use strict';

// The self-contained program site/programs/brnfck-qwen2.5-<model>.bf, checked.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { OUT, files, generate, questionBytes, restoreRanges, num, gib, now } = require('./common');
const { dirtyCells } = require('./gen');
const { sumsOf } = require('./build_pure');
const { session, runPure, pieceTimes } = require('./run');

const args = process.argv.slice(2), model = args.shift() || '0.5b', FILES = files(model);
const want = (s) => !args.length || args[0] === s;
let failed = 0, passed = 0;
const ok = (good, name, extra = '') => { console.log(`${good ? 'ok  ' : 'FAIL'}  ${name} ${extra}`); if (good) passed++; else { failed++; process.exitCode = 1; } };
const meta = JSON.parse(fs.readFileSync(FILES.pureMeta, 'utf8'));
console.log(`${FILES.pure}; free memory ${gib(os.freemem())}`);

if (want('scan')) {
  const t = now(), fd = fs.openSync(FILES.pure, 'r'), piece = Buffer.allocUnsafe(1 << 22), hash = crypto.createHash('sha256');
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
  ok(at === meta.programBytes && fs.statSync(FILES.pure).size === at, `1  ${num(at)} characters (${gib(at)})`, `[scanned in ${(now() - t).toFixed(0)} s]`);
  ok(other === 0, '1  only the 8 brainfuck commands', `(${[...'+-<>[].,'].map((ch) => `${ch} ${num(count[ch.charCodeAt(0)])}`).join('   ')}${other ? `; ${other} other characters` : ''})`);
  ok(depth === 0 && minDepth === 0, '1  the brackets match');
  ok(firstIn >= meta.writerBytes && firstOut >= meta.writerBytes, `1  the writing part (the first ${num(meta.writerBytes)} characters) has no ',' and no '.'`, `(first ',' at ${num(firstIn)}, first '.' at ${num(firstOut)}; ${num(count[44])} ',' in all; longest loop of the writing part: ${num(maxLoop)} characters)`);
  ok(count[44] === 1, `1  exactly one input command in the whole program (the one that reads the question, byte by byte, in a loop)`, `(${num(count[44])} ',' and ${num(count[46])} '.')`);
  ok(hash.digest('hex') === meta.sha256, '1  SHA-256 of the file is the one build_pure.js noted');
}

let old = null;
if (want('tape')) {
  const t = now(), tmp = path.join(OUT, `load-sums-${model}.json`);
  execFileSync(process.execPath, [path.join(__dirname, 'build_pure.js'), model, 'sums', tmp], { stdio: ['ignore', 'ignore', 'inherit'] });
  old = JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.unlinkSync(tmp);
  console.log(`      load part of chat-${model}.bf run on the data files in a second process: ${old.sums.length} sums  [${(now() - t).toFixed(1)} s]`);
}

const S = (want('tape') || want('ask')) ? session(meta.tapeSize) : null;

if (want('tape')) {
  const t = now(), r = runPure(S, FILES.pure, Buffer.alloc(0), { stopAt: meta.writerBytes }), mine = sumsOf(S.tape());
  console.log(`      writing part run in ${r.seconds.stream.toFixed(1)} s without any input (${S.bits}-bit memory): ${num(r.stats.loops)} loops (${num(r.stats.loopTexts)} different texts), pointer on cell ${r.pointer}  [with the sums ${(now() - t).toFixed(1)} s]`);
  const bad = mine.map((s, i) => (s === old.sums[i] ? -1 : i)).filter((i) => i >= 0);
  ok(mine.length === old.sums.length && bad.length === 0, `2  the tape after the writing part equals the tape after the load part: ${mine.length} SHA-256 sums over ${num(meta.tapeSize)} cells (pieces of ${num(meta.pieceCells)} cells)`, bad.length ? `(pieces that differ: ${bad.slice(0, 10)})` : '');
  ok(r.pointer === old.pointer, `2  the pointer is on the same cell (${r.pointer})`, r.pointer === old.pointer ? '' : `(load part: ${old.pointer})`);
  ok(mine.join() === meta.tapeSums.join() && r.pointer === meta.pointerAfterWriting, '2  and both equal what build_pure.js noted');
}

if (want('ask')) {
  const ref = JSON.parse(fs.readFileSync(FILES.ref, 'utf8')), { layout } = generate(model);
  const pick = args.length > 1 ? args.slice(1).map(Number) : [0, 3, 4, 5], starts = [], perPiece = [];
  for (const i of pick) {
    const e = ref.questions[i], wantBytes = Buffer.from(e.hex, 'hex'), q = questionBytes(e.question);
    console.log(`\n> [${i}] ${JSON.stringify(e.question)}   (the spec: ${e.newIds.length} new ids${e.ended ? ', then end of turn' : ', not finished'})`);
    let saved = null;
    const keep = () => { const tape = S.tape(); saved = restoreRanges(meta.restore).map(([first, n]) => ({ first, cells: tape.slice(first, first + n) })); };
    const r = runPure(S, FILES.pure, q, { stopAfterBytes: wantBytes.length + (e.ended ? 1 : 0), onStart: keep });
    const good = r.output.equals(wantBytes) && r.aborted === !e.ended;
    ok(good, `3  input = the ${q.length} bytes of the question and its newline; the printed text equals the spec's (${wantBytes.length} bytes${r.aborted ? '; run broken off there' : '; the program ended by itself'})`,
      good ? '' : `\n      got  ${JSON.stringify(r.output.toString('utf8'))}\n      want ${JSON.stringify(e.text)}`);
    ok(r.marks.length === e.printing, `3  ${r.marks.length} word pieces arrived one by one`, r.marks.length === e.printing ? '' : `(the spec has ${e.printing} ids that print something)`);
    ok(r.handoverAt >= meta.writerBytes, `3  the writing part was executed from the file as plain brainfuck (WebAssembly from character ${num(r.handoverAt)})`);
    if (!r.aborted) {
      const d = dirtyCells(S.tape(), layout);
      ok(d.length === 0, '3  every scratch cell is zero at the end', d.length ? `(dirty real cells ${d})` : '');
      ok(r.pointer >= 0 && r.pointer < meta.tapeSize, '3  pointer on the tape at the end');
      // what the web page relies on to ask a second question without running the writing part again
      const tape = S.tape();
      for (const s of saved) tape.set(s.cells, s.first);
      ok(sumsOf(tape).join() === meta.tapeSums.join(), `3  with ${num(saved.reduce((n, s) => n + s.cells.length, 0))} cells put back (token, position, stored keys and values) the tape is again the tape after the writing part (${meta.tapeSums.length} sums)`);
    }
    const pt = pieceTimes(r.marks);
    starts.push(r.seconds.startup); if (pt) perPiece.push(pt.median);
    console.log(`      start-up ${r.seconds.startup.toFixed(1)} s (program text streamed ${r.seconds.stream.toFixed(1)} s, rest compiled ${r.seconds.compile.toFixed(1)} s); first piece after ${r.marks.length ? r.marks[0].toFixed(1) : '-'} s; ` +
      `${pt ? pt.median.toFixed(2) : '-'} s per word piece (median; mean ${pt ? pt.mean.toFixed(2) : '-'}); whole run ${r.seconds.total.toFixed(1)} s`);
    console.log(`      ${JSON.stringify(r.output.toString('utf8'))}`);
  }
  const avg = (a) => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : '-');
  console.log(`\nstart-up ${avg(starts)} s on average, ${avg(perPiece)} s per word piece`);
}
console.log(failed ? `\n${failed} FAILED, ${passed} ok` : `\nall ${passed} ok`);
console.log(`peak memory of this process: ${gib(process.resourceUsage().maxRSS * 1024)}`);
