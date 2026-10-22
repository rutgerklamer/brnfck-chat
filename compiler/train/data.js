'use strict';

// The training text: data/names.txt in a new shuffled order for every epoch, or the first 90% of
// data/shakespeare.txt once for every epoch (the last 10% is kept apart to measure the loss on); cut to whole batches.

const fs = require('fs');
const path = require('path');
const { lcg } = require('./spec');

const NAMES = path.join(__dirname, 'data', 'names.txt'), SHAKESPEARE = path.join(__dirname, 'data', 'shakespeare.txt');
const SHUFFLE_SEED = 1;

function names() {
  return fs.readFileSync(NAMES, 'latin1').split('\n').filter(Boolean);
}

// the text of Shakespeare: the part to learn from and the part kept apart
function shakespeare() {
  const s = fs.readFileSync(SHAKESPEARE, 'latin1'), cut = Math.floor(s.length * 0.9);
  return { train: s.slice(0, cut), held: s.slice(cut) };
}

// epochs: [first, last) of the epochs (the whole run: [0, m.epochs))
function trainingText(m, epochs = [0, m.epochs]) {
  if (m.text === 'shakespeare') {
    const t = shakespeare().train, one = t.slice(0, t.length - (t.length % m.batch));
    return Buffer.from(one.repeat(epochs[1] - epochs[0]), 'latin1');
  }
  const list = names();
  let x = SHUFFLE_SEED, text = '';
  for (let e = 0; e < epochs[1]; e++) {
    const order = list.slice();
    for (let i = order.length - 1; i > 0; i--) {
      x = lcg(x);
      const j = (x >>> 8) % (i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    if (e >= epochs[0]) text += order.map((s) => s + '\n').join('');
  }
  text = text.slice(0, text.length - (text.length % m.batch));
  return Buffer.from(text, 'latin1');
}

module.exports = { names, shakespeare, trainingText };
