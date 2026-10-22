'use strict';

// The Shakespeare part of "Trained in brainfuck" (site/train/): reads the long run of
// tools/train-long.js (compiler/train/out/long/brnfck-shakespeare-attn-55k/) and writes
//   site/train/data/shakespeare.json         the loss over the run, every pass, what each child wrote
//   site/train/data/shakespeare/pass-NN.bin  the weights of each pass's child (16-bit, region by region),
//                                            from which the page builds and runs that child
// Pass 0 is the child of the random start weights. Run it again while the run goes on, or after it.
//   node tools/site-shakespeare.js

const fs = require('fs');
const path = require('path');
const S = require('../compiler/train/spec');
const R = require('../compiler/train/reference');
const { shakespeare, trainingText } = require('../compiler/train/data');
const { Gen, childWritingOf, layout } = require('../compiler/train/gen');
const { regionValues } = require('../compiler/train/layout');
const { runBF } = require('../compiler/train/run');

const ROOT = path.join(__dirname, '..'), m = S.MODELS.shakespeare, L = layout(m);
const RUN = path.join(ROOT, 'compiler/train/out/long', m.name), OUT = path.join(ROOT, 'site/train/data');
const JSON_FILE = path.join(OUT, 'shakespeare.json'), BIN = path.join(OUT, 'shakespeare');
const num = (n) => Math.round(n).toLocaleString('en-US');
const pad = (n) => String(n).padStart(2, '0');

if (!fs.existsSync(path.join(RUN, 'state.json'))) { console.error(`no run in ${path.relative(ROOT, RUN)}: start it with node tools/train-long.js shakespeare`); process.exit(1); }
const state = JSON.parse(fs.readFileSync(path.join(RUN, 'state.json'), 'utf8'));
const old = fs.existsSync(JSON_FILE) ? JSON.parse(fs.readFileSync(JSON_FILE, 'utf8')) : {};
fs.mkdirSync(BIN, { recursive: true });

const engine = new Gen(m, { child: true }).childEngine();
const sizes = L.regions.map((Rg) => Rg.regionSlots);

// the child's weights out of its program: per region, per slot a run of + or -, then 13 times >
function parseChild(src) {
  if (!src.endsWith(engine)) throw new Error('the child does not end with the engine');
  const w = src.slice(0, src.length - engine.length);
  let i = 0;
  const skip = (n) => { for (let k = 0; k < n; k++, i++) if (w[i] !== '>') throw new Error(`> expected at ${i}`); };
  skip(L.regions[0].R0 + 1);
  const vals = L.regions.map((Rg, r) => {
    if (r) skip(Rg.R0 - L.regions[r - 1].END);
    const out = new Int16Array(Rg.regionSlots);
    for (let s = 0; s < Rg.regionSlots; s++) {
      const ch = w[i];
      let n = 0;
      if (ch === '+' || ch === '-') while (w[i] === ch) { n++; i++; }
      if (n > 32767) throw new Error('a weight too large for 16 bits');
      out[s] = ch === '-' ? -n : n;
      skip(13);
    }
    return out;
  });
  if (i !== w.length || childWritingOf(L, vals) !== w) throw new Error('the child does not read back the same');
  return vals;
}
const writeBin = (p, vals) => fs.writeFileSync(path.join(BIN, `pass-${pad(p)}.bin`), Buffer.concat(vals.map((v) => Buffer.from(v.buffer, v.byteOffset, v.byteLength))));

// pass 0: the child of the random start weights, run as brainfuck
const v0 = regionValues(L, R.initParams(m)).map((vals) => Int16Array.from(vals, (w) => S.rs(w, S.SW - S.SC)));
writeBin(0, v0);
const c0 = childWritingOf(L, v0) + engine;
const pass0 = { sample: old.pass0 ? old.pass0.sample : runBF(c0, { tapeSize: L.tapeSize }).text, childChars: c0.length };

// every pass of the run
const passes = state.done.map((d) => {
  const file = path.join(RUN, `pass-${pad(d.pass)}.bf`), src = fs.readFileSync(file, 'latin1');
  writeBin(d.pass, parseChild(src));
  const sample = fs.readFileSync(path.join(RUN, `pass-${pad(d.pass)}.sample.txt`), 'latin1');
  return { pass: d.pass, step: d.step, seconds: Math.round(d.seconds), msPerChar: +d.msPerChar.toFixed(3), loss: +d.loss.toFixed(4), held: +d.held.toFixed(4), equal: d.equal, sample, childChars: src.length };
});

// the loss over the run, from the lines it printed every two minutes (mean of the steps since the last one)
const curve = [];
const perPass = trainingText(m).length / m.batch;
for (const line of fs.readFileSync(path.join(RUN, 'log.txt'), 'utf8').split('\n')) {
  const head = line.match(/^== pass (\d+) of/);
  if (head) { const from = (head[1] - 1) * perPass; while (curve.length && curve[curve.length - 1][0] > from) curve.pop(); continue; }
  const p = line.match(/^\s+step ([\d,]+) \(.*loss of the last (\d+) steps ([\d.]+)/);
  if (p) curve.push([+p[1].replace(/,/g, ''), +p[2], Math.round(+p[3] * 1000)]);
}

// the first 2,000 steps in more detail, from the reference (equal to the run's lines, as every pass checks)
let early = old.early;
if (!early) {
  const t = Date.now(), text = trainingText(m).subarray(0, 2000 * m.batch);
  const ls = R.train(m, text).losses;
  early = [];
  for (let s = 0; s < ls.length; s += 20) early.push([s + 20, Math.round((ls.slice(s, s + 20).reduce((a, b) => a + b, 0) / 20) * 1000)]);
  console.log(`the first 2,000 steps from the reference: ${((Date.now() - t) / 1000).toFixed(0)} s`);
}

// what simpler guesses score on the part kept apart, in nats per character
let base = old.base;
if (!base) {
  const { train, held } = shakespeare(), V = m.chars.length, idx = (c) => m.chars.indexOf(c);
  const n1 = new Float64Array(V).fill(1), n2 = Array.from({ length: V }, () => new Float64Array(V).fill(1));
  for (let i = 0; i < train.length; i++) { n1[idx(train[i])]++; if (i) n2[idx(train[i - 1])][idx(train[i])]++; }
  const tot1 = n1.reduce((a, b) => a + b, 0), tot2 = n2.map((r) => r.reduce((a, b) => a + b, 0));
  let h1 = 0, h2 = 0;
  for (let i = 1; i < held.length; i++) { const a = idx(held[i - 1]), b = idx(held[i]); h1 -= Math.log(n1[b] / tot1); h2 -= Math.log(n2[a][b] / tot2[a]); }
  base = { uniform: +Math.log(V).toFixed(4), letters: +(h1 / (held.length - 1)).toFixed(4), pairs: +(h2 / (held.length - 1)).toFixed(4) };
}

const trainer = new Gen(m).trainer(engine);
const out = {
  name: m.name, trainer: m.name.replace('brnfck-', 'brnfck-train-'), parameters: S.paramsOf(m).total, chars: m.chars,
  T: L.T, ctx: m.ctx, hidden: m.hidden, dk: m.dk, batch: m.batch, decay: m.decay, samples: m.samples,
  stepsPerPass: perPass, charsPerPass: perPass * m.batch, passesPlanned: state.passes, programChars: trainer.src.length,
  engineChars: engine.length, regions: sizes, base, early, curve, pass0, passes,
};
fs.writeFileSync(JSON_FILE, JSON.stringify(out));
console.log(`site/train/data/shakespeare.json: ${num(fs.statSync(JSON_FILE).size)} bytes; ${passes.length} of ${state.passes} passes, ${curve.length} points of the loss`);
console.log(`site/train/data/shakespeare/pass-00.bin .. pass-${pad(passes.length)}.bin: ${num(sizes.reduce((a, b) => a + b, 0) * 2)} bytes each; every child reads back to the same program`);
