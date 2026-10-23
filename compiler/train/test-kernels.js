'use strict';

// Every building block of kernels.js against what it means in JavaScript, on random and edge values.
// node compiler/train/test-kernels.js

const { Kernels } = require('./kernels');
const { runBF } = require('./run');
const { lcg, RECIP, LN } = require('./spec');
const { switchOn } = require('../core/switch');

let failed = 0;
const ok = (good, name, extra = '') => { console.log(`${good ? 'ok  ' : 'FAIL'}  ${name} ${extra}`); if (!good) { failed++; process.exitCode = 1; } };

let seed = 12345;
const rnd = (lo, hi) => { seed = lcg(seed); return lo + Math.floor(((seed >>> 0) / 2 ** 32) * (hi - lo + 1)); };

// Run many cases in one program, case i on the cells from 64 * i + 2: setup(e, base, case) writes its code;
// case.want holds the expected [offset, value] pairs, every other cell must end 0.
function batch(name, cases, setup, { output = null } = {}) {
  const e = new Kernels(), W = 64;
  cases.forEach((c, i) => setup(e, W * i + 2, c));
  const r = runBF(e.toString(), { tapeSize: W * cases.length + 64 });
  let bad = null;
  cases.forEach((c, i) => {
    for (const [off, v] of c.want) if (!bad && r.tape[W * i + 2 + off] !== (v | 0)) bad = `case ${JSON.stringify(c.args)}: cell ${off} is ${r.tape[W * i + 2 + off]}, wanted ${v}`;
    for (let k = 0; k < W && !bad; k++) {
      if (!c.want.some(([o]) => o === k) && r.tape[W * i + 2 + k] !== 0) bad = `case ${JSON.stringify(c.args)}: cell ${k} left ${r.tape[W * i + 2 + k]}`;
    }
  });
  if (output !== null && !bad && r.text !== output) bad = `printed ${JSON.stringify(r.text)}, wanted ${JSON.stringify(output)}`;
  ok(!bad, `${name}: ${cases.length} cases, ${e.toString().length.toLocaleString('en-US')} characters`, bad || '');
}

const S = (b) => [...Array(10)].map((_, i) => b + 10 + i);

// shift: Y = lo + clamp/mod(floor((X + addend) / 2^k) - lo)
for (const clamp of [false, true]) {
  const cases = [];
  const specs = clamp
    ? [[9, 8, -128, 256], [17, 8, -128, 65536], [10, 8, -128, 512], [8, 1, 0, 0], [6, 24, 0, 32]]
    : [[7, 24, -(2 ** 23), 64], [14, 17, 0, 8192], [17, 14, -8192, 0], [21, 10, 0, 0], [19, 1, 0, 2 ** 19], [8, 1, 0, 255], [7, 12, 0, 0], [3, 15, -(2 ** 14), 4]];
  for (const [k, n, lo, addend] of specs) {
    const xs = [0, 1, -1, 2 ** 29, -(2 ** 29), 2 ** (k + n - 1), -(2 ** (k + n - 1))];
    for (let i = 0; i < 12; i++) xs.push(rnd(-(2 ** 29), 2 ** 29));
    for (let i = 0; i < 12; i++) xs.push(rnd(lo * 2 ** k - 4, (lo + 2 ** n) * 2 ** k + 4));
    for (const x of xs) {
      let y;
      if (clamp) y = Math.max(lo, Math.min(lo + 2 ** n - 1, Math.floor((x + addend) / 2 ** k)));
      else { const f = Math.floor((x + addend) / 2 ** k) - lo; y = lo + (((f % 2 ** n) + 2 ** n) % 2 ** n); }
      if (!clamp && (x + addend - lo * 2 ** k >= 2 ** 31 || x + addend - lo * 2 ** k < -(2 ** 31))) continue;
      cases.push({ args: { x, k, n, lo, addend }, want: [[1, y]], x, k, n, lo, addend });
    }
  }
  batch(`shift (${clamp ? 'clamped' : 'modulo 2^n'})`, cases, (e, b, c) => {
    e.addBig(b, c.x, [b + 30, b + 31]);
    e.shift(b, b + 1, c.k, c.n, { lo: c.lo, addend: c.addend, clamp }, S(b));
  });
}

// mulAcc: acc += a * b for two pairs, a nb-bit signed
for (const nb of [8, 9, 11, 14, 16]) {
  const cases = [];
  for (let i = 0; i < 30; i++) {
    const a = i === 0 ? -(2 ** (nb - 1)) : i === 1 ? 2 ** (nb - 1) - 1 : rnd(-(2 ** (nb - 1)), 2 ** (nb - 1) - 1);
    const lim = Math.floor(2 ** 29 / 2 ** nb);
    const b1 = rnd(-lim, lim), b2 = rnd(-lim, lim), acc = rnd(-1000, 1000);
    cases.push({ args: { a, b1, b2 }, want: [[0, a], [1, b1], [2, b2], [3, acc + a * b1], [4, a * b2]], a, b1, b2, acc });
  }
  batch(`mulAcc nb=${nb}`, cases, (e, b, c) => {
    e.addBig(b, c.a, [b + 30, b + 31]).addBig(b + 1, c.b1, [b + 30, b + 31]).addBig(b + 2, c.b2, [b + 30, b + 31]).addBig(b + 3, c.acc, [b + 30, b + 31]);
    e.mulAcc(b, nb, [[b + 1, b + 3, b + 5], [b + 2, b + 4, b + 6]], [b + 10, b + 11, b + 12, b + 13, b + 14, b + 15, b + 16, b + 17]);
  });
}

// lookupAll: two tables at once, 8 and 12 bits
for (const n of [8, 12]) {
  const T1 = [...Array(2 ** n)].map(() => rnd(-70000, 70000)), T2 = [...Array(2 ** n)].map(() => rnd(0, 30));
  const cases = [];
  for (let i = 0; i < 25; i++) {
    const x = i < 2 ? [0, 2 ** n - 1][i] : rnd(-(2 ** (n - 1)), 2 ** n - 1);
    const idx = ((x % 2 ** n) + 2 ** n) % 2 ** n;
    cases.push({ args: { x }, want: [[0, x], [1, T1[idx]], [2, 5 + T2[idx]]], x });
  }
  batch(`lookupAll n=${n}`, cases, (e, b, c) => {
    e.addBig(b, c.x, [b + 30, b + 31]).add(b + 2, 5);
    e.lookupAll(b, [[b + 1, T1], [b + 2, T2]], [b + 10, b + 11, b + 12, b + 13, b + 14, b + 15, b + 16, b + 17, b + 18]);
  });
}

// lcg, addPow, switchOn
{
  const cases = [];
  for (let i = 0; i < 20; i++) { const x = i ? rnd(-(2 ** 31), 2 ** 31 - 1) : 0; cases.push({ args: { x }, want: [[0, lcg(lcg(x))]], x }); }
  batch('lcg (two steps)', cases, (e, b, c) => { e.addBig(b, c.x, [b + 30, b + 31]); e.lcg(b, [b + 1, b + 2]).lcg(b, [b + 1, b + 2]); });
}
{
  const cases = [];
  for (const e2 of [0, 3, 8, 9, 13, 17, 28, 30]) for (const sg of [1, -1]) cases.push({ args: { e2, sg }, want: [[0, 77 + sg * 2 ** e2]], e2, sg });
  batch('addPow', cases, (e, b, c) => { e.add(b, 77).addPow(b, c.e2, c.sg, [b + 1, b + 2]); });
}
{
  const cases = [];
  for (const ch of [10, 97, 98, 120, 122, 0, 50]) cases.push({ args: { ch }, want: [[1, ch === 10 ? 1 : ch >= 97 ? ch - 96 + 1 : 99]], ch });
  batch('switchOn', cases, (e, b, c) => {
    e.add(b, c.ch);
    const cs = [[10, () => e.add(b + 1, 1)]];
    for (let t = 1; t <= 26; t++) cs.push([96 + t, () => e.add(b + 1, t + 1)]);
    switchOn(e, b, b + 2, cs, b + 3, { otherwise: () => e.add(b + 1, 99) });
  });
}
// chainAll: the reciprocal and log tables from 128 on
{
  const cases = [];
  for (const x of [128, 129, 191, 192, 193, 200, 255, 256, 1000, 1023, 1024, 3455, 3456, 4095]) cases.push({ args: { x }, want: [[0, x], [1, RECIP[Math.min(x, 4095)]], [2, 3 + LN[Math.min(x, 4095)]]], x });
  batch('chainAll', cases, (e, b, c) => {
    e.addBig(b, c.x, [b + 30, b + 31]).add(b + 2, 3);
    e.chainAll(b, [[b + 1, RECIP], [b + 2, LN]], 128, [...Array(16)].map((_, i) => b + 10 + i));
  });
}

// printing: numbers and text
{
  const nums = [0, 7, 10, 99, 100, 1234, 30000, 65535, 99999];
  const losses = [0, 5, 3296, 2271, 10, 999, 1000];
  const cases = [...nums.map((v) => ({ args: { v }, want: [], v })), ...losses.map((v) => ({ args: { v, point: true }, want: [], v, point: true }))];
  const out = [...nums.map((v) => `${v} `), ...losses.map((v) => `${Math.floor(v / 1000)}.${String(v % 1000).padStart(3, '0')} `)].join('') + 'step 12 loss\n+++++++++>>>>>>>>>>>>[-]';
  batch('printNumber and printText', cases, (e, b, c) => {
    e.addBig(b, c.v, [b + 30, b + 31]);
    e.printNumber(b, c.point ? 4 : 5, [b + 10, b + 11, b + 12, b + 13, b + 14], [b + 20, b + 21, b + 22], { point: !!c.point });
    e.printText(' ', b + 25, b + 26, b + 27);
    if (c === cases[cases.length - 1]) e.printText('step 12 loss\n+++++++++>>>>>>>>>>>>[-]', b + 25, b + 26, b + 27);
  }, { output: out });
}

console.log(failed ? `${failed} FAILED` : 'all ok');
