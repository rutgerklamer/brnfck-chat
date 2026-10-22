'use strict';

// A neural network trained inside brainfuck. Builds the training program of a model, runs it on the
// names through the WebAssembly runtime, checks it against the whole-number reference step by step,
// runs the child program it prints, and writes the programs and a log to compiler/train/out/.
//
//   node tools/train.js            all three: brnfck-names-bigram-756, brnfck-names-mlp-7k, brnfck-names-attn-10k
//   node tools/train.js attn       one of them (bigram, mlp or attn)
//   node tools/train.js mlp --every 1   print the loss of every step (default: every 50th)

const fs = require('fs');
const path = require('path');
const { build, OUT } = require('../compiler/train/build');
const { MODELS, SW } = require('../compiler/train/spec');
const { attention } = require('../compiler/train/reference');

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(name); if (i < 0) return def; const v = Number(args[i + 1]); args.splice(i, 2); return v; };
const every = flag('--every', 50);
const keys = args.length ? args : ['bigram', 'mlp', 'attn'];
const num = (n, d = 0) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

// attn: how the trained head spreads its attention over the last 8 letters, for a few names
function attentionView(key, p) {
  const m = MODELS[key];
  if (m.kind !== 'attn') return [];
  const out = ['', `attention of the trained head (per cent), predicting the next letter after the last one`];
  for (const word of ['isabel', 'christop', 'alexand', 'jonath', 'emm']) {
    const ctx = [...word.padStart(m.T, '.')].map((ch) => (ch === '.' ? 0 : ch.charCodeAt(0) - 96));
    const { att } = attention(m, p, ctx, SW);
    out.push(`  ${[...word.padStart(m.T, '.')].map((ch, i) => `${ch} ${String(Math.round((att[i] * 100) / 256)).padStart(3)}`).join('  ')}`);
  }
  return out;
}

let allOk = true;
for (const key of keys) {
  const t = Date.now();
  const r = build(key, { every });
  const p = r.report;
  const win = Math.max(1, Math.round(p.steps / 12)), curve = [];
  for (let i = 0; i < p.steps; i += win) { const part = r.ref.losses.slice(i, i + win); curve.push(`  steps ${String(i + 1).padStart(5)} to ${String(i + part.length).padStart(5)}  ${(part.reduce((a, b) => a + b, 0) / part.length).toFixed(3)}`); }
  const log = [
    `${p.model}, trained inside brainfuck by ${p.trainer}`,
    ``,
    `parameters                ${num(p.parameters)}`,
    `training program          ${num(p.trainerChars)} characters (writing part ${num(p.writerChars)})`,
    `child program             ${num(p.childChars)} characters (weights ${num(p.childChars - p.engineChars)}, engine ${num(p.engineChars)})`,
    `tape                      ${num(p.tapeCells)} cells of 32 bits`,
    `training text             ${num(p.examples)} characters, batch ${p.batch}, ${num(p.steps)} steps`,
    `training run              ${num(p.runSeconds, 1)} s in the WebAssembly runtime: ${num(p.msPerStep, 2)} ms per step, ${num(p.msPerExample * 1000, 0)} us per character`,
    `the same run in JavaScript ${num(p.referenceMs / 1000, 1)} s (reference.js)`,
    `loss                      ${p.lossFirst.toFixed(3)} at step 1, ${p.lossLast.toFixed(3)} at step ${p.steps} (nats per character, one batch)`,
    ``,
    `loss, the mean of every ${win} steps`,
    ...curve,
    ...attentionView(key, r.ref.params),
    ``,
    `checks`,
    ...r.lines.filter((l) => /^(ok|FAIL)/.test(l)),
    ``,
    `names printed by the child`,
    ...p.samples.map((s) => `  ${s}`),
    ``,
    `loss per step`,
    ...r.ref.log,
    ``,
  ];
  fs.writeFileSync(path.join(OUT, `${p.model}.txt`), log.join('\n'));
  console.log(`${r.ok ? 'all ok' : 'FAILED'}: ${p.model} in ${((Date.now() - t) / 1000).toFixed(0)} s; log in ${path.relative(process.cwd(), path.join(OUT, `${p.model}.txt`))}`);
  console.log(`loss, the mean of every ${win} steps:`);
  for (const c of curve) console.log(c);
  console.log(`names: ${p.samples.join(' ')}`);
  for (const l of attentionView(key, r.ref.params).slice(1)) console.log(l);
  console.log('');
  if (!r.ok) allOk = false;
}
if (!allOk) process.exitCode = 1;
