'use strict';

// The training text: data/names.txt (or a word list of your own) shuffled anew every epoch, or the first 90% of
// data/shakespeare.txt once per epoch (the last 10% is kept apart to measure the loss on); cut to whole batches.

const fs = require('fs');
const path = require('path');
const { lcg } = require('./spec');

const NAMES = path.join(__dirname, 'data', 'names.txt'), SHAKESPEARE = path.join(__dirname, 'data', 'shakespeare.txt');
const SHUFFLE_SEED = 1;

// the names of data/names.txt, or the words of a list of your own (wordsModel)
function names(m) {
  return m && m.words ? m.words : fs.readFileSync(NAMES, 'latin1').split('\n').filter(Boolean);
}

// A names model on your own list, one word per line (lowercased, accents dropped, only a to z kept): as many characters
// as the names model, so about as long; weight decay keeps the weights in range when a short list comes round often.
function wordsModel(m, file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const valid = lines.map((s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')).filter((s) => /^[a-z]+$/.test(s));
  const words = [...new Set(valid)];
  if (words.length < 20) throw new Error(`${file}: ${words.length} words of a to z, at least 20 are needed`);
  const charsOf = (list) => list.reduce((n, s) => n + s.length + 1, 0), target = m.epochs * charsOf(names());
  let list = path.basename(file).replace(/\.[^.]*$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'words';
  if (list === 'names') list = 'names-list';
  return {
    ...m, name: m.name.replace('-names-', `-${list}-`), words, wordsFile: file, skipped: lines.length - valid.length,
    epochs: Math.max(1, Math.round(target / charsOf(words))), maxChars: target, decay: 12,
  };
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
  const list = names(m);
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
  if (m.maxChars) text = text.slice(0, m.maxChars);
  text = text.slice(0, text.length - (text.length % m.batch));
  return Buffer.from(text, 'latin1');
}

module.exports = { names, wordsModel, shakespeare, trainingText };
