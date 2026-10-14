'use strict';

// Writes engine/data/calib.json: the keys and values of the first token in every layer, from the float model.
//   node compiler/smollm/reference/calibrate.js

const fs = require('fs');
const path = require('path');
const F = require('./float');

const m = F.loadModel(), tok = F.loadTokenizer();
const ids = tok.encode(tok.chatPrompt('Tell me a short story about a cat.')), c = { bosK: [], bosV: [] };
F.forward(m, F.newCache(m), ids[0], 0, false, (name, l, a) => {
  if (name === 'k') c.bosK[l] = Array.from(a);
  if (name === 'v') c.bosV[l] = Array.from(a);
});
const file = path.join(__dirname, '..', 'engine', 'data', 'calib.json');
fs.writeFileSync(file, JSON.stringify(c));
console.log(file + ' written');
