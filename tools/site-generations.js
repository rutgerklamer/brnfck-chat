#!/usr/bin/env node
// The data of "It prints its next generation" (site/train/): bigram and attn trained in 20 generations, each checked by reference.js.
//   node tools/site-generations.js        (about 7 minutes; writes site/train/data/generations.json)
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('../compiler/train/spec');
const R = require('../compiler/train/reference');
const { trainingText } = require('../compiler/train/data');
const { Gen, childWriting, nextWriting, runsOf, layout } = require('../compiler/train/gen');
const { runBF } = require('../compiler/train/run');
const { SL, W } = require('../compiler/train/layout');

const G = 20, OUT = path.join(__dirname, '..', 'site', 'train', 'data', 'generations.json');
const num = (n) => Math.round(n).toLocaleString('en-US');
let failed = 0;
const ok = (good, s) => { console.log((good ? 'ok    ' : 'FAIL  ') + s); if (!good) failed++; };

// the weight cell of every slot of every region, read by running the child's writing part (+, - and > only)
function weightsOf(L, child) {
  const tape = new Map(); let p = 0;
  for (let i = 0; i < child.length; i++) {
    const c = child.charCodeAt(i);
    if (c === 62) p++; else if (c === 43) tape.set(p, (tape.get(p) || 0) + 1); else if (c === 45) tape.set(p, (tape.get(p) || 0) - 1); else break;
  }
  return L.regions.map((Rg) => Array.from({ length: Rg.regionSlots }, (_, i) => tape.get(Rg.R0 + i * SL + W) || 0));
}

// gen k trains on part k of the text and prints gen k + 1; fed nothing, every generation also prints its child
function chain(key) {
  const m = S.MODELS[key], L = layout(m), text = trainingText(m), steps = text.length / m.batch;
  const engine = new Gen(m, { child: true }).childEngine(), P0 = new Gen(m).selfTrainer(engine), one = R.train(m, text);
  const gens = [], files = [];
  let prog = P0.src, from;
  for (let k = 0; ; k++) {
    if (k < 3) files.push(prog);
    const child = runBF(prog, { input: '', tapeSize: P0.tapeSize }).text;
    if (from) ok(child === childWriting(m, from.params) + engine, `${key} gen${k} fed nothing prints the child of its weights`);
    const names = runBF(child, { tapeSize: L.tapeSize }).text.split('\n').filter(Boolean);
    gens.push({ k, chars: prog.length, step: from ? from.step : 0, child: child.length, names, weights: weightsOf(L, child), loss: [] });
    if (k === G) { ok(child === childWriting(m, one.params) + engine, `${key} gen${G}'s child equals the child of one run over the whole text`); break; }
    const a = Math.floor((k * steps) / G) * m.batch, b = Math.floor(((k + 1) * steps) / G) * m.batch;
    const part = text.subarray(a, b), ref = R.train(m, part, { from });
    const next = runBF(prog, { input: part, tapeSize: P0.tapeSize }).text;
    let cut = 2;
    for (let i = 0; i < ref.log.length; i++) cut = next.indexOf('\n', cut) + 1;
    const got = next.slice(2, cut).split('\n').slice(0, ref.log.length);
    ok(got.join('\n') === ref.log.join('\n'), `${key} gen${k} trains on characters ${num(a)} to ${num(b)}: ${ref.log[0]} .. ${ref.log[ref.log.length - 1]}`);
    gens[k].loss = got.map((l) => Math.round(+l.split(' ')[3] * 1000));
    from = { params: ref.params, step: ref.step, ctx: ref.ctx };
    ok(next.slice(cut) === nextWriting(m, from, P0.body), `${key} gen${k} prints gen${k + 1}: ${num(next.length)} characters`);
    prog = next;
  }
  return { m, L, P0, engine, gens, files };
}

// the parts of a generation: [ loss lines ], the state, the walk to the data, the body as data, the walk back, the body
function parts(text, body) {
  const data = runsOf(body).map(([s, r]) => '+'.repeat(s) + '>' + '+'.repeat(r) + '>>>').join('') + '<<<<[<<<<]';
  let cut = 2, lines = 0;
  while (text.startsWith('step', cut)) { cut = text.indexOf('\n', cut) + 1; lines++; }
  if (!lines) cut = 0;
  const at = text.indexOf(data, cut); let s = at;
  while (text[s - 1] === '>') s--;
  const bodyAt = text.length - body.length;
  if (at < 0 || text.slice(bodyAt) !== body) throw new Error('a generation without its data or body');
  const mul = text.indexOf('[->++++++++<]', cut);
  return {
    chars: text.length, lines,
    parts: [['loss', cut], ['state', s - cut], ['walk', at - s], ['data', data.length], ['back', bodyAt - at - data.length], ['body', body.length]],
    text: { loss: text.slice(0, 64), state: text.slice(Math.max(cut, mul - 26), mul + 80), data: text.slice(at, at + 90), body: body.slice(0, 90) },
  };
}

const B = chain('bigram'), A = chain('attn');
const V = B.L.V, sl = V + 2;
const out = {
  made: 'tools/site-generations.js', generations: G,
  bigram: {
    model: B.m.name, trainer: B.m.name.replace('brnfck-', 'brnfck-train-'), loss: B.gens.flatMap((g) => g.loss),
    gens: B.gens.map((g) => {
      const v = g.weights[0];
      return { k: g.k, step: g.step, chars: g.chars, child: g.child, names: g.names.slice(0, 12),
        w: Array.from({ length: V }, (_, c) => Array.from({ length: V }, (_, j) => v[(j + 1) * sl + 1 + c])), b: Array.from({ length: V }, (_, j) => v[(j + 1) * sl + 1 + V]) };
    }),
  },
  attn: {
    model: A.m.name, trainer: A.m.name.replace('brnfck-', 'brnfck-train-'),
    gens: A.gens.map((g, k) => ({ k, step: g.step, chars: g.chars, child: g.child, names: g.names.slice(0, 12),
      loss: k ? Math.round(A.gens[k - 1].loss.reduce((s, x) => s + x, 0) / A.gens[k - 1].loss.length) : null })),
    parts: [1, 2].map((k) => ({ k, ...parts(A.files[k], A.P0.body) })), runs: runsOf(A.P0.body).length, engine: A.engine.length,
  },
};
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`${failed ? failed + ' checks failed' : 'all ok'}: ${path.relative(process.cwd(), OUT)}, ${num(fs.statSync(OUT).size)} bytes`);
if (failed) process.exitCode = 1;
