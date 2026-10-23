'use strict';

// The challenges of site/challenges/ as questions for brnfck-qwen2.5-coder-0.5b, and the judgement of its answers.
//   node compiler/coder/challenges.js questions | judge <answers>   (questions -> out/challenges.json)

const fs = require('fs');
const path = require('path');
global.self = global;
require('../../site/challenges/data.js');
require('../../site/challenges/engine.js');
const { questionBytes } = require('../qwen/program/common');

const OUT = path.join(__dirname, 'out');
const LIST = self.BFData.CHALLENGES;

// The statement without code marks, cut the way the program cuts a question.
const question = (ch) => questionBytes(ch.text.replace(/`/g, '')).subarray(0, -1).toString('utf8');

function questions() {
  fs.mkdirSync(OUT, { recursive: true });
  const rows = LIST.map((ch) => ({ id: ch.id, group: ch.group, question: question(ch), cut: Buffer.byteLength(ch.text.replace(/`/g, '')) > Buffer.byteLength(question(ch)) }));
  fs.writeFileSync(path.join(OUT, 'challenges.json'), JSON.stringify(rows, null, 1));
  console.log(`${rows.length} questions written to ${path.join(OUT, 'challenges.json')}; ${rows.filter((r) => r.cut).length} cut at 200 bytes`);
}

function judge(file) {
  const answers = JSON.parse(fs.readFileSync(file, 'utf8'));
  const byGroup = {};
  let pass = 0;
  for (const a of answers) {
    const ch = self.BFData.byId[a.id];
    const r = self.BFEngine.judge(ch, a.answer);
    const ok = r.cases.filter((c) => c.pass).length;
    (byGroup[ch.group] ||= [0, 0])[1]++;
    if (r.pass) { pass++; byGroup[ch.group][0]++; }
    console.log(`${r.pass ? 'PASS' : 'fail'}  ${a.id.padEnd(12)} ${ok}/${r.cases.length}  ${a.answer.length > 90 ? a.answer.slice(0, 87) + '...' : a.answer}`);
  }
  console.log(`\n${pass} of ${answers.length} challenges solved`);
  console.log(Object.entries(byGroup).map(([g, [p, n]]) => `${g} ${p}/${n}`).join(', '));
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'questions') questions();
else if (cmd === 'judge') judge(arg || path.join(OUT, 'answers.json'));
else { console.error('usage: node compiler/coder/challenges.js questions | judge [answers.json]'); process.exit(1); }
