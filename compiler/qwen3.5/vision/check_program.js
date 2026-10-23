'use strict';

// program.js VisionEngine against both specs on synthetic models: the ids printed for a prompt with a picture, a clean tape.
//   node compiler/qwen3.5/vision/check_program.js [seed]

const Spec = require('../engine/spec');
const VS = require('./spec');
const { synthModel } = require('../engine/synth');
const { synthVision, synthPicture } = require('./synth');
const { squares } = require('../reference/vision');
const { visionArch, VisionEngine, visionKind } = require('./program');
const { packToArray, packPrompt, unpackIds } = require('../engine/pack');
const { run } = require('../engine/bfrun');

const args = process.argv.slice(2), seed = +(args.find((x) => /^\d+$/.test(x)) || 1);
let failed = 0, passed = 0;
const ok = (good, name, extra = '') => { console.log(`${good ? 'ok  ' : 'FAIL'}  ${name} ${extra}`); if (good) passed++; else { failed++; process.exitCode = 1; } };
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const firstDiff = (a, b) => { const i = a.findIndex((v, j) => v !== b[j]); return i < 0 ? (a.length === b.length ? '' : `(lengths ${a.length}, ${b.length})`) : `(first difference at ${i}: got ${a[i]}, want ${b[i]})`; };
const range = (n, f = (i) => i) => Array.from({ length: n }, (_, i) => f(i));
const NOSTOP = [2 ** 23, 2 ** 23 + 1];

// the places for the rotation: positions before the picture, the picture's blocks (row, column), after it shifted back
function ropeOf(start, bh, bw, maxTokens) {
  const images = bh * bw, shift = images - Math.max(bh, bw);
  return range(maxTokens, (i) => (i < start ? [i, i, i] : i < start + images ? [start, start + Math.floor((i - start) / bw), start + ((i - start) % bw)] : [i - shift, i - shift, i - shift]));
}

function check(name, lmSize, vSize, before, after, maxNew, maxTokens = 32) {
  const src = synthModel(seed, lmSize), V = synthVision(seed + 7, { ...vSize, out: src.dim });
  V.imageToken = src.vocab - 3;
  const sq = squares(synthPicture(V, seed), V.P, V.merge), bh = sq.gh / V.merge, bw = sq.gw / V.merge;
  const vopts = VS.widthsFor(VS.measure(V, [sq])), vnet = VS.build(V, sq, vopts);
  const rope = ropeOf(before.length, bh, bw, maxTokens), lmOpts = { maxTokens, rope };
  const net = Spec.build(src, lmOpts);
  const eng = new VisionEngine(visionArch(src, lmOpts, { chunk: 16, stops: NOSTOP }, { V, sq, options: vopts }));
  const { src: prog, layout } = eng.build(), vp = eng.vp;
  const weights = packToArray(eng.a, net, layout, { ...eng.kinds, vision: visionKind(vp, vnet, net) });
  const images = bh * bw, ids = [...before, ...range(images, () => V.imageToken), ...after];
  console.log(`\n${name}: text ${JSON.stringify({ dim: src.dim, layers: src.layers, types: src.types.join(' ') })}, vision ${JSON.stringify({ depth: V.depth, squares: sq.n })}; prompt of ${ids.length} ids, ${images} of them the picture; program ${prog.length.toLocaleString('en-US')} characters, tape ${layout.tapeSize.toLocaleString('en-US')} cells`);
  // the spec: the picture's vectors, then the text model reading them at the picture's positions
  const emb = vnet.encode(sq.bytes), input = (pos) => (ids[pos] === V.imageToken ? emb.subarray((pos - before.length) * src.dim, (pos - before.length + 1) * src.dim) : null);
  const cache = net.step.newCache(), want = [], xs = [];
  let logits = null;
  for (let pos = 0; pos < ids.length; pos++) logits = net.step(cache, ids[pos], pos, pos === ids.length - 1, (nm, l, v) => { if (nm === 'emb') xs[pos] = v; }, input(pos));
  for (let n = 0; n < maxNew; n++) {
    const t = Spec.argmax(logits);
    want.push(t);
    if (n + 1 < maxNew) logits = net.step(cache, t, ids.length + n, true);
  }
  // the program's input of the first layer at the first picture position, and its answer
  const inputBytes = Buffer.concat([weights, Buffer.from(sq.bytes), Buffer.from(packPrompt(ids, ids.length + maxNew - 1))]);
  const mark = layout.marks.find((m) => m.name === 'emb');
  const at = before.length;
  let r = run(prog, { input: inputBytes, tapeSize: layout.tapeSize, breakAt: { charIndex: mark.end, hit: at + 1 } });
  const X = eng.P0 - eng.PRE + eng.pre.x, got = range(src.dim, (i) => r.tape[layout.real(X + i)] | 0);
  ok(same(got, xs[at]), `the input of the text model at the first picture position (${at})`, firstDiff(got, xs[at]));
  r = run(prog, { input: inputBytes, tapeSize: layout.tapeSize });
  const printed = unpackIds(r.output);
  ok(same(printed, want), `the answer: ${JSON.stringify(printed)}`, `${firstDiff(printed, want)} [${r.steps.toLocaleString('en-US')} steps]`);
  const dirty = [], N = layout.engineCells - 1;
  let v = 0;
  for (const [lo, hi] of [...layout.allowedRanges(), [N + 1, N + 1]]) {
    for (; v < lo && dirty.length < 5; v++) if (r.tape[layout.real(v)] !== 0) dirty.push(v);
    v = Math.max(v, hi + 1);
  }
  // the vision part, at the end of the tape: only its weights, constants and the (empty) queue of pictures may hold numbers
  for (let cell = layout.visionReal[0]; cell <= layout.visionReal[1] && dirty.length < 5; cell++) if (r.tape[cell] !== 0 && !layout.visionData(cell)) dirty.push('real ' + cell);
  ok(dirty.length === 0, '   every scratch cell is zero at the end', dirty.length ? `(dirty virtual cells: ${dirty.join(', ')})` : '');
}

check('lin lin lin att, 16 squares', { layers: 4 }, { dim: 32, hidden: 64, depth: 2, heads: 2 }, [4, 9], [17, 3, 25], 6);
console.log(failed ? `\n${failed} FAILED, ${passed} ok` : `\nall ${passed} ok`);
