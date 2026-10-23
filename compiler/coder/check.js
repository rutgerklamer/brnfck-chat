'use strict';

// 30 hand-written check tasks that pick the best training snapshot (train.py --snap), so blind.js stays untouched.
//   node compiler/coder/check.js questions | judge <answers>   (questions -> out/check.json; answers of ask.py)

const fs = require('fs');
const path = require('path');
global.self = global;
require('../../site/challenges/engine.js');

const OUT = path.join(__dirname, 'out');
const rev = (s) => [...s].reverse().join('');
const sh = (s, k) => [...s].map((c) => String.fromCharCode(c.charCodeAt(0) + k)).join('');

const TASKS = [
  ['say-yes', 'just output yes', () => 'yes', ['']],
  ['caret-row', 'a line of 12 carets ^', () => '^'.repeat(12), ['']],
  ['digits-down', 'count from 9 down to 1', () => '987654321', ['']],
  ['capital-ab', 'print ABCDEFG', () => 'ABCDEFG', ['']],
  ['two-lines', 'output hi, a newline, then bye', () => 'hi\nbye', ['']],
  ['echo', 'repeat back what you are given', (x) => x, ['', 'xyz', 'Hi there']],
  ['first-only', 'give me only the first character', (x) => x[0], ['a', 'hello', 'Q?']],
  ['rev-two', 'take two characters, output them swapped', (x) => rev(x), ['ab', '12', 'zY']],
  ['skip-three', 'everything except the first three characters', (x) => x.slice(3), ['', 'abc', 'abcdefg']],
  ['triple-each', 'each input character three times', (x) => [...x].map((c) => c.repeat(3)).join(''), ['', 'ab', 'xyz']],
  ['plus-two', 'one char in, the char two places on out', (x) => sh(x, 2), ['a', 'M', '5']],
  ['last-one', 'output the final character only, nothing if no input', (x) => x.slice(-1), ['', 'z', 'hello!']],
  ['upper', 'uppercase the input (it is lowercase letters)', (x) => x.toUpperCase(), ['', 'abc', 'quiet']],
  ['backwards', 'the input, reversed', rev, ['', 'ab', 'stressed']],
  ['twice-whole', 'output the input two times', (x) => x + x, ['', 'ab', 'hey!']],
  ['angle', 'surround the input with < and >', (x) => '<' + x + '>', ['', 'tag', 'a b']],
  ['dots-gone', 'strip all periods from the input', (x) => x.split('.').join(''), ['', 'a.b.c', '...', 'none']],
  ['dash-space', 'turn every space into a dash', (x) => x.split(' ').join('-'), ['', 'a b c', '  ', 'none']],
  ['nonempty', 'Y when there is input, N when there is none', (x) => (x ? 'Y' : 'N'), ['', 'a', 'abc']],
  ['is-q', 'read one char, answer 1 if it is q else 0', (x) => (x === 'q' ? '1' : '0'), ['q', 'Q', 'p']],
  ['equal-two', 'two chars in: E if equal, U if not', (x) => (x[0] === x[1] ? 'E' : 'U'), ['aa', 'ab', '99']],
  ['add-two', 'two digits in, their sum out (single digit)', (x) => String(+x[0] + +x[1]), ['00', '27', '45']],
  ['bigger', 'the bigger of two input digits', (x) => String(Math.max(+x[0], +x[1])), ['19', '91', '55', '00']],
  ['times-two', 'one digit in, twice it out (stays below 10)', (x) => String(2 * +x), ['0', '2', '4']],
  ['n-hashes', 'digit n in, n hash marks out', (x) => '#'.repeat(+x), ['0', '3', '9']],
  ['length', 'how many characters? one digit, at most 9', (x) => String(x.length), ['', 'abc', 'abcdefghi']],
  ['count-x', 'count the x characters, one digit', (x) => String([...x].filter((c) => c === 'x').length), ['', 'xax', 'xxxxx']],
  ['code-num', 'a character in, its ASCII number out in decimal', (x) => String(x.charCodeAt(0)), ['A', '0', '~']],
  ['comma-each', 'every input character followed by a comma', (x) => [...x].map((c) => c + ',').join(''), ['', 'ab', 'xyz']],
  ['rev-then-dash', 'the input backwards, then a dash', (x) => rev(x) + '-', ['', 'ab', 'abc']],
];
const CHECK = TASKS.map(([id, question, f, inputs]) => ({ id, question, tests: inputs.map((x) => ({ in: x, out: f(x) })) }));

function judge(file) {
  const answers = JSON.parse(fs.readFileSync(file, 'utf8'));
  let pass = 0;
  for (const a of answers) {
    const t = CHECK.find((c) => c.id === a.id), src = self.BFEngine.strip(a.answer);
    const ok = src.length > 0 && t.tests.every((c) => { const r = self.BFEngine.run(src, { input: c.in, bits: 8, eof: 0 }); return r.status === 'ok' && r.out === c.out; });
    if (ok) pass++;
  }
  console.log(`${pass} of ${answers.length} check tasks solved`);
  return pass;
}

if (require.main === module) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'questions') { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'check.json'), JSON.stringify(CHECK.map(({ id, question }) => ({ id, question })), null, 1)); console.log(`${CHECK.length} check questions written`); }
  else if (cmd === 'judge') judge(arg);
  else { console.error('usage: node compiler/coder/check.js questions | judge <answers.json>'); process.exit(1); }
}

module.exports = { CHECK, judge };
