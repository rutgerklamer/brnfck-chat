'use strict';

// The answers of the whole-number spec of compiler/qwen/engine/ to the questions of a JSON file: what the brainfuck
// program prints, token for token. Needs compiler/qwen/engine/data/<model>/calib.json (compiler/qwen/reference/calibrate.js).
//   node compiler/coder/spec_ask.js [questions.json] [answers.json] [--model coder-0.5b]

const fs = require('fs');
const path = require('path');
const Spec = require('../qwen/engine/spec');

const OUT = path.join(__dirname, 'out');
const a = process.argv.slice(2), opt = (n, d) => { const i = a.indexOf(n); if (i < 0) return d; const v = a[i + 1]; a.splice(i, 2); return v; };
const model = opt('--model', 'coder-0.5b');
const [inFile = path.join(OUT, 'challenges.json'), outFile = path.join(OUT, 'answers-spec.json')] = a;
const MAX_TOKENS = 256;

const t0 = Date.now();
const { tok, net } = Spec.buildReal(model);
console.log(`whole-number model of ${model} built in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
const rows = JSON.parse(fs.readFileSync(inFile, 'utf8'));
for (const r of rows) {
  const t = Date.now(), ids = tok.encode(tok.chatPrompt(r.question));
  const out = Spec.generateIds(net, ids, MAX_TOKENS - ids.length);
  r.answer = tok.decode(out);
  console.log(`${r.id}  [${ids.length}+${out.length} tokens, ${((Date.now() - t) / 1000).toFixed(0)} s]  ${r.answer.slice(0, 100)}`);
  fs.writeFileSync(outFile, JSON.stringify(rows.filter((x) => 'answer' in x), null, 1));
}
console.log(`${rows.length} answers written to ${outFile}`);
