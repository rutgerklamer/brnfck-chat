'use strict';

// Writes data/seq256.json: 256 tokens of a question and the float model's own answer, the text drift.js measures on.
//   node compiler/qwen3.5/reference/sequence.js [--model=qwen3.5-0.8b]

const fs = require('fs');
const path = require('path');
const F = require('./float');

const DIR = F.modelDir(), N = 256;
const QUESTION = 'Explain how a steam engine works, step by step, and why it changed the world.';
const tok = F.loadTokenizer(DIR), m = F.loadModel(DIR);
const prompt = tok.encode(tok.chatPrompt(QUESTION));
const ids = prompt.concat(F.generateIds(m, prompt, N - prompt.length, []));
const file = path.join(__dirname, '..', 'data', 'seq256.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify({ model: path.basename(DIR), question: QUESTION, prompt: prompt.length, ids }));
console.log(tok.decode(ids, { skipSpecial: false }));
console.log(file + ' written');
