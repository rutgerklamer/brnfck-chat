'use strict';

// The gated attention mixer (mixers/attention.js) against spec.js on small attention-only models, under bfrun.js.
//   node compiler/qwen3.5/engine/check_att.js [quick] [seed]

const Spec = require('./spec');
const { synthModel } = require('./synth');
const { Engine, archOf } = require('./gen');
const { packToArray, packPrompt, unpackIds } = require('./pack');
const { run } = require('./bfrun');
const att = require('./mixers/attention');

const args = process.argv.slice(2), quick = args.includes('quick'), seed = +(args.find((x) => /^\d+$/.test(x)) || 1);
let failed = 0, passed = 0;
const ok = (good, name, extra = '') => { console.log(`${good ? 'ok  ' : 'FAIL'}  ${name} ${extra}`); if (good) passed++; else { failed++; process.exitCode = 1; } };
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const firstDiff = (a, b) => { const i = a.findIndex((v, j) => v !== b[j]); return i < 0 ? (a.length === b.length ? '' : `(lengths ${a.length}, ${b.length})`) : `(first difference at ${i}: got ${a[i]}, want ${b[i]})`; };
const NOSTOP = [2 ** 23, 2 ** 23 + 1];
const range = (n, f = (i) => i) => Array.from({ length: n }, (_, i) => f(i));

function setup(size, options = {}) {
  const src = synthModel(seed, size), opts = { maxTokens: 16, ...options };
  const net = Spec.build(src, opts), arch = archOf(src, opts, { chunk: 16, stops: NOSTOP });
  const eng = new Engine(arch), { src: prog, layout } = eng.build();
  const weights = packToArray(arch, net, layout, { att: eng.kinds.att });
  return { src, net, arch, prog, layout, weights };
}

function runTo(S, ids, positions, mark, hit) {
  const input = Buffer.concat([S.weights, Buffer.from(packPrompt(ids, positions))]);
  const r = run(S.prog, { input, tapeSize: S.layout.tapeSize, breakAt: mark ? { charIndex: mark.end, hit } : null });
  r.at = (v) => r.tape[S.layout.real(v)] | 0;
  r.strip = (v, n) => range(n, (i) => r.at(v + i));
  return r;
}

// the code of a matrix input back to its value
const uncode = (c) => (c & 1 ? (c - 1) / 2 : -(c - 2) / 2);

function check(name, size, options, prompts, stages = 2) {
  const S = setup(size, options), L = S.layout, a = S.arch, { dim, qDim, headSize: hs, kvHeads, heads, layers } = a, kv = kvHeads * hs;
  console.log(`\n${name}: ${JSON.stringify({ dim, layers, heads, kvHeads, headSize: hs, rotDim: a.rotDim })}; program ${S.prog.length.toLocaleString('en-US')} characters, tape ${L.tapeSize.toLocaleString('en-US')} cells`);
  const perm = att.permOf(a), Lo = L.Lt.att, so = Lo.so, F = att.fields;
  const ours = (v) => range(v.length, (j) => v[perm(j)]);        // a vector of qDim numbers in engine order

  // stage by stage at the first positions
  const ids = prompts[0][0];
  const cache = S.net.step.newCache(), trace = [];
  for (let pos = 0; pos < stages; pos++) { const tr = {}; S.net.step(cache, ids[pos], pos, true, (nm, l, v) => { (tr[nm] ||= {})[l] = v; }); trace.push(tr); }
  const mark = (nm) => L.marks.find((m) => m.name === nm && m.kind === 'att');
  for (let pos = 0; pos < stages; pos++) {
    for (let l = 0; l < layers; l++) {
      const P = L.Pof(l), t = (nm) => trace[pos][nm][l], hit = pos * layers + l + 1, s1 = P + Lo.dock + Lo.SS;
      const at = (nm, h = hit) => runTo(S, ids, stages, mark(nm), h);
      const cmp = (what, got, want) => ok(same(got, want), `position ${pos}, layer ${l}: ${what}`, firstDiff(got, want));
      let r = at('qkv');
      cmp('q, k rounded', r.strip(P + Lo.Aqk, qDim + kv), [...ours(t('qraw')), ...t('kraw')]);
      cmp('gate rounded', r.strip(P + Lo.Agt, qDim), ours(t('graw')));
      cmp('v rounded', r.strip(P + Lo.Aqn + qDim + kv, kv), t('v'));
      const want = [...ours(t('qn')), ...t('kn')];
      for (const b of [0, heads + kvHeads - 1]) {
        r = at('gain', (hit - 1) * (heads + kvHeads) + b + 1);
        cmp(`head ${b} normalised, times the gain`, r.strip(P + Lo.Aqk + b * hs, hs), want.slice(b * hs, (b + 1) * hs));
      }
      r = at('heads');
      cmp('q, k rotated, v', r.strip(s1 + so.QK, qDim + 2 * kv), [...ours(t('q')), ...t('k'), ...t('v')]);
      r = at('att');
      cmp('total weights', range(heads, (h) => r.at(P + Lo.dock + so.H + h * att.HS + F.TOT)), t('tot'));
      r = at('mixed');
      cmp('gated values', r.strip(s1 + so.HB, qDim).map(uncode), ours(t('gated')));
      r = at('xatt');
      cmp('residual after the mixer', r.strip(P + Lo.mix + L.pre.x, dim), t('xatt'));
    }
  }
  if (S.net.stats.scoreOverflow) console.log(`      (scores beyond 2^scoreBits: ${S.net.stats.scoreOverflow})`);

  // whole runs: the printed ids and a clean tape
  for (const [prompt, maxNew] of prompts) {
    const r = runTo(S, prompt, prompt.length + maxNew - 1), got = unpackIds(r.output), wantIds = Spec.generateIds(S.net, prompt, maxNew, NOSTOP);
    ok(same(got, wantIds), `prompt ${JSON.stringify(prompt)}, ${maxNew} new: ${JSON.stringify(got)}`, `${firstDiff(got, wantIds)} [${r.steps.toLocaleString('en-US')} steps]`);
    const dirty = [], N = L.tapeSize - 1;
    let v = 0;
    for (const [lo, hi] of [...L.allowedRanges(), [N + 1, N + 1]]) {
      for (; v < lo && dirty.length < 5; v++) if (r.tape[L.real(v)] !== 0) dirty.push(v);
      v = Math.max(v, hi + 1);
    }
    ok(dirty.length === 0, '   every scratch cell is zero at the end', dirty.length ? `(dirty virtual cells: ${dirty.join(', ')})` : '');
  }
}

const ids = [5, 21, 33, 14];
check('two layers', { types: ['att', 'att'], layers: 2 }, {}, [[ids, 6], [[2], 8], [[30, 31, 32, 33, 34, 35, 36], 5]]);
if (!quick) {
  check('four query heads on two key heads, rotDim 8', { types: ['att'], layers: 1, heads: 4, kvHeads: 2, headSize: 8, rotDim: 8, dim: 24 }, {}, [[ids, 12], [[7, 7, 7], 13]]);
  check('one key head, rotDim = headSize', { types: ['att'], layers: 1, heads: 3, kvHeads: 1, headSize: 16, rotDim: 16 }, {}, [[[1, 2, 3], 13]]);
  check('large values', { types: ['att', 'att'], layers: 2, hot: 3 }, {}, [[ids, 12]]);
  check('32 positions', { types: ['att', 'att', 'att'], layers: 3, heads: 4, kvHeads: 2, headSize: 16, rotDim: 4 }, { maxTokens: 32 }, [[[3, 9, 27, 17, 51, 25], 26]], 1);
}
console.log(failed ? `\n${failed} FAILED, ${passed} ok` : `\nall ${passed} ok`);
