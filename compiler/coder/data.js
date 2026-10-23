'use strict';

// Training examples for brnfck-qwen2.5-coder-0.5b: a task in words and a brainfuck program, checked on random inputs.
//   node compiler/coder/data.js [count] [seed]   ->  compiler/coder/out/train.jsonl, test.jsonl

const fs = require('fs');
const path = require('path');
global.self = global;
require('../../site/challenges/engine.js');
const BF = self.BFEngine;

const OUT = path.join(__dirname, 'out');
const MAX_QUESTION = 200; // the program reads at most this many bytes of a question

// ---- random numbers from a seed (mulberry32)
let seed = 1;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (a) => a[Math.floor(rnd() * a.length)];
const chance = (p) => rnd() < p;

// ---- pieces of programs
const set = (d) => (d >= 0 ? '+'.repeat(d) : '-'.repeat(-d));
const printText = (s) => { let at = 0, code = ''; for (const ch of s) { const c = ch.charCodeAt(0); code += set(c - at) + '.'; at = c; } return code; };
const code = (ch) => ch.charCodeAt(0);

// ---- words for tasks
const LOWER = 'abcdefghijklmnopqrstuvwxyz', UPPER = LOWER.toUpperCase(), DIGITS = '0123456789';
const PUNCT = '!?.,:;-+*#@$%&=/_~^()<>|';
const PRINTABLE = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
const WORDS = ('cat dog sun moon tree star book code bird fish rain snow wind fire lamp door key cup tea milk bread apple pear lemon ' +
  'river stone cloud green blue red yellow black white house car boat train road city park game play jump run walk sing ' +
  'yes no ok hey bye good bad big small fast slow hot cold one two three four five six seven eight nine ten zero ' +
  'robot pixel tape cell loop byte bit data input output print brain fun cool wow nice done stop go up down left right').split(' ');
const NUMBER = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const times = (n) => (n === 1 ? 'once' : n === 2 ? pick(['twice', 'two times']) : (n <= 12 && chance(0.5) ? NUMBER[n] : String(n)) + ' times');
const count = (n) => (n <= 12 && chance(0.5) ? NUMBER[n] : String(n));
const name = (ch, bare) => {
  if (ch === ' ') return bare ? 'space' : pick(['a space', 'the space character']);
  if (ch === '\n') return bare ? 'line break' : pick(['a line break', 'a newline', 'the character 10']);
  return pick([`\`${ch}\``, `"${ch}"`, `'${ch}'`, ch]);
};
const quote = (s) => pick([`\`${s}\``, `"${s}"`, s]);
const NO_INPUT = ['', '', ' There is no input.', ' No input.', ' It reads nothing.'];
const EMPTY_OK = ['', '', ' The input can be empty.', ' The input may be empty.'];
const lead = () => pick(['', '', '', 'Write a brainfuck program to ', 'Write a program to ', 'Brainfuck: ', 'In brainfuck, ', 'Using brainfuck, ']);
// The first letter in capitals when the sentence starts the question.
const sentence = (pre, rest) => (pre ? pre + rest[0].toLowerCase() + rest.slice(1) : rest[0].toUpperCase() + rest.slice(1));

function randomText(maxLen) {
  const kind = int(0, 5);
  if (kind === 0) return pick(WORDS);
  if (kind === 1) { const w = pick(WORDS); return w[0].toUpperCase() + w.slice(1) + pick(['', '!', '.', '?']); }
  if (kind === 2) return Array.from({ length: int(1, maxLen) }, () => pick(UPPER)).join('');
  if (kind === 3) return Array.from({ length: int(1, maxLen) }, () => pick(PRINTABLE)).join('').trim() || 'x';
  if (kind === 4) return pick(WORDS) + pick([' ', ', ', '-']) + pick(WORDS);
  return Array.from({ length: int(1, maxLen) }, () => pick(LOWER + DIGITS + PUNCT)).join('');
}
const randomInput = (alphabet, maxLen, minLen = 0) => Array.from({ length: int(minLen, maxLen) }, () => pick(alphabet)).join('');

// ---- the families: each returns { q, code, f (input -> output), inputs } or null to skip this draw
const F = {};

F.text = () => {
  const s = randomText(10);
  const q = s.length === 1 && /[A-Z]/.test(s) ? pick([`Print the capital letter ${quote(s)}.`, `Print the letter ${quote(s)}.`])
    : pick([`Print ${quote(s)}.`, `print ${quote(s)}`, `Print the text ${quote(s)}.`, `Output ${quote(s)}.`, `Print ${quote(s)} exactly, with no line break at the end.`]);
  return { q: sentence(lead(), q) + pick(NO_INPUT), code: printText(s), f: () => s, inputs: [''] };
};

F.repeat = () => {
  const ch = pick(PRINTABLE.replace(' ', '') + '*****'), n = int(2, 40);
  const s = ch.repeat(n);
  const body = n <= 8 ? set(code(ch)) + '.'.repeat(n) : set(code(ch)) + '>' + set(n) + '[<.>-]';
  const q = pick([`Print ${name(ch)} ${times(n)}.`, `Print ${count(n)} ${ch === '*' ? 'stars' : 'copies of ' + name(ch)}.`, `Print a row of ${count(n)} ${ch === '*' ? 'stars' : name(ch) + "'s"}: ${quote(s)}.`]);
  return { q: sentence(lead(), q) + pick(NO_INPUT), code: body, f: () => s, inputs: [''] };
};

F.range = () => {
  let a, b, q;
  const kind = int(0, 3);
  if (kind === 0) { const al = pick([UPPER, LOWER]); a = int(0, 20); b = int(a + 2, 25); a = al[a]; b = al[b]; }
  else if (kind === 1) { a = String(int(0, 6)); b = String(int(+a + 2, 9)); }
  else if (kind === 2) { a = String.fromCharCode(int(32, 100)); b = String.fromCharCode(int(code(a) + 3, Math.min(126, code(a) + 60))); }
  else { const al = pick([UPPER, LOWER, DIGITS]); a = al[0]; b = al[al.length - 1]; }
  const down = chance(0.35);
  const [from, to] = down ? [b, a] : [a, b];
  const n = Math.abs(code(to) - code(from)) + 1;
  let s = '';
  for (let i = 0; i < n; i++) s += String.fromCharCode(code(from) + (down ? -i : i));
  const body = set(code(from)) + '>' + set(n) + (down ? '[<.->-]' : '[<.+>-]');
  if (kind === 2) q = `Print all ${n} characters with the numbers ${code(from)} to ${code(to)}, in order.`;
  else if (kind === 3) q = down ? `Print the ${n} ${DIGITS.includes(a) ? 'digits' : 'letters'} from ${quote(from)} down to ${quote(to)}.` : pick([`Print the ${n} ${DIGITS.includes(a) ? 'digits' : a === 'a' ? 'small letters' : 'capital letters'} from ${quote(from)} to ${quote(to)}.`, `Print the ${a === 'a' ? 'alphabet in small letters' : a === 'A' ? 'alphabet in capitals' : 'digits in order'}.`]);
  else q = pick([`Print the characters from ${quote(from)} to ${quote(to)}${down ? ', counting down' : ''}: ${quote(s)}.`, `Print ${quote(s)}.`, `Print every character from ${quote(from)} ${down ? 'down ' : ''}to ${quote(to)}.`]);
  return { q: sentence(lead(), q) + pick(NO_INPUT), code: body, f: () => s, inputs: [''] };
};

F.lines = () => {
  const ch = pick(['*', '*', '#', '+', 'x', 'o', '@', '=', '.']), k = int(2, 9), tri = chance(0.5), m = int(2, 9);
  let s = '';
  for (let i = 1; i <= k; i++) s += ch.repeat(tri ? i : m) + '\n';
  const body = set(code(ch)) + '>++++++++++>' + set(k) + (tri ? '[>+[>+<<<<.>>>-]>[<+>-]<<<.>-]' : '[>' + set(m) + '[<<<.>>>-]<<.>-]');
  const what = ch === '*' ? 'stars' : name(ch) + "'s";
  const q = tri ? `Print ${count(k)} lines of ${what}: one on the first line, two on the second, up to ${count(k)}. End every line with a line break.`
    : `Print ${count(k)} lines of ${count(m)} ${what} each. End every line with a line break.`;
  return { q: sentence(lead(), q) + pick(NO_INPUT), code: body, f: () => s, inputs: [''] };
};

F.cat = () => {
  const q = pick(['Print the whole input, unchanged.', 'Copy the input to the output.', 'Echo the input back.', 'Print everything it reads.', 'Read all input and print it as it is.', 'Behave like cat: print the input.']);
  return { q: sentence(lead(), q) + pick(EMPTY_OK), code: ',[.,]', f: (x) => x, inputs: ['', 'hello', 'a', 'Brainfuck!', randomInput(PRINTABLE, 12, 1)] };
};

F.echoTimes = () => {
  const n = int(1, 6);
  const q = n === 1 ? pick(['Read one character and print it.', 'Print the first character of the input.']) : `Read one character and print it ${times(n)}.`;
  return { q: sentence(lead(), q), code: ',' + '.'.repeat(n), f: (x) => x[0].repeat(n), inputs: Array.from({ length: 4 }, () => randomInput(PRINTABLE, 3, 1)) };
};

F.shift = () => {
  const k = pick([-5, -4, -3, -2, -1, 2, 3, 4, 5, 6, 7, 8, 10, 13, 16, 32, -32]);
  const al = k === 32 ? LOWER : k === -32 ? UPPER : LOWER.slice(Math.max(0, -k), 26 - Math.max(0, k));
  const q = k === 32 ? 'Read one small letter and print it as a capital.' : k === -32 ? 'Read one capital letter and print it as a small letter.'
    : k === -1 ? pick(['Read one letter and print the letter before it in the alphabet.', 'Read one character and print the character before it.'])
    : `Read one character and print the character ${Math.abs(k)} places ${k > 0 ? 'later' : 'earlier'} in the ASCII table.`;
  return { q: sentence(lead(), q), code: ',' + set(k) + '.', f: (x) => String.fromCharCode(code(x) + k), inputs: Array.from({ length: 4 }, () => pick(al)) };
};

F.order = () => {
  const n = int(2, 5), rev = chance(0.6);
  const perm = rev ? Array.from({ length: n }, (_, i) => n - 1 - i) : (() => { const p = Array.from({ length: n }, (_, i) => i); for (let i = n - 1; i > 0; i--) { const j = int(0, i); [p[i], p[j]] = [p[j], p[i]]; } return p; })();
  let body = ',' + '>,'.repeat(n - 1), at = n - 1;
  for (const i of perm) { body += set(i - at).replace(/\+/g, '>').replace(/-/g, '<') + '.'; at = i; }
  const ord = ['first', 'second', 'third', 'fourth', 'fifth'];
  const q = rev ? pick([`Read ${count(n)} characters and print them in reverse order.`, `Read ${count(n)} characters and print them backwards.`])
    : `Read ${count(n)} characters and print them in this order: ${perm.map((i) => ord[i]).join(', ')}.`;
  return { q: sentence(lead(), q), code: body, f: (x) => perm.map((i) => x[i]).join(''), inputs: Array.from({ length: 4 }, () => randomInput(LOWER + UPPER + DIGITS, n, n)) };
};

F.skip = () => {
  const k = int(1, 5);
  const q = k === 1 ? pick(['Print the input without its first character.', 'Print all but the first character of the input.']) : `Print the input without its first ${count(k)} characters.`;
  return { q: sentence(lead(), q) + pick(EMPTY_OK), code: ','.repeat(k + 1) + '[.,]', f: (x) => x.slice(k), inputs: ['', 'a', 'abcdefgh', randomInput(PRINTABLE, 10, 1), randomInput(LOWER, 12, 1)] };
};

F.each = () => {
  const m = int(2, 5);
  const q = pick([`Print every character of the input ${times(m)}.`, `Repeat every character of the input ${times(m)}: ${quote('ab')} becomes ${quote('a'.repeat(m) + 'b'.repeat(m))}.`]);
  return { q: sentence(lead(), q) + pick(EMPTY_OK), code: ',[' + '.'.repeat(m) + ',]', f: (x) => [...x].map((c) => c.repeat(m)).join(''), inputs: ['', 'xy', randomInput(PRINTABLE, 8, 1), randomInput(LOWER, 6, 1)] };
};

F.every = () => {
  const k = int(2, 4), ex = 'abcdefghij';
  const q = `Print the first character of the input and then every ${['', '', 'second', 'third', 'fourth'][k]} one after it: ${quote(ex)} becomes ${quote([...ex].filter((_, i) => i % k === 0).join(''))}.`;
  return { q: sentence(lead(), q) + pick(EMPTY_OK), code: ',[.' + ',[-]'.repeat(k - 1) + ',]', f: (x) => [...x].filter((_, i) => i % k === 0).join(''), inputs: ['', 'a', 'abcdefghijk', randomInput(PRINTABLE, 12, 1), randomInput(LOWER, 9, 1)] };
};

F.first = () => {
  const k = int(2, 5);
  const q = `Print the first ${count(k)} characters of the input. The input has at least ${count(k)} characters.`;
  return { q: sentence(lead(), q), code: ',.'.repeat(k), f: (x) => x.slice(0, k), inputs: Array.from({ length: 4 }, () => randomInput(PRINTABLE, 9, k)) };
};

F.until = () => {
  const stop = pick(['.', ',', ' ', '!', ';', '#', '/', '\n', '\n']);
  const q = `The input contains ${name(stop)}. Print everything before the first ${name(stop, true)}.`;
  return { q: sentence(lead(), q), code: ',' + set(-code(stop)) + '[' + set(code(stop)) + '.,' + set(-code(stop)) + ']', f: (x) => x.split(stop)[0], inputs: Array.from({ length: 4 }, () => randomInput(LOWER + DIGITS, 6) + stop + randomInput(LOWER, 4)) };
};

F.countChar = () => {
  const ch = pick(LOWER + 'xyz .!');
  const q = pick([`Print how many times ${name(ch)} occurs in the input, as one digit. It occurs at most 9 times.`, `Count the ${name(ch)} characters in the input and print the count as a digit (at most 9).`]);
  const al = LOWER.slice(0, 6) + ch + ch;
  const body = ',[' + set(-code(ch)) + '>+<[>-<[-]]>[->+<]<,]>>' + set(48) + '.';
  return { q: sentence(lead(), q), code: body, f: (x) => String([...x].filter((c) => c === ch).length), inputs: ['', ch, randomInput(al, 8), randomInput(al, 9, 1), randomInput(al, 6, 1)].filter((x) => [...x].filter((c) => c === ch).length <= 9) };
};

F.length = () => {
  const ch = pick(['*', '#', '.', '-', '=', 'x']);
  const q = `Print one ${name(ch)} for every character of the input.`;
  return { q: sentence(lead(), q) + pick(EMPTY_OK), code: ',[>' + set(code(ch)) + '.[-]<,]', f: (x) => ch.repeat(x.length), inputs: ['', 'abc', randomInput(PRINTABLE, 9, 1), randomInput(LOWER, 5, 1)] };
};

const digits = (n) => Array.from({ length: n }, () => String(int(0, 9))).join('');

F.addConst = () => {
  const k = int(1, 8), op = pick(['+', '-']);
  const q = op === '+' ? `Read one digit and print it plus ${k}. The result is never more than 9.` : `Read one digit and print it minus ${k}. The digit is never smaller than ${k}.`;
  const ins = [];
  for (let d = 0; d <= 9; d++) if (op === '+' ? d + k <= 9 : d >= k) ins.push(String(d));
  return { q: sentence(lead(), q), code: ',' + set(op === '+' ? k : -k) + '.', f: (x) => String(+x + (op === '+' ? k : -k)), inputs: ins };
};

F.addThree = () => {
  const q = pick(['Read three digits and print their sum, which is never more than 9: `123` gives `6`.', 'Add three digits from the input and print the sum (at most 9).', 'The input is three digits. Print their total as one digit; it is never above 9.']);
  const ins = [];
  while (ins.length < 6) { const s = digits(3); if (+s[0] + +s[1] + +s[2] <= 9) ins.push(s); }
  return { q: sentence(lead(), q), code: ',>,[<+>-]>,[<<+>>-]<<' + set(-96) + '.', f: (x) => String(+x[0] + +x[1] + +x[2]), inputs: ins };
};

F.mulConst = () => {
  const k = int(2, 4);
  const q = pick([`Read one digit and print it times ${k}. The result is never more than 9.`, `Read a digit and print ${k} times that digit, which is at most 9.`, `Multiply the digit in the input by ${k} and print the result (never above 9).`]);
  const ins = [];
  for (let d = 0; d * k <= 9; d++) ins.push(String(d));
  return { q: sentence(lead(), q), code: ',' + set(-48) + '[>' + set(k) + '<-]>' + set(48) + '.', f: (x) => String(+x * k), inputs: ins };
};

F.digitChars = () => {
  const ch = pick(['#', '+', '-', '=', 'x', 'o', '@', '.', '!']);
  const q = `Read one digit and print that many ${name(ch)}'s: ${quote('3')} gives ${quote(ch.repeat(3))}, and ${quote('0')} gives nothing.`;
  return { q: sentence(lead(), q), code: ',' + set(-48) + '>' + set(code(ch)) + '<[>.<-]', f: (x) => ch.repeat(+x), inputs: ['0', '1', '3', '7', '9'] };
};

F.countUp = () => {
  const q = `Read one digit and count up from 0 to it: ${quote('3')} gives ${quote('0123')}.`;
  return { q: sentence(lead(), q), code: ',' + set(-47) + '>' + set(48) + '<[>.+<-]', f: (x) => DIGITS.slice(0, +x + 1), inputs: ['0', '2', '5', '9'] };
};

F.countDownTo1 = () => {
  const q = `Read one digit, at least 1, and count down from it to 1: ${quote('3')} gives ${quote('321')}.`;
  return { q: sentence(lead(), q), code: ',[->+>+<<]>>' + set(-48) + '[<.->-]', f: (x) => [...DIGITS.slice(1, +x + 1)].reverse().join(''), inputs: ['1', '3', '6', '9'] };
};

F.reverse = () => {
  const q = pick(['Print the input in reverse.', 'Reverse the input.', 'Print the characters of the input from last to first.', 'Print the input backwards: `abc` becomes `cba`.', 'Read all the input and print it reversed.']);
  return { q: sentence(lead(), q) + pick(EMPTY_OK) + ' It never holds the character 0.', code: '>,[>,]<[.<]', f: (x) => [...x].reverse().join(''), inputs: ['', 'ab', 'stressed', randomInput(PRINTABLE, 10, 1)] };
};

F.mirror = () => {
  const q = pick(['Print the input followed by the input backwards.', 'Print the input and then its reverse: `ab` becomes `abba`.', 'Print the input, then the same characters from last to first.', 'Make a palindrome: the input and then the input reversed.']);
  return { q: sentence(lead(), q) + pick(EMPTY_OK) + ' It never holds the character 0.', code: '>,[.>,]<[.<]', f: (x) => x + [...x].reverse().join(''), inputs: ['', 'xyz', randomInput(PRINTABLE, 8, 1)] };
};

F.repeatAll = () => {
  const k = int(2, 4);
  const q = `Print the whole input ${times(k)} in a row.`;
  return { q: sentence(lead(), q) + pick(EMPTY_OK) + ' It never holds the character 0.', code: '>,[>,]<[<]>' + '[.>]<[<]>'.repeat(k - 1) + '[.>]', f: (x) => x.repeat(k), inputs: ['', 'ab', randomInput(PRINTABLE, 7, 1)] };
};

F.caseAll = () => {
  const up = chance(0.6), k = up ? -32 : 32;
  const q = up ? pick(['The input is made of small letters only. Print it in capitals.', 'Convert the input, all small letters, to upper case.', 'Print the input in capital letters. It only has the letters a to z.']) : pick(['The input is made of capital letters only. Print it in small letters.', 'Convert the input, all capitals, to lower case.']);
  return { q: sentence(lead(), q) + pick(EMPTY_OK), code: ',[' + set(k) + '.,]', f: (x) => [...x].map((c) => String.fromCharCode(code(c) + k)).join(''), inputs: ['', randomInput(up ? LOWER : UPPER, 9, 1), randomInput(up ? LOWER : UPPER, 4, 1)] };
};

F.shiftAll = () => {
  const k = pick([1, 2, 3, -1, -2]);
  const q = k === 1 ? 'The input is made of the small letters a to y. Replace every letter by the next one in the alphabet.'
    : `Print the input with every character ${Math.abs(k)} places ${k > 0 ? 'later' : 'earlier'} in the ASCII table.`;
  const al = k === 1 ? LOWER.slice(0, 25) : LOWER.slice(2, 24);
  return { q: sentence(lead(), q) + pick(EMPTY_OK), code: ',[' + set(k) + '.,]', f: (x) => [...x].map((c) => String.fromCharCode(code(c) + k)).join(''), inputs: ['', randomInput(al, 9, 1), randomInput(al, 4, 1)] };
};

F.wrap = () => {
  const pairs = [['(', ')'], ['<', '>'], ['{', '}'], ['"', '"'], ['*', '*'], ['_', '_'], ['[', ']']];
  const [a, b] = pick(pairs);
  const q = `Print the input between ${name(a)} and ${name(b)}: ${quote('hi')} becomes ${quote(a + 'hi' + b)}.`;
  return { q: sentence(lead(), q) + pick(EMPTY_OK), code: set(code(a)) + '.,[.,]' + set(code(b)) + '.', f: (x) => a + x + b, inputs: ['', 'word', randomInput(PRINTABLE, 8, 1)] };
};

F.append = () => {
  const ch = pick(['?', '.', ':', '#', '*', ';']), front = chance(0.4);
  const q = front ? `Print ${name(ch)} followed by the input.` : `Print the input followed by ${name(ch)}.`;
  const body = front ? set(code(ch)) + '.,[.,]' : ',[.,]' + set(code(ch)) + '.';
  return { q: sentence(lead(), q) + pick(EMPTY_OK), code: body, f: (x) => (front ? ch + x : x + ch), inputs: ['', 'yes', randomInput(PRINTABLE, 8, 1)] };
};

F.swapPairs = () => {
  const q = pick(['Swap every two characters of the input. If one is left over at the end, print it as it is.', 'Swap the characters of the input in pairs: `abcd` becomes `badc`, and a last odd character stays.', 'Print the input with each pair of characters swapped. An odd last character is printed as it is.']);
  return { q: sentence(lead(), q) + pick(EMPTY_OK), code: ',[>,[.<.[-]>[-]]<[.[-]],]', f: (x) => x.replace(/(.)(.)/gs, '$2$1'), inputs: ['', 'a', 'abcd', 'abcde', randomInput(LOWER, 9, 1)] };
};

// if-else on one cell: prints zero when it is 0, else nonzero; the two cells to its right are scratch
function branch(zero, nonzero) { return '>+<[>-<[-]>>' + set(code(nonzero)) + '.[-]<<]>[>' + set(code(zero)) + '.[-]<-]'; }

F.isEmpty = () => {
  const [y, n] = pick([['T', 'F'], ['1', '0'], ['+', '-'], ['y', 'n'], ['E', 'F']]);
  const q = `Print ${name(y)} if the input holds at least one character, and ${name(n)} if it is empty.`;
  return { q: sentence(lead(), q), code: ',' + branch(n, y), f: (x) => (x.length ? y : n), inputs: ['', 'a', 'hello'] };
};

F.isChar = () => {
  const ch = pick(LOWER + UPPER + DIGITS + '?!'), [y, n] = pick([['Y', 'N'], ['T', 'F'], ['1', '0'], ['+', '-'], ['=', 'x']]);
  const q = `Read one character. Print ${name(y)} if it is ${name(ch)}, and ${name(n)} if it is not.`;
  return { q: sentence(lead(), q), code: ',' + set(-code(ch)) + branch(y, n), f: (x) => (x === ch ? y : n), inputs: [ch, ch, pick(LOWER), pick(DIGITS), String.fromCharCode(code(ch) + 1)] };
};

F.same = () => {
  const [y, n] = pick([['Y', 'N'], ['T', 'F'], ['1', '0'], ['+', '-'], ['s', 'd']]);
  const q = `Read two characters. Print ${name(y)} if they are the same, and ${name(n)} if they differ.`;
  return { q: sentence(lead(), q), code: ',>,[<->-]<' + branch(y, n), f: (x) => (x[0] === x[1] ? y : n), inputs: ['aa', 'ab', '11', '12', 'zZ', '!!'] };
};

F.parity = () => {
  const [e, o] = pick([['0', '1'], ['Y', 'N'], ['e', 'o'], ['+', '-']]);
  const q = `Print ${name(e)} if the number of characters in the input is even, and ${name(o)} if it is odd. An empty input counts as even.`;
  const body = '>+<,[>[->+<]+>[-<->]<<,]>' + '>+<[>-<[-]>>' + set(code(e)) + '.[-]<<]>[>' + set(code(o)) + '.[-]<-]';
  return { q: sentence(lead(), q), code: body, f: (x) => (x.length % 2 ? o : e), inputs: ['', 'a', 'ab', 'abc', randomInput(LOWER, 9, 1)] };
};

F.replace = () => {
  const from = pick([' ', '.', ',', 'a', 'e', '-']), to = pick(['_', '*', '#', '+', '-', '.']);
  if (from === to) return null;
  const q = `Print the input with every ${name(from, true)} replaced by ${name(to)}. All other characters stay as they are.`;
  const body = ',[' + set(-code(from)) + '>+<[' + set(code(from)) + '.[-]>-<]>[>' + set(code(to)) + '.[-]<-]<,]';
  const al = 'bcdxyz' + from + from;
  return { q: sentence(lead(), q), code: body, f: (x) => x.split(from).join(to), inputs: ['', from, randomInput(al, 9, 1), randomInput(al, 6, 1)] };
};

F.remove = () => {
  const ch = pick(['.', ',', 'a', 'e', '-', '!', 'x']);
  const q = `Print the input without its ${name(ch, true)} characters.`;
  const al = 'bcdyz ' + ch + ch;
  return { q: sentence(lead(), q), code: ',[' + set(-code(ch)) + '[' + set(code(ch)) + '.[-]],]', f: (x) => x.split(ch).join(''), inputs: ['', ch, randomInput(al, 9, 1), randomInput(al, 6, 1)] };
};

// ---- skills that take more than one cell or a loop of loops
// divmod: n d 0 0 -> 0 d-n%d n%d n/d
const DM = '[->-[>+>>]>[+[-<+>]>+>>]<<<<<]';
// the cell (0..255) in decimal without leading zeros; needs the 9 cells to its right zero, leaves them zero
const PRINTNUM = '>' + set(10) + '<' + DM + '>[-]>>>' + set(10) + '<' + DM + '>[-]>>[' + set(48) + '.[-]>+<]' +
  '<[->>>+>+<<<<]>>>>[-<<<<+>>>>]<[[-]<+>]<[<<' + set(48) + '.[-]>>[-]]<<<<<' + set(48) + '.[-]<<';
const TWO = ',' + set(-48) + '>,' + set(-48) + '<';                     // two digits as numbers in cells 0 and 1
const MUL = '[->[->+>+<<]>>[-<<+>>]<<<]>[-]>';                         // cell 0 times cell 1 into cell 2
const DIGIT_PAIRS = Array.from({ length: 100 }, (_, i) => String(i).padStart(2, '0'));
const somePairs = (ok) => { const all = DIGIT_PAIRS.filter(ok); return Array.from({ length: 6 }, () => pick(all)); };

F.lastChar = () => {
  const q = pick(['Print only the last character of the input. If the input is empty, print nothing.', 'Print the last character of the input, or nothing for an empty input.', 'Read the whole input and print its last character (nothing if it is empty).']);
  return { q: sentence(lead(), q), code: '>,[>,]<[.[-]]', f: (x) => x.slice(-1), inputs: ['', 'a', 'hello', randomInput(PRINTABLE, 9, 1)] };
};

F.lengthDigit = () => {
  const k = int(5, 9);
  const q = pick([`The input has at most ${k} characters. Print how many there are, as one digit.`, `Print the length of the input as a single digit. It has at most ${k} characters.`]);
  return { q: sentence(lead(), q), code: ',[>+<,]>' + set(48) + '.', f: (x) => String(x.length), inputs: ['', 'a', randomInput(LOWER, k, 1), randomInput(PRINTABLE, k, 1)] };
};

F.lengthNumber = () => {
  const q = pick(['Print the number of characters in the input in ordinary digits. The input has at most 255 characters and can be empty.', 'Count the characters of the input and print the count in decimal (at most 255).']);
  return { q: sentence(lead(), q), code: ',[>+<,]>' + PRINTNUM, f: (x) => String(x.length), inputs: ['', 'abc', 'x'.repeat(int(10, 99)), 'y'.repeat(int(100, 255))] };
};

F.twoDigits = () => {
  const op = pick(['+', '-', '*', 'max']);
  if (op === '+') return { q: sentence(lead(), pick(['Read two digits and print their sum, which is never more than 9.', 'Add the two digits of the input and print the result (at most 9).'])), code: ',>,[<+>-]<' + set(-48) + '.', f: (x) => String(+x[0] + +x[1]), inputs: somePairs((p) => +p[0] + +p[1] <= 9) };
  if (op === '-') return { q: sentence(lead(), pick(['Read two digits. The first is never smaller than the second. Print the first minus the second.', 'Subtract the second digit of the input from the first and print the result; it is never negative.'])), code: ',>,[<->-]<' + set(48) + '.', f: (x) => String(+x[0] - +x[1]), inputs: somePairs((p) => +p[0] >= +p[1]) };
  if (op === '*') return { q: sentence(lead(), pick(['Read two digits and print their product, which is never more than 9.', 'Multiply the two digits of the input and print the product (at most 9).'])), code: TWO + MUL + set(48) + '.', f: (x) => String(+x[0] * +x[1]), inputs: somePairs((p) => +p[0] * +p[1] <= 9) };
  const body = TWO + '[->>>>+>+<<<<<]>>>>>[-<<<<<+>>>>>]<<<<<' + '[->[->+>+<<]>>[-<<+>>]<[[-]<->]<<]' + '>[->>>+<<<]>>>' + set(48) + '.';
  return { q: sentence(lead(), pick(['Read two digits and print the larger of the two. If they are equal, print that digit once.', 'Print the bigger of the two digits in the input.'])), code: body, f: (x) => String(Math.max(+x[0], +x[1])), inputs: somePairs(() => true) };
};

F.productNumber = () => {
  const q = pick(['Read two digits and print their product in ordinary digits: 67 gives 42.', 'Multiply the two digits of the input and print the product in decimal, which can have two digits.']);
  return { q: sentence(lead(), q), code: TWO + MUL + PRINTNUM, f: (x) => String(+x[0] * +x[1]), inputs: somePairs(() => true) };
};

F.divide = () => {
  const k = int(2, 5);
  const q = k === 2 ? pick(['Read one digit and print half of it, rounded down.', 'Halve the digit in the input, rounding down, and print it.']) : `Read one digit and print it divided by ${k}, rounded down.`;
  return { q: sentence(lead(), q), code: ',' + set(-48) + '>' + set(k) + '<' + DM + '>>>' + set(48) + '.', f: (x) => String(Math.floor(+x / k)), inputs: [...DIGITS] };
};

F.charCode = () => {
  const q = pick(['Read one character and print its number in ordinary digits: A gives 65. If the input is empty, print 0.', 'Print the ASCII code of the character in the input, in decimal (0 for an empty input).']);
  return { q: sentence(lead(), q), code: ',' + PRINTNUM, f: (x) => String(x ? code(x) : 0), inputs: ['', 'A', ' ', pick(PRINTABLE), pick(LOWER)] };
};

F.readNumber = () => {
  const q = pick(['The input is a number from 32 to 126, written in digits. Print the character with that number.', 'Read a number in decimal digits and print the character with that ASCII code (32 to 126).']);
  return { q: sentence(lead(), q), code: '>,[' + set(-48) + '<[->++++++++++<]>[-<+>],]<.', f: (x) => String.fromCharCode(+x), inputs: Array.from({ length: 5 }, () => String(int(32, 126))) };
};

F.countDown = () => {
  const q = pick(['Read one digit and count down from it to 0.', 'Read a digit and print the digits from it down to 0: 3 gives 3210.']);
  return { q: sentence(lead(), q), code: ',[->+>+<<]>>' + set(-47) + '[<.->-]', f: (x) => [...DIGITS.slice(0, +x + 1)].reverse().join(''), inputs: ['0', '3', '9', pick(DIGITS)] };
};

F.rotate = () => {
  const q = pick(['The input is made of small letters a to z only. Replace every letter by the next one in the alphabet, and z by a.', 'Move every small letter of the input one place on in the alphabet, z going round to a.']);
  return { q: sentence(lead(), q) + pick(EMPTY_OK), code: ',[' + set(-122) + '>+<[' + set(123) + '.[-]>-<]>[>' + set(97) + '.[-]<-]<,]', f: (x) => [...x].map((c) => (c === 'z' ? 'a' : String.fromCharCode(code(c) + 1))).join(''), inputs: ['', 'z', 'buzz', randomInput(LOWER, 8, 1)] };
};

F.noPlus = () => {
  const ch = pick(UPPER + LOWER + DIGITS + '!?*');
  const q = `Print ${name(ch)} without using the command + anywhere.`;
  return { q: sentence(lead(), q) + pick(NO_INPUT), code: set(code(ch) - 256) + '.', f: () => ch, inputs: [''] };
};

F.balanced = () => {
  const [y, n] = pick([['Y', 'N'], ['Y', 'N'], ['1', '0'], ['T', 'F']]);
  const q = `The input is made of the characters [ and ] only. Print ${name(y)} if the brackets match, and ${name(n)} if they do not.`;
  const body = ',[' + set(-91) + '>>>+<<<[[-]>>>-<<' + '[->>>+>+<<<<]>>>>[-<<<<+>>>>]<' + '>>+<<' + '[[-]<<<->>>>>-<<]' + '>>[-<<<<+>>>>]' + '<<<<<<]' +
    '>>>[-<<+>>]<<<,]' + '>>[-<+>]<' + '>+<[>-<[-]>>' + set(code(n)) + '.[-]<<]>[>' + set(code(y)) + '.[-]<-]';
  const ok = (x) => { let d = 0; for (const c of x) { d += c === '[' ? 1 : -1; if (d < 0) return false; } return d === 0; };
  const r = () => Array.from({ length: int(0, 10) }, () => pick('[]')).join('');
  return { q: sentence(lead(), q), code: body, f: (x) => (ok(x) ? y : n), inputs: ['', '[]', '][', '[[]]', '[', r(), r(), r()] };
};

// ---- tasks made of parts: the program is put together from pieces, and so is the question
const ordinal = (k) => (Math.abs(k) === 1 ? 'one place' : `${count(Math.abs(k))} places`);
const shiftWords = (k) => (k === -32 ? 'in capitals' : k === 32 ? 'as small letters' : `${ordinal(k)} ${k > 0 ? 'later' : 'earlier'} in the ASCII table`);

F.perChar = () => {
  const o = { drop: null, k: 0, n: 1, before: null, after: null };
  const parts = [];
  if (chance(0.4)) o.drop = pick([' ', ',', '.', 'a', 'e', '-', '!']);
  if (chance(0.45)) o.k = pick([1, 2, 3, -1, -2, -32, -32, 32]);
  if (chance(0.4)) o.n = int(2, 3);
  if (chance(0.5)) { const s = pick([' ', ' ', '\n', '\n', ',', '-', '.', '*', '|']); if (chance(0.7)) o.after = s; else o.before = s; }
  if (!o.drop && !o.k && o.n === 1 && !o.before && !o.after) return null;
  if (o.k === -32 && o.drop && /[a-z]/.test(o.drop)) return null;
  let body = set(o.k) + (o.before ? '>' + set(code(o.before)) + '.[-]<' : '') + '.'.repeat(o.n) + (o.after ? '>' + set(code(o.after)) + '.[-]<' : '');
  const program = o.drop ? ',[' + set(-code(o.drop)) + '[' + set(code(o.drop)) + body + '[-]],]' : ',[' + body + ',]';
  // the question: one clause per part
  let q = pick(['Print every character of the input', 'Print each character of the input', 'Go through the input and print every character', 'For every character of the input, print it']);
  if (o.drop) parts.push(pick([`except the ${name(o.drop, true)} characters`, `but leave out every ${name(o.drop, true)}`, `skipping every ${name(o.drop, true)}`]));
  if (o.k) parts.push(shiftWords(o.k));
  if (o.n > 1) parts.push(times(o.n));
  if (o.after === '\n' && !o.before) parts.push(pick(['each on its own line', 'with a line break after each one']));
  else if (o.after) parts.push(pick([`each followed by ${name(o.after)}`, `with ${name(o.after)} after each one`]));
  if (o.before) parts.push(pick([`each after ${name(o.before)}`, `with ${name(o.before)} before each one`]));
  q += (parts.length ? ' ' + parts.join(', ') : '') + '.';
  const al = o.k === -32 ? LOWER + (o.drop && !/[a-z]/.test(o.drop) ? o.drop : '') : o.k === 32 ? UPPER : LOWER.slice(3, 23) + ' ,.' + (o.drop || '');
  if (o.k === -32) q += ' The input is made of small letters' + (o.drop && !/[a-z]/.test(o.drop) ? ` and ${name(o.drop, true)}s` : '') + ' only.';
  if (o.k === 32) q += ' The input is made of capital letters only.';
  const f = (x) => [...x].filter((c) => c !== o.drop).map((c) => (o.before || '') + String.fromCharCode(code(c) + o.k).repeat(o.n) + (o.after || '')).join('');
  return { q: sentence(lead(), q) + pick(EMPTY_OK), code: program, f, inputs: ['', pick(al), randomInput(al, 8, 1), randomInput(al, 5, 1)] };
};

// the whole input first, then phases; every phase starts and ends on the empty cell after the input
F.phases = () => {
  const n = int(2, 4), steps = [];
  let usesInput = false, caps = false, len = false;
  for (let i = 0; i < n; i++) {
    const r = rnd();
    if (i === n - 1 && !len && r < 0.25) { steps.push(['len']); len = true; usesInput = true; continue; }
    if (r < 0.3) { const t = pick(['-', '!', '?', ' ', ': ', '|', '=', '>', '<', '.', '; ', ' / ', '()', '[]', randomText(4)]); if (steps.length && steps[steps.length - 1][0] === 'text') continue; steps.push(['text', t]); continue; }
    const k = chance(0.25) ? pick([-32, 1]) : 0;
    if (k === -32) caps = true;
    steps.push([chance(0.5) ? 'fwd' : 'back', k]); usesInput = true;
  }
  if (!usesInput || steps.length < 2) return null;
  const PH = {
    fwd: (k) => '<[<]>[' + set(k) + '.' + set(-k) + '>]',
    back: (k) => '<[' + set(k) + '.' + set(-k) + '<]>[>]',
    text: (s) => printText(s) + '[-]',
    len: () => '<[[-]>[-<+>]<+<]>' + set(48) + '.',
  };
  const program = '>,[>,]' + steps.map(([p, a]) => PH[p](a)).join('');
  const sh = (s, k) => [...s].map((c) => String.fromCharCode(code(c) + k)).join('');
  const f = (x) => steps.map(([p, a]) => (p === 'fwd' ? sh(x, a) : p === 'back' ? sh([...x].reverse().join(''), a) : p === 'text' ? a : String(x.length))).join('');
  const said = steps.map(([p, a]) => {
    const tail = a === -32 ? ' in capitals' : a === 1 ? ', every character one place on in the ASCII table' : '';
    if (p === 'fwd') return pick(['the input', 'the input as it is', 'the whole input']) + tail;
    if (p === 'back') return pick(['the input backwards', 'the input reversed', 'the input from last to first']) + tail;
    if (p === 'text') return pick([`\`${a}\``, `"${a}"`]);
    return pick(['its length as one digit', 'the number of characters as a digit']);
  });
  const joins = [', then ', ', followed by ', ', and then ', ' and after that '];
  let q = pick(['Print ', 'Print ', 'Output ']) + said.map((s, i) => (i ? pick(joins) : '') + s).join('') + '.';
  if (caps) q += ' The input is made of small letters only.';
  if (len) q += ' It has at most 9 characters.';
  q += ' It never holds the character 0.';
  const al = caps ? LOWER : LOWER + DIGITS + ' !';
  return { q: sentence(lead(), q) + pick(EMPTY_OK), code: program, f, inputs: ['', pick(al), randomInput(al, len ? 9 : 8, 1), randomInput(al, 5, 1)] };
};

// ---- rewording: another verb, or "a program that ..."
const VERB = { Print: 'prints', Read: 'reads', Copy: 'copies', Reverse: 'reverses', Count: 'counts', Swap: 'swaps', Add: 'adds', Multiply: 'multiplies', Subtract: 'subtracts',
  Convert: 'converts', Halve: 'halves', Move: 'moves', Repeat: 'repeats', Echo: 'echoes', Make: 'makes', Replace: 'replaces', Output: 'outputs', Go: 'goes', For: null, Behave: 'behaves', The: null };
const SAME = { Print: ['Output', 'Show', 'Display', 'Write out', 'Produce'], Read: ['Take', 'Read in'], Copy: ['Echo'], Reverse: ['Flip'], Count: ['Tally'] };
function reword(q) {
  const m = /^([A-Z][a-z]+) /.exec(q);
  if (!m || !(m[1] in VERB)) return q;
  const r = rnd();
  if (r < 0.4 && SAME[m[1]]) return pick(SAME[m[1]]) + q.slice(m[1].length);
  if (r < 0.8 && VERB[m[1]]) {
    // later verbs of the first sentence follow: 'reads one digit and counts down'
    const rest = q.slice(m[1].length).replace(/^([^.]*)/, (first) => first.replace(/(and|then) ([a-z]+)/g, (w, j, v) => { const V = VERB[v[0].toUpperCase() + v.slice(1)]; return V ? j + ' ' + V : w; }));
    return pick(['Write a program that ', 'Make a program that ', 'I need a program that ', 'Create a brainfuck program that ', 'Code that ', 'A program that ']) + VERB[m[1]] + rest;
  }
  return q[0].toLowerCase() + q.slice(1).replace(/\.$/, '');
}
const WEIGHT = { perChar: 4, phases: 4 };

// ---- making and checking examples
// The questions of blind.js (the test) and check.js (snapshot choice) are never used.
const BLIND = new Set([...require('./blind').BLIND, ...require('./check').CHECK].map((t) => t.question.toLowerCase()));
function check(ex) {
  for (const input of ex.inputs) {
    const r = BF.run(ex.code, { input, bits: 8, eof: 0 });
    if (r.status !== 'ok' || r.out !== ex.f(input)) return `on ${JSON.stringify(input)} it printed ${JSON.stringify(r.out)} (${r.status}), expected ${JSON.stringify(ex.f(input))}`;
  }
  return null;
}

// Equal counts per family (more for those in WEIGHT); a family with few wordings repeats them.
function make(n, families, skip = new Set()) {
  const out = [], names = Object.keys(families), total = names.reduce((t, f) => t + (WEIGHT[f] || 1), 0);
  for (const fam of names) {
    const each = Math.ceil(n * (WEIGHT[fam] || 1) / total);
    const rows = [], seen = new Set();
    for (let tries = 0; rows.length < each && tries < each * 30; tries++) {
      const ex = families[fam]();
      if (ex && chance(0.45)) ex.q = reword(ex.q);
      if (!ex || Buffer.byteLength(ex.q) > MAX_QUESTION || BLIND.has(ex.q.toLowerCase())) continue;
      const bad = check(ex);
      if (bad) throw new Error(`family ${fam}: ${ex.q}\n${ex.code}\n${bad}`);
      const key = ex.q + '\u0000' + ex.code;
      if (seen.has(key) || skip.has(key)) continue;
      seen.add(key);
      rows.push({ family: fam, question: ex.q, code: ex.code });
    }
    for (let i = 0, k = rows.length; rows.length < each && k > 0; i++) rows.push(rows[i % k]);
    out.push(...rows);
  }
  for (let i = out.length - 1; i > 0; i--) { const j = int(0, i); [out[i], out[j]] = [out[j], out[i]]; }
  return out.slice(0, n);
}

if (require.main === module) {
  const n = +(process.argv[2] || 160000);
  seed = +(process.argv[3] || 1);
  fs.mkdirSync(OUT, { recursive: true });
  const train = make(n, F);
  seed = 777;
  const keys = new Set(train.map((e) => e.question + '\u0000' + e.code));
  const test = [...new Map(make(1400, F, keys).map((e) => [e.question + '\u0000' + e.code, e])).values()];
  const write = (file, rows) => fs.writeFileSync(path.join(OUT, file), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  write('train.jsonl', train);
  write('test.jsonl', test);
  const per = {};
  for (const e of train) per[e.family] = (per[e.family] || 0) + 1;
  console.log(`${train.length} training examples, ${test.length} test examples, ${Object.keys(F).length} families, all checked`);
  console.log(Object.entries(per).map(([k, v]) => `${k} ${v}`).join(', '));
  for (let i = 0; i < 6; i++) console.log(`  ${JSON.stringify(train[i].question)}\n    ${train[i].code}`);
}

module.exports = { F, make, check };
