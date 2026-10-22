'use strict';

// The blind test of brnfck-qwen2.5-coder-0.5b: 60 tasks written by hand, in other words than the generator of
// data.js uses, each with its own test cases. They never go into training: data.js refuses a question that is one
// of these. Some ask for two skills at once, which no training family has.
//   node compiler/coder/blind.js questions            ->  compiler/coder/out/blind.json
//   node compiler/coder/blind.js judge <answers>      the answers of ask.py or spec_ask.js, run on the test cases

const fs = require('fs');
const path = require('path');
global.self = global;
require('../../site/challenges/engine.js');

const OUT = path.join(__dirname, 'out');
const rev = (s) => [...s].reverse().join('');
const up = (s) => s.toUpperCase();
const shift = (s, k) => [...s].map((c) => String.fromCharCode(c.charCodeAt(0) + k)).join('');
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';

// [id, question, f(input) -> output, inputs]
const TASKS = [
  ['word', 'Make a program that outputs the word "brainfuck".', () => 'brainfuck', ['']],
  ['bang-ask', 'Output an exclamation mark followed by a question mark. Nothing is read.', () => '!?', ['']],
  ['digits-up', 'Write out the digits 0 through 9 in increasing order.', () => DIGITS, ['']],
  ['equals-15', 'Output fifteen equals signs in a row.', () => '='.repeat(15), ['']],
  ['lower-abc', 'Show the lowercase alphabet from a to z.', () => LOWER, ['']],
  ['hash-box', 'Produce three lines, each containing four hash signs (#), every line ending in a newline.', () => '####\n'.repeat(3), ['']],
  ['zyxwv', 'Print the letters Z, Y, X, W, V in that order.', () => 'ZYXWV', ['']],
  ['ok-line', 'Output the text OK followed by a newline.', () => 'OK\n', ['']],
  ['at-7', 'Print 7 at signs: @@@@@@@', () => '@'.repeat(7), ['']],
  ['stairs', 'Print a staircase of plus signs: 1 on the first line up to 4 on the fourth, each line ending with a newline.', () => '+\n++\n+++\n++++\n', ['']],
  ['echo-all', 'Echo whatever is typed in, without changes.', (x) => x, ['', 'abc', 'Hello, you!', '12 34']],
  ['first-3x', 'Output the first character you read three times in a row.', (x) => x[0].repeat(3), ['a', 'Zq', '7']],
  ['ascii-next', 'Read a single character and output the character right after it in ASCII.', (x) => shift(x, 1), ['a', 'M', '0', '!']],
  ['drop-2', 'Drop the first two characters of the input and print what remains.', (x) => x.slice(2), ['', 'a', 'ab', 'abcdef', 'xyz!']],
  ['rev-3', 'Read three characters and output them in reverse.', (x) => rev(x), ['abc', '123', 'xY!']],
  ['each-twice', 'Output every input character twice in a row.', (x) => [...x].map((c) => c + c).join(''), ['', 'ab', 'hey!']],
  ['very-last', 'Print only the very last character of what you read. Print nothing for empty input.', (x) => x.slice(-1), ['', 'q', 'hello', 'ab c']],
  ['to-comma', 'Print characters from the input until you hit a comma, not including the comma. There is always a comma.', (x) => x.split(',')[0], ['ab,cd', ',x', 'hello world,!']],
  ['first-three', 'Print the first three characters of the input; it is always at least three long.', (x) => x.slice(0, 3), ['abc', 'abcdef', '12345']],
  ['sum-digit', 'The input is two digits. Output their sum as a single digit (it never exceeds 9).', (x) => String(+x[0] + +x[1]), ['00', '18', '45', '27', '90']],
  ['a-minus-b', 'Read two digits, a then b, with a >= b, and output a - b.', (x) => String(+x[0] - +x[1]), ['00', '91', '55', '73', '80']],
  ['double', 'Read one digit and output double its value; the answer stays below 10.', (x) => String(2 * +x), ['0', '1', '3', '4']],
  ['dashes', 'Given a digit, print that many dashes.', (x) => '-'.repeat(+x), ['0', '1', '4', '9']],
  ['down-0', 'Read a digit n and output all digits from n down to 0.', (x) => rev(DIGITS.slice(0, +x + 1)), ['0', '3', '9']],
  ['plus-3', 'Read a digit and output it plus 3; the result is at most 9.', (x) => String(+x + 3), ['0', '4', '6']],
  ['product', 'Input: two digits. Output: the product, which is at most 9.', (x) => String(+x[0] * +x[1]), ['00', '19', '33', '24', '50']],
  ['mod-3', 'Read a digit and print the remainder when it is divided by 3.', (x) => String(+x % 3), ['0', '2', '3', '7', '9']],
  ['sum-long', 'Two digits come in. Print their sum written in decimal, which may need two digits.', (x) => String(+x[0] + +x[1]), ['00', '45', '99', '58', '19']],
  ['count-dec', 'Print how many characters the input contains, in decimal. The input has at most 200 characters.', (x) => String(x.length), ['', 'abc', 'x'.repeat(57), 'y'.repeat(120)]],
  ['code-of', 'Read one character and print its ASCII code in decimal.', (x) => String(x.charCodeAt(0)), ['A', 'z', ' ', '0']],
  ['smaller', 'Input: two digits. Print the smaller one.', (x) => String(Math.min(+x[0], +x[1])), ['00', '39', '93', '55', '71']],
  ['quarter', 'Read a digit and print it divided by 4, rounded down.', (x) => String(Math.floor(+x / 4)), ['0', '3', '4', '9']],
  ['around', 'Turn the input around so the last character comes first.', rev, ['', 'ab', 'racecar!', 'hello']],
  ['caps', 'Convert every lowercase letter of the input (all lowercase a-z) to uppercase.', up, ['', 'abc', 'brainfuck']],
  ['period', 'Print the input, then a period.', (x) => x + '.', ['', 'end', 'a b']],
  ['braces', 'Wrap the input in curly braces: hi becomes {hi}.', (x) => '{' + x + '}', ['', 'hi', 'x y']],
  ['pair-swap', 'Swap neighbouring characters pairwise; a leftover last character stays.', (x) => x.replace(/(.)(.)/gs, '$2$1'), ['', 'a', 'abcd', 'abcde']],
  ['two-times', 'Repeat the entire input two times.', (x) => x + x, ['', 'ab', 'hey']],
  ['one-back', 'Shift each letter one back in the alphabet; the input only uses b to z.', (x) => shift(x, -1), ['', 'bcd', 'zz']],
  ['palin', 'Print the input and then the same input reversed.', (x) => x + rev(x), ['', 'ab', 'xyz']],
  ['rot1', 'The input is lowercase letters. Print it with each letter moved forward one place, z wrapping around to a.', (x) => [...x].map((c) => (c === 'z' ? 'a' : shift(c, 1))).join(''), ['', 'abc', 'zap', 'zz']],
  ['no-bang', 'Print the input with all exclamation marks removed.', (x) => x.split('!').join(''), ['', 'hi!', '!a!b!', 'none']],
  ['any-1-0', 'Print 1 if there is any input at all, otherwise print 0.', (x) => (x ? '1' : '0'), ['', 'a', 'hello']],
  ['is-x', 'Read a character; print T if it is an x and F otherwise.', (x) => (x === 'x' ? 'T' : 'F'), ['x', 'y', 'X', 'w']],
  ['match-sd', 'Read two characters and output S when they match and D when they do not.', (x) => (x[0] === x[1] ? 'S' : 'D'), ['aa', 'ab', '11', 'Aa']],
  ['odd-even', 'Output Y when the input length is odd and N when it is even.', (x) => (x.length % 2 ? 'Y' : 'N'), ['', 'a', 'ab', 'abc', 'abcd']],
  ['semicolon', 'Replace each comma in the input with a semicolon.', (x) => x.split(',').join(';'), ['', 'a,b', ',,', 'no comma']],
  ['count-e', 'Count the letter e in the input and print the count as one digit (at most 9).', (x) => String([...x].filter((c) => c === 'e').length), ['', 'tree', 'eeeee', 'abc']],
  ['larger-of', 'Read two digits and print the larger.', (x) => String(Math.max(+x[0], +x[1])), ['00', '39', '93', '55', '71']],
  ['parens', 'The input consists of ( and ) only. Print Y if every bracket is properly closed, N otherwise.', (x) => { let d = 0; for (const c of x) { d += c === '(' ? 1 : -1; if (d < 0) return 'N'; } return d ? 'N' : 'Y'; }, ['', '()', '(())', ')(', '(()', '()()']],
  ['from-code', 'Read a number written in decimal digits (between 33 and 126) and print the character with that code.', (x) => String.fromCharCode(+x), ['65', '33', '126', '97']],
  ['with-len', 'Print the input followed by its length as one digit. The input has at most 9 characters.', (x) => x + x.length, ['', 'ab', 'hello']],
  ['rev-caps', 'Print the input reversed and in capitals. The input is lowercase letters only.', (x) => up(rev(x)), ['', 'abc', 'stop']],
  ['spaced', 'Print each character of the input followed by a space.', (x) => [...x].map((c) => c + ' ').join(''), ['', 'abc', 'x']],
  ['per-line', 'Print every character of the input on its own line.', (x) => [...x].map((c) => c + '\n').join(''), ['', 'ab', 'xyz']],
  ['digit-total', 'Print the sum of all digits in the input, in decimal. The input is only digits.', (x) => String([...x].reduce((s, c) => s + +c, 0)), ['', '5', '123', '9999']],
  ['star-lines', 'Read a digit and print that many lines with a single star each.', (x) => '*\n'.repeat(+x), ['0', '1', '3']],
  ['z-to-a', 'Print the alphabet backwards, from z to a.', () => rev(LOWER), ['']],
  ['drop-last', 'Print the input without its last character.', (x) => x.slice(0, -1), ['', 'a', 'abc', 'hello']],
  ['two-after', 'Read a character and print the character two places after it, twice.', (x) => shift(x, 2).repeat(2), ['a', 'x', '0']],
];
const BLIND = TASKS.map(([id, question, f, inputs]) => ({ id, question, tests: inputs.map((x) => ({ in: x, out: f(x) })) }));

function questions() {
  fs.mkdirSync(OUT, { recursive: true });
  const long = BLIND.filter((t) => Buffer.byteLength(t.question) > 200);
  if (long.length) throw new Error('longer than a question can be: ' + long.map((t) => t.id));
  fs.writeFileSync(path.join(OUT, 'blind.json'), JSON.stringify(BLIND.map(({ id, question }) => ({ id, question })), null, 1));
  console.log(`${BLIND.length} blind questions written to ${path.join(OUT, 'blind.json')}`);
}

function judge(file) {
  const answers = JSON.parse(fs.readFileSync(file, 'utf8'));
  let pass = 0;
  for (const a of answers) {
    const t = BLIND.find((b) => b.id === a.id);
    const res = t.tests.map((c) => { const r = self.BFEngine.run(self.BFEngine.strip(a.answer), { input: c.in, bits: 8, eof: 0 }); return r.status === 'ok' && r.out === c.out; });
    const ok = res.every(Boolean) && self.BFEngine.strip(a.answer).length > 0;
    if (ok) pass++;
    console.log(`${ok ? 'PASS' : 'fail'}  ${a.id.padEnd(12)} ${res.filter(Boolean).length}/${res.length}  ${a.answer.length > 90 ? a.answer.slice(0, 87) + '...' : a.answer}`);
  }
  console.log(`\n${pass} of ${answers.length} blind tasks solved`);
}

if (require.main === module) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'questions') questions();
  else if (cmd === 'judge') judge(arg || path.join(OUT, 'answers-blind.json'));
  else { console.error('usage: node compiler/coder/blind.js questions | judge [answers.json]'); process.exit(1); }
}

module.exports = { BLIND };
