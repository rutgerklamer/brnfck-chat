// Every pattern of the library, once.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PatData = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- small helpers ---------------------------------------------------------------------
  const rep = (c, n) => c.repeat(Math.max(0, n));
  const pm = (n) => (n >= 0 ? rep('+', n) : rep('-', -n));
  const range = (n, f = (i) => i) => Array.from({ length: n }, (_, i) => f(i));
  const num = (id, label, min, max, def, extra) => Object.assign({ id, label, min, max, def }, extra || {});
  const WIDE = { hi: { 16: 65535, 32: 100000 } };
  const utf8 = (s) => { const o = []; for (const ch of unescape(encodeURIComponent(String(s)))) o.push(ch.charCodeAt(0)); return o; };
  const cells = (from, arr, step = 1) => { const o = {}; arr.forEach((v, i) => { if (v) o[from + i * step] = v; }); return o; };
  const names = (from, arr) => { const o = {}; arr.forEach((v, i) => { if (v !== null) o[from + i] = v; }); return o; };
  const B = (x) => (x ? 1 : 0);
  const PG = (G, bits) => { const p = new G.Patterns(bits === 32 ? 32 : 16); p.B = bits; return p; };
  const powmod = (x, y, bits) => { let r = 1n; const m = 1n << BigInt(bits); for (let i = 0; i < y; i++) r = (r * BigInt(x)) % m; return Number(r); };

  // ---- generators that are part of a pattern ------------------------------------------------
  function constCode(n) {
    let best = rep('+', n);
    for (let a = 2; a <= 60; a++) for (let b = 2; b <= 60; b++) {
      const r = n - a * b;
      if (Math.abs(r) > 12) continue;
      const s = '>' + rep('+', a) + '[-<' + rep('+', b) + '>]<' + pm(r);
      if (s.length < best.length) best = s;
    }
    return best;
  }
  // Print a text three ways.
  function printFromZero(text) { return utf8(text).map((c) => rep('+', c) + '.[-]').join(''); }
  function printDelta(text) { let prev = 0, s = ''; for (const c of utf8(text)) { s += pm(c - prev) + '.'; prev = c; } return s; }
  function printSeeded(text) {
    const codes = utf8(text);
    if (!codes.length) return { code: '', ptr: 0, vals: [0] };
    let best = null;
    for (let step = 7; step <= 16; step++) {
      let seeds = [...new Set(codes.map((c) => Math.round(c / step)))].filter((x) => x > 0).sort((a, b) => a - b);
      if (!seeds.length) seeds = [1];
      let s = rep('+', step) + '[' + seeds.map((k) => '>' + rep('+', k)).join('') + rep('<', seeds.length) + '-]';
      const vals = [0, ...seeds.map((k) => k * step)];
      let p = 0;
      for (const c of codes) {
        let bi = 1, bc = Infinity;
        for (let i = 1; i < vals.length; i++) { const cost = Math.abs(i - p) + Math.abs(c - vals[i]); if (cost < bc) { bc = cost; bi = i; } }
        s += rep(bi > p ? '>' : '<', Math.abs(bi - p)) + pm(c - vals[bi]) + '.';
        p = bi; vals[bi] = c;
      }
      if (!best || s.length < best.code.length) best = { code: s, ptr: p, vals };
    }
    return best;
  }
  function writeDigits(values) {
    const K = values.length, T = 1, planes = 3;
    const out = []; let ptr = 0;
    const to = (a) => { out.push(rep(a > ptr ? '>' : '<', Math.abs(a - ptr))); ptr = a; };
    const add = (a, n) => { to(a); out.push(pm(n)); };
    const digits = values.map((v) => {
      const d0 = ((v + 2) % 5) - 2, r = (v - d0) / 5, d1 = ((r + 2) % 5) - 2, top = (r - d1) / 5;
      return [top - 1, d1, d0];
    });
    for (let i = 0; i < K; i++) add(T + planes + i, 1);
    for (let pl = 0; pl < planes; pl++) {
      const s0 = T + planes - pl;
      for (let i = K - 1; i >= 0; i--) add(s0 + i, digits[i][pl]);
      to(s0); out.push('[[-<' + (pl < planes - 1 ? '+++++' : '+') + '>]>]');
      ptr = s0 + K;
    }
    return { code: out.join(''), ptr, digits };
  }
  // The bits of a number by halving it eight times (the naive way, for the bit peel page).
  function bitsByHalving() {
    let s = '';
    for (let j = 0; j < 8; j++) {
      s += '>++>+<<[->-[>+>>]>[[-<+>]+>+>>]<<<<<]>[-]>-';
      s += '[-' + rep('>', 5 + j) + '+' + rep('<', 5 + j) + ']>[-<<<+>>>]<<<';
    }
    return s;
  }
  const DIV = '[->-[>+>>]>[[-<+>]+>+>>]<<<<<]';        // the divmod loop that works for every divisor
  const SAT = '[->>+<[->-]>[<<[-]>>->]<<<]';           // y = max(y - x, 0), x is used up

  const lookupTable = (size) => range(size, (i) => i * i);
  const argmaxRef = (a) => { let b = 0; a.forEach((v, i) => { if (v > a[b]) b = i; }); return b; };
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

  const SRC = {
    esoAlg: { name: 'Esolang wiki: Brainfuck algorithms', url: 'https://esolangs.org/wiki/Brainfuck_algorithms' },
    esoConst: { name: 'Esolang wiki: Brainfuck constants', url: 'https://esolangs.org/wiki/Brainfuck_constants' },
    project: { name: 'This project: emit.js and patterns.js', url: '../how/' },
  };
  const src = (s, note) => Object.assign({}, s, { note });

  const GROUPS = [
    { id: 'basics', name: 'First moves', want: 'I want to put a value somewhere' },
    { id: 'control', name: 'Control', want: 'I want to decide or repeat' },
    { id: 'arithmetic', name: 'Arithmetic', want: 'I want to calculate' },
    { id: 'data', name: 'Data', want: 'I want to keep many values' },
    { id: 'io', name: 'Input and output', want: 'I want to read or print' },
    { id: 'advanced', name: 'Advanced: wrapping cells of a known width', want: 'I want it to be fast on large numbers' },
  ];

  const P = [];

  P.push({
    id: 'clear', group: 'basics', name: 'Set a cell to zero', key: 'zero reset empty clear',
    does: 'Empties the cell under the pointer, whatever it held.',
    why: [
      'The loop takes 1 from the cell and asks "is it zero?". It goes round until the answer is yes.',
      'So the plain cost grows with the value: two steps for every unit. An optimising interpreter sees a loop that only counts its own cell down and sets the cell to zero in one step.',
    ],
    needs: ['Any cell size. No scratch cells. The pointer does not move.', 'On cells that do not wrap, the value must not be negative, or <code class="bf">[-]</code> never ends.'],
    mistakes: ['Forgetting it before a "set to a constant". <code class="bf">+++</code> adds 3, it does not set 3.', 'Clearing a cell that is known to be zero already. It is harmless, but it is one more step every time.', 'Using <code class="bf">[+]</code> on wide cells: it counts up to the top, which takes billions of plain steps on 32-bit cells.'],
    used: ['Inside almost every other pattern, for example <a href="if-nonzero.html">if non-zero</a>.', '<a href="../challenges/basics/04-loops.html#s2">Brainfuck basics, lesson 4, "Loops"</a>, has you empty a cell this way, in its section "Empty a cell".'],
    sources: [src(SRC.esoAlg, 'section "x = 0"')],
    variants: [
      { id: 'minus', name: 'Count down', does: 'The usual form.', code: '[-]', vars: [num('x', 'x', 0, 255, 5, WIDE)], labels: { 0: 'x' },
        init: (v) => ({ 0: v.x }), expect: () => ({ tape: {} }), cost: { plain: ['1 + 2x', (v) => 1 + 2 * v.x], fast: ['1', () => 1] }, table: [{ x: 0 }, { x: 5 }, { x: 255 }] },
      { id: 'plus', name: 'Count up', does: 'Counts up until the cell wraps round to zero. Needs wrapping cells.', code: '[+]', bits: [8, 16], vars: [num('x', 'x', 0, 255, 250, { hi: { 16: 65535 } })], labels: { 0: 'x' },
        init: (v) => ({ 0: v.x }), expect: () => ({ tape: {} }), cost: { plain: ['1 + 2 × (cell size − x), or 1 when x = 0', (v, b) => (v.x ? 1 + 2 * (2 ** b - v.x) : 1)], fast: ['the same: this loop is not folded', (v, b) => (v.x ? 1 + 2 * (2 ** b - v.x) : 1)] }, table: [{ x: 5 }, { x: 250 }] },
      { id: 'three', name: 'Three cells in a row', does: 'Clears a block and walks back.', code: '[-]>[-]>[-]<<', vars: [num('a', 'a', 0, 255, 4), num('b', 'b', 0, 255, 0), num('c', 'c', 0, 255, 9)], labels: { 0: 'a', 1: 'b', 2: 'c' },
        init: (v) => ({ 0: v.a, 1: v.b, 2: v.c }), expect: () => ({ tape: {} }), cost: { plain: ['7 + 2 × (a + b + c)', (v) => 7 + 2 * (v.a + v.b + v.c)], fast: ['4', () => 4] } },
    ],
  });

  P.push({
    id: 'constant', group: 'basics', name: 'Set a constant', key: 'number literal value big short',
    does: 'Puts a fixed number in a cell, in as few characters as possible.',
    why: [
      'One <code class="bf">+</code> adds one. For a large number that is a long text, so we let a loop do the adding: a rounds of b make a × b, and a few more <code class="bf">+</code> or <code class="bf">−</code> fix the rest.',
      'The loop needs a counter, so it costs one scratch cell. The text is then about 2 × √n characters long instead of n.',
      'For really large numbers (wide cells) the number is written in base 256: each byte is made small and shifted up by a loop that multiplies by 256.',
    ],
    needs: ['The target cell must be zero before, or the constant is added to what is there.', 'The loop forms need one scratch cell that is zero, and leave it zero.', 'The "wrap" form needs 8-bit wrapping cells. It gives a different number on any other size.'],
    mistakes: ['Using a short form from a table of constants without checking the cell size it was made for.', 'Counting characters only. On an optimising interpreter every form here is one to three steps; in plain steps the loop form is slower than the long row of plus signs.'],
    used: ['<a href="print-string.html">Print a constant string</a> is this pattern, once per letter.', '<a href="../challenges/basics/05-numbers.html">Brainfuck basics, lesson 5, "Building numbers"</a>, builds a number as a product. <a href="../learn/03-multiply.html">Build toward a chatbot, lesson 3, "Multiplying by a fixed number"</a>, does it for a big number, and <a href="../learn/08-size.html">Build toward a chatbot, lesson 8, "Size"</a>, shows why the length of the text matters for the chat program.', 'In the project: <code>addConst</code> in emit.js and <code>addBig</code> in patterns.js.'],
    sources: [src(SRC.esoConst, 'a table of the shortest known program for every number from 0 to 255; the wrap form here is checked against that idea, not copied'), src(SRC.project, 'the base-256 form is addBig')],
    variants: [
      { id: 'product', name: 'A product and a rest', does: 'The shortest of "n plus signs" and "a × b + rest". Cell 1 is the scratch cell.', code: (v) => constCode(v.n), consts: [num('n', 'n', 0, 255, 65, { hi: { 16: 3000, 32: 3000 } })], labels: { 0: 'n', 1: 'scratch' },
        expect: (v) => ({ tape: { 0: v.n } }), cost: { plain: ['about 2 × √n characters; plain steps grow with n', null], fast: ['3 with a loop, 1 without', null] }, table: [{ n: 10 }, { n: 65 }, { n: 100 }, { n: 255 }] },
      { id: 'plain', name: 'One plus per unit', does: 'The longest text, and the fewest plain steps.', code: (v) => rep('+', v.n), consts: [num('n', 'n', 0, 255, 65)], labels: { 0: 'n' },
        expect: (v) => ({ tape: { 0: v.n } }), cost: { plain: ['n', (v) => v.n], fast: ['1', (v) => B(v.n)] } },
      { id: 'wrap', name: 'By wrapping (8-bit cells only)', does: 'Makes 48, the code of the digit 0. It starts at 255, and 255 ÷ 5 is 51. The result is in cell 1.', code: '-[>+<-----]>---', bits: [8], labels: { 0: 'counter', 1: '48' },
        expect: () => ({ tape: { 1: 48 }, ptr: 1 }), cost: { plain: ['465', () => 465], fast: ['156', () => 156] } },
      { id: 'big', name: 'Base 256, for wide cells', does: 'One short piece per byte of the number. Cells 1 and 2 are scratch cells.', gen: true, bits: [32, 16],
        code: (v, bits, G) => { const p = PG(G, bits); p.addBig(0, v.n, [1, 2]); return { code: p.toString(), ptr: p.ptr }; },
        consts: [num('n', 'n', 0, 65535, 50000, { hi: { 32: 2000000000 } })], labels: { 0: 'n', 1: 'scratch', 2: 'scratch' }, ok: (v, bits) => v.n < 2 ** bits, okText: 'the number has to fit in the cell',
        expect: (v, bits, prog) => ({ tape: { 0: v.n }, ptr: prog.ptr }), cost: { plain: ['grows with n', null], fast: ['1 for the lowest byte, 2 for each further byte', null] }, table: [{ n: 1000 }, { n: 50000 }] },
    ],
  });

  P.push({
    id: 'move', group: 'basics', name: 'Move a value', key: 'transfer add drain',
    does: 'Adds a cell to another cell and leaves the first one empty.',
    why: [
      'Each round takes 1 from the source and gives 1 to the target. The loop stops when the source is zero, so by then everything has arrived.',
      'The target gets the value <em>added</em>. If it held 2 before, it holds 2 more than the source did.',
      'A loop like this one only adds and moves and comes back to where it started. That is called a flat loop. An optimising interpreter does it in one step.',
    ],
    needs: ['Any cell size. No scratch cell.', 'The loop must end on the cell it started on: as many <code class="bf">&gt;</code> as <code class="bf">&lt;</code>.', 'Clear the target first if you want "set", not "add".'],
    mistakes: ['Unequal numbers of <code class="bf">&gt;</code> and <code class="bf">&lt;</code>. The loop then tests a different cell every round and wanders off.', 'Expecting the source to survive. Use <a href="copy.html">copy a value</a> for that.'],
    used: ['<a href="../challenges/basics/07-copy.html">Brainfuck basics, lesson 7, "Moving and copying"</a>, teaches it first. <a href="../learn/02-copy.html">Build toward a chatbot, lesson 2, "Moving and copying"</a>, builds it step by step, starting from an empty tape.', 'In the project it is <code>move</code> in emit.js, a special case of <code>scatter</code>. Almost everything in the chat program is made of scatters.'],
    sources: [src(SRC.project, 'move and scatter in emit.js')],
    variants: [
      { id: 'right', name: 'To the next cell', does: 'y gets x added, x becomes 0.', code: '[->+<]', vars: [num('x', 'x', 0, 255, 4, WIDE), num('y', 'y', 0, 255, 0, WIDE)], labels: { 0: 'x', 1: 'y' },
        init: (v) => ({ 0: v.x, 1: v.y }), expect: (v) => ({ tape: { 1: v.x + v.y } }), cost: { plain: ['1 + 5x', (v) => 1 + 5 * v.x], fast: ['1', () => 1] }, table: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 200, y: 3 }] },
      { id: 'far', name: 'Two cells away', does: 'The same, with a longer walk. Every round pays for the distance twice.', code: '[->>+<<]', vars: [num('x', 'x', 0, 255, 4, WIDE)], labels: { 0: 'x', 1: 'other', 2: 'target' },
        init: (v) => ({ 0: v.x, 1: 7 }), expect: (v) => ({ tape: { 1: 7, 2: v.x } }), cost: { plain: ['1 + 7x', (v) => 1 + 7 * v.x], fast: ['1', () => 1] } },
      { id: 'two', name: 'Into two cells at once', does: 'Both targets get the value. This is the first half of <a href="copy.html">copy a value</a>.', code: '[->+>+<<]', vars: [num('x', 'x', 0, 255, 4, WIDE)], labels: { 0: 'x', 1: 'first', 2: 'second' },
        init: (v) => ({ 0: v.x }), expect: (v) => ({ tape: { 1: v.x, 2: v.x } }), cost: { plain: ['1 + 8x', (v) => 1 + 8 * v.x], fast: ['1', () => 1] } },
      { id: 'left', name: 'To the left', does: 'The pointer starts on the right cell.', code: '[-<+>]', start: 1, vars: [num('x', 'x', 0, 255, 4, WIDE)], labels: { 0: 'target', 1: 'x' },
        init: (v) => ({ 1: v.x }), expect: (v) => ({ tape: { 0: v.x } }), cost: { plain: ['1 + 5x', (v) => 1 + 5 * v.x], fast: ['1', () => 1] } },
    ],
  });

  P.push({
    id: 'copy', group: 'basics', name: 'Copy a value', key: 'duplicate keep source scratch',
    does: 'Adds a cell to another cell and keeps the first one.',
    why: [
      'Brainfuck can only read a cell by emptying it. So the first loop pours the value into two cells at once: the copy and a helper.',
      'The second loop pours the helper back into the original. Now the value stands in two places and the helper is empty again.',
      'A helper cell that is empty before and after is called a <b>scratch cell</b>.',
    ],
    needs: ['One scratch cell that is zero. It is zero again at the end.', 'The copy is added to the target: clear the target first if it may hold something.', 'Any cell size. The pointer ends where it started.'],
    mistakes: ['Using a scratch cell that is not empty. The original then comes back too large.', 'Forgetting the second loop. That is the form <a href="move.html#v-two">Into two cells at once</a> of <a href="move.html">move a value</a>, and the original is gone.'],
    used: ['<a href="../challenges/basics/07-copy.html#s3">Brainfuck basics, lesson 7, "Moving and copying"</a>, teaches it in its section "Keep the original". <a href="../learn/02-copy.html">Build toward a chatbot, lesson 2, "Moving and copying"</a>, teaches it again and has you change the program yourself.', 'Every "keeping the source" variation in this library is a copy first.', 'In the project: <code>copy</code> in emit.js.'],
    sources: [src(SRC.esoAlg, 'section "x = y"'), src(SRC.project, 'copy in emit.js')],
    variants: [
      { id: 'right', name: 'Scratch cell on the right', does: 'Layout: x, copy, scratch.', code: '[->+>+<<]>>[-<<+>>]<<', vars: [num('x', 'x', 0, 255, 3, WIDE)], labels: { 0: 'x', 1: 'copy', 2: 'scratch' },
        init: (v) => ({ 0: v.x }), expect: (v) => ({ tape: { 0: v.x, 1: v.x } }), cost: { plain: ['6 + 15x', (v) => 6 + 15 * v.x], fast: ['3', () => 3] }, table: [{ x: 0 }, { x: 3 }, { x: 255 }] },
      { id: 'left', name: 'Scratch cell on the left', does: 'Layout: scratch, x, copy. The pointer starts on x.', code: '[->+<<+>]<[->+<]>', start: 1, vars: [num('x', 'x', 0, 255, 3, WIDE)], labels: { 0: 'scratch', 1: 'x', 2: 'copy' },
        init: (v) => ({ 1: v.x }), expect: (v) => ({ tape: { 1: v.x, 2: v.x } }), cost: { plain: ['4 + 13x', (v) => 4 + 13 * v.x], fast: ['3', () => 3] } },
      { id: 'twice', name: 'Two copies in one pass', does: 'One loop can feed as many cells as you like.', code: '[->+>+>+<<<]>>>[-<<<+>>>]<<<', vars: [num('x', 'x', 0, 255, 3, WIDE)], labels: { 0: 'x', 1: 'copy', 2: 'copy', 3: 'scratch' },
        init: (v) => ({ 0: v.x }), expect: (v) => ({ tape: { 0: v.x, 1: v.x, 2: v.x } }), cost: { plain: ['8 + 20x', (v) => 8 + 20 * v.x], fast: ['3', () => 3] } },
    ],
  });

  P.push({
    id: 'add-sub', group: 'basics', name: 'Add and subtract two cells', key: 'plus minus sum difference',
    does: 'Adds one cell to another, or takes it off.',
    why: [
      'Adding is the pattern <a href="move.html">move a value</a>: every unit that leaves y arrives in x. Subtracting is the same loop with a <code class="bf">−</code> at the target.',
      'To keep y, the loop also feeds a scratch cell and a second loop moves that back, as in <a href="copy.html">copy a value</a>.',
      'Nothing here looks at the size of the numbers. If the sum does not fit, the cell wraps round; if the difference is negative, it wraps the other way. That is the right answer in the arithmetic of the cell.',
    ],
    needs: ['Any cell size. The "keep" forms need one scratch cell that is zero.', 'The pointer ends where it started.', 'A negative result is only meaningful on wrapping cells, read as a signed number.'],
    mistakes: ['Expecting subtraction to stop at zero. It does not: 3 − 5 is 254 on 8-bit cells. For a floor at zero use the <a href="satsub.html">saturating subtract</a>.', 'Looping on x and adding to y when you wanted the sum in x.'],
    used: ['<a href="../challenges/basics/07-copy.html#s4">Brainfuck basics, lesson 7, "Moving and copying"</a>, adds two cells in its section "Adding". <a href="../learn/03-multiply.html">Build toward a chatbot, lesson 3, "Multiplying by a fixed number"</a>, adds up products this way.', 'Every sum in the chat program is a row of these loops with a factor: see <a href="mul-const.html">multiply by a constant</a>.'],
    sources: [src(SRC.esoAlg, 'sections "x = x + y" and "x = x − y"')],
    variants: [
      { id: 'add', name: 'Add, using up y', does: 'x = x + y, y = 0.', code: '>[-<+>]<', vars: [num('x', 'x', 0, 255, 3, WIDE), num('y', 'y', 0, 255, 4, WIDE)], labels: { 0: 'x', 1: 'y' },
        init: (v) => ({ 0: v.x, 1: v.y }), expect: (v) => ({ tape: { 0: v.x + v.y } }), cost: { plain: ['3 + 5y', (v) => 3 + 5 * v.y], fast: ['2', () => 2] }, table: [{ x: 3, y: 4 }, { x: 200, y: 100 }] },
      { id: 'addkeep', name: 'Add, keeping y', does: 'x = x + y, y stays.', code: '>[-<+>>+<]>[-<+>]<<', vars: [num('x', 'x', 0, 255, 3, WIDE), num('y', 'y', 0, 255, 4, WIDE)], labels: { 0: 'x', 1: 'y', 2: 'scratch' },
        init: (v) => ({ 0: v.x, 1: v.y }), expect: (v) => ({ tape: { 0: v.x + v.y, 1: v.y } }), cost: { plain: ['6 + 13y', (v) => 6 + 13 * v.y], fast: ['3', () => 3] } },
      { id: 'sub', name: 'Subtract, using up y', does: 'x = x − y, y = 0.', code: '>[-<->]<', vars: [num('x', 'x', 0, 255, 9, WIDE), num('y', 'y', 0, 255, 4, WIDE)], labels: { 0: 'x', 1: 'y' },
        init: (v) => ({ 0: v.x, 1: v.y }), expect: (v) => ({ tape: { 0: v.x - v.y } }), cost: { plain: ['3 + 5y', (v) => 3 + 5 * v.y], fast: ['2', () => 2] } },
      { id: 'subkeep', name: 'Subtract, keeping y', does: 'x = x − y, y stays.', code: '>[-<->>+<]>[-<+>]<<', vars: [num('x', 'x', 0, 255, 9, WIDE), num('y', 'y', 0, 255, 4, WIDE)], labels: { 0: 'x', 1: 'y', 2: 'scratch' },
        init: (v) => ({ 0: v.x, 1: v.y }), expect: (v) => ({ tape: { 0: v.x - v.y, 1: v.y } }), cost: { plain: ['6 + 13y', (v) => 6 + 13 * v.y], fast: ['3', () => 3] } },
    ],
  });

  P.push({
    id: 'swap', group: 'basics', name: 'Swap two cells', key: 'exchange',
    does: 'Exchanges the values of two cells.',
    why: [
      'Three moves: x goes to the scratch cell, y goes to x, the scratch cell goes to y.',
      'There is no way round the third cell. Each move empties its source, so one of the two values needs a place to wait.',
    ],
    needs: ['One scratch cell that is zero; it is zero again at the end.', 'Any cell size for the main form. The form <a href="#v-wrap">With a subtraction (wrapping cells)</a>, which is the one from the wiki, needs wrapping cells.'],
    mistakes: ['Moving x onto y first. Then both values are mixed in one cell and cannot be separated.', 'Thinking the form without <code class="bf">[-]</code>-style moves is cheaper: the form <a href="#v-wrap">With a subtraction (wrapping cells)</a> on this page takes more plain steps whenever y is smaller than x.'],
    used: ['<a href="stack.html#v-swap">A stack</a>, in its form "Swap the two top items".', 'Sorting exercises in the <a href="../challenges/">challenges</a>.'],
    sources: [src(SRC.esoAlg, 'section "swap x, y", both forms')],
    variants: [
      { id: 'three', name: 'Three moves', does: 'Layout: x, y, scratch.', code: '[->>+<<]>[-<+>]>[-<+>]<<', vars: [num('x', 'x', 0, 255, 2, WIDE), num('y', 'y', 0, 255, 7, WIDE)], labels: { 0: 'x', 1: 'y', 2: 'scratch' },
        init: (v) => ({ 0: v.x, 1: v.y }), expect: (v) => ({ tape: { 0: v.y, 1: v.x } }), cost: { plain: ['7 + 12x + 5y', (v) => 7 + 12 * v.x + 5 * v.y], fast: ['4', () => 4] }, table: [{ x: 2, y: 7 }, { x: 200, y: 100 }] },
      { id: 'wrap', name: 'With a subtraction (wrapping cells)', does: 'First y becomes y − x, then x becomes y − x, then the scratch cell rebuilds both. When y is smaller than x the middle loop runs almost once round the cell.', code: '[->>+<-<]>[-<+>]>[-<+<+>>]<<', bits: [8, 16], vars: [num('x', 'x', 0, 255, 2), num('y', 'y', 0, 255, 7)], labels: { 0: 'x', 1: 'y', 2: 'scratch' },
        init: (v) => ({ 0: v.x, 1: v.y }), expect: (v) => ({ tape: { 0: v.y, 1: v.x } }), cost: { plain: ['7 + 17x + 5 × ((y − x) wrapped)', null], fast: ['4', () => 4] }, table: [{ x: 2, y: 7 }, { x: 7, y: 2 }] },
    ],
  });

  P.push({
    id: 'if-nonzero', group: 'control', name: 'If non-zero', key: 'if then condition test',
    does: 'Runs a piece of program once when a cell is not zero.',
    why: [
      'A loop is the only thing in brainfuck that looks at a cell. So an "if" is a loop that is made to run at most once.',
      'The simplest way to stop it after one round is to clear the cell at the end of the body. That destroys the value.',
      'To keep the value, either test a copy (see <a href="copy.html">copy a value</a>), or leave the loop by stepping onto a cell that is known to be zero and then find the way back.',
    ],
    needs: ['Destroying form: nothing. Copy form: two scratch cells. No-copy form: a zero cell on each side of x.', 'The body must come back to the cell it started on.', 'Any cell size.'],
    mistakes: ['Leaving the loop on another cell than the one you entered on, and then moving as if you knew where you are. See the note <a href="#wrong">"Wrong as often given"</a> under this list.', 'A body that changes the tested cell and forgets that the closing bracket tests it again.'],
    pitfallText: 'A short form that is often given is "x[ code temp ]x": leave the loop by walking to an empty cell, then walk back to x. Written with fixed moves this is wrong when x is zero: the loop is skipped, the pointer is still on x, and the walk back goes one cell too far. The form <a href="#v-nocopy">Keeping x, without a copy</a> on this page repairs it with <code class="bf">[&lt;]</code>, which stops on the zero cell left of x in both cases.',
    used: ['In the project: <code>ifNonZero</code> (destroying) and <code>whenNonZero</code> (copy) in emit.js.', '<a href="../challenges/basics/08-deciding.html">Brainfuck basics, lesson 8, "Making a decision"</a>, teaches it. <a href="../learn/04-zero.html">Build toward a chatbot, lesson 4, "Only one question"</a>, is about the only question brainfuck can ask.', '<a href="if-else.html">If and else</a> builds on the no-copy idea.'],
    sources: [src(SRC.esoAlg, 'section "if (x) { code }": three forms; the second needs the repair described here'), src(SRC.project, 'ifNonZero, whenNonZero')],
    variants: [
      { id: 'destroy', name: 'Using up x', does: 'The body here adds 1 to "out". Then x is cleared, so the loop ends.', code: '[>+<[-]]', vars: [num('x', 'x', 0, 255, 5, WIDE)], labels: { 0: 'x', 1: 'out' },
        init: (v) => ({ 0: v.x }), expect: (v) => ({ tape: { 1: B(v.x) } }), cost: { plain: ['6 + 2x when x is not 0, else 1', (v) => (v.x ? 6 + 2 * v.x : 1)], fast: ['4 when x is not 0, else 1', (v) => (v.x ? 4 : 1)] }, table: [{ x: 0 }, { x: 5 }] },
      { id: 'copy', name: 'Keeping x, by testing a copy', does: 'Layout: x, out, two scratch cells.', code: '[->>+>+<<<]>>>[-<<<+>>>]<[<+>[-]]<<', vars: [num('x', 'x', 0, 255, 5, WIDE)], labels: { 0: 'x', 1: 'out', 2: 'scratch', 3: 'scratch' },
        init: (v) => ({ 0: v.x }), expect: (v) => ({ tape: { 0: v.x, 1: B(v.x) } }), cost: { plain: ['14 + 21x when x is not 0, else 9', (v) => (v.x ? 14 + 21 * v.x : 9)], fast: ['7 when x is not 0, else 4', (v) => (v.x ? 7 : 4)] } },
      { id: 'nocopy', name: 'Keeping x, without a copy', does: 'Layout: zero, x, zero, out. The pointer starts on x. Leaving the loop on the zero cell costs nothing; <code class="bf">&lt;[&lt;]&gt;</code> finds x again.', code: '[>>+<]<[<]>', start: 1, vars: [num('x', 'x', 0, 255, 5, WIDE)], labels: { 0: 'zero', 1: 'x', 2: 'zero', 3: 'out' },
        init: (v) => ({ 1: v.x }), expect: (v) => ({ tape: { 1: v.x, 3: B(v.x) }, ptr: 1 }), cost: { plain: ['11 when x is not 0, else 4', (v) => (v.x ? 11 : 4)], fast: ['6 when x is not 0, else 3', (v) => (v.x ? 6 : 3)] } },
    ],
  });

  P.push({
    id: 'if-zero', group: 'control', name: 'If zero', key: 'if not unless else empty',
    does: 'Runs a piece of program once when a cell is zero.',
    why: [
      'A loop runs when a cell is <em>not</em> zero. For the opposite we need a second cell, a flag, that starts at 1.',
      'If x is not zero, a loop on x knocks the flag down to 0. Then a loop on the flag runs the body: it runs exactly when x was zero.',
      'In the main form the flag sits right next to x, and the two loops are arranged so that the pointer ends on the same cell both ways.',
    ],
    needs: ['Main form: the two cells to the right of x must be zero. They are zero again at the end, and x is kept.', 'The body starts and ends on the flag cell.', 'Any cell size.'],
    mistakes: ['Putting the flag anywhere else than directly right of x: the moves <code class="bf">&gt;-]&gt;</code> depend on it.', 'A body that leaves the pointer on another cell.'],
    used: ['In the project: <code>whenZero</code> in emit.js (the flag form).', 'The "not" of <a href="logic.html">not, and, or on flags</a> is this pattern with "set a flag" as its body.', '<a href="../learn/04-zero.html">Build toward a chatbot, lesson 4, "Only one question"</a>, measures what counting down costs.'],
    sources: [src(SRC.esoAlg, 'section "if (x) { code1 } else { code2 }", the form by Ben-Arba with an empty first part'), src(SRC.project, 'whenZero')],
    variants: [
      { id: 'next', name: 'Flag next to x', does: 'Layout: x, flag, zero, out. The body here adds 1 to "out".', code: '>+<[>-]>[>>+<<->]<<', vars: [num('x', 'x', 0, 255, 0, WIDE)], labels: { 0: 'x', 1: 'flag', 2: 'zero', 3: 'out' },
        init: (v) => ({ 0: v.x }), expect: (v) => ({ tape: { 0: v.x, 3: B(!v.x) } }), cost: { plain: ['11 when x is not 0, else 16', (v) => (v.x ? 11 : 16)], fast: ['6 when x is not 0, else 7', (v) => (v.x ? 6 : 7)] }, table: [{ x: 0 }, { x: 5 }] },
      { id: 'flag', name: 'Flag anywhere, testing a copy', does: 'Layout: x, out, flag, two scratch cells. Longer, but the cells may be anywhere.', code: '>>+<<[->>>+>+<<<<]>>>>[-<<<<+>>>>]<[<->[-]]<[<+>-]<<', vars: [num('x', 'x', 0, 255, 0, WIDE)], labels: { 0: 'x', 1: 'out', 2: 'flag', 3: 'scratch', 4: 'scratch' },
        init: (v) => ({ 0: v.x }), expect: (v) => ({ tape: { 0: v.x, 1: B(!v.x) } }), cost: { plain: ['22 + 25x', (v) => 22 + 25 * v.x], fast: ['9 when x is not 0, else 6', (v) => (v.x ? 9 : 6)] } },
      { id: 'destroy', name: 'Using up x', does: 'Layout: x, flag, out.', code: '>+<[[-]>-<]>[>+<-]<', vars: [num('x', 'x', 0, 255, 0, WIDE)], labels: { 0: 'x', 1: 'flag', 2: 'out' },
        init: (v) => ({ 0: v.x }), expect: (v) => ({ tape: { 2: B(!v.x) } }), cost: { plain: ['12 + 2x', (v) => 12 + 2 * v.x], fast: ['7 when x is not 0, else 4', (v) => (v.x ? 7 : 4)] } },
    ],
  });

  P.push({
    id: 'if-else', group: 'control', name: 'If and else', key: 'if then else branch either',
    does: 'Runs one piece of program when a cell is not zero and another piece when it is zero.',
    why: [
      'A flag next to x starts at 1. If x is not zero, the first loop runs the "then" part, clears the flag and stops on the flag cell.',
      'One step to the right is then a zero cell, so the second loop is skipped. If x was zero the first loop is skipped, that same step lands on the flag, which is still 1, and the "else" part runs.',
      'Both ways end on the same cell. That is the whole trick: after a decision the program must know where the pointer is.',
    ],
    needs: ['Main form: flag and one more zero cell directly right of x. Both are zero at the end; x is kept.', 'Each part starts and ends on a fixed cell (here: the "then" part on x, the "else" part on the flag).', 'Any cell size.'],
    mistakes: ['Changing x inside the "then" part. The first loop leaves through the flag cell, not through x, so that is allowed, but the layout must stay x, flag, zero.', 'Running two separate ifs, "if x" and "if not x", when the first one changes x.'],
    used: ['<a href="compare-less.html">Less than</a> and <a href="satsub.html">saturating subtract</a> use it once per round.', 'The <a href="table-lookup.html">table lookup</a> of the project is a tree of these, one per bit.'],
    sources: [src(SRC.esoAlg, 'section "if (x) { code1 } else { code2 }": the forms by Ben-Arba (main) and Jeffry Johnston (copy)')],
    variants: [
      { id: 'next', name: 'Flag next to x', does: 'Layout: x, flag, zero, then, else. "then" and "else" each get 1 added.', code: '>+<[>>>+<<-]>[>>>+<<<->]<<', vars: [num('x', 'x', 0, 255, 5, WIDE)], labels: { 0: 'x', 1: 'flag', 2: 'zero', 3: 'then', 4: 'else' },
        init: (v) => ({ 0: v.x }), expect: (v) => ({ tape: { 0: v.x, 3: B(v.x), 4: B(!v.x) } }), cost: { plain: ['16 when x is not 0, else 18', (v) => (v.x ? 16 : 18)], fast: ['7', () => 7] }, table: [{ x: 0 }, { x: 5 }] },
      { id: 'copy', name: 'Testing a copy', does: 'Layout: x, flag, scratch, then, else. Works for any layout, costs a copy.', code: '[->+>+<<]>[-<+>]+>[>+<<->[-]]<[>>>+<<<-]<', vars: [num('x', 'x', 0, 255, 5, WIDE)], labels: { 0: 'x', 1: 'flag', 2: 'scratch', 3: 'then', 4: 'else' },
        init: (v) => ({ 0: v.x }), expect: (v) => ({ tape: { 0: v.x, 3: B(v.x), 4: B(!v.x) } }), cost: { plain: ['17 + 15x when x is not 0, else 18', (v) => (v.x ? 17 + 15 * v.x : 18)], fast: ['10 when x is not 0, else 6', (v) => (v.x ? 10 : 6)] } },
      { id: 'destroy', name: 'Using up x', does: 'Layout: x, flag, then, else.', code: '>+<[[-]>->+<<]>[>>+<<-]<', vars: [num('x', 'x', 0, 255, 5, WIDE)], labels: { 0: 'x', 1: 'flag', 2: 'then', 3: 'else' },
        init: (v) => ({ 0: v.x }), expect: (v) => ({ tape: { 2: B(v.x), 3: B(!v.x) } }), cost: { plain: ['15 + 2x when x is not 0, else 14', (v) => (v.x ? 15 + 2 * v.x : 14)], fast: ['8 when x is not 0, else 4', (v) => (v.x ? 8 : 4)] } },
    ],
  });

  P.push({
    id: 'while', group: 'control', name: 'While', key: 'loop repeat until condition',
    does: 'Repeats a piece of program as long as a condition holds.',
    why: [
      'A loop tests one cell, at its start and again at its end. A "while" works the condition out into that cell before the loop, and works it out again as the last thing in the body.',
      'Here the condition is "the letter just read is not a newline". Taking 10 off the letter makes a newline zero, and zero is what the loop can see.',
    ],
    needs: ['The condition must be in the cell under the pointer when the body ends.', 'First form: the input must contain a newline, and the cells must wrap (0 − 10 has to be a number).', 'Any cell size that wraps.'],
    mistakes: ['Working out the condition only once, before the loop. The closing bracket then tests an old value.', 'Input that ends without a newline: with "0 at the end of input" the first form never sees a zero and reads for ever. The stepper adds the newline for you.'],
    used: ['<a href="read-line.html">Read a line into memory</a> is this loop with "store the letter" as its body.', '<a href="counted-loop.html">A counted loop</a> is the special case "while the counter is not zero".'],
    sources: [src(SRC.esoAlg, 'sections "while (x) { code }" and "Read until newline"')],
    variants: [
      { id: 'line', name: 'Until a newline', does: 'Counts the letters of one line. Layout: letter, count.', code: ',----------[>+<,----------]', vars: [{ id: 't', label: 'the line', type: 'text', max: 30, def: 'hello' }], labels: { 0: 'letter', 1: 'count' },
        input: (v) => v.t + '\n', expect: (v) => ({ tape: { 1: utf8(v.t).length } }), ok: (v) => !/\n/.test(v.t), okText: 'the text has to be one line, without a newline', cost: { plain: ['12 + 15 per letter', (v) => 12 + 15 * utf8(v.t).length], fast: ['3 + 4 per letter', (v) => 3 + 4 * utf8(v.t).length] }, table: [{ t: '' }, { t: 'hello' }] },
      { id: 'eof', name: 'Until the end of the input', does: 'Counts all letters. Works where <code class="bf">,</code> gives 0 at the end of the input.', code: ',[>+<,]', vars: [{ id: 't', label: 'the input', type: 'text', max: 30, def: 'hello' }], labels: { 0: 'letter', 1: 'count' },
        input: (v) => v.t, expect: (v) => ({ tape: { 1: utf8(v.t).length } }), cost: { plain: ['2 + 5 per letter', (v) => 2 + 5 * utf8(v.t).length], fast: ['2 + 3 per letter', (v) => 2 + 3 * utf8(v.t).length] } },
    ],
  });

  P.push({
    id: 'counted-loop', group: 'control', name: 'A counted loop', key: 'for repeat times counter',
    does: 'Runs a piece of program a given number of times.',
    why: [
      'The counter is the loop cell. Each round takes 1 off; when it reaches zero the loop ends.',
      'The counter is used up. To keep it, each round also adds 1 to a scratch cell, and one move at the end puts it back (see <a href="move.html">move a value</a>).',
      'The body may read the counter too, as long as it leaves it where it was: the form <a href="#v-sum">The body reads the counter</a> adds the counter itself to a total each round.',
    ],
    needs: ['The body must return to the counter cell.', 'Any cell size. A count of zero runs the body zero times.'],
    mistakes: ['Taking 1 off at the start of the round in one place and at the end in another. Both work; mixing them up inside one body does not.', 'A body that is not "flat" (it prints, or holds a loop): the optimiser cannot fold the loop, so the cost is per round. See <a href="cost.html">the cost page</a>.'],
    used: ['<a href="mul-cells.html">Multiply two cells</a> is a counted loop round a copy.', '<a href="print-string.html">Print a constant string</a>: the loop that seeds the cells.'],
    sources: [src(SRC.esoAlg, 'section "Summing 1~n" for the idea of the third form; the code here is our own')],
    variants: [
      { id: 'stars', name: 'Using up the counter', does: 'Prints n stars. Layout: n, scratch, star. The first loop only makes the star (42).', code: '>++++++[->+++++++<]<[->>.<<]', vars: [num('n', 'n', 0, 30, 5)], labels: { 0: 'n', 1: 'scratch', 2: 'star' },
        init: (v) => ({ 0: v.n }), expect: (v) => ({ tape: { 2: 42 }, out: rep('*', v.n) }), cost: { plain: ['76 + 7n', (v) => 76 + 7 * v.n], fast: ['3 + 3n', (v) => 3 + 3 * v.n] }, table: [{ n: 0 }, { n: 5 }, { n: 30 }] },
      { id: 'keep', name: 'Keeping the counter', does: 'Layout: n, keep, star. Every round saves one unit in "keep".', code: '>++++++[->+++++++<]<[->+>.<<]>[-<+>]<', vars: [num('n', 'n', 0, 30, 5)], labels: { 0: 'n', 1: 'keep', 2: 'star' },
        init: (v) => ({ 0: v.n }), expect: (v) => ({ tape: { 0: v.n, 2: 42 }, out: rep('*', v.n) }), cost: { plain: ['79 + 13n', (v) => 79 + 13 * v.n], fast: ['5 + 4n', (v) => 5 + 4 * v.n] } },
      { id: 'sum', name: 'The body reads the counter', does: 'Adds n + (n − 1) + … + 1. Layout: n, total, scratch.', code: '[[->+>+<<]>>[-<<+>>]<<-]', vars: [num('n', 'n', 0, 22, 4, { hi: { 16: 300, 32: 300 } })], labels: { 0: 'n', 1: 'total', 2: 'scratch' },
        init: (v) => ({ 0: v.n }), expect: (v) => ({ tape: { 1: v.n * (v.n + 1) / 2 } }), cost: { plain: ['grows with n × n', null], fast: ['1 + 4n', (v) => 1 + 4 * v.n] } },
    ],
  });

  P.push({
    id: 'logic', group: 'control', name: 'Not, and, or on flags', key: 'boolean logical true false',
    does: 'Combines yes-or-no values, where 0 means no and 1 means yes.',
    why: [
      '<b>Not</b>: start a helper at 1 and take x off it. <b>And</b>: only if x is set does y get moved into the answer. <b>Or</b>: add the two and turn "anything but zero" into 1.',
      'The short forms trust that the cells hold 0 or 1 only. The "any value" forms first turn every non-zero value into a clean 1; they cost a little more.',
    ],
    needs: ['Short forms: the inputs must be 0 or 1.', 'One scratch cell (not) or an answer cell that is zero (and).', 'Any cell size. The inputs are used up.'],
    mistakes: ['Feeding a number such as 2 to a short form: "not 2" gives 255 on 8-bit cells, not 0.', 'The short "or" adds the two inputs. With arbitrary numbers the sum can wrap to exactly zero (128 + 128 on 8-bit cells) and the answer is wrong. Use the "any value" form.'],
    used: ['<a href="compare-equal.html">Equal</a> is "not (x − y)".', 'Combining tests in the <a href="../challenges/">challenges</a>.'],
    sources: [src(SRC.esoAlg, 'sections "not x", "x and y", "x or y" (boolean, logical); the snippets here are our own, shorter forms for the same layouts')],
    variants: [
      { id: 'not', name: 'Not (flag)', does: 'x = 1 − x. Layout: x, scratch.', code: '>+<[->-<]>[-<+>]<', vars: [num('x', 'x', 0, 1, 1)], labels: { 0: 'x', 1: 'scratch' },
        init: (v) => ({ 0: v.x }), expect: (v) => ({ tape: { 0: 1 - v.x } }), cost: { plain: ['12', () => 12], fast: ['4', () => 4] }, table: [{ x: 0 }, { x: 1 }] },
      { id: 'notany', name: 'Not (any value)', does: 'x = 1 if x was 0, else 0.', code: '>+<[[-]>-<]>[-<+>]<', vars: [num('x', 'x', 0, 255, 7, WIDE)], labels: { 0: 'x', 1: 'scratch' },
        init: (v) => ({ 0: v.x }), expect: (v) => ({ tape: { 0: B(!v.x) } }), cost: { plain: ['12 + 2x', (v) => 12 + 2 * v.x], fast: ['7 when x is not 0, else 4', (v) => (v.x ? 7 : 4)] } },
      { id: 'and', name: 'And (flags)', does: 'z = x and y. Layout: x, y, z.', code: '[>[->+<]<-]>[-]<', vars: [num('x', 'x', 0, 1, 1), num('y', 'y', 0, 1, 1)], labels: { 0: 'x', 1: 'y', 2: 'z' },
        init: (v) => ({ 0: v.x, 1: v.y }), expect: (v) => ({ tape: { 2: v.x & v.y } }), cost: { plain: ['at most 14', null], fast: ['at most 6', null] }, table: [{ x: 0, y: 1 }, { x: 1, y: 1 }] },
      { id: 'andany', name: 'And (any values)', does: 'z = 1 if both are not 0.', code: '[>[[-]>+<]<[-]]>[-]<', vars: [num('x', 'x', 0, 255, 3, WIDE), num('y', 'y', 0, 255, 9, WIDE)], labels: { 0: 'x', 1: 'y', 2: 'z' },
        init: (v) => ({ 0: v.x, 1: v.y }), expect: (v) => ({ tape: { 2: B(v.x && v.y) } }), cost: { plain: ['grows with x + y (2 per unit)', null], fast: ['at most 11', null] } },
      { id: 'or', name: 'Or (flags)', does: 'x = x or y. Layout: x, y.', code: '[->+<]>[[-]<+>]<', vars: [num('x', 'x', 0, 1, 0), num('y', 'y', 0, 1, 1)], labels: { 0: 'x', 1: 'y' },
        init: (v) => ({ 0: v.x, 1: v.y }), expect: (v) => ({ tape: { 0: v.x | v.y } }), cost: { plain: ['at most 16', null], fast: ['at most 6', null] }, table: [{ x: 0, y: 0 }, { x: 0, y: 1 }] },
      { id: 'orany', name: 'Or (any values)', does: 'x = 1 if either is not 0. Layout: x, y, scratch.', code: '[[-]>>+<<]>[[-]>+<]>[[-]<<+>>]<<', vars: [num('x', 'x', 0, 255, 128, WIDE), num('y', 'y', 0, 255, 128, WIDE)], labels: { 0: 'x', 1: 'y', 2: 'scratch' },
        init: (v) => ({ 0: v.x, 1: v.y }), expect: (v) => ({ tape: { 0: B(v.x || v.y) } }), cost: { plain: ['grows with x + y (2 per unit)', null], fast: ['at most 15', null] } },
    ],
  });

  P.push({
    id: 'compare-equal', group: 'control', name: 'Equal', key: 'compare same equals == != different',
    does: 'Sets a flag to 1 when two cells hold the same number.',
    why: [
      'Two numbers are equal when their difference is zero. Subtracting is cheap (a flat loop), and "is it zero" is the one question brainfuck can ask.',
      'So: x becomes x − y, and then a "not" (see <a href="logic.html">not, and, or on flags</a>) turns "zero" into 1 and everything else into 0.',
    ],
    needs: ['Wrapping cells (or x at least y), because x − y may go below zero on the way.', 'Short form: no scratch cell; both inputs are used up. Keeping form: two more cells.', 'The pointer ends where it started.'],
    mistakes: ['Thinking the same trick gives "less than". The difference tells you whether the numbers differ, but on wrapping cells not which one is larger: see <a href="compare-less.html">less than</a>.'],
    used: ['<a href="compare-strings.html">Compare two strings</a> does this once per letter.', 'The form <a href="while.html#pattern">Until a newline</a> of <a href="while.html">while</a> is an equality test against 10.'],
    sources: [src(SRC.esoAlg, 'sections "x = x == y" and "x = x != y" (Jeffry Johnston; the short forms)')],
    variants: [
      { id: 'short', name: 'Using up both', does: 'x = 1 if x equals y, else 0. Layout: x, y.', code: '[->-<]+>[<->[-]]<', vars: [num('x', 'x', 0, 255, 7, WIDE), num('y', 'y', 0, 255, 7, WIDE)], labels: { 0: 'x', 1: 'y' },
        init: (v) => ({ 0: v.x, 1: v.y }), expect: (v) => ({ tape: { 0: B(v.x === v.y) } }), cost: { plain: ['grows with x, and with the difference', null], fast: ['4 when equal, else 7', (v) => (v.x === v.y ? 4 : 7)] }, table: [{ x: 7, y: 7 }, { x: 7, y: 9 }, { x: 200, y: 3 }] },
      { id: 'keep', name: 'Keeping both', does: 'Layout: x, y, answer, scratch.', code: '[->>+>+<<<]>>>[-<<<+>>>]<<[->->+<<]>>[-<<+>>]+<[[-]>-<]>[-<+>]<<<', vars: [num('x', 'x', 0, 255, 7, WIDE), num('y', 'y', 0, 255, 7, WIDE)], labels: { 0: 'x', 1: 'y', 2: 'answer', 3: 'scratch' },
        init: (v) => ({ 0: v.x, 1: v.y }), expect: (v) => ({ tape: { 0: v.x, 1: v.y, 2: B(v.x === v.y) } }), cost: { plain: ['grows with x + y (about 20 per unit)', null], fast: ['8 when equal, else 11', (v) => (v.x === v.y ? 8 : 11)] } },
      { id: 'differ', name: 'Not equal', does: 'x = 1 if the two differ.', code: '[->-<]>[[-]<+>]<', vars: [num('x', 'x', 0, 255, 7, WIDE), num('y', 'y', 0, 255, 9, WIDE)], labels: { 0: 'x', 1: 'y' },
        init: (v) => ({ 0: v.x, 1: v.y }), expect: (v) => ({ tape: { 0: B(v.x !== v.y) } }), cost: { plain: ['grows with x, and with the difference', null], fast: ['3 when equal, else 6', (v) => (v.x === v.y ? 3 : 6)] } },
    ],
  });

  P.push({
    id: 'compare-less', group: 'control', name: 'Less than', key: 'compare smaller greater < > order minimum',
    does: 'Sets a flag to 1 when the first number is smaller than the second.',
    why: [
      'Brainfuck cannot see which of two numbers is larger. It can only count both down together and see which one runs out first.',
      'Each round takes 1 from x. Then an <a href="if-else.html">if and else</a> on y: if y still has something, take 1 from it; if not, x was larger, so clear x to stop.',
      'When the loop ends, y holds what was left: y − x, but never below zero. x was smaller exactly when something is left.',
      '<b>Why this is costly.</b> The loop has a decision inside, so it is not flat, and no optimiser can fold it. The cost grows with the smaller of the two numbers. On 32-bit cells that can be billions of rounds.',
    ],
    needs: ['Main form: two zero cells right of y. Both inputs are used up. Any cell size, wrapping or not.', 'The numbers are read as unsigned (0 and up).', 'The "by bits" form needs wrapping cells of a known width and the project generators.'],
    mistakes: ['Subtracting and looking at the result. On wrapping cells 3 − 5 is 254: not zero, and not visibly negative either.', 'Using the balanced-loops form on large numbers: its cost grows with x × y.'],
    used: ['<a href="satsub.html">Saturating subtract</a> is the same loop without the last line.', '<a href="../learn/04-zero.html">Build toward a chatbot, lesson 4, "Only one question"</a>, shows the wall. <a href="../learn/05-peel.html">Build toward a chatbot, lesson 5, "Peeling off bits"</a>, shows the way through, which is the form <a href="#v-bits">By bits, on wrapping cells of a known width</a> on this page.', 'The chat program never compares by counting. It uses <a href="shift-round-clamp.html">shift, round and clamp</a> and <a href="argmax.html">pick the largest by a race</a>.'],
    sources: [src(SRC.esoAlg, 'sections "x = x < y" (Ian Kelly) and "z = x > y" (ais523, the balanced-loops form shown as a variation)'), src(SRC.project, 'the form by bits is requant with a shift of 0')],
    variants: [
      { id: 'count', name: 'Counting both down', does: 'Layout: x, y, answer, zero. x and y are used up.', code: SAT + '>[[-]>+<]<', vars: [num('x', 'x', 0, 255, 3, { hi: { 16: 2000, 32: 2000 } }), num('y', 'y', 0, 255, 5, { hi: { 16: 2000, 32: 2000 } })], labels: { 0: 'x', 1: 'y', 2: 'answer', 3: 'zero' },
        init: (v) => ({ 0: v.x, 1: v.y }), expect: (v) => ({ tape: { 2: B(v.x < v.y) } }), cost: { plain: ['about 16 per unit of the smaller number', null], fast: ['about 8 per unit of the smaller number', null] }, table: [{ x: 3, y: 5 }, { x: 5, y: 3 }, { x: 200, y: 250 }] },
      { id: 'balanced', name: 'Greater than, with balanced loops only', does: 'z = 1 if x is greater than y. Layout: x, y, two scratch cells, z. y ends as y − x. Each round moves all of y away and back.', code: '[>>+<[->[-]>+<<]>[->>+<<]>[-<<+>>]<<-<-]', bits: [8], vars: [num('x', 'x', 0, 255, 5), num('y', 'y', 0, 255, 3)], labels: { 0: 'x', 1: 'y', 2: 'scratch', 3: 'scratch', 4: 'z' },
        init: (v) => ({ 0: v.x, 1: v.y }), expect: (v) => ({ tape: { 1: v.y - v.x, 4: B(v.x > v.y) } }), cost: { plain: ['grows with x × y', null], fast: ['grows with x × y', null] }, table: [{ x: 5, y: 3 }, { x: 200, y: 250 }] },
      { id: 'bits', name: 'By bits, on wrapping cells of a known width', does: 'Works out y − x in one step, then reads it bit by bit and keeps it only if it is positive. The cost does not depend on the numbers. Layout: x, y, answer, then 12 scratch cells.', gen: true, bits: [32, 16],
        code: (v, bits, G) => { const p = PG(G, bits); p.scatter(0, [[3, -1]]); p.scatter(1, [[3, 1]]); p.requant(3, 14, { k: 0, n: 8, lo: 0, addend: 0 }, range(10, (i) => 4 + i)); p.ifNonZero(14, () => p.add(2, 1)); return { code: p.toString(), ptr: p.ptr }; },
        vars: [num('x', 'x', 0, 255, 3), num('y', 'y', 0, 255, 5)], labels: { 0: 'x', 1: 'y', 2: 'answer', 3: 'y − x' }, size: 64,
        init: (v) => ({ 0: v.x, 1: v.y }), expect: (v, b, prog) => ({ tape: { 2: B(v.x < v.y) }, ptr: prog.ptr }), cost: { plain: ['thousands: the shifts are long loops', null], fast: ['35 to 50, whatever the numbers', null] }, table: [{ x: 3, y: 5 }, { x: 200, y: 250 }] },
    ],
  });

  P.push({
    id: 'scan', group: 'control', name: 'Find a zero cell or a marker', key: 'search scan seek walk find end',
    does: 'Moves the pointer to the nearest cell with a given value, however far away it is.',
    why: [
      '<code class="bf">[&gt;]</code> is a loop whose whole body is one step to the right. It asks "is this cell zero?" and, if not, moves on. It stops on the first zero cell.',
      'To stop on another value, change the question: take the value off, ask, and put it back before moving on.',
      'A scan is the one loop here that does not come back to where it started. The program no longer knows the number of the cell it stands on, only what kind of cell it is. That is how brainfuck does without addresses.',
    ],
    needs: ['There must be a cell to stop on, or the pointer runs off the tape.', 'The marker forms need wrapping cells (0 − 1 has to be a number).', 'The scan for a non-zero cell needs one spare zero cell to the <em>left</em> of where it starts.'],
    mistakes: ['Data that may contain a zero inside a <code class="bf">[&gt;]</code> scan: the scan stops there.', 'Starting the non-zero scan on the first cell of the tape. As usually given, it says only "the start cell must be zero"; it also touches the cell to the left of it.'],
    used: ['Every walk over data ends in a scan: a row of records (<a href="records.html">walk an array of records</a>), a string (<a href="read-line.html">read a line into memory</a>).', '<a href="argmax.html">Pick the largest by a race</a> uses a scan as its "did anyone reach zero?" test.', '<a href="../learn/07-walking.html">Build toward a chatbot, lesson 7, "No addresses"</a>, is about working without addresses.'],
    sources: [src(SRC.esoAlg, 'sections "Find a zeroed cell" and "Find a non-zeroed cell" (Epsilon)')],
    variants: [
      { id: 'right', name: 'The first zero to the right', does: 'Walks over cells that are not zero.', code: '[>]', vars: [{ id: 'a', label: 'cells', type: 'list', min: 1, max: 9, len: [0, 8], def: [3, 1, 4, 1, 5] }], labels: (v) => names(0, v.a.map((_, i) => 'cell ' + i).concat(['zero'])),
        init: (v) => cells(0, v.a), expect: (v) => ({ tape: cells(0, v.a), ptr: v.a.length }), cost: { plain: ['1 + 2 per cell passed', (v) => (v.a.length ? 1 + 2 * v.a.length : 1)], fast: ['1 + 1 per cell passed', (v) => 1 + v.a.length] }, table: [{ a: [] }, { a: [3, 1, 4, 1, 5] }] },
      { id: 'left', name: 'The first zero to the left', does: 'The pointer starts on the last cell.', code: '[<]', start: (v) => v.a.length, vars: [{ id: 'a', label: 'cells', type: 'list', min: 1, max: 9, len: [1, 8], def: [3, 1, 4] }], labels: (v) => names(0, ['zero'].concat(v.a.map((_, i) => 'cell ' + (i + 1)))),
        init: (v) => cells(1, v.a), expect: (v) => ({ tape: cells(1, v.a), ptr: 0 }), cost: { plain: ['1 + 2 per cell passed', (v) => 1 + 2 * v.a.length], fast: ['1 + 1 per cell passed', (v) => 1 + v.a.length] } },
      { id: 'marker', name: 'The first cell that holds 1', does: 'Takes 1 off, asks, puts it back. The other cells may hold anything, zero too.', code: '-[+>-]+', bits: [8, 16, 32], vars: [num('m', 'where the 1 is', 0, 7, 4)], labels: (v) => ({ [v.m]: 'marker' }),
        init: (v) => Object.assign(cells(0, [5, 0, 3, 7, 0, 2, 9, 4].slice(0, v.m)), { [v.m]: 1 }), expect: (v) => ({ tape: Object.assign(cells(0, [5, 0, 3, 7, 0, 2, 9, 4].slice(0, v.m)), { [v.m]: 1 }), ptr: v.m }), cost: { plain: ['3 + 4 per cell passed', (v) => 3 + 4 * v.m], fast: ['3 + 3 per cell passed', (v) => 3 + 3 * v.m] } },
      { id: 'nonzero', name: 'The first cell that is not zero', does: 'Carries a 1 along over the empty cells. Starts on cell 1, because it uses the cell to its left.', code: '+[>[<-]<[->+<]>]>', start: 1, vars: [num('m', 'empty cells in between', 0, 7, 3)], labels: (v) => ({ 0: 'spare', 1: 'start', [2 + v.m]: 'target' }),
        init: (v) => ({ [2 + v.m]: 7 }), expect: (v) => ({ tape: { [2 + v.m]: 7 }, ptr: 2 + v.m }), cost: { plain: ['about 11 per cell passed', null], fast: ['about 4 per cell passed', null] } },
    ],
  });

  P.push({
    id: 'mul-const', group: 'arithmetic', name: 'Multiply by a constant', key: 'times factor scale weight scatter',
    does: 'Adds a fixed multiple of a cell to another cell.',
    why: [
      'It is the pattern <a href="move.html">move a value</a>, but it gives more than it takes: for every 1 that leaves x, the target gets 3.',
      'The factor is written into the program as that many plus signs. A minus sign instead gives a negative factor.',
      'The loop is flat, so an optimising interpreter does the whole multiplication in one step, for any x.',
    ],
    needs: ['The factor is fixed when the program is written.', 'The target gets the product added. Any cell size; too large a product wraps.', 'To keep x: one scratch cell.'],
    mistakes: ['Writing a large factor as hundreds of plus signs. Split it: two loops of 16 make 256.', 'Expecting x × y for two cells from this: the factor cannot come from the tape. See <a href="mul-cells.html">multiply two cells</a>.'],
    used: ['<a href="../learn/03-multiply.html">Build toward a chatbot, lesson 3, "Multiplying by a fixed number"</a>, teaches it, with 90 × 100 as the example.', 'This is how the chat program holds its weights: each weight is a factor in a loop like this. In the project it is <code>scatter</code> and <code>addMulConst</code> in emit.js.', '<a href="constant.html">Set a constant</a> is this pattern with a fixed x.'],
    sources: [src(SRC.project, 'scatter, addMulConst')],
    variants: [
      { id: 'drain', name: 'Using up x', does: 'y gets f × x added. Layout: x, y.', code: (v) => '[->' + rep('+', v.f) + '<]', consts: [num('f', 'factor f', 1, 12, 3)], vars: [num('x', 'x', 0, 255, 5, WIDE)], labels: { 0: 'x', 1: 'y' },
        init: (v) => ({ 0: v.x }), expect: (v) => ({ tape: { 1: v.f * v.x } }), cost: { plain: ['1 + (4 + f) × x', (v) => 1 + (4 + v.f) * v.x], fast: ['1', () => 1] }, table: [{ f: 3, x: 5 }, { f: 12, x: 200 }] },
      { id: 'keep', name: 'Keeping x', does: 'Layout: x, y, scratch.', code: (v) => '[->' + rep('+', v.f) + '>+<<]>>[-<<+>>]<<', consts: [num('f', 'factor f', 1, 12, 3)], vars: [num('x', 'x', 0, 255, 5, WIDE)], labels: { 0: 'x', 1: 'y', 2: 'scratch' },
        init: (v) => ({ 0: v.x }), expect: (v) => ({ tape: { 0: v.x, 1: v.f * v.x } }), cost: { plain: ['6 + (14 + f) × x', (v) => 6 + (14 + v.f) * v.x], fast: ['3', () => 3] } },
      { id: 'inplace', name: 'In place', does: 'x becomes f × x. Layout: x, scratch.', code: (v) => '[->' + rep('+', v.f) + '<]>[-<+>]<', consts: [num('f', 'factor f', 1, 12, 3)], vars: [num('x', 'x', 0, 255, 5, WIDE)], labels: { 0: 'x', 1: 'scratch' },
        init: (v) => ({ 0: v.x }), expect: (v) => ({ tape: { 0: v.f * v.x } }), cost: { plain: ['4 + (4 + f) × x + 5 × the product', (v, b) => 4 + (4 + v.f) * v.x + 5 * ((v.f * v.x) % 2 ** b)], fast: ['3', () => 3] } },
      { id: 'many', name: 'Several factors in one pass', does: 'Three targets get 2x, 3x and −x. One loop, one step.', code: '[->++>+++>-<<<]', vars: [num('x', 'x', 0, 255, 5, WIDE)], labels: { 0: 'x', 1: '2x', 2: '3x', 3: '−x' },
        init: (v) => ({ 0: v.x }), expect: (v) => ({ tape: { 1: 2 * v.x, 2: 3 * v.x, 3: -v.x } }), cost: { plain: ['1 + 14x', (v) => 1 + 14 * v.x], fast: ['1', () => 1] } },
    ],
  });

  P.push({
    id: 'mul-cells', group: 'arithmetic', name: 'Multiply two cells', key: 'times product variable',
    does: 'Multiplies two numbers that are both on the tape.',
    why: [
      'x × y is "add y, x times". The outer loop counts x down. Each round copies y into the answer (see <a href="copy.html">copy a value</a>).',
      'It is a loop inside a loop. The inner loops are flat and cost one optimised step each, but the outer loop is not flat: its cost is a few steps for every unit of x.',
      'That is fine for small numbers and hopeless for large ones. And a negative x on a wrapping cell is a very large number.',
    ],
    needs: ['Main form: two scratch cells that are zero. y is kept, x is replaced by the product.', 'Any cell size. Too large a product wraps.', 'For numbers that may be large or negative, see <a href="signed-multiply.html">signed multiplication by shift-and-add</a>.'],
    mistakes: ['Looping on the larger number. The cost follows the outer counter: put the smaller one there.', 'Forgetting that −3 on 32-bit cells means 4,294,967,293 rounds.'],
    used: ['<a href="../learn/06-product.html">Build toward a chatbot, lesson 6, "Two numbers from the tape"</a>, shows why this is the second obstacle.', 'Built on it in this library: <a href="square.html">square</a> and <a href="powers-of-two.html">powers of two, and powers</a>.', 'In the project: <code>addMul</code> in emit.js, kept only as the slow way to measure against.'],
    sources: [src(SRC.esoAlg, 'section "x = x * y"'), src(SRC.project, 'addMul')],
    variants: [
      { id: 'inplace', name: 'x becomes x × y', does: 'Layout: x, y, two scratch cells.', code: '[->>>+<<<]>>>[<<[-<+>>+<]>[-<+>]>-]<<<', vars: [num('x', 'x', 0, 255, 6, { hi: { 16: 300, 32: 300 } }), num('y', 'y', 0, 255, 7, { hi: { 16: 300, 32: 300 } })], labels: { 0: 'x', 1: 'y', 2: 'scratch', 3: 'counter' },
        init: (v) => ({ 0: v.x, 1: v.y }), expect: (v) => ({ tape: { 0: v.x * v.y, 1: v.y } }), cost: { plain: ['13 to 16 × x × y', null], fast: ['3 + 4x', (v) => 3 + 4 * v.x] }, table: [{ x: 6, y: 7 }, { x: 15, y: 17 }, { x: 255, y: 255 }] },
      { id: 'acc', name: 'Adding the product to a third cell', does: 'acc gets a × b added; a and b are kept. This is the text the project generator writes. Layout: a, b, acc, two scratch cells.', code: '[->>>+<<[->+>>+<<<]>>>[-<<<+>>>]<<<<]>>>[-<<<+>>>]', vars: [num('a', 'a', 0, 255, 6, { hi: { 16: 300, 32: 300 } }), num('b', 'b', 0, 255, 7, { hi: { 16: 300, 32: 300 } })], labels: { 0: 'a', 1: 'b', 2: 'acc', 3: 'scratch', 4: 'scratch' },
        init: (v) => ({ 0: v.a, 1: v.b }), expect: (v) => ({ tape: { 0: v.a, 1: v.b, 2: v.a * v.b }, ptr: 3 }), cost: { plain: ['about 18 × a × b', null], fast: ['2 + 5a', (v) => 2 + 5 * v.a] } },
    ],
  });

  P.push({
    id: 'divmod', group: 'arithmetic', name: 'Divide, with remainder', key: 'division quotient modulo mod remainder divmod',
    does: 'Divides one cell by another, or by a constant, and gives the quotient and the remainder.',
    why: [
      'Division is counting: take 1 from n and 1 from the divisor, again and again. Every time the divisor reaches zero, one more "whole" has been taken out: add 1 to the quotient and fill the divisor up again.',
      'To fill it up again the loop keeps a second count that goes up while the divisor goes down. That count is also the remainder when n runs out.',
      'The clever part is the pointer. <code class="bf">[&gt;+&gt;&gt;]</code> and the loop after it are an <a href="if-else.html">if and else</a> on the divisor that end on the same cell both ways.',
      '<b>Why this is costly.</b> One round per unit of n, and the loop is not flat. Dividing 1,000,000 takes about 7 million optimised steps. For a divisor that is a power of two there is a much faster way: <a href="shift-round-clamp.html">shift, round and clamp</a>.',
    ],
    needs: ['Main form: the six cells n, d, 1, 0, 0, 0. The pattern puts the 1 there itself.', 'The divisor must be at least 1. A divisor of 0 acts as "cell size" (256 on 8-bit cells).', 'Any cell size. n and d are used up.'],
    mistakes: ['Using the well-known shorter loop with a divisor of 1. It fails: see the note <a href="#wrong">"Wrong as often given"</a> under this list.', 'Reading the raw result: before the tidy-up the cells hold d − remainder and remainder + 1, not d and the remainder.'],
    pitfallText: 'The shorter loop that is usually quoted, <code class="bf">[-&gt;-[&gt;+&gt;&gt;]&gt;[+[-&lt;+&gt;]&gt;+&gt;&gt;]&lt;&lt;&lt;&lt;&lt;]</code>, is correct for a divisor of 2 or more. With a divisor of 1 the pointer walks off to the left. The wiki says so; many copies of the snippet do not. The main form of this page (<a href="#pattern">the first figure</a>) is the wiki\'s "fixed version", which starts the remainder cell at 1.',
    used: ['<a href="print-number.html">Print a number in decimal</a> divides by 10 once per digit.', '<a href="../learn/04-zero.html">Build toward a chatbot, lesson 4, "Only one question"</a>, measures how slow dividing by counting is.', 'The chat program never divides this way: it multiplies by a reciprocal from a table (see <a href="table-lookup.html">table lookup as a decision tree</a>) and shifts (see <a href="shift-round-clamp.html">shift, round and clamp</a>).'],
    sources: [src(SRC.esoAlg, 'sections "Divmod" (the short loop and the "Fixed Version") and "Modulo"')],
    variants: [
      { id: 'cell', name: 'By a cell', does: 'Layout: n, d, remainder, quotient, two zero cells. n and d end at 0.', code: '>>+<<' + DIV + '>[-]>-<<', vars: [num('n', 'n', 0, 255, 17, { hi: { 16: 5000, 32: 5000 } }), num('d', 'd', 1, 255, 5, { hi: { 16: 5000, 32: 5000 } })], labels: { 0: 'n', 1: 'd', 2: 'remainder', 3: 'quotient', 4: 'zero', 5: 'zero' },
        init: (v) => ({ 0: v.n, 1: v.d }), expect: (v) => ({ tape: { 2: v.n % v.d, 3: Math.floor(v.n / v.d) } }), cost: { plain: ['about 22 per unit of n', null], fast: ['about 7 per unit of n; 9 when d is 1', null] }, table: [{ n: 17, d: 5 }, { n: 255, d: 10 }, { n: 255, d: 1 }] },
      { id: 'const', name: 'By a constant', does: 'The divisor is written into the program.', code: (v) => '>' + rep('+', v.d) + '>+<<' + DIV + '>[-]>-<<', consts: [num('d', 'd', 1, 20, 10)], vars: [num('n', 'n', 0, 255, 173, { hi: { 16: 5000, 32: 5000 } })], labels: { 0: 'n', 1: 'd', 2: 'remainder', 3: 'quotient', 4: 'zero', 5: 'zero' },
        init: (v) => ({ 0: v.n }), expect: (v) => ({ tape: { 2: v.n % v.d, 3: Math.floor(v.n / v.d) } }), cost: { plain: ['about 22 per unit of n', null], fast: ['about 7 per unit of n', null] }, table: [{ d: 10, n: 173 }] },
      { id: 'short', name: 'The short loop (divisor 2 or more)', does: 'One character shorter per round and no 1 to set up. The result is raw: d − remainder, remainder, quotient.', code: '[->-[>+>>]>[+[-<+>]>+>>]<<<<<]', vars: [num('n', 'n', 0, 255, 17, { hi: { 16: 5000, 32: 5000 } }), num('d', 'd', 2, 255, 5, { hi: { 16: 5000, 32: 5000 } })], labels: { 0: 'n', 1: 'd − rem', 2: 'remainder', 3: 'quotient', 4: 'zero', 5: 'zero' },
        init: (v) => ({ 0: v.n, 1: v.d }), expect: (v) => ({ tape: { 1: v.d - (v.n % v.d), 2: v.n % v.d, 3: Math.floor(v.n / v.d) } }), cost: { plain: ['about 22 per unit of n', null], fast: ['about 7 per unit of n', null] } },
      { id: 'mod', name: 'Remainder only', does: 'Layout: zero, n, d, remainder, two zero cells. The pointer starts on n. d ends as d − remainder.', code: '[>->+<[>]>[<+>-]<<[<]>-]', start: 1, vars: [num('n', 'n', 0, 255, 17, { hi: { 16: 5000, 32: 5000 } }), num('d', 'd', 1, 255, 5, { hi: { 16: 5000, 32: 5000 } })], labels: { 0: 'zero', 1: 'n', 2: 'd − rem', 3: 'remainder', 4: 'zero', 5: 'zero' },
        init: (v) => ({ 1: v.n, 2: v.d }), expect: (v) => ({ tape: { 2: v.d - (v.n % v.d), 3: v.n % v.d }, ptr: 1 }), cost: { plain: ['about 27 per unit of n', null], fast: ['about 11 per unit of n', null] } },
    ],
  });

  P.push({
    id: 'square', group: 'arithmetic', name: 'Square', key: 'power squared x*x',
    does: 'Replaces a number by its square.',
    why: [
      'A square is a sum of odd numbers: 1 + 3 + 5 + 7 = 16 = 4 × 4. The loop counts down from x and each round adds the next odd number, two for every unit still left plus one.',
      'The other way is plain: copy x and multiply the two (see <a href="copy.html">copy a value</a> and <a href="mul-cells.html">multiply two cells</a>).',
    ],
    needs: ['Two scratch cells (odd-number form) or three (copy form). Any cell size; too large a square wraps.', 'The pointer ends where it started.'],
    mistakes: ['Expecting the square of 16 or more to fit an 8-bit cell: 16 × 16 = 256 wraps to 0.'],
    used: ['<a href="table-lookup.html">Table lookup as a decision tree</a> uses a table of squares as its example and gets the same answer in a fixed number of steps.'],
    sources: [src(SRC.esoAlg, 'section "x = x * x" (Softengy): the sum of odd numbers')],
    variants: [
      { id: 'odd', name: 'As a sum of odd numbers', does: 'Layout: x, counter, scratch.', code: '[->+<]>[-[->+<<++>]<+>>[-<+>]<]<', vars: [num('x', 'x', 0, 255, 5, { hi: { 16: 300, 32: 300 } })], labels: { 0: 'x', 1: 'counter', 2: 'scratch' },
        init: (v) => ({ 0: v.x }), expect: (v) => ({ tape: { 0: v.x * v.x } }), cost: { plain: ['about 7 × x × x', null], fast: ['3 + 5x', (v) => 3 + 5 * v.x] }, table: [{ x: 5 }, { x: 15 }, { x: 255 }] },
      { id: 'copy', name: 'Copy, then multiply', does: 'Layout: x, copy, two scratch cells.', code: '[->+>+<<]>>[-<<+>>]<<' + '[->>>+<<<]>>>[<<[-<+>>+<]>[-<+>]>-]<<<' + '>[-]<', vars: [num('x', 'x', 0, 255, 5, { hi: { 16: 300, 32: 300 } })], labels: { 0: 'x', 1: 'copy', 2: 'scratch', 3: 'counter' },
        init: (v) => ({ 0: v.x }), expect: (v) => ({ tape: { 0: v.x * v.x } }), cost: { plain: ['13 to 20 × x × x', null], fast: ['6 + 4x', (v) => 6 + 4 * v.x] } },
    ],
  });

  P.push({
    id: 'powers-of-two', group: 'arithmetic', name: 'Powers of two, and powers', key: 'exponent double doubling 2^n x^y shift left',
    does: 'Works out 2 to the power n, or x to the power y.',
    why: [
      'Start at 1 and double it n times. Doubling is multiplying by the constant 2 (see <a href="mul-const.html">multiply by a constant</a>), into a scratch cell and back.',
      'A general power is the same loop round a multiplication (see <a href="mul-cells.html">multiply two cells</a>) instead of a doubling.',
      'Doubling a number moves all its bits one place up. On a wrapping cell the top bit falls out. That is the idea <a href="bit-peel.html">the bit peel</a> turns into a tool.',
    ],
    needs: ['One scratch cell for 2ⁿ, three for x to the power y. n and y are used up.', 'Any cell size. The result wraps: 2⁸ is 0 on 8-bit cells.'],
    mistakes: ['Expecting 0 to the power 0 to be 0. The loop never runs, so the answer is the 1 it started with.', 'Leaving the base behind: the general form keeps a copy of x in a scratch cell and must clear it at the end. The snippet on the wiki does not.'],
    used: ['<a href="bit-peel.html">The bit peel</a> multiplies by a power of two to push bits out of the cell.', 'In the project: <code>pow2</code> and <code>shl</code> in patterns.js build large powers of two from short loops.'],
    sources: [src(SRC.esoAlg, 'section "x = x^y" (chad3814); here with its scratch cell cleared at the end')],
    variants: [
      { id: 'two', name: '2 to the power n', does: 'Layout: n, result, scratch.', code: '>+<[->[->++<]>[-<+>]<<]', vars: [num('n', 'n', 0, 12, 5)], labels: { 0: 'n', 1: 'result', 2: 'scratch' },
        init: (v) => ({ 0: v.n }), expect: (v, bits) => ({ tape: { 1: powmod(2, v.n, bits) } }), cost: { plain: ['grows with 2ⁿ', null], fast: ['2 + 4n', (v) => 2 + 4 * v.n] }, table: [{ n: 0 }, { n: 5 }, { n: 12 }] },
      { id: 'power', name: 'x to the power y', does: 'Layout: x, y, three scratch cells. x becomes the result.', code: '[->>+<<]+>[<[->>>>+<<<<]>>>>[<<[-<<+>>>+<]>[-<+>]>-]<<<-]>[-]<<', vars: [num('x', 'x', 0, 9, 3), num('y', 'y', 0, 5, 4)], labels: { 0: 'x', 1: 'y', 2: 'base', 3: 'scratch', 4: 'counter' },
        init: (v) => ({ 0: v.x, 1: v.y }), expect: (v, bits) => ({ tape: { 0: powmod(v.x, v.y, bits) } }), cost: { plain: ['grows with the result', null], fast: ['grows with the result ÷ x', null] }, table: [{ x: 3, y: 4 }, { x: 2, y: 5 }] },
    ],
  });

  P.push({
    id: 'satsub', group: 'arithmetic', name: 'Saturating subtract', key: 'floor zero clamp max minus monus difference',
    does: 'Subtracts, but stops at zero instead of wrapping round.',
    why: [
      'A plain subtraction cannot stop at zero, because nothing in a flat loop looks at the cell. So we take single steps and look each time.',
      'Each round takes 1 from the amount to subtract. Then an <a href="if-else.html">if and else</a>: if the value still has something, take 1 from it; if it is empty already, clear what is left of the amount.',
      'The cost is one round per unit actually subtracted. That is the price of every "do not go below zero" by counting.',
    ],
    needs: ['Two zero cells to the right of the value. The amount is used up.', 'Any cell size, wrapping or not. The numbers are unsigned.'],
    mistakes: ['Looping on the value instead of on the amount: then the loop ends too early when the value is smaller.', 'Using this on large numbers. With wrapping cells of a known width, the clamp by bits (see <a href="shift-round-clamp.html">shift, round and clamp</a>) costs the same for every number.'],
    used: ['<a href="compare-less.html">Less than</a>: "is something left?".', 'In the project: <code>satSub</code> in emit.js.', '<a href="../learn/04-zero.html">Build toward a chatbot, lesson 4, "Only one question"</a>, is about this one question and what follows from it.'],
    sources: [src(SRC.project, 'satSub; the two-cell loop here is our own')],
    variants: [
      { id: 'cells', name: 'Two cells', does: 'y = y − x, but not below 0. Layout: x, y, flag, zero.', code: SAT, vars: [num('x', 'x', 0, 255, 5, { hi: { 16: 2000, 32: 2000 } }), num('y', 'y', 0, 255, 3, { hi: { 16: 2000, 32: 2000 } })], labels: { 0: 'x', 1: 'y', 2: 'flag', 3: 'zero' },
        init: (v) => ({ 0: v.x, 1: v.y }), expect: (v) => ({ tape: { 1: Math.max(v.y - v.x, 0) } }), cost: { plain: ['about 16 per unit taken off', null], fast: ['about 8 per unit taken off', null] }, table: [{ x: 5, y: 3 }, { x: 3, y: 5 }, { x: 100, y: 250 }] },
      { id: 'const', name: 'By a constant', does: 'The amount is written into the program, in cell 0. The value is in cell 1.', code: (v) => rep('+', v.n) + SAT, consts: [num('n', 'amount n', 1, 20, 4)], vars: [num('y', 'value', 0, 255, 3, WIDE)], labels: { 0: 'amount', 1: 'value', 2: 'flag', 3: 'zero' },
        init: (v) => ({ 1: v.y }), expect: (v) => ({ tape: { 1: Math.max(v.y - v.n, 0) } }), cost: { plain: ['about 17 per unit of the amount', null], fast: ['about 8 per unit of the amount', null] } },
      { id: 'project', name: 'The project form', does: 'Tests a copy of the value each round, so the cells may lie anywhere. Layout: value, counter, two scratch cells.', gen: true,
        code: (v, bits, G) => new G.Emitter().satSub(0, v.n, [1, 2, 3]).toString(), consts: [num('n', 'amount n', 1, 20, 4)], vars: [num('x', 'value', 0, 255, 3, { hi: { 16: 2000, 32: 2000 } })], labels: { 0: 'value', 1: 'counter', 2: 'scratch', 3: 'scratch' },
        init: (v) => ({ 0: v.x }), expect: (v) => ({ tape: { 0: Math.max(v.x - v.n, 0) }, ptr: 1 }), cost: { plain: ['grows with n × value', null], fast: ['about 8 per unit of n', null] } },
    ],
  });

  P.push({
    id: 'records', group: 'data', name: 'Walk an array of records', key: 'array list struct loop each frame stride',
    does: 'Does the same job on every record of a row, with one copy of the program.',
    why: [
      'Brainfuck moves are relative: "two cells to the right of here". So a piece of program written for one record works on any record, if the pointer stands on that record\'s first cell.',
      'Every record starts with a flag that is 1. The loop does the job, steps one record to the right and tests the next flag. The first empty flag ends the walk.',
      'A zero cell before the first record lets <code class="bf">[&lt;&lt;&lt;]</code> walk home again.',
    ],
    needs: ['All records the same length; here 3 cells: flag, a, b.', 'A zero flag after the last record and a zero cell one record length before the first.', 'Any cell size.'],
    mistakes: ['A job that ends on another cell of the record than it started on. The step to the next record then lands in the wrong column.', 'A zero in the flag column inside the row: the walk stops there.'],
    used: ['<a href="../learn/07-walking.html">Build toward a chatbot, lesson 7, "No addresses"</a>, walks a job over 512 places.', 'The chat program does every job this way: one piece of program, walked over hundreds of places. Its version lays the flags itself: <a href="frames.html">one copy of code over many frames</a>.', '<a href="array-index.html">Store and fetch by index</a> is a walk that counts.'],
    sources: [src(SRC.project, 'eachFrame in patterns.js is the grown-up form')],
    variants: [
      { id: 'each', name: 'A job on every record', does: 'In every record b gets 2 × a, and a is emptied. Then the pointer walks home. The pointer starts on the first flag, cell 3.', code: '[>[->++<]>>]<<<[<<<]>>>', start: 3, vars: [{ id: 'a', label: 'the a of each record', type: 'list', min: 0, max: 20, len: [0, 5], def: [3, 1, 4] }],
        labels: (v) => Object.assign({ 0: 'zero' }, ...v.a.map((_, i) => ({ [3 + 3 * i]: 'flag', [4 + 3 * i]: 'a', [5 + 3 * i]: 'b' })), { [3 + 3 * v.a.length]: 'end' }),
        init: (v) => Object.assign({}, ...v.a.map((x, i) => ({ [3 + 3 * i]: 1, [4 + 3 * i]: x }))), expect: (v) => ({ tape: Object.assign({}, ...v.a.map((x, i) => ({ [3 + 3 * i]: 1, [5 + 3 * i]: 2 * x }))), ptr: 3 }),
        cost: { plain: ['grows with the values', null], fast: ['3 + 3 per record', (v) => 3 + 3 * v.a.length] }, table: [{ a: [3, 1, 4] }, { a: [9, 9, 9, 9, 9] }] },
      { id: 'carry', name: 'A running total that travels along', does: 'Adds up the a of every record. The total moves from record to record in the third cell and ends just past the last record.', code: '[>[->+<]>[->>>+<<<]>]', start: 3, vars: [{ id: 'a', label: 'the a of each record', type: 'list', min: 0, max: 20, len: [0, 5], def: [3, 1, 4] }],
        labels: (v) => Object.assign({ 0: 'zero' }, ...v.a.map((_, i) => ({ [3 + 3 * i]: 'flag', [4 + 3 * i]: 'a', [5 + 3 * i]: 'carry' })), { [3 + 3 * v.a.length]: 'end', [5 + 3 * v.a.length]: 'total' }),
        init: (v) => Object.assign({}, ...v.a.map((x, i) => ({ [3 + 3 * i]: 1, [4 + 3 * i]: x }))), expect: (v) => ({ tape: Object.assign({ [5 + 3 * v.a.length]: v.a.reduce((s, x) => s + x, 0) }, ...v.a.map((x, i) => ({ [3 + 3 * i]: 1 }))), ptr: 3 + 3 * v.a.length }),
        cost: { plain: ['grows with the values', null], fast: ['1 + 3 per record', (v) => 1 + 3 * v.a.length] } },
    ],
  });

  const ARR = { id: 'a', label: 'the array', type: 'list', min: 0, max: 99, len: [1, 6], def: [7, 3, 9, 4, 6, 2] };
  const mineLabels = (v) => Object.assign({ 0: 'zero', 1: 'index', 2: v.val === undefined ? 'out' : 'value' }, ...v.a.map((_, k) => ({ [3 + 3 * k]: 'count', [4 + 3 * k]: 'item ' + k, [5 + 3 * k]: 'carry' })));
  const wikiLabels = (second) => (v) => Object.assign({ 0: 'index', 1: second, 3: 'head', 4: 'temp', 5: 'trail' }, ...v.a.map((_, k) => ({ [6 + 2 * k]: 'item ' + k, [7 + 2 * k]: 'trail' })));
  P.push({
    id: 'array-index', group: 'data', name: 'Store and fetch by index', key: 'array index address pointer table lookup random access get set',
    does: 'Reads or writes item number i of an array, when i is a value on the tape.',
    why: [
      'There are no addresses. The program cannot say "go to cell i". It can only walk, and count the walk down: the index travels along with the pointer and loses 1 at every item.',
      'In our form each item is three cells: a counter slot, the item, and a carry slot. Walking out, the counter is moved one item on and a 1 is left behind as a trail. At the item, the value is copied into the carry slot.',
      'Walking back, the trail says "not home yet": each step clears one trail mark and moves the carry one item to the left. A zero cell before the array ends the walk.',
      'The wiki form uses two cells per item and lays the whole trail first. Its fetch walks the trail once for every unit of the value, so its cost grows with index × value. Ours grows with the index only.',
    ],
    needs: ['Our form: a zero cell, the index, one more cell, then the array at three cells per item. The index is used up.', 'Wiki form: index, value or out, a temp, then head, two temps and the array at two cells per item.', 'The index must be inside the array. Any cell size.'],
    mistakes: ['An index past the end: the walk goes on into whatever follows the array.', 'Forgetting that the walk costs time. Item 1000 is 1000 hops away, every time. The project cuts this to a few dozen with long hops: see <a href="../learn/07-walking.html">Build toward a chatbot, lesson 7, "No addresses"</a>.'],
    used: ['<a href="../learn/07-walking.html">Build toward a chatbot, lesson 7, "No addresses"</a>, fetches from a table of 64 records with long and short hops.', 'The chat program avoids indexing where it can: a table whose index is known to be small becomes a decision tree in the program text (see <a href="table-lookup.html">table lookup as a decision tree</a>).'],
    sources: [src(SRC.esoAlg, 'sections "x(y) = z" and "x = y(z)" (1-d array, 2 cells per element; Jeffry Johnston). The three-cell forms are our own.')],
    variants: [
      { id: 'fetch', name: 'Fetch, carrying the value home', does: 'out gets item i. Layout: zero, index, out, then count / item / carry for each item.', code: '>[->>+<<]>>[-[->>>+<<<]+>>>]>[->+<<+>]<[->+<]<<<[->>>>>[-<<<+>>>]<<<<<<<<]>>>>>[-<<<+>>>]<<<<<', size: 64,
        vars: [ARR, num('i', 'index i', 0, 5, 2)], labels: mineLabels, ok: (v) => v.i < v.a.length, okText: 'the index has to be smaller than the number of items',
        init: (v) => Object.assign({ 1: v.i }, cells(4, v.a, 3)), expect: (v) => ({ tape: Object.assign({ 2: v.a[v.i] }, cells(4, v.a, 3)) }),
        cost: { plain: ['grows with the index, and with the value times the index', null], fast: ['7 + 7 per hop', (v) => 7 + 7 * v.i] }, table: [{ a: [7, 3, 9, 4, 6, 2], i: 0 }, { a: [7, 3, 9, 4, 6, 2], i: 5 }, { a: [7, 3, 99, 4, 6, 2], i: 2 }] },
      { id: 'store', name: 'Store', does: 'Item i becomes the value. The layout of the main form (<a href="#pattern">Fetch, carrying the value home</a>, the first figure), with the value in the third cell.', code: '>[->>+<<]>[->>>+<<<]>[-[->>>+<<<]>>[->>>+<<<]<<+>>>]>[-]>[-<+>]<<<<<[-<<<]', size: 64,
        vars: [ARR, num('i', 'index i', 0, 5, 2), num('val', 'value', 0, 99, 50)], labels: mineLabels, ok: (v) => v.i < v.a.length, okText: 'the index has to be smaller than the number of items',
        init: (v) => Object.assign({ 1: v.i, 2: v.val }, cells(4, v.a, 3)), expect: (v) => ({ tape: cells(4, v.a.map((x, k) => (k === v.i ? v.val : x)), 3) }),
        cost: { plain: ['grows with the index, and with the value times the index', null], fast: ['6 + 7 per hop', (v) => 6 + 7 * v.i] } },
      { id: 'wikiget', name: 'Fetch, the form from the wiki', does: 'out gets item i; the index is kept. Two cells per item. The walk is repeated for every unit of the value.', code: '[->>>>>+<+<<<<]>>>>[-<<<<+>>>>]<' + '>>[[>>]+[<<]>>-]+[>>]<[<[<<]>+<<<+>>>>[>>]<-]<[<<]>[>[>>]<+<[<<]>-]>[>>]<<[-<<]' + '<<<', size: 64,
        vars: [ARR, num('i', 'index i', 0, 5, 2)], labels: wikiLabels('out'), ok: (v) => v.i < v.a.length, okText: 'the index has to be smaller than the number of items',
        init: (v) => Object.assign({ 0: v.i }, cells(6, v.a, 2)), expect: (v) => ({ tape: Object.assign({ 0: v.i, 1: v.a[v.i] }, cells(6, v.a, 2)) }),
        cost: { plain: ['grows with index × value', null], fast: ['grows with index × value', null] }, table: [{ a: [7, 3, 9, 4, 6, 2], i: 0 }, { a: [7, 3, 9, 4, 6, 2], i: 5 }, { a: [7, 3, 99, 4, 6, 2], i: 2 }] },
      { id: 'wikiset', name: 'Store, the form from the wiki', does: 'Item i becomes the value; index and value are kept.', code: '[->>>>>+<<<+<<]>>[-<<+>>]<[->>>+<<+<]>[-<+>]>' + '>>[[>>]+[<<]>>-]+[>>]<[-]<[<<]>[>[>>]<+<[<<]>-]>[>>]<<[-<<]' + '<<<', size: 64,
        vars: [ARR, num('i', 'index i', 0, 5, 2), num('val', 'value', 0, 99, 50)], labels: wikiLabels('value'), ok: (v) => v.i < v.a.length, okText: 'the index has to be smaller than the number of items',
        init: (v) => Object.assign({ 0: v.i, 1: v.val }, cells(6, v.a, 2)), expect: (v) => ({ tape: Object.assign({ 0: v.i, 1: v.val }, cells(6, v.a.map((x, k) => (k === v.i ? v.val : x)), 2)) }),
        cost: { plain: ['grows with index × value', null], fast: ['grows with index × value', null] } },
    ],
  });

  const STK = (def, min) => ({ id: 's', label: 'the stack, bottom first', type: 'list', min: 0, max: 99, len: [min, 5], def });
  const stkLabels = (extra) => (v) => names(0, ['base'].concat(v.s.map((_, i) => (i === v.s.length - 1 ? 'top' : 'item')), extra || []));
  const MULTOP = '[-<[->>+>+<<<]>>>[-<<<+>>>]<<]<[-]>>[-<<+>>]<<';
  P.push({
    id: 'stack', group: 'data', name: 'A stack', key: 'push pop dup drop top forth',
    does: 'Keeps values in a pile: you add to the top and take from the top.',
    why: [
      'The tape itself is the pile, and the pointer is the top. To push, step right and write. To drop, clear and step left.',
      'Nothing has to be searched for, because the program always stands on the newest value. That makes every operation a short flat piece.',
      'Whole programs can be written this way: every piece takes its inputs from the top and leaves its result there.',
    ],
    needs: ['The pointer rests on the top item. The cells to the right of the top are zero (two of them for "duplicate" and "multiply").', 'Any cell size.'],
    mistakes: ['Leaving rubbish above the top. The next push adds to it.', 'Dropping below the base of the pile: the pointer walks off the tape.'],
    used: ['Compilers from other languages to brainfuck usually lay their values out like this.', 'The <a href="../challenges/">challenges</a> ask for a small calculator built from these pieces.'],
    sources: [src(SRC.esoAlg, 'the pieces are the wiki\'s move, copy and swap, placed at the top of a pile; the arrangement is our own')],
    variants: [
      { id: 'push', name: 'Push a constant', does: 'Step right, write.', code: (v) => '>' + rep('+', v.c), start: (v) => v.s.length, consts: [num('c', 'constant', 0, 20, 3)], vars: [STK([5, 8], 0)], labels: stkLabels(['free']), size: 16,
        init: (v) => cells(1, v.s), expect: (v) => ({ tape: cells(1, v.s.concat([v.c])), ptr: v.s.length + 1 }), cost: { plain: ['1 + the constant', (v) => 1 + v.c], fast: ['1', () => 1] } },
      { id: 'drop', name: 'Drop', does: 'Clear the top, step left.', code: '[-]<', start: (v) => v.s.length, vars: [STK([5, 8], 1)], labels: stkLabels(), size: 16,
        init: (v) => cells(1, v.s), expect: (v) => ({ tape: cells(1, v.s.slice(0, -1)), ptr: v.s.length - 1 }), cost: { plain: ['2 + 2 × top', (v) => 2 + 2 * v.s[v.s.length - 1]], fast: ['2', () => 2] } },
      { id: 'dup', name: 'Duplicate the top', does: 'A copy, with the cell two above as scratch.', code: '[->+>+<<]>>[-<<+>>]<', start: (v) => v.s.length, vars: [STK([5, 8], 1)], labels: stkLabels(['free', 'scratch']), size: 16,
        init: (v) => cells(1, v.s), expect: (v) => ({ tape: cells(1, v.s.concat([v.s[v.s.length - 1]])), ptr: v.s.length + 1 }), cost: { plain: ['5 + 15 × top', (v) => 5 + 15 * v.s[v.s.length - 1]], fast: ['3', () => 3] } },
      { id: 'add', name: 'Add the two top items', does: 'Two items become one.', code: '[-<+>]<', start: (v) => v.s.length, vars: [STK([5, 8], 2)], labels: stkLabels(), size: 16,
        init: (v) => cells(1, v.s), expect: (v) => ({ tape: cells(1, v.s.slice(0, -2).concat([v.s[v.s.length - 2] + v.s[v.s.length - 1]])), ptr: v.s.length - 1 }), cost: { plain: ['2 + 5 × top', (v) => 2 + 5 * v.s[v.s.length - 1]], fast: ['2', () => 2] } },
      { id: 'swap', name: 'Swap the two top items', does: 'Three moves, with the free cell above as scratch.', code: '[->+<]<[->+<]>>[-<<+>>]<', start: (v) => v.s.length, vars: [STK([5, 8], 2)], labels: stkLabels(['free']), size: 16,
        init: (v) => cells(1, v.s), expect: (v) => ({ tape: cells(1, v.s.slice(0, -2).concat([v.s[v.s.length - 1], v.s[v.s.length - 2]])) }), cost: { plain: ['7 + 12 × top + 5 × the one below', (v) => 7 + 12 * v.s[v.s.length - 1] + 5 * v.s[v.s.length - 2]], fast: ['4', () => 4] } },
      { id: 'program', name: 'A small program: (2 + 3) squared', does: 'Push 2, push 3, add, duplicate, multiply. The pointer starts on cell 1, the first place of the pile.', code: '++' + '>+++' + '[-<+>]<' + '[->+>+<<]>>[-<<+>>]<' + MULTOP, start: 1, labels: { 0: 'base', 1: 'result', 2: 'free', 3: 'free', 4: 'scratch' }, size: 16,
        expect: () => ({ tape: { 1: 25 }, ptr: 1 }), cost: { plain: ['821', () => 821], fast: ['29', () => 29] } },
    ],
  });

  const TXT = (def, label) => ({ id: 't', label: label || 'the input', type: 'text', max: 30, def });
  const strLabels = (v) => names(0, ['zero'].concat(utf8(v.t).map(() => 'letter'), ['end']));
  P.push({
    id: 'read-line', group: 'data', name: 'Read a line into memory', key: 'string input store text line newline',
    does: 'Reads letters and stores them in cells next to each other, up to a newline or the end of the input.',
    why: [
      'One cell per letter, from cell 1 on. Cell 0 stays zero and the cell after the last letter is zero: a string in brainfuck is a row of non-zero cells between two zeros.',
      'Those two zeros are what make the string usable. <code class="bf">[&lt;]</code> walks to its start and <code class="bf">[&gt;]</code> to its end, whatever its length: see <a href="scan.html">find a zero cell or a marker</a>.',
      'To stop at a newline, take 10 off each letter as it arrives. A newline becomes zero and ends the loop; any other letter gets its 10 back.',
    ],
    needs: ['A zero cell before the string and enough zero cells after it.', 'The newline form needs wrapping cells and an input that has a newline in it.', 'The end-of-input form needs <code class="bf">,</code> to give 0 (or leave the cell alone) at the end of the input.'],
    mistakes: ['Starting on cell 0. Then there is no zero to the left of the string and <code class="bf">[&lt;]</code> runs off the tape.', 'Input without a final newline in the newline form: at the end of the input it reads zeros for ever.'],
    used: ['<a href="reverse.html">Reverse a string</a> and <a href="compare-strings.html">compare two strings</a> start with this.', 'The chat program reads its question this way, one byte per cell, before it turns it into word pieces.'],
    sources: [src(SRC.esoAlg, 'sections "Read all characters into memory" and "Read until newline/other char"')],
    variants: [
      { id: 'newline', name: 'Up to a newline', does: 'The newline itself is not stored. The pointer ends on the zero cell after the string.', code: '>,----------[++++++++++>,----------]', vars: [TXT('hello', 'the line')], labels: strLabels, size: 64, ok: (v) => !/\n/.test(v.t), okText: 'the text has to be one line, without a newline',
        input: (v) => v.t + '\n', expect: (v) => ({ tape: cells(1, utf8(v.t)), ptr: utf8(v.t).length + 1 }), cost: { plain: ['13 + 23 per letter', (v) => 13 + 23 * utf8(v.t).length], fast: ['3 + 4 per letter', (v) => 3 + 4 * utf8(v.t).length] }, table: [{ t: '' }, { t: 'hello' }] },
      { id: 'eof', name: 'Up to the end of the input', does: 'Shorter. Needs 0 at the end of the input.', code: '>,[>,]', vars: [TXT('hello')], labels: strLabels, size: 64, eofs: ['zero', 'same'],
        input: (v) => v.t, expect: (v) => ({ tape: cells(1, utf8(v.t)), ptr: utf8(v.t).length + 1 }), cost: { plain: ['3 + 3 per letter', (v) => 3 + 3 * utf8(v.t).length], fast: ['2 + 2 per letter', (v) => 2 + 2 * utf8(v.t).length] } },
      { id: 'wiki', name: 'The form from the wiki, keeping the newline', does: 'Starts by taking 10 off the empty first cell, so cell 0 serves as the left zero. The newline is stored as the last letter and the pointer ends on it.', code: '----------[++++++++++>,----------]++++++++++', vars: [TXT('hello', 'the line')], labels: (v) => names(0, ['zero'].concat(utf8(v.t).map(() => 'letter'), ['newline'])), size: 64, ok: (v) => !/\n/.test(v.t), okText: 'the text has to be one line, without a newline',
        input: (v) => v.t + '\n', expect: (v) => ({ tape: cells(1, utf8(v.t).concat([10])), ptr: utf8(v.t).length + 1 }), cost: { plain: ['44 + 23 per letter', (v) => 44 + 23 * utf8(v.t).length], fast: ['7 + 4 per letter', (v) => 7 + 4 * utf8(v.t).length] } },
    ],
  });

  const rev = (t) => utf8(t).reverse();          // bytes, not letters
  P.push({
    id: 'reverse', group: 'data', name: 'Reverse a string', key: 'backwards print string text',
    does: 'Prints a text back to front.',
    why: [
      'After the reading loop (see <a href="read-line.html">read a line into memory</a>), the pointer stands just past the last letter. One step left is the last letter.',
      '<code class="bf">[.&lt;]</code> prints the cell and steps left, until it meets the zero cell before the string. Reversing costs nothing extra: it is the direction the pointer has to walk anyway.',
    ],
    needs: ['A zero cell before the string (the read loop starts on cell 1 for that reason).', 'Everything else as for <a href="read-line.html">read a line into memory</a>: wrapping cells for the newline form, 0 at the end of the input for the other.'],
    mistakes: ['Text in more than one byte per letter (é, 你): the bytes of each letter come out in the wrong order. The tape holds bytes, not letters.'],
    used: ['A classic first exercise; the <a href="../challenges/">challenges</a> ask for it without showing the answer.'],
    sources: [src(SRC.esoAlg, 'section "Read all characters into memory", followed by a scan to the left')],
    variants: [
      { id: 'eof', name: 'The whole input', does: 'The letters stay on the tape.', code: '>,[>,]<[.<]', vars: [TXT('stressed')], labels: strLabels, size: 64, eofs: ['zero', 'same'],
        input: (v) => v.t, expect: (v) => ({ tape: cells(1, utf8(v.t)), out: rev(v.t) }), cost: { plain: ['5 + 6 per letter', (v) => 5 + 6 * utf8(v.t).length], fast: ['3 + 4 per letter', (v) => 3 + 4 * utf8(v.t).length] }, table: [{ t: '' }, { t: 'stressed' }] },
      { id: 'line', name: 'One line', does: 'Stops at the newline and does not print it.', code: '>,----------[++++++++++>,----------]<[.<]', vars: [TXT('stressed', 'the line')], labels: strLabels, size: 64, ok: (v) => !/\n/.test(v.t), okText: 'the text has to be one line, without a newline',
        input: (v) => v.t + '\n', expect: (v) => ({ tape: cells(1, utf8(v.t)), out: rev(v.t) }), cost: { plain: ['15 + 26 per letter', (v) => 15 + 26 * utf8(v.t).length], fast: ['4 + 6 per letter', (v) => 4 + 6 * utf8(v.t).length] } },
      { id: 'clean', name: 'Clearing up behind it', does: 'Each letter is erased after it is printed, so the tape ends empty.', code: '>,[>,]<[.[-]<]', vars: [TXT('stressed')], labels: strLabels, size: 64, eofs: ['zero', 'same'],
        input: (v) => v.t, expect: (v) => ({ tape: {}, out: rev(v.t) }), cost: { plain: ['grows with the letter codes', null], fast: ['3 + 5 per letter', (v) => 3 + 5 * utf8(v.t).length] } },
    ],
  });

  P.push({
    id: 'compare-strings', group: 'data', name: 'Compare two strings', key: 'equal same text string match',
    does: 'Reads two lines and prints Y if they are the same and N if not.',
    why: [
      'The first line is stored with two empty cells after every letter. Then the second line is read one letter at a time, and each letter is taken off the stored one: a flat loop.',
      'If anything is left, the letters differed. A flag is set to 1, and the flag is carried along from letter to letter, as the running total is in the form <a href="records.html#v-carry">A running total that travels along</a> of <a href="records.html">walk an array of records</a>.',
      'A line that is longer than the other leaves letters with nothing to cancel them, so different lengths are caught by the same test.',
    ],
    needs: ['Both lines end with a newline. Wrapping cells.', 'A zero cell at the start; three cells per letter of the longer line, plus four.', 'The tape ends empty. The pointer ends past the strings: where exactly depends on their length.'],
    mistakes: ['Storing the two strings one after the other. Then every comparison of two letters is a walk between them. Next to each other, it is one step.', 'Counting the differences instead of setting a flag: 256 differences would wrap to "equal" on 8-bit cells.'],
    used: ['The idea of laying two things side by side so that one flat loop can combine them is how the chat program adds up its sums.', 'The <a href="../challenges/">challenges</a>: recognise a command word.'],
    sources: [src(SRC.esoAlg, 'the equality test and the newline loop are the wiki\'s; the side-by-side layout and the carried flag are our own')],
    variants: [
      { id: 'lines', name: 'Two lines from the input', does: 'Layout: a zero cell, two unused cells, then for each letter: letter, flag, scratch.', code: '>>>,----------[++++++++++>>>,----------]<<<[<<<]>>>' + '>>,----------[++++++++++[-<<->>]<<[[-]>[-]+<]>[->>>+<<<]>>>>,----------]' + '<<[[-]>[-]+[->>>+<<<]>>]' + '>>+<[[-]>->>++++++[-<+++++++++++++>]<.[-]<]>[>>+++++++++++[-<++++++++>]<+.[-]<->]<<', size: 160,
        vars: [{ id: 'a', label: 'first line', type: 'text', max: 20, def: 'tea' }, { id: 'b', label: 'second line', type: 'text', max: 20, def: 'ten' }], ok: (v) => !/\n/.test(v.a + v.b), okText: 'each text has to be one line',
        labels: (v) => Object.assign({ 0: 'zero' }, ...range(Math.max(utf8(v.a).length, utf8(v.b).length) + 1, (i) => ({ [3 + 3 * i]: 'letter', [4 + 3 * i]: 'flag', [5 + 3 * i]: 'scratch' }))),
        input: (v) => v.a + '\n' + v.b + '\n', expect: (v) => ({ tape: {}, ptr: 4 + 3 * Math.max(utf8(v.a).length, utf8(v.b).length), out: v.a === v.b ? 'Y' : 'N' }),
        cost: { plain: ['grows with the letter codes', null], fast: ['19 + 12 per letter when the lines are equal', null] }, table: [{ a: 'tea', b: 'tea' }, { a: 'tea', b: 'ten' }, { a: 'tea', b: 'teapot' }] },
    ],
  });

  P.push({
    id: 'print-string', group: 'io', name: 'Print a constant string', key: 'hello world text message output compact short',
    does: 'Prints a fixed text with as short a program as possible.',
    why: [
      'A letter is printed by making its code in a cell. Making each code from zero is long: "H" alone is 72 plus signs.',
      'Shorter: keep the cell and walk from one letter\'s code to the next. "l" to "o" is three plus signs.',
      'Shorter still: one loop first puts a round number in each of a few cells (near 30 for spaces, near 70 for capitals, near 100 for small letters). Each letter is then a short walk from the nearest cell. The classic "Hello World!" program is built this way.',
    ],
    needs: ['One cell, or a handful: one per group of letter codes. They are left holding the last letters.', 'Any cell size. The text is fixed when the program is written.'],
    mistakes: ['Clearing between letters. The whole gain comes from keeping what is there.', 'Counting on wrapping to reach a far letter the short way round: that makes the program depend on 8-bit cells.'],
    used: ['The chat program prints every word piece as a walk from the previous byte, inside a branch that is chosen by the race (see <a href="argmax.html">pick the largest by a race</a>).', '<a href="../learn/11-together.html">Build toward a chatbot, lesson 11, "Choosing the word"</a>, prints " Paris" this way.'],
    sources: [src({ name: 'Wikipedia: Brainfuck, "Hello World!"', url: 'https://en.wikipedia.org/wiki/Brainfuck#Hello_World!' }, 'the classic program that seeds four cells with one loop; the generator here is our own'), src(SRC.esoConst, 'for the shortest way to reach a single code')],
    variants: [
      { id: 'seeded', name: 'A few cells seeded by one loop', does: 'Type a text; the program is made for it. Each letter uses the cell that is nearest in value.', code: (v) => printSeeded(v.t), consts: [{ id: 't', label: 'the text', type: 'text', max: 40, def: 'Hello, World!' }], size: 32, labels: () => ({ 0: 'counter' }),
        expect: (v, bits, prog) => ({ tape: cells(0, prog.vals), ptr: prog.ptr, out: v.t }), cost: { plain: ['the length of the program is what counts here', null], fast: ['about 2 per letter', null] }, table: [{ t: 'Hi' }, { t: 'Hello, World!' }] },
      { id: 'delta', name: 'One cell, from letter to letter', does: 'No loop at all.', code: (v) => printDelta(v.t), consts: [{ id: 't', label: 'the text', type: 'text', max: 40, def: 'Hello, World!' }], labels: { 0: 'letter' },
        expect: (v) => ({ tape: { 0: utf8(v.t).length ? utf8(v.t)[utf8(v.t).length - 1] : 0 }, out: v.t }), cost: { plain: ['the length of the program', null], fast: ['2 per letter', null] }, table: [{ t: 'Hi' }, { t: 'Hello, World!' }] },
      { id: 'zero', name: 'Every letter from zero', does: 'The naive way, to measure against.', baseline: true, code: (v) => printFromZero(v.t), consts: [{ id: 't', label: 'the text', type: 'text', max: 40, def: 'Hello, World!' }], labels: { 0: 'letter' },
        expect: (v) => ({ tape: {}, out: v.t }), cost: { plain: ['about 5 per unit of every letter code', null], fast: ['3 per letter', (v) => 3 * utf8(v.t).length] }, table: [{ t: 'Hi' }, { t: 'Hello, World!' }] },
    ],
  });

  P.push({
    id: 'print-number', group: 'io', name: 'Print a number in decimal', key: 'output digits decimal itoa show value',
    does: 'Prints the value of a cell as digits, for example 173.',
    why: [
      'A cell holds a number; the screen wants letters. The digits are found by dividing by 10 (see <a href="divmod.html">divide, with remainder</a>): the remainder is the last digit, the quotient is the rest.',
      'So the last digit comes first. The digits are stored and then printed in the other order. Adding 48 turns a digit into its letter.',
      'The 8-bit form knows there are at most three digits and writes the two divisions out. The form for any cell size loops: divide, store a digit, go on with the quotient until it is zero, then walk back printing (see <a href="scan.html">find a zero cell or a marker</a>).',
    ],
    needs: ['8-bit form: eight cells; the value is kept; made for cells that hold 0 to 255.', 'Any-size form: the value, a zero cell, then about three cells per digit, all cleared at the end. The value is kept.', 'A single digit needs one scratch cell.'],
    mistakes: ['Printing the cell itself with <code class="bf">.</code>: that prints the letter with that code, not the number.', 'Forgetting that the cost grows with the value, because division counts. Printing 1,000,000 on 32-bit cells takes millions of steps.'],
    used: ['Any program that shows a result.', 'The chat program never prints numbers: it prints the bytes of word pieces directly.'],
    sources: [src({ name: 'Stack Overflow: "Printing a number in brainfuck", answer by itchyny', url: 'https://stackoverflow.com/questions/12569444/printing-a-number-in-brainfuck/13946554#13946554' }, 'the 8-bit form, tested here for all 256 values'), src(SRC.esoAlg, 'sections "Print value of cell x as number (8-bit)" and "… for ANY sized cell"')],
    variants: [
      { id: 'byte', name: 'A value from 0 to 255', does: 'Two divisions by 10, written out. No leading zeros.', code: '>>++++++++++<<[->+>-[>+>>]>[+[-<+>]>+>>]<<<<<<]>>[-]>>>++++++++++<[->-[>+>>]>[+[-<+>]>+>>]<<<<<]>[-]>>[>++++++[-<++++++++>]<.<<+>+>[-]]<[<[->-<]++++++[->++++++++<]>.[-]]<<++++++[-<++++++++>]<.[-]<<[-<+>]<', bits: [8, 16, 32], size: 32,
        vars: [num('x', 'x', 0, 255, 173)], labels: { 0: 'x' }, init: (v) => ({ 0: v.x }), expect: (v) => ({ tape: { 0: v.x }, out: String(v.x) }), cost: { plain: ['about 260 + 34 per unit of x', null], fast: ['about 14 + 9 per unit of x', null] }, table: [{ x: 0 }, { x: 7 }, { x: 173 }, { x: 255 }] },
      { id: 'any', name: 'Any cell size', does: 'Loops until the quotient is zero. Layout: value, zero, then working cells.', code: '>[-]>[-]+>[-]+<[>[-<-<<[->+>+<<]>[-<+>]>>]++++++++++>[-]+>[-]>[-]>[-]<<<<<[->-[>+>>]>[[-<+>]+>+>>]<<<<<]>>-[-<<+>>]<[-]++++++++[-<++++++>]>>[-<<+>>]<<]<[.[-]<]<', size: 64,
        vars: [num('x', 'x', 0, 255, 173, { hi: { 16: 65535, 32: 300000 } })], labels: { 0: 'x', 1: 'zero' }, init: (v) => ({ 0: v.x }), expect: (v) => ({ tape: { 0: v.x }, out: String(v.x) }), cost: { plain: ['about 270 + 41 per unit of x', null], fast: ['about 30 + 8 per unit of x', null] }, table: [{ x: 0 }, { x: 173 }, { x: 255 }] },
      { id: 'digit', name: 'One digit', does: 'Adds 48 and prints. For a value from 0 to 9. The cell is left holding the letter.', code: '>++++++[-<++++++++>]<.', vars: [num('x', 'x', 0, 9, 7)], labels: { 0: 'digit', 1: 'scratch' }, init: (v) => ({ 0: v.x }), expect: (v) => ({ tape: { 0: v.x + 48 }, out: String(v.x) }), cost: { plain: ['82', () => 82], fast: ['3', () => 3] } },
    ],
  });

  P.push({
    id: 'read-number', group: 'io', name: 'Read a decimal number', key: 'input digits parse atoi decimal',
    does: 'Reads digits such as 173 and puts the number they spell in a cell.',
    why: [
      'The digits arrive first to last. For every new digit: multiply what we have by 10, and add the digit. 1, then 17, then 173.',
      'A digit arrives as a letter code, 48 more than its value. So 48 is taken off first.',
      'Multiplying by 10 is the pattern <a href="mul-const.html">multiply by a constant</a>: a flat loop, one optimised step.',
    ],
    needs: ['Short form: a line that ends with a newline, digits only; two scratch cells; wrapping cells.', 'The form by Urban Müller also stops at the end of the input, with any of the three answers <code class="bf">,</code> can give there.', 'A number that does not fit the cell wraps.'],
    mistakes: ['Feeding it anything but digits. Both forms treat every letter as a digit: "a" counts as 49.', 'Typing 300 on 8-bit cells and expecting 300. The cell holds 300 − 256 = 44.'],
    used: ['With <a href="print-number.html">print a number in decimal</a> it makes a calculator: see the <a href="../challenges/">challenges</a>.'],
    sources: [src(SRC.esoAlg, 'section "Input a decimal number" (Urban Müller, 1993). The short form is our own.')],
    variants: [
      { id: 'short', name: 'A line of digits', does: 'Layout: number, letter, scratch.', code: '>,----------[>++++++[-<------>]<--<[->>++++++++++<<]>>[-<<+>>]<[-<+>],----------]<', vars: [num('n', 'the number typed', 0, 255, 173, { hi: { 16: 65535, 32: 4000000 } })], labels: { 0: 'number', 1: 'letter', 2: 'scratch' },
        input: (v) => v.n + '\n', expect: (v) => ({ tape: { 0: v.n } }), cost: { plain: ['grows with the number', null], fast: ['4 + 9 per digit', (v) => 4 + 9 * String(v.n).length] }, table: [{ n: 0 }, { n: 7 }, { n: 173 }] },
      { id: 'muller', name: 'The form by Urban Müller', does: 'Stops at a newline or at the end of the input. Layout: number, flag, letter, scratch.', code: '[-]>[-]+[[-]>[-],[+[-----------[>[-]++++++[<------>-]<--<<[->>++++++++++<<]>>[-<<+>>]<+>]]]<]<', vars: [num('n', 'the number typed', 0, 255, 173, { hi: { 16: 65535, 32: 4000000 } }), { id: 'nl', label: 'ends with', type: 'choice', def: 'newline', options: [['newline', 'a newline'], ['none', 'the end of the input']] }], labels: { 0: 'number', 1: 'flag', 2: 'letter', 3: 'scratch' },
        eofs: ['zero', 'minus', 'same'], input: (v) => v.n + (v.nl === 'newline' ? '\n' : ''), expect: (v) => ({ tape: { 0: v.n } }), cost: { plain: ['grows with the number', null], fast: ['16 + 19 per digit', null] }, table: [{ n: 173, nl: 'newline' }] },
    ],
  });

  P.push({
    id: 'echo', group: 'io', name: 'Echo until the end of the input', key: 'cat copy input output eof end of file portable',
    does: 'Prints everything it reads and stops when the input ends, on any interpreter.',
    why: [
      'The loop itself is simple: read, and while there is a letter, print it and read again. The hard part is "while there is a letter".',
      'Brainfuck never fixed what <code class="bf">,</code> does when the input is over. Some interpreters put 0 in the cell, some put −1, some leave the cell as it was. A program that only knows one of the three hangs on the others.',
      'The portable form covers all three. It clears the cell before each read, so "left as it was" becomes 0. And it tests each letter twice: is it 0, and is it 0 after adding 1 (which catches −1).',
    ],
    needs: ['Portable form: one zero cell on each side of the working cell. It starts on cell 0 and reads into cell 1.', 'The pointer ends on cell 1 when the end was 0 or "no change", and on cell 0 when it was −1.', 'A byte with all bits set (255) in the input ends the portable form early.'],
    mistakes: ['Testing a program with one interpreter only. Use the choice "At the end of the input, the comma gives", in More controls under <a href="#fig-echo-portable">the first figure</a>, to try all three answers.', 'Using <code class="bf">,[.,]</code> where the end of the input is −1: it prints the byte 255 for ever.'],
    used: ['Every program that reads until the end: <a href="read-line.html">read a line into memory</a>, <a href="reverse.html">reverse a string</a>.', '<a href="../challenges/basics/06-input.html#s3">Brainfuck basics, lesson 6, "Reading input"</a>, builds the short form in its section "Until there is nothing left".', 'The reference page <a href="../reference/portability.html#eof">Where implementations differ</a> shows the three answers in its section "The end of the input", and its <a href="../reference/portability.html#table">compatibility table</a> lists what six implementations and descriptions do.'],
    sources: [src(SRC.esoAlg, 'the −1 test is the one in "Input a decimal number" (Urban Müller); the arrangement here is our own'), src({ name: 'Esolang wiki: Brainfuck, "EOF"', url: 'https://esolangs.org/wiki/Brainfuck#EOF' }, 'the three conventions')],
    variants: [
      { id: 'portable', name: 'For all three conventions', does: 'Layout: zero, letter, zero.', code: '>,[+[-.[-],>]<]', eofs: ['zero', 'minus', 'same'], vars: [TXT('abc')], labels: { 0: 'zero', 1: 'letter', 2: 'zero' },
        input: (v) => v.t, ok: (v) => !utf8(v.t).includes(255), okText: 'the text may not contain the byte 255', expect: (v, b, p, eof) => ({ tape: {}, ptr: eof === 'minus' ? 0 : 1, out: v.t }), cost: { plain: ['grows with the letter codes', null], fast: ['2 + 8 per letter', null] }, table: [{ t: '' }, { t: 'abc' }] },
      { id: 'zero', name: 'End of input is 0', does: 'The shortest form. Also the most common convention.', code: ',[.,]', eofs: ['zero'], vars: [TXT('abc')], labels: { 0: 'letter' },
        input: (v) => v.t, expect: (v) => ({ tape: {}, out: v.t }), cost: { plain: ['2 + 3 per letter', (v) => 2 + 3 * utf8(v.t).length], fast: ['2 + 3 per letter', (v) => 2 + 3 * utf8(v.t).length] } },
      { id: 'minus', name: 'End of input is −1', does: 'Adds 1 before the test and takes it off again inside.', code: ',+[-.,+]', eofs: ['minus'], eof: 'minus', vars: [TXT('abc')], labels: { 0: 'letter' },
        input: (v) => v.t, expect: (v) => ({ tape: {}, out: v.t }), cost: { plain: ['3 + 5 per letter', (v) => 3 + 5 * utf8(v.t).length], fast: ['3 + 5 per letter', (v) => 3 + 5 * utf8(v.t).length] } },
    ],
  });

  const ADV_NEEDS = 'Cells that wrap at a known width. The program text is made for that width (8, 16 or 32 bits) and gives wrong answers on any other.';
  const ADV_FAST = 'To be fast it needs an interpreter that does a flat loop in one step. In plain steps the shifts are long loops and the gain is lost.';

  P.push({
    id: 'bit-peel', group: 'advanced', name: 'The bit peel', key: 'bits binary read number bit by bit shift wrap',
    does: 'Reads a number bit by bit, at a fixed cost per bit, instead of counting it down unit by unit.',
    why: [
      'On a cell that wraps, multiplying by 2 pushes the top bit out of the cell. Multiply by enough twos and only one bit of the number is left inside: the cell is non-zero exactly when that bit is set.',
      'And multiplying is a flat loop: one step. So "is bit j set?" becomes a question brainfuck can ask, at a cost that does not depend on the number.',
      'The peel asks it for the lowest bit first. If the bit is set, it is taken off the number, so that the next test sees one bit again. Eight bits take 23 to 56 optimised steps: 23 when one bit is set, 56 when all eight are. The size of the number does not come into it.',
      'Everything on the advanced pages is "peel some bits and do something for each set bit".',
    ],
    needs: [ADV_NEEDS, ADV_FAST, 'Six scratch cells, zero before and after. The number is used up.'],
    mistakes: ['Running the 8-bit text on 16-bit cells: the bits no longer fall out where the text expects.', 'Peeling from the top bit down. The low bits must be gone first, or the test sees several bits at once.'],
    used: ['<a href="../learn/05-peel.html">Build toward a chatbot, lesson 5, "Peeling off bits"</a>, builds it up from a single doubling.', 'In the chat model: <code>peel</code> in patterns.js. Its division, its multiplication and its lookups all rest on it: see <a href="../how/#s9">How it works, section "Why it does not take a year"</a>.', 'Built on it in this library: <a href="shift-round-clamp.html">shift, round and clamp</a>, <a href="signed-multiply.html">signed multiplication</a>, <a href="table-lookup.html">table lookup</a>.'],
    sources: [src(SRC.project, 'peel')],
    compare: { text: 'The same eight bits by halving the number eight times with the division loop of <a href="divmod.html">divide, with remainder</a>.', rows: [{ x: 1 }, { x: 100 }, { x: 255 }] },
    variants: [
      { id: 'peel', name: 'Eight bits of a number', does: 'The number is in cell 0. Its bits end up in eight cells, lowest first.', gen: true, size: 64,
        code: (v, bits, G) => {
          const p = PG(G, bits), O = 8;
          if (bits === 8) p.peel(0, { m: 8, onSet: (j) => p.add(O + j, 1) }, { Zo: 1, T: 2, H: [3, 4], K: 5, Kt: 6 });
          else { p.shl(0, 1, bits - 8, [3, 4]); p.peel(1, { m: 8, onSet: (j) => p.add(O + j, 1) }, { Zo: 7, T: 2, H: [3, 4], K: 5, Kt: 6 }); }
          return { code: p.toString(), ptr: p.ptr };
        },
        vars: [num('x', 'x', 0, 255, 100)], labels: () => Object.assign({ 0: 'x' }, ...range(8, (j) => ({ [8 + j]: 'bit ' + j }))),
        init: (v) => ({ 0: v.x }), expect: (v, b, prog) => ({ tape: Object.assign({}, ...range(8, (j) => ({ [8 + j]: (v.x >> j) & 1 }))), ptr: prog.ptr }),
        cost: { plain: ['hundreds to tens of thousands: each shift is a long loop', null], fast: ['about 18 + 5 per set bit', null] }, table: [{ x: 1 }, { x: 100 }, { x: 255 }] },
      { id: 'halving', name: 'The naive way: halve eight times', does: 'Each bit is the remainder of a division by 2. Works on any cell size, and costs time for every unit of the number.', baseline: true, code: bitsByHalving(), size: 64,
        vars: [num('x', 'x', 0, 255, 100)], labels: () => Object.assign({ 0: 'x' }, ...range(8, (j) => ({ [7 + j]: 'bit ' + j }))),
        init: (v) => ({ 0: v.x }), expect: (v) => ({ tape: Object.assign({}, ...range(8, (j) => ({ [7 + j]: (v.x >> j) & 1 }))) }),
        cost: { plain: ['about 55 per unit of x', null], fast: ['about 16 per unit of x', null] }, table: [{ x: 1 }, { x: 100 }, { x: 255 }] },
    ],
  });

  const rq = (X, k) => clamp(Math.floor((X + 2 ** (k - 1)) / 2 ** k), -128, 127);
  P.push({
    id: 'shift-round-clamp', group: 'advanced', name: 'Shift, round and clamp', key: 'divide power of two requant quantise round clamp limit saturate signed',
    does: 'Divides a signed number by a power of two, rounds it, and keeps the result between −128 and 127.',
    why: [
      'Dividing by 2ᵏ means: throw away the k lowest bits. <a href="bit-peel.html">The bit peel</a> reads the bits one by one, so it can simply not write the low ones.',
      'Rounding is free: add half of 2ᵏ before the division. Negative numbers are free too: add a fixed offset first so that everything is positive, and take it off the result.',
      'The limits are checked without comparing. A second copy of the number has every peeled bit taken off again. If that copy is not zero at the end, the number was outside the range, and only then are the high bits looked at to see on which side.',
    ],
    needs: [ADV_NEEDS, ADV_FAST, 'Ten scratch cells. The input is used up. The true value must fit the cell, and k + 8 must be less than the cell width.'],
    mistakes: ['Letting the sum wrap before it is clamped. A clamp cannot repair a number that has already gone round.', 'Using this for a divisor that is not a power of two. For that the project multiplies by a reciprocal from a table first (see <a href="table-lookup.html">table lookup as a decision tree</a>).'],
    used: ['<a href="../learn/05-peel.html">Build toward a chatbot, lesson 5, "Peeling off bits"</a>, builds it. <a href="../learn/09-neuron.html">Build toward a chatbot, lesson 9, "One number of the model"</a>, uses it for one number of the model.', 'In the chat model: <code>requant</code> in patterns.js. Every number the model works out goes through it, which keeps the values small: see <a href="../how/#s6">How it works, section "Multiply and add"</a>.'],
    sources: [src(SRC.project, 'requant, requantCore, requantCount (the baseline)')],
    compare: { text: 'The same division by counting: take 2ᵏ units off, add 1 to the result, again and again. That baseline does not even clamp, and it only takes numbers that are not negative.', rows: [{ k: 7, X: 11868 }, { k: 7, X: 300 }, { k: 4, X: 1000 }],
      project: 'Measured in the project on the sums of a real layer (64 inputs, shift 10, 32-bit cells): about 100 optimised steps per result with the peel, against 1.2 to 1.5 million by counting.' },
    variants: [
      { id: 'requant', name: 'Divide by 2ᵏ, round, clamp to −128…127', does: 'X is in cell 0, the result goes to cell 1. Ten scratch cells follow.', gen: true, bits: [32, 16], size: 64,
        code: (v, bits, G) => { const p = PG(G, bits); p.requant(0, 1, { k: v.k, n: 8, addend: 2 ** (v.k - 1) }, range(10, (i) => 2 + i)); return { code: p.toString(), ptr: p.ptr }; },
        consts: [num('k', 'shift k', 1, 10, 7)], vars: [num('X', 'X', -200000, 200000, 11868)], signed: true, labels: { 0: 'X', 1: 'result' },
        ok: (v, bits) => v.k + 8 <= bits - 1 && Math.abs(v.X) + 2 ** (v.k - 1) + 2 ** (v.k + 7) < 2 ** (bits - 1), okText: 'the shift and the rounding have to fit in a signed cell',
        init: (v) => ({ 0: v.X }), expect: (v, b, prog) => ({ tape: { 1: rq(v.X, v.k) }, ptr: prog.ptr }),
        cost: { plain: ['tens of thousands and more', null], fast: ['75 to 100 inside the range, about 160 when the result is clamped', null] }, table: [{ k: 7, X: 11868 }, { k: 7, X: -3000 }, { k: 7, X: 99999 }, { k: 4, X: 1000 }] },
      { id: 'count', name: 'The naive way: divide by counting', does: 'Rounds, but does not clamp, and X must not be negative.', baseline: true, gen: true, bits: [32, 16], size: 64,
        code: (v, bits, G) => { const p = PG(G, bits); p.addConst(0, 2 ** (v.k - 1), 2); p.requantCount(0, 1, v.k, [2, 3, 4, 5]); return { code: p.toString(), ptr: p.ptr }; },
        consts: [num('k', 'shift k', 1, 10, 7)], vars: [num('X', 'X', 0, 30000, 11868)], labels: { 0: 'X', 1: 'result', 2: 'counter' },
        ok: (v, bits) => v.X + 2 ** v.k < 2 ** (bits - 1), okText: 'X plus 2^k has to fit in a signed cell',
        init: (v) => ({ 0: v.X }), expect: (v, b, prog) => ({ tape: { 1: Math.floor((v.X + 2 ** (v.k - 1)) / 2 ** v.k) }, ptr: prog.ptr }),
        cost: { plain: ['grows with X × 2ᵏ', null], fast: ['about 11 per unit of X', null] }, table: [{ k: 7, X: 11868 }, { k: 7, X: 300 }, { k: 4, X: 1000 }] },
    ],
  });

  const sext8 = (a) => { const u = ((a % 256) + 256) % 256; return u >= 128 ? u - 256 : u; };
  P.push({
    id: 'signed-multiply', group: 'advanced', name: 'Signed multiplication by shift-and-add', key: 'multiply variable negative two cells product shift add',
    does: 'Multiplies two numbers from the tape, negative ones too, at a cost that does not depend on the numbers.',
    why: [
      'This is long multiplication in base 2. Read a bit by bit with <a href="bit-peel.html">the bit peel</a>. For every set bit j, add b × 2ʲ to the answer.',
      'b × 2ʲ is the pattern <a href="mul-const.html">multiply by a constant</a>, a flat loop: one step, and b is kept with a second step.',
      'The top bit of a signed number counts negative, so for that one bit the same loop subtracts. Nothing else is needed for negative numbers.',
      'So the cost is about 25 steps for the eight tests and 5 more for every set bit of a: 28 to 60 in all, whether b is 7 or 7 million.',
    ],
    needs: [ADV_NEEDS, ADV_FAST, 'Eight scratch cells. a is read as a signed 8-bit number; b may be any value. Both are kept.'],
    mistakes: ['Peeling the wider of the two numbers. The cost follows the bits of a: peel the narrow one.', 'An a outside −128…127: only its low 8 bits are used.'],
    used: ['<a href="../learn/06-product.html">Build toward a chatbot, lesson 6, "Two numbers from the tape"</a>, multiplies −25 by −60 with it.', 'In the chat model: <code>mulAcc</code> and <code>dotVar</code> in patterns.js. It is what makes attention possible, because there both numbers come from the tape: see <a href="../how/#s7">How it works, section "Looking back at the other words"</a>.', '<a href="../learn/10-attention.html">Build toward a chatbot, lesson 10, "Looking back"</a>, uses it twice.'],
    sources: [src(SRC.project, 'mulAcc; the baseline is addMul in emit.js')],
    compare: { text: 'The same product by repeated addition, the loop of <a href="mul-cells.html">multiply two cells</a>. A negative a is a huge count there: −3 on 16-bit cells is 65,533 rounds.', rows: [{ a: 6, b: 7 }, { a: 100, b: -60 }, { a: -25, b: -60 }], bits: 16,
      project: 'Measured in the project on 16-bit cells with both numbers between −127 and 127: about 43 optimised steps per product, against about 195,000 by repeated addition.' },
    variants: [
      { id: 'mulacc', name: 'acc gets a × b added', does: 'Layout: a, b, acc, then eight scratch cells.', gen: true, bits: [32, 16], size: 64,
        code: (v, bits, G) => { const p = PG(G, bits); p.mulAcc(0, 8, [[1, 2]], range(8, (i) => 3 + i)); return { code: p.toString(), ptr: p.ptr }; },
        vars: [num('a', 'a', -128, 127, -25), num('b', 'b', -255, 255, -60, { hi: { 32: 100000 } })], signed: true, labels: { 0: 'a', 1: 'b', 2: 'acc' },
        init: (v) => ({ 0: v.a, 1: v.b }), expect: (v, b, prog) => ({ tape: { 0: v.a, 1: v.b, 2: sext8(v.a) * v.b }, ptr: prog.ptr }),
        cost: { plain: ['tens of thousands and more', null], fast: ['about 25 + 5 per set bit of a', null] }, table: [{ a: 6, b: 7 }, { a: 100, b: -60 }, { a: -25, b: -60 }, { a: -128, b: -128 }] },
      { id: 'naive', name: 'The naive way: repeated addition', does: 'The loop of <a href="mul-cells.html">multiply two cells</a>. Correct for negative numbers on wrapping cells, and very slow for them.', baseline: true, bits: [8, 16], size: 64,
        code: '[->>>+<<[->+>>+<<<]>>>[-<<<+>>>]<<<<]>>>[-<<<+>>>]', vars: [num('a', 'a', -128, 127, -25), num('b', 'b', -255, 255, -60)], signed: true, labels: { 0: 'a', 1: 'b', 2: 'acc', 3: 'scratch', 4: 'scratch' },
        init: (v) => ({ 0: v.a, 1: v.b }), expect: (v) => ({ tape: { 0: v.a, 1: v.b, 2: v.a * v.b }, ptr: 3 }),
        cost: { plain: ['grows with a × b, each read as a count', null], fast: ['2 + 5 × a, with a read as a count', null] }, table: [{ a: 6, b: 7 }, { a: 100, b: -60 }, { a: -25, b: -60 }] },
    ],
  });

  P.push({
    id: 'table-lookup', group: 'advanced', name: 'Table lookup as a decision tree', key: 'table array constant index switch case function tree',
    does: 'Gives entry number x of a fixed table, in a number of steps that depends on the size of the table and not on x.',
    why: [
      'The table is not on the tape. It is in the program text, as a tree of <a href="if-else.html">if and else</a>: first "is bit 0 of x set?", inside each answer "is bit 1 set?", and so on. At the end of each path one entry is added to the result.',
      'The questions are the tests of <a href="bit-peel.html">the bit peel</a>, so no bit is ever stored. A table of 256 entries is 8 questions deep: about 70 steps.',
      'The price is length. Every entry has its own path in the text. The table of 16 squares here is about 4,000 characters; with 256 entries it is 134,000.',
    ],
    needs: [ADV_NEEDS, ADV_FAST, 'Nine scratch cells. The table length is a power of two. An x past the end counts from the start again.'],
    mistakes: ['Using it for a big table. The text grows with the table; the tape form, <a href="array-index.html">store and fetch by index</a>, does not.', 'Using a tree where x is nearly always tiny. A chain of "take 1 off, still not zero?" is shorter and then just as fast: that is the form <a href="#v-chain">The naive way: a chain</a> on this page.'],
    used: ['<a href="../learn/10-attention.html">Build toward a chatbot, lesson 10, "Looking back"</a>: the weights of attention and the reciprocal for its division come from two such tables.', 'In the chat model: <code>lookup</code> in patterns.js, for the weights of attention and for dividing by their total: see <a href="../how/#s7">How it works, section "Looking back at the other words"</a>.'],
    sources: [src(SRC.project, 'lookup, lookupChain (the baseline)')],
    compare: { text: 'The same table as a chain: take 1 off x and add the next difference, once for every unit of x.', rows: [{ size: 256, x: 3 }, { size: 256, x: 100 }, { size: 256, x: 255 }], bits: 16,
      project: 'Measured in the project for a table of 256 entries and a random x: about 68 optimised steps with the tree, against about 500 with the chain.' },
    variants: [
      { id: 'tree', name: 'A table of squares', does: 'y gets entry x of the table 0, 1, 4, 9, … added. x is kept. Layout: x, y, then nine scratch cells.', gen: true, bits: [32, 16], size: 64,
        code: (v, bits, G) => { const p = PG(G, bits); p.lookup(0, 1, lookupTable(v.size), range(9, (i) => 2 + i)); return { code: p.toString(), ptr: p.ptr }; },
        consts: [{ id: 'size', label: 'entries', type: 'choice', def: 16, options: [[16, '16'], [64, '64'], [256, '256']] }], vars: [num('x', 'x', 0, 255, 5)], labels: { 0: 'x', 1: 'y' },
        init: (v) => ({ 0: v.x }), expect: (v, b, prog) => ({ tape: { 0: v.x, 1: lookupTable(v.size)[v.x % v.size] }, ptr: prog.ptr }),
        cost: { plain: ['thousands', null], fast: ['about 40 for 16 entries, 60 to 80 for 256', null] }, table: [{ size: 16, x: 5 }, { size: 256, x: 3 }, { size: 256, x: 100 }, { size: 256, x: 255 }] },
      { id: 'chain', name: 'The naive way: a chain', does: 'Nested loops, one per entry. Short text, and a cost per unit of x.', baseline: true, gen: true, bits: [32, 16], size: 64,
        code: (v, bits, G) => { const p = PG(G, bits); p.lookupChain(0, 1, lookupTable(v.size), [2, 3, 4]); return { code: p.toString(), ptr: p.ptr }; },
        consts: [{ id: 'size', label: 'entries', type: 'choice', def: 16, options: [[16, '16'], [64, '64'], [256, '256']] }], vars: [num('x', 'x', 0, 255, 5)], labels: { 0: 'x', 1: 'y', 2: 'counter' }, ok: (v) => v.x < v.size, okText: 'x has to be smaller than the number of entries',
        init: (v) => ({ 0: v.x }), expect: (v, b, prog) => ({ tape: { 0: v.x, 1: lookupTable(v.size)[v.x] }, ptr: prog.ptr }),
        cost: { plain: ['grows with x', null], fast: ['about 4 per unit of x', null] }, table: [{ size: 16, x: 5 }, { size: 256, x: 3 }, { size: 256, x: 100 }, { size: 256, x: 255 }] },
    ],
  });

  const frameLabels = (v) => Object.assign({ 0: 'scratch' }, ...range(v.n, (i) => ({ [2 + 4 * i]: 'marker', [3 + 4 * i]: 'x', [4 + 4 * i]: 'y', [5 + 4 * i]: 'tmp' })));
  const frameCode = (loop) => (v, bits, G) => {
    const p = PG(G, bits), S = 4, m0 = 2;
    if (loop) p.eachFrame(m0, S, v.n, 0, () => p.addMulConst(m0 + 1, m0 + 2, 3, m0 + 3));
    else for (let i = 0; i < v.n; i++) p.addMulConst(m0 + i * S + 1, m0 + i * S + 2, 3, m0 + i * S + 3);
    return { code: p.toString(), ptr: p.ptr };
  };
  P.push({
    id: 'frames', group: 'advanced', name: 'One copy of code over many frames', key: 'loop each frame stride code size relative repeat array',
    does: 'Runs one piece of program at many places on the tape, so the program text holds it once instead of many times.',
    why: [
      'A program that is written out for 512 places is 512 times as long. Length is a real cost here: the chat program is a file you have to load.',
      'Moves in brainfuck are relative, so a piece written for the first place works at every place. The tape is cut into equal stretches, <b>frames</b>, and a loop does the piece and then steps one frame on.',
      'One flat loop first puts a marker in every frame. The walking loop takes the marker away as it goes and stops at the first frame without one. That costs 2 steps more per frame than writing the piece out.',
    ],
    needs: ['Frames of equal length; the piece may use only cells of its own frame, scratch cells included.', 'One marker cell per frame, zero outside the call, and a zero cell where the next frame would start. One scratch cell for laying the markers.', 'Any cell size: this pattern does not need wrapping.'],
    mistakes: ['A piece that reaches into the next frame for scratch space.', 'Forgetting that results must leave the frame by being carried: see the form <a href="records.html#v-carry">A running total that travels along</a> of <a href="records.html">walk an array of records</a>.'],
    used: ['<a href="../learn/07-walking.html">Build toward a chatbot, lesson 7, "No addresses"</a>, does one job at 512 places with it.', 'In the project: <code>eachFrame</code> in patterns.js. One rounding step is 5,000 to 13,000 characters; the model needs it at hundreds of places per layer.', '<a href="../inside/">Inside the program</a> and <a href="../map/">the map</a> show the frames on the real tape of the chat model.'],
    sources: [src(SRC.project, 'eachFrame')],
    compare: { text: 'The same job written out once per frame. The steps are nearly the same; look at the length of the text.', rows: [{ n: 8, a: 2 }, { n: 64, a: 2 }], chars: true,
      project: 'Measured in the project: one clamped rounding step looped over 64 cells is one copy of the text (about 6,000 characters) and a few extra steps per cell, instead of 64 copies.' },
    variants: [
      { id: 'loop', name: 'y = 3 × x in every frame', does: 'Frames of four cells from cell 2 on: marker, x, y, tmp. The x of frame i is "first x" + i.', gen: true, size: (v) => 2 + (v.n + 1) * 4 + 4,
        code: frameCode(true), consts: [num('n', 'frames', 1, 64, 4)], vars: [num('a', 'first x', 0, 20, 2)], labels: frameLabels,
        init: (v) => Object.assign({}, ...range(v.n, (i) => ({ [3 + 4 * i]: v.a + i }))), expect: (v, b, prog) => ({ tape: Object.assign({}, ...range(v.n, (i) => ({ [3 + 4 * i]: v.a + i, [4 + 4 * i]: 3 * (v.a + i) }))), ptr: prog.ptr }),
        cost: { plain: ['grows with the values', null], fast: ['3 + 4 per frame', (v) => 3 + 4 * v.n] }, table: [{ n: 4, a: 2 }, { n: 8, a: 2 }, { n: 64, a: 2 }] },
      { id: 'unrolled', name: 'The naive way: written out per frame', does: 'The same piece, n times in the text.', baseline: true, gen: true, size: (v) => 2 + (v.n + 1) * 4 + 4,
        code: frameCode(false), consts: [num('n', 'frames', 1, 64, 4)], vars: [num('a', 'first x', 0, 20, 2)], labels: frameLabels,
        init: (v) => Object.assign({}, ...range(v.n, (i) => ({ [3 + 4 * i]: v.a + i }))), expect: (v, b, prog) => ({ tape: Object.assign({}, ...range(v.n, (i) => ({ [3 + 4 * i]: v.a + i, [4 + 4 * i]: 3 * (v.a + i) }))), ptr: prog.ptr }),
        cost: { plain: ['grows with the values', null], fast: ['2 per frame', null] }, table: [{ n: 4, a: 2 }, { n: 8, a: 2 }, { n: 64, a: 2 }] },
    ],
  });

  const SCORES = { id: 's', label: 'the scores', type: 'list', min: 0, max: 255, len: [2, 8], def: [93, 41, 207, 150] };
  P.push({
    id: 'argmax', group: 'advanced', name: 'Pick the largest by a race', key: 'maximum max argmax largest highest winner compare many',
    does: 'Finds which of many numbers is the largest, without comparing any two of them.',
    why: [
      'Add 1 to every number at the same time, again and again. The first one to reach the top was the largest. "Add 1 to all" is one flat loop: one step, however many numbers there are.',
      '"Has anyone arrived?" is a scan (see <a href="scan.html">find a zero cell or a marker</a>). The numbers are stored as "distance still to go", so an arrival is a zero cell, and <code class="bf">[&gt;&gt;&gt;&gt;&gt;]</code> slides over all the others and stops on it. If nobody has arrived it stops on an empty frame at the end, and a marker there says "go round again".',
      'A race over the whole value would take up to 256 rounds. So each number is split into two digits of 4 bits. The race is run on the high digits first, 16 rounds at most; only the winners of that race take part in the race on the low digits.',
      'The first of several equal numbers wins, because the scan comes from the left.',
    ],
    needs: ['Each number in a frame of five cells: marker, marker, result, high digit, low digit, with one empty frame before and after. One scratch cell.', 'Any cell size that wraps. The numbers are used up; the result is a 1 in the result cell of the winner.', ADV_FAST],
    mistakes: ['Racing on whole values. With 512 numbers a round is about 515 steps; 200 rounds are 100,000 steps.', 'Forgetting the empty frames at both ends: the scan needs a place to stop, and the walk home needs one too.'],
    used: ['<a href="../learn/11-together.html">Build toward a chatbot, lesson 11, "Choosing the word"</a>: it chooses the next word piece this way.', 'In the chat model: <code>argmax</code> in patterns.js picks the next word piece out of tens of thousands: see <a href="../how/#s8">How it works, section "Choosing the word"</a>. <code>splitDigits</code> makes the digits with <a href="bit-peel.html">the bit peel</a>.'],
    sources: [src(SRC.project, 'argmax, argmaxRaceNaive (the baseline), frames, splitDigits')],
    compare: { text: 'The race of the first version of this project: count every number down by 1 per round, and test each one for zero with a copy.', rows: [{ s: [93, 41, 207, 150] }, { s: [3, 1, 2, 0, 3, 2, 1, 0] }],
      project: 'Measured in the project for 512 scores on 32-bit cells: about 5,000 optimised steps with digits of 2 bits, against 119,000 to 595,000 for the baseline, depending on how high the best score is.' },
    variants: [
      { id: 'digits', name: 'Two digits of four bits', does: 'Type the scores (0 to 255). Each is stored as its two digits. The winner gets a 1 in its result cell.', gen: true, size: 128,
        code: (v, bits, G) => { const p = PG(G, bits), fr = G.Patterns.frames(0, v.s.length, 2); p.argmax(fr, [{ top: 16, span: 16 }, { top: 16, span: 16 }], fr.end); return { code: p.toString(), ptr: p.ptr, fr }; },
        consts: [SCORES], labels: (v, b, prog) => Object.assign({}, ...v.s.map((_, i) => ({ [prog.fr.OH(i)]: 'result ' + i, [prog.fr.X(i, 0)]: 'high ' + i, [prog.fr.X(i, 1)]: 'low ' + i })), { [prog.fr.end]: 'scratch' }),
        init: (v, b, prog) => Object.assign({}, ...v.s.map((x, i) => ({ [prog.fr.X(i, 0)]: x >> 4, [prog.fr.X(i, 1)]: x & 15 }))), expect: (v, b, prog) => ({ tape: { [prog.fr.OH(argmaxRef(v.s))]: 1 }, ptr: prog.ptr }),
        cost: { plain: ['hundreds to thousands', null], fast: ['about (numbers + 3) per round; at most 32 rounds', null] }, table: [{ s: [93, 41, 207, 150] }, { s: [3, 1, 2, 0, 3, 2, 1, 0] }, { s: [255, 255] }] },
      { id: 'naive', name: 'The naive way: count down and test each one', does: 'The lowest "distance to go" wins, so each score is stored as 255 − score. Scores in cells 0…, results after them.', baseline: true, gen: true, size: 128,
        code: (v, bits, G) => { const p = PG(G, bits), N = v.s.length, us = range(N), ohs = range(N, (i) => N + i); p.argmaxRaceNaive(us, ohs, [2 * N, 2 * N + 1, 2 * N + 2, 2 * N + 3]); return { code: p.toString(), ptr: p.ptr }; },
        consts: [SCORES], labels: (v) => Object.assign({}, ...v.s.map((_, i) => ({ [i]: 'to go ' + i, [v.s.length + i]: 'result ' + i }))),
        init: (v) => cells(0, v.s.map((x) => 255 - x)), expect: (v, b, prog) => ({ tape: { [v.s.length + argmaxRef(v.s)]: 1 }, ptr: prog.ptr }),
        cost: { plain: ['grows with numbers × (255 − best)', null], fast: ['about 10 per number per round; 255 − best rounds', null] }, table: [{ s: [93, 41, 207, 150] }, { s: [3, 1, 2, 0, 3, 2, 1, 0] }, { s: [255, 255] }] },
    ],
  });

  const VALS = { id: 'a', label: 'the numbers (13 to 262)', type: 'list', min: 13, max: 262, len: [1, 12], def: [100, 64, 200, 31, 127, 250] };
  P.push({
    id: 'digit-planes', group: 'advanced', name: 'Write many numbers compactly as digits', key: 'constants data weights size compact encode digits radix planes',
    does: 'Puts a long row of fixed numbers on the tape with a few characters per number, instead of one plus sign per unit.',
    why: [
      'A number written as plus signs costs its own value in characters. Written in digits it costs a few characters per digit: 200 is 1, 3, 0 in base 5 with digits from −2 to 2.',
      'The row is written one digit place at a time, for all numbers at once. The text walks along the row and gives every cell its small top digit. Then one loop, <code class="bf">[[-&lt;+++++&gt;]&gt;]</code>, multiplies every cell by 5 into its left neighbour. Then the next digit is added, and so on.',
      'That loop tests the cell it stands on to know whether the row has ended. So no cell may be zero on the way: every number starts at 1, and the digits are chosen with that in mind.',
    ],
    needs: ['The row ends up three cells to the left of where it is first written: one cell per digit place.', 'A zero cell after the row. Cells wide enough for the numbers (here above 255, so 16 or 32 bits).', 'With this simple form the numbers must lie between 13 and 262.'],
    mistakes: ['A number that passes through zero between two digit places: the multiplying loop stops there and the rest of the row is lost.', 'Thinking this saves steps. It saves characters; the steps are about the same.'],
    used: ['<a href="../learn/08-size.html">Build toward a chatbot, lesson 8, "Size"</a>: holding 135 million weights.', 'The chat model writes all its weights onto the tape this way before it starts: see <a href="../how/#weights">How it works, section "A billion characters of numbers"</a>. Its encoder (compiler/smollm/pure/encode.js) uses more digit places and a final correction; this page shows the simplified form that <a href="../learn/08-size.html">Build toward a chatbot, lesson 8, "Size"</a>, uses.'],
    sources: [src(SRC.project, 'the encoder of the chat program, simplified as in <a href="../learn/08-size.html">Build toward a chatbot, lesson 8, "Size"</a>')],
    compare: { text: 'The same row written with one plus sign per unit. Look at the length of the text.', rows: [{ a: [100, 64, 200, 31, 127, 250] }, { a: [262, 262, 262, 262, 262, 262, 262, 262, 262, 262, 262, 262] }], chars: true },
    variants: [
      { id: 'planes', name: 'Three digit places in base 5', does: 'Type the numbers. They end up in cells 1, 2, 3, …', code: (v) => writeDigits(v.a), bits: [16, 32], size: 32, consts: [VALS], labels: (v) => names(1, v.a.map((_, i) => 'number ' + i)),
        expect: (v, b, prog) => ({ tape: cells(1, v.a), ptr: prog.ptr }), cost: { plain: ['about 7 per unit of every number', null], fast: ['about 9 per number', null] }, table: [{ a: [100, 64, 200, 31, 127, 250] }, { a: [262, 262, 262, 262, 262, 262, 262, 262, 262, 262, 262, 262] }] },
      { id: 'plain', name: 'The naive way: one plus per unit', does: 'Short to explain, long to write.', baseline: true, code: (v) => v.a.map((x) => '>' + rep('+', x)).join(''), bits: [16, 32], size: 32, consts: [VALS], labels: (v) => names(1, v.a.map((_, i) => 'number ' + i)),
        expect: (v) => ({ tape: cells(1, v.a), ptr: v.a.length }), cost: { plain: ['the sum of the numbers', null], fast: ['1 per number', (v) => v.a.length] }, table: [{ a: [100, 64, 200, 31, 127, 250] }, { a: [262, 262, 262, 262, 262, 262, 262, 262, 262, 262, 262, 262] }] },
    ],
  });

  const byId = {};
  for (const p of P) byId[p.id] = p;
  return { GROUPS, PATTERNS: P, byId };
});
