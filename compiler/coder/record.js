'use strict';

// The data of site/coder/: each version's answers, the training, the program's numbers (the page judges answers itself).
//   node compiler/coder/record.js   ->  site/coder/data/coder.json

const fs = require('fs');
const path = require('path');
global.self = global;
const { BLIND } = require('./blind');
const { F } = require('./data');

const OUT = path.join(__dirname, 'out');
const SITE = path.join(__dirname, '..', '..', 'site');
const read = (f) => (fs.existsSync(path.join(OUT, f)) ? JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')) : null);
const byId = (rows, set) => Object.fromEntries((rows || []).filter((r) => !set || !r.set || r.set === set).map((r) => [r.id, r.answer]));

// the downloaded model in floating point, then each taught one through the whole-number spec (what its program prints)
const base = read('answers-base.json');
const VERSIONS = [
  { key: 'base', name: 'As downloaded', note: 'Qwen2.5-Coder-0.5B-Instruct before it was taught, in floating point', challenges: byId(base, 'challenge'), blind: byId(base, 'blind') },
  { key: 'v1', name: 'Taught, first round', note: '60,000 examples in 35 families, through the whole-number spec', challenges: byId(read('answers-spec.json')), blind: byId(read('answers-blind-spec-v1.json')) },
  { key: 'v3', name: 'Taught, final round', note: '2,350 real programs, then 160,000 examples in 49 families, through the whole-number spec', challenges: byId(read('answers-spec-v3.json')), blind: byId(read('answers-blind-spec-v3.json')) },
].filter((v) => Object.keys(v.challenges).length);

const questions = read('challenges.json');
const challenges = questions.map((q) => ({ id: q.id, question: q.question }));
const blind = BLIND.map((t) => ({ id: t.id, question: t.question, tests: t.tests }));

// one example of every family; the families added after the first round are marked
const V1_FAMILIES = ['text', 'repeat', 'range', 'lines', 'cat', 'echoTimes', 'shift', 'order', 'skip', 'each', 'every', 'first', 'until', 'countChar', 'length',
  'addConst', 'addThree', 'mulConst', 'digitChars', 'countUp', 'countDownTo1', 'reverse', 'mirror', 'repeatAll', 'caseAll', 'shiftAll', 'wrap', 'append', 'swapPairs',
  'isEmpty', 'isChar', 'same', 'parity', 'replace', 'remove'];
const families = Object.keys(F).map((k) => { let ex = null; for (let i = 0; !ex && i < 50; i++) ex = F[k](); return { key: k, added: !V1_FAMILIES.includes(k), question: ex.q, code: ex.code }; });

// final round, second stage: [step, test loss, % exact] every 500 steps
const curve = [];
if (fs.existsSync(path.join(OUT, 'train.log'))) {
  let step = 0;
  for (const line of fs.readFileSync(path.join(OUT, 'train.log'), 'utf8').split('\n')) {
    const s = /^step (\d+)\/(\d+)/.exec(line); if (s) step = +s[1];
    const t = /test loss ([\d.]+), whole answer exactly right .* ([\d.]+)%/.exec(line); if (t) curve.push([step, +t[1], +t[2]]);
    const b = /^before: test loss ([\d.]+)/.exec(line); if (b) curve.push([0, +b[1], 0]);
  }
}

const meta = JSON.parse(fs.readFileSync(path.join(SITE, 'programs', 'brnfck-qwen2.5-coder-0.5b.meta.json'), 'utf8'));
const data = {
  program: { name: 'brnfck-qwen2.5-coder-0.5b', chars: meta.programBytes, writer: meta.writerBytes, tape: meta.tapeSize },
  // one answer of compiler/qwen/program/ask.js, Node.js 24, 8 cores: Count the a
  run: JSON.parse(fs.readFileSync(path.join(__dirname, 'run.json'), 'utf8')),
  versions: VERSIONS.map(({ key, name, note }) => ({ key, name, note })),
  answers: Object.fromEntries(VERSIONS.map((v) => [v.key, { challenges: v.challenges, blind: v.blind }])),
  challenges, blind, families, curve,
  training: [
    { key: 'v1', examples: 60000, families: 35, steps: 3750, minutes: 52, exact: 88.4 },
    { key: 'v3', examples: 160000, families: 49, stack: 2350, steps: 5000, minutes: 245, exact: curve.length ? curve[curve.length - 1][2] : null },
  ],
};
fs.mkdirSync(path.join(SITE, 'coder', 'data'), { recursive: true });
fs.writeFileSync(path.join(SITE, 'coder', 'data', 'coder.json'), JSON.stringify(data));
console.log(`site/coder/data/coder.json: ${VERSIONS.map((v) => v.key).join(', ')}; ${families.length} families; ${curve.length} points of the curve; ${(fs.statSync(path.join(SITE, 'coder', 'data', 'coder.json')).size / 1024).toFixed(0)} KB`);
