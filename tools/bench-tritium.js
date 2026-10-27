'use strict';
// Runs each training program in the brnfck runtime and in Tritium (bfi -b32 -z) on the same input: time and output.
//   node tools/bench-tritium.js [bigram mlp attn shakespeare] [--bfi path/to/bfi] [--chars 20000]

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const BFWasm = require('../site/runtime/bfwasm');
const { Gen, layout } = require('../compiler/train/gen');
const { MODELS } = require('../compiler/train/spec');
const { trainingText } = require('../compiler/train/data');

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i < 0 ? dflt : args.splice(i, 2)[1]; };
const BFI = opt('--bfi', 'bfi'), CHARS = Number(opt('--chars', 20000));
const keys = args.length ? args : Object.keys(MODELS);
const now = () => Number(process.hrtime.bigint()) / 1e9;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const sec = (s) => `${s.toFixed(s < 10 ? 2 : 1)} s`;

console.log('| Training program | Input | brnfck runtime (compile + run) | Tritium (load + run) | Same output |');
console.log('|---|---|---|---|---|');
let allSame = true;
for (const key of keys) {
  const m = MODELS[key];
  const src = Buffer.from(new Gen(m).trainer(new Gen(m, { child: true }).childEngine()).src, 'latin1');
  const file = path.join(os.tmpdir(), `${m.name}.bf`);
  fs.writeFileSync(file, src);
  let input = trainingText(m);
  if (key === 'shakespeare') input = input.subarray(0, CHARS - (CHARS % m.batch));   // a slice: the whole text runs for hours

  let t = now();
  const exe = BFWasm.compileSync(src, { cellBits: 32, tapeSize: layout(m).tapeSize });
  const compile = now() - t; t = now();
  const mine = Buffer.from(exe.run(input, { flushEvery: 1 << 16 }).output);
  const run = now() - t;

  t = now();
  const r = spawnSync(BFI, ['-v', '-b32', '-z', '-B', file], { input, maxBuffer: 1 << 30 });
  fs.unlinkSync(file);
  if (r.error || r.status !== 0) throw new Error(`${BFI}: ${r.error ? r.error.message : r.stderr}`);
  const total = now() - t, tRun = Number(/Run time ([\d.]+)s/.exec(r.stderr)[1]);
  const theirs = Buffer.from(r.stdout.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');   // Windows writes \n as \r\n

  const same = sha(mine) === sha(theirs);
  allSame = allSame && same;
  console.log(`| ${m.name.replace('brnfck-', 'brnfck-train-')} | ${input.length.toLocaleString('en-US')} characters | ${sec(compile)} + ${sec(run)} | ${sec(total - tRun)} + ${sec(tRun)} | ${same ? 'yes' : 'NO'} |`);
}
if (!allSame) process.exitCode = 1;
