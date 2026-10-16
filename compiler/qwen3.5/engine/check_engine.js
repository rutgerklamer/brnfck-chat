'use strict';

// The brainfuck engine (gen.js) against the spec (spec.js) on small synthetic models (synth.js), under bfrun.js.
//   node compiler/qwen3.5/engine/check_engine.js [none|full] [seed]
// none: the engine without its token mixers (spec.js noMixer); full: the whole engine.

const Spec = require('./spec');
const { synthModel } = require('./synth');
const { Engine, archOf } = require('./gen');
const { packToArray, packPrompt, unpackIds } = require('./pack');
const { run } = require('./bfrun');

const args = process.argv.slice(2), mode = args[0] || 'none', seed = +(args[1] || 1);
let failed = 0, passed = 0;
const ok = (good, name, extra = '') => { console.log(`${good ? 'ok  ' : 'FAIL'}  ${name} ${extra}`); if (good) passed++; else { failed++; process.exitCode = 1; } };
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const firstDiff = (a, b) => { const i = a.findIndex((v, j) => v !== b[j]); return i < 0 ? (a.length === b.length ? '' : `(lengths ${a.length}, ${b.length})`) : `(first difference at ${i}: got ${a[i]}, want ${b[i]})`; };
const NOSTOP = [2 ** 23, 2 ** 23 + 1];

function setup(size = {}, options = {}) {
  const src = synthModel(seed, size), opts = { maxTokens: 16, noMixer: mode === 'none', ...options };
  const net = Spec.build(src, opts), arch = archOf(src, opts, { chunk: 16, stops: NOSTOP });
  const eng = new Engine(arch), { src: prog, layout } = eng.build();
  const weights = packToArray(arch, net, layout, eng.kinds);
  return { src, net, arch, prog, layout, weights };
}

// Run to the end of a named step (its hit-th execution), or to the end of the program.
function runTo(S, ids, positions, mark, hit) {
  const input = Buffer.concat([S.weights, Buffer.from(packPrompt(ids, positions))]);
  const r = run(S.prog, { input, tapeSize: S.layout.tapeSize, breakAt: mark ? { charIndex: mark.end, hit } : null });
  r.at = (v) => r.tape[S.layout.real(v)] | 0;
  return r;
}

const S = setup();
console.log(`model: ${JSON.stringify({ dim: S.src.dim, layers: S.src.layers, types: S.src.types, vocab: S.src.vocab })}; program ${S.prog.length.toLocaleString('en-US')} characters, tape ${S.layout.tapeSize.toLocaleString('en-US')} cells, stream ${S.weights.length.toLocaleString('en-US')} bytes`);

// stage by stage at the first two positions: the residual after every layer
const ids = [5, 21, 33, 14];
const cache = S.net.step.newCache(), trace = [];
for (let pos = 0; pos < 2; pos++) { const tr = {}; S.net.step(cache, ids[pos], pos, true, (nm, l, v) => { (tr[nm] ||= {})[l] = v; }); trace.push(tr); }
const L = S.layout, dim = S.src.dim, nU = S.arch.unit.length;
const xAt = (base) => Array.from({ length: dim }, (_, i) => base + L.pre.x + i);
for (let pos = 0; pos < 2; pos++) {
  const mk = L.marks.find((m) => m.name === 'emb');
  const r = runTo(S, ids, 2, mk, pos + 1), got = xAt(L.P0 - L.PRE).map(r.at);
  ok(same(got, trace[pos].emb[-1]), `position ${pos}: embedding`, firstDiff(got, trace[pos].emb[-1]));
  for (let l = 0; l < S.src.layers; l++) {
    const u = l % nU, g = Math.floor(l / nU), m = L.marks.find((x) => x.name === 'xout' && x.u === u);
    const r2 = runTo(S, ids, 2, m, pos * S.arch.groups + g + 1), got2 = xAt(L.Pof(l) + L.Lt[S.src.types[l]].preD).map(r2.at);
    ok(same(got2, trace[pos].xout[l]), `position ${pos}: residual after layer ${l}`, firstDiff(got2, trace[pos].xout[l]));
  }
}

// whole runs: the printed ids, and a clean tape
for (const [prompt, maxNew] of [[ids, 6], [[2], 8], [[30, 31, 32, 33, 34, 35, 36], 5]]) {
  const r = runTo(S, prompt, prompt.length + maxNew - 1), got = unpackIds(r.output), want = Spec.generateIds(S.net, prompt, maxNew, NOSTOP);
  ok(same(got, want), `prompt ${JSON.stringify(prompt)}, ${maxNew} new: ${JSON.stringify(got)}`, `${firstDiff(got, want)} [${r.steps.toLocaleString('en-US')} steps]`);
  const dirty = [], N = L.tapeSize - 1;
  let v = 0;
  for (const [lo, hi] of [...L.allowedRanges(), [N + 1, N + 1]]) {
    for (; v < lo && dirty.length < 5; v++) if (r.tape[L.real(v)] !== 0) dirty.push(v);
    v = Math.max(v, hi + 1);
  }
  ok(dirty.length === 0, '   every scratch cell is zero at the end', dirty.length ? `(dirty virtual cells: ${dirty.join(', ')})` : '');
}
console.log(failed ? `\n${failed} FAILED, ${passed} ok` : `\nall ${passed} ok`);
