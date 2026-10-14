'use strict';

// Writes engine/data/<model>/calib.json: the keys and values of the fixed chat prefix, from the float model.
//   node compiler/qwen/reference/calibrate.js --model=0.5b

const fs = require('fs');
const path = require('path');
const F = require('./float');
const M = require('./model');

const m = F.loadModel(M.DIR), tok = F.loadTokenizer(M.DIR);
const ids = tok.encode(tok.chatPrefix()), cache = F.newCache(m);
for (let pos = 0; pos < ids.length; pos++) F.forward(m, cache, ids[pos], pos, false);
const n = ids.length * m.kvDim, r = (a) => Array.from(a.subarray(0, n), (v) => +v.toPrecision(7));
const file = path.join(__dirname, '..', 'engine', 'data', M.NAME, 'calib.json');
fs.writeFileSync(file, JSON.stringify({ ids, k: cache.k.map(r), v: cache.v.map(r) }));
console.log(file + ' written');
