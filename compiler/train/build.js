'use strict';

// Build a training program, run it through the WebAssembly runtime on the names, check every line
// it prints and every weight it ends with against reference.js, then run the child program it printed
// and check its names. Writes the programs and a log to compiler/train/out/.

const fs = require('fs');
const path = require('path');
const S = require('./spec');
const R = require('./reference');
const { trainingText, names } = require('./data');
const { Gen, childWriting, layout } = require('./gen');
const { regionValues, SL, W, VEL } = require('./layout');
const { runBF } = require('./run');

const OUT = path.join(__dirname, 'out');
const num = (n) => Math.round(n).toLocaleString('en-US');
const now = () => Number(process.hrtime.bigint()) / 1e6;

function build(key, { print = console.log, every = 1, chars = 0 } = {}) {
  const m = S.MODELS[key];
  if (!m) throw new Error(`no model ${key}; one of ${Object.keys(S.MODELS).join(', ')}`);
  const L = layout(m), trainerName = m.name.replace('brnfck-', 'brnfck-train-');
  const all = trainingText(m), text = chars ? all.subarray(0, chars - (chars % m.batch)) : all, steps = text.length / m.batch;
  fs.mkdirSync(OUT, { recursive: true });
  let failed = 0;
  const lines = [];
  const say = (s) => { lines.push(s); print(s); };
  const ok = (good, s) => { say(`${good ? 'ok  ' : 'FAIL'}  ${s}`); if (!good) failed++; };

  say(`${m.name}: ${S.paramsOf(m).total.toLocaleString('en-US')} parameters, ${m.kind === 'bigram' ? 'context 1' : `context ${m.ctx}, hidden ${m.hidden}${m.kind === 'attn' ? `, attention over ${m.T} letters with ${m.dk}-dimensional queries and keys` : ''}`}`);
  say(`training text: ${num(text.length)} characters (${m.text === 'shakespeare' ? 'of data/shakespeare.txt' : m.epochs + ' epochs of ' + num(names().length) + ' names'}), batch ${m.batch}, ${num(steps)} steps`);

  // the reference
  let t = now();
  const ref = R.train(m, text);
  const refMs = now() - t;
  const childP = R.childParams(ref.params);
  const samples = R.sample(m, childP, m.samples);

  // the programs
  t = now();
  const engine = new Gen(m, { child: true }).childEngine();
  const { src, writerChars } = new Gen(m).trainer(engine);
  const genMs = now() - t;
  const trainerFile = path.join(OUT, `${trainerName}.bf`);
  fs.writeFileSync(trainerFile, src);
  fs.writeFileSync(path.join(OUT, `${trainerName}.input`), text);
  ok(/^[+\-<>[\].,]*$/.test(src), `${path.relative(process.cwd(), trainerFile)}: ${num(src.length)} characters, only the 8 commands (writing part ${num(writerChars)}; made in ${(genMs / 1000).toFixed(1)} s)`);

  // run it, checking each step's line as it comes
  const expected = ref.log.map((l) => l + '\n').join('') + childWriting(m, ref.params) + engine;
  let got = '', step = 0, firstBad = -1, tStep = now();
  const stepMs = [];
  const res = runBF(src, {
    input: text, tapeSize: L.tapeSize, flushEvery: 64,
    onOutput: (b) => {
      if (step >= steps) return;
      got += Buffer.from(b).toString('latin1');
      let nl;
      while (step < steps && (nl = got.indexOf('\n')) >= 0) {
        const line = got.slice(0, nl);
        got = got.slice(nl + 1);
        const want = ref.log[step], tt = now();
        stepMs.push(tt - tStep); tStep = tt;
        if (line !== want && firstBad < 0) firstBad = step;
        step++;
        if (step % every === 0 || step === 1 || step === steps || line !== want) print(`${line}${line === want ? '' : `   <- the reference: ${want}`}`);
      }
    },
  });
  const outText = res.text;
  const runSec = res.ms.run / 1000;
  ok(firstBad < 0 && step === steps, `${steps} steps, every line equal to the reference (${num(res.ms.compile)} ms to compile, ${runSec.toFixed(1)} s to run)`);
  const outLog = outText.split('\n').slice(0, steps);
  ok(outLog.join('\n') === ref.log.join('\n'), `the loss of every step: ${ref.log[0].replace(/^step \d+ /, '')} at step 1, ${ref.log[steps - 1].replace(/^step \d+ /, '')} at step ${steps}`);

  // the weights it ends with
  const tape = res.tape, wantW = regionValues(L, ref.params, 'w'), wantV = regionValues(L, ref.params, 'v');
  let badW = 0, badV = 0, slots = 0;
  L.regions.forEach((R, i) => {
    for (let r = 0; r < R.regionSlots; r++, slots++) {
      if (tape[R.R0 + r * SL + W] !== wantW[i][r]) badW++;
      if (tape[R.R0 + r * SL + VEL] !== wantV[i][r]) badV++;
    }
  });
  ok(!badW && !badV, `every weight and velocity on the tape equals the reference (${num(slots)} slots${badW || badV ? `; ${badW} weights and ${badV} velocities differ` : ''})`);

  // the child it printed
  const child = outText.slice(outText.lastIndexOf('\n') + 1);
  ok(outText === expected, `the printed child program equals the reference's (${num(child.length)} characters: weights ${num(child.length - engine.length)}, engine ${num(engine.length)})`);
  const childFile = path.join(OUT, `${m.name}.bf`);
  fs.writeFileSync(childFile, child);
  const cr = runBF(child, { tapeSize: L.tapeSize });
  ok(cr.text === samples, `${path.relative(process.cwd(), childFile)} prints the reference's ${m.samples} names (${num(cr.ms.compile)} ms to compile, ${(cr.ms.run / 1000).toFixed(2)} s to run)`);

  const perStep = runSec / steps;
  const report = {
    model: m.name, trainer: trainerName, parameters: S.paramsOf(m).total, trainerChars: src.length, writerChars,
    childChars: child.length, engineChars: engine.length, steps, batch: m.batch, examples: text.length, tapeCells: L.tapeSize,
    runSeconds: runSec, msPerStep: perStep * 1000, msPerExample: (runSec / text.length) * 1000, referenceMs: refMs,
    lossFirst: ref.losses[0], lossLast: ref.losses[steps - 1], samples: cr.text.split('\n').filter(Boolean),
  };
  return { ok: !failed, report, lines, ref, childText: cr.text, stepMs };
}

module.exports = { build, OUT };
