'use strict';

// Copies the model code of compiler/qwen3.5 (float.js, deltanet.js) to site/compare/live/, where the page
// "Compare the models" runs it in the browser. With --check it only compares, and fails when a copy differs.
//   node tools/site-qwen3.5.js [--check]

const fs = require('fs');
const path = require('path');

const FROM = path.join(__dirname, '..', 'compiler', 'qwen3.5', 'reference'), TO = path.join(__dirname, '..', 'site', 'compare', 'live');
const FILES = ['float.js', 'deltanet.js'], check = process.argv.includes('--check');
let differ = 0;
for (const f of FILES) {
  const src = fs.readFileSync(path.join(FROM, f)), dst = path.join(TO, f);
  const same = fs.existsSync(dst) && fs.readFileSync(dst).equals(src);
  if (check) { console.log((same ? 'ok    ' : 'DIFFER ') + 'site/compare/live/' + f); if (!same) differ++; continue; }
  if (!same) fs.writeFileSync(dst, src);
  console.log((same ? 'same   ' : 'copied ') + 'site/compare/live/' + f);
}
process.exit(differ ? 1 : 0);
