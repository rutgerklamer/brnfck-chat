'use strict';

// What the SPEC (compiler/smollm/engine/spec.js, plain JavaScript integers) answers to the test questions.

const fs = require('fs');
const path = require('path');
const F = require('../reference/float');
const Spec = require('../engine/spec');
const QUESTIONS = require('./questions');

const FILE = path.join(__dirname, 'out', 'ref.json');
fs.mkdirSync(path.dirname(FILE), { recursive: true });
let t = Date.now();
const { m, tok, net } = Spec.buildReal();
console.log(`spec built in ${((Date.now() - t) / 1000).toFixed(1)} s`);
const T = net.cfg.maxTokens, NP = net.prefix.n, ref = { maxTokens: T, prefix: NP, cases: [] };
for (const q of QUESTIONS) {
  t = Date.now();
  const all = tok.encode(tok.chatPrompt(q.means ?? q.question));
  if (all.slice(0, NP).join() !== net.prefix.ids.join()) throw new Error('prompt does not start with the fixed prefix');
  const room = T + 1 - all.length, ids = F.generateIds(m, all, room, net.step);
  ref.cases.push({ ...q, promptIds: all.length, ids, text: tok.decode(ids), printing: ids.filter((id) => tok.decode([id]) !== '').length, end: ids.length < room ? 'end token' : 'position limit' });
  console.log(`> ${q.question}\n  ${all.length} prompt ids, ${ids.length} new (${ids.length < room ? 'end token' : 'position limit'}), ${((Date.now() - t) / 1000).toFixed(0)} s: ${JSON.stringify(tok.decode(ids))}`);
  fs.writeFileSync(FILE, JSON.stringify(ref, null, 1));
}
