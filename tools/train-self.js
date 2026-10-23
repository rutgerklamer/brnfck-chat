'use strict';

// The training program that prints its next generation; the last, fed nothing, prints the child. Checked by reference.js.
//   node tools/train-self.js [bigram mlp attn | shakespeare] [--generations 3] [--chars 64000]

const fs = require('fs');
const path = require('path');
const S = require('../compiler/train/spec');
const R = require('../compiler/train/reference');
const { trainingText } = require('../compiler/train/data');
const { Gen, childWriting, nextWriting, layout } = require('../compiler/train/gen');
const { runBF } = require('../compiler/train/run');
const { OUT } = require('../compiler/train/build');

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(name); if (i < 0) return def; const v = Number(args[i + 1]); args.splice(i, 2); return v; };
const G = flag('--generations', 3), chars = flag('--chars', 0);
const keys = args.length ? args : ['bigram', 'mlp', 'attn'];
const num = (n) => Math.round(n).toLocaleString('en-US');
const rel = (f) => path.relative(process.cwd(), f);

let allOk = true;
for (const key of keys) {
  const m = S.MODELS[key];
  if (!m) throw new Error(`no model ${key}; one of ${Object.keys(S.MODELS).join(', ')}`);
  const L = layout(m), trainer = m.name.replace('brnfck-', 'brnfck-train-');
  const all = trainingText(m), text = chars ? all.subarray(0, chars - (chars % m.batch)) : all, steps = text.length / m.batch;
  const lines = [];
  let failed = 0;
  const say = (s) => { lines.push(s); console.log(s); };
  const ok = (good, s) => { say(`${good ? 'ok  ' : 'FAIL'}  ${s}`); if (!good) failed++; };
  const file = (k) => path.join(OUT, `${trainer}-gen${k}.bf`);

  say(`${trainer} in ${G} generations: each one trains on a part of the ${num(text.length)} characters and prints the next`);
  const engine = new Gen(m, { child: true }).childEngine();
  const P0 = new Gen(m).selfTrainer(engine);
  fs.writeFileSync(file(0), P0.src);
  say(`gen0  ${rel(file(0))}: ${num(P0.src.length)} characters, made by the generator: writing part ${num(P0.writerChars)} (with the body as data: ${num(P0.tokens)} tokens), then the start weights and the body (${num(P0.body.length)} characters)`);

  const one = R.train(m, text);
  let prog = P0.src, from;
  // gen k trains on part k of the text and prints gen k + 1: itself with its weights, velocities, step and context in it
  for (let k = 0; k < G; k++) {
    const a = Math.floor((k * steps) / G) * m.batch, b = Math.floor(((k + 1) * steps) / G) * m.batch;
    const part = text.subarray(a, b), ref = R.train(m, part, { from });
    const t = Date.now();
    const r = runBF(prog, { input: part, tapeSize: P0.tapeSize });
    // what it prints: [, the loss lines, then the next generation (its ] first), all of it the next program
    const next = r.text, n = ref.log.length;
    let cut = 2;
    for (let i = 0; i < n; i++) cut = next.indexOf('\n', cut) + 1;
    const got = next.slice(2, cut).split('\n').slice(0, n);
    ok(next.startsWith('[\n') && got.join('\n') === ref.log.join('\n') && ref.log.join('\n') === one.log.slice(ref.step - n, ref.step).join('\n'),
      `gen${k} trains on characters ${num(a)} to ${num(b)}: ${ref.log[0]} .. ${ref.log[n - 1]}, every line equal to the reference (${((Date.now() - t) / 1000).toFixed(1)} s)`);
    from = { params: ref.params, step: ref.step, ctx: ref.ctx };
    fs.writeFileSync(file(k + 1), next);
    ok(next.slice(cut) === nextWriting(m, from, P0.body), `it prints gen${k + 1}, ${rel(file(k + 1))}: ${num(next.length)} characters, equal to the reference's (the loss lines inside [ ], then its weights, velocities, step ${from.step} and context written in, then the same body)`);
    prog = next;
  }

  const t = Date.now();
  const child = runBF(prog, { input: '', tapeSize: P0.tapeSize }).text;
  ok(child === childWriting(m, from.params) + engine && child === childWriting(m, one.params) + engine,
    `gen${G} fed nothing prints the child: ${num(child.length)} characters, equal to the child of one run over the whole text (${((Date.now() - t) / 1000).toFixed(1)} s)`);
  const names = runBF(child, { tapeSize: L.tapeSize }).text;
  ok(names === R.sample(m, R.childParams(one.params), m.samples), `the child prints the reference's ${m.samples} ${m.text === 'shakespeare' ? 'lines' : 'names'}: ${names.split('\n').filter(Boolean).slice(0, 8).join(' ')} ..`);
  say(failed ? `${failed} checks failed` : `all ok: ${trainer} in ${G} generations`);
  if (!chars) fs.writeFileSync(path.join(OUT, `${trainer}-generations.txt`), lines.join('\n') + '\n');
  if (failed) allOk = false;
  console.log('');
}
process.exitCode = allOk ? 0 : 1;
