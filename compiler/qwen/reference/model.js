'use strict';

// Which model the scripts of this folder work on: --model=0.5b (default) or --model=1.5b.

const path = require('path');

let NAME = '0.5b';
for (let i = process.argv.length - 1; i >= 2; i--) {
  const m = /^--model=(.+)$/.exec(process.argv[i]);
  if (m) { NAME = m[1]; process.argv.splice(i, 1); }
}

module.exports = {
  NAME,
  DIR: path.join(__dirname, '..', '..', 'downloads', 'qwen2.5-' + NAME),
  MAX_NEW: NAME === '0.5b' ? 50 : 40,     // the 1.5B is three times slower
};
