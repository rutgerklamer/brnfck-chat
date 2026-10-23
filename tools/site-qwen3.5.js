'use strict';

// Copies float.js and deltanet.js of compiler/qwen3.5 to site/compare/live/; --check only compares, failing on a change.
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
