'use strict';

// The Gated DeltaNet mixer (mixers/deltanet.js) against the spec (spec.js) on small synthetic models, under bfrun.js.
//   node compiler/qwen3.5/engine/check_lin.js [quick] [seed]
// Every model has only DeltaNet layers. Stage by stage at the first positions (with the state of every head),
// then whole runs: the printed ids and a clean tape.

const Spec = require('./spec');
const { synthModel } = require('./synth');
const { Engine, archOf } = require('./gen');
const { packToArray, packPrompt, unpackIds } = require('./pack');
const { run } = require('./bfrun');
const lin = require('./mixers/deltanet');

const args = process.argv.slice(2), quick = args.includes('quick'), seed = +(args.find((x) => /^\d+$/.test(x)) || 1);
let failed = 0, passed = 0;
const ok = (good, name, extra = '') => { console.log(`${good ? 'ok  ' : 'FAIL'}  ${name} ${extra}`); if (good) passed++; else { failed++; process.exitCode = 1; } };
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const firstDiff = (a, b) => { const i = a.findIndex((v, j) => v !== b[j]); return i < 0 ? (a.length === b.length ? '' : `(lengths ${a.length}, ${b.length})`) : `(first difference at ${i}: got ${a[i]}, want ${b[i]})`; };
const NOSTOP = [2 ** 23, 2 ** 23 + 1];
const range = (n, f = (i) => i) => Array.from({ length: n }, (_, i) => f(i));
const uncode = (c) => (c & 1 ? (c - 1) / 2 : -(c - 2) / 2);

function setup(size, options = {}) {
  // forget: head 0 of every layer forgets everything at once (D falls to 0 and St is cleared)
  const { forget, ...rest } = options, s0 = synthModel(seed, size), opts = { maxTokens: 16, ...rest };
  const src = forget ? { ...s0, tensor: (kind, l) => { const t = s0.tensor(kind, l); if (kind === 'aLog') t[0] = 6; return t; } } : s0;
  const net = Spec.build(src, opts), arch = archOf(src, opts, { chunk: 16, stops: NOSTOP });
  const eng = new Engine(arch), { src: prog, layout } = eng.build();
  const weights = packToArray(arch, net, layout, { lin: eng.kinds.lin });
  return { src, net, arch, prog, layout, weights, eng };
}

function runTo(S, ids, positions, mark, hit) {
  const input = Buffer.concat([S.weights, Buffer.from(packPrompt(ids, positions))]);
  const r = run(S.prog, { input, tapeSize: S.layout.tapeSize, breakAt: mark ? { charIndex: mark.end, hit } : null });
  r.at = (v) => r.tape[S.layout.real(v)] | 0;
  r.strip = (v, n) => range(n, (i) => r.at(v + i));
  return r;
}

function check(name, size, options, prompts, stages = 3) {
  const S = setup(size, options), L = S.layout, a = S.arch, { dim, layers, nk, nv, dk, dv, keyDim, valueDim, convDim } = a;
  console.log(`\n${name}: ${JSON.stringify({ dim, layers, nk, nv, dk, dv, kernel: a.kernel })}; program ${S.prog.length.toLocaleString('en-US')} characters, tape ${L.tapeSize.toLocaleString('en-US')} cells`);
  const Lo = L.Lt.lin, ro = Lo.ro;
  const zOf = (i) => (nv - 1 - Math.floor(i / dv)) * dv + (i % dv), ours = (v) => range(v.length, (i) => v[zOf(i)]);

  const ids = prompts[0][0];
  const cache = S.net.step.newCache(), trace = [], states = [];
  for (let pos = 0; pos < stages; pos++) {
    const tr = {};
    S.net.step(cache, ids[pos], pos, true, (nm, l, v) => { (tr[nm] ||= {})[l] = v; });
    trace.push(tr);
    states.push(cache.lin.map((c) => c && { S: c.S.map((h) => Array.from(h)), D: Array.from(c.D), win: Array.from(c.win) }));
  }
  const mark = (nm) => L.marks.find((m) => m.name === nm && m.kind === 'lin');
  for (let pos = 0; pos < stages; pos++) {
    for (let l = 0; l < layers; l++) {
      const P = L.Pof(l), t = (nm) => trace[pos][nm][l], hit = pos * layers + l + 1, R0 = P + Lo.R0, RN = R0 + nv * Lo.RS;
      const at = (nm, h = hit) => runTo(S, ids, stages, mark(nm), h);
      const cmp = (what, got, want) => ok(same(got, want), `position ${pos}, layer ${l}: ${what}`, firstDiff(got, want));
      let r = at('round');
      cmp('mix rounded', r.strip(P + Lo.MIX, convDim), t('mix'));
      cmp('z rounded', r.strip(R0 + ro.ZR, valueDim), ours(t('z')));
      cmp('a, b rounded', [...r.strip(R0 + ro.IA, nv), ...r.strip(R0 + ro.IB, nv)], [...t('a'), ...t('b')]);
      r = at('conv');
      cmp('after the convolution and silu', r.strip(P + Lo.C, convDim), t('conv'));
      r = at('qk');
      const [QN, KN] = nv === nk ? [R0 + ro.IQ, R0 + ro.IK] : [P + Lo.QN, P + Lo.KN];
      cmp('queries and keys normalised', [...r.strip(QN, keyDim), ...r.strip(KN, keyDim)], t('qk'));
      r = at('heads');
      cmp('output of the state of every head', r.strip(RN + ro.OUT, valueDim), ours(t('core')));
      const st = states[pos][l], cells = lin.stateCells({ a }, P, Lo);
      cmp('D of every head', range(nv, (h) => r.at(cells.D(h))), st.D);
      cmp('St of every head', range(nv * dk * dv, (x) => r.at(cells.S(Math.floor(x / (dk * dv)), Math.floor(x / dv) % dk, x % dv))), st.S.flat());
      cmp('the convolution window', range((a.kernel - 1) * convDim, (x) => r.at(cells.win(Math.floor(x / convDim), x % convDim))), st.win);
      r = at('gated');
      cmp('gated output', r.strip(P + Lo.oO + Lo.Mo.q, valueDim).map(uncode), ours(t('gated')));
      r = at('xatt');
      cmp('residual after the mixer', r.strip(P + Lo.mix + L.pre.x, dim), t('xatt'));
    }
  }
  console.log(`      spec: ${JSON.stringify(S.net.stats)}`);

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

check('two DeltaNet layers', { types: ['lin', 'lin'], layers: 2 }, {}, [[[5, 21, 33, 14], 8], [[2], 6]], quick ? 1 : 3);
if (!quick) {
  check('two value heads per key head, kernel 3', { types: ['lin'], layers: 1, nk: 1, nv: 2, kernel: 3 }, {}, [[[7, 3, 9], 10]]);
  check('hot: large values', { types: ['lin', 'lin'], layers: 2, hot: 3 }, {}, [[[11, 40, 2, 9, 30], 10]]);
  check('a head that forgets everything at once', { types: ['lin'], layers: 1 }, { forget: true }, [[[4, 8, 15, 16, 23, 42], 8]]);
}
console.log(failed ? `\n${failed} FAILED, ${passed} ok` : `\nall ${passed} ok`);
