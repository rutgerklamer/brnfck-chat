// Every program the basics course shows, and every task it checks.
self.BasicsPrograms = (function () {
  'use strict';
  const rep = (s, n) => new Array(n + 1).join(s);
  const strip = (src) => String(src).replace(/[−–]/g, '-').replace(/[^+\-<>\[\].,]/g, '');
  // a text as the reader should see it: what cannot be seen gets a mark
  const show = (s) => '"' + String(s).replace(/[\x00-\x1f\x7f-\xff]/g, (c) => (c === '\n' ? '↵' : '·')) + '"';

  const H = rep('+', 72) + '.';
  const YES = ',>+<\n[ >-<\n  >>++++++[<++++++++>-]<+ . [-] <     print 1\n  [-]\n]\n>[\n';
  const IF33 = ',[>' + rep('+', 33) + '.<[-]]';
  const NOT0 = ',' + rep('-', 48) + '[>' + rep('+', 78) + '.<[-]]';
  const DEMOS = [
    { id: 'd1s2', code: '+++++--' },
    { id: 'd1s4', code: '-' },
    { id: 'd2s4', code: '<' },
    { id: 'd3s2', code: H },
    { id: 'd4s1', code: '+++[-]' },
    { id: 'd4s3', code: '++++[->+++<]' },
    { id: 'd4s4', code: '+[]' },
    { id: 'd4s5', code: '[+++]>+' },
    { id: 'd5s1', code: '++++++++[>+++++++++<-]>.' },
    { id: 'd6s1', code: ',.', input: 'k' },
    { id: 'd6s2', code: ',+.', input: 'a' },
    { id: 'd6s3', code: ',[.,]', input: 'hey' },
    { id: 'd7s1', code: '[->+<]', init: { 0: 5 } },
    { id: 'd7s3', code: '[->+>+<<]>>[-<<+>>]', init: { 0: 4 } },
    { id: 'd8s1', code: IF33, input: 'a' },
    { id: 'd8s2', code: NOT0, input: '5' },
    { id: 'd10s3', code: '++[>+++<-]>+' },
    { id: 'd10s4', code: '>,[>,]<[.<]', input: 'abc' },
  ];

  const TASKS = [
    { id: 't1s3', start: '+', cases: [{ cells: { 0: 7 } }], answer: '+++++++' },
    { id: 't2s2', start: '+>', cases: [{ cells: { 0: 1, 1: 2, 2: 3 } }], answer: '+>++>+++' },
    { id: 't2s3', start: '+++>>++', cases: [{ cells: { 0: 3, 1: 2, 2: 0 } }], answer: '+++>++' },
    { id: 't3s3', start: H, cases: [{ out: 'HI' }], answer: H + '+.' },
    { id: 't3s4', start: rep('+', 48) + '.', cases: [{ out: '7' }], answer: rep('+', 55) + '.' },
    { id: 't4s2', start: '', cases: [{ init: { 0: 200 }, cells: { 0: 0 } }, { init: { 0: 13 }, cells: { 0: 0 } }], max: 3, answer: '[-]' },
    { id: 't5s2', start: '', cases: [{ out: 'A' }], max: 30, answer: '++++++++[>++++++++<-]>+.' },
    { id: 't5s3', start: '++++++++[>+++++++++<-]>.', cases: [{ out: 'Hi' }], answer: '++++++++[>+++++++++<-]>.' + rep('+', 33) + '.' },
    { id: 't6s4', start: ',.', cases: [{ input: 'ab', out: 'ba' }, { input: 'xy', out: 'yx' }], answer: ',>,.<.' },
    { id: 't7s2', start: '[->+<]', cases: [{ init: { 0: 7 }, cells: { 0: 0, 1: 0, 2: 7 } }, { init: { 0: 3 }, cells: { 0: 0, 1: 0, 2: 3 } }], answer: '[->>+<<]' },
    { id: 't7s4', start: '', cases: [{ init: { 0: 3, 1: 4 }, cells: { 0: 0, 1: 7 } }, { init: { 0: 10, 1: 1 }, cells: { 0: 0, 1: 11 } }], answer: '[->+<]' },
    { id: 't8s3', start: YES + '  your part: print 0 here\n-]', cases: [{ input: 'a', out: '1' }, { input: '', out: '0' }, { input: '0', out: '1' }], answer: YES + '  >++++++[>++++++++<-]>.[-]<<\n-]' },
    { id: 't8s4', start: ',', cases: [{ input: '5', out: '!' }, { input: '0', out: '' }, { input: '9', out: '!' }], answer: ',' + rep('-', 48) + '[>' + rep('+', 33) + '.<[-]]' },
    { id: 't9s1', start: ',.', cases: [{ input: '3', out: '4' }, { input: '0', out: '1' }, { input: '8', out: '9' }], answer: ',+.' },
    { id: 't9s2', start: '++++++[>++++++++<-]    48 in cell 1: the character 0\n>>++++++++++           10 in cell 2: the counter\n[                      ten times\n\n]', cases: [{ out: '0123456789' }], answer: '++++++[>++++++++<-]    48 in cell 1: the character 0\n>>++++++++++           10 in cell 2: the counter\n[                      ten times\n  <.+>-\n]' },
    { id: 't9s3', start: '', cases: [{ input: '3', out: '***' }, { input: '0', out: '' }, { input: '9', out: '*********' }], answer: ',>++++++[<-------->-]++++++[>+++++++<-]<[>>.<<-]' },
    { id: 't9s4', start: '', cases: [{ input: '3', out: '3210' }, { input: '0', out: '0' }, { input: '9', out: '9876543210' }], answer: ',[->+>+<<]>>[-<<+>>]++++++[<-------->-]<+[<.->-]' },
    { id: 't10s1', start: 'This program prints the letter H. It uses a loop, 8 times 9.\n++++++++ [ > +++++++++ < - ] > .', cases: [{ out: 'H' }], answer: 'This program prints the letter H with a loop of 8 times 9\n++++++++ [ > +++++++++ < - ] > .' },
  ];
  const byId = {};
  for (const t of TASKS) byId[t.id] = t;
  for (const d of DEMOS) byId[d.id] = d;

  function check(t, src, core) {
    const code = strip(src), n = code.length;
    if (!n) return { ok: false, text: 'Type your program in the box.' };
    for (const c of t.cases) {
      let r;
      try { r = core.run(code, { bits: 8, size: 2048, mode: 'plain', init: c.init || null, input: Array.from(c.input || '', (ch) => ch.charCodeAt(0) & 255), max: 2e5 }); }
      catch (e) { return { ok: false, text: e.kind === 'open' ? 'There is a [ without its ].' : 'There is a ] without a [ before it.' }; }
      const when = (c.input !== undefined ? 'with the input ' + (c.input ? show(c.input) : 'left empty') + ' ' : '') + (c.init ? 'when ' + Object.keys(c.init).map((k) => 'cell ' + k + ' starts at ' + c.init[k]).join(' and ') + ', ' : '');
      if (r.error) return { ok: false, text: 'Not yet: ' + when + 'the pointer walks off the ' + r.error + ' end of the tape.' };
      if (!r.finished) return { ok: false, text: 'Not yet: ' + when + 'the program does not stop. A loop ends only when the cell under the pointer is zero.' };
      if (c.out !== undefined) {
        const out = String.fromCharCode.apply(null, r.out);
        if (out !== c.out) return { ok: false, text: 'Not yet: ' + when + 'it prints ' + (out ? show(out) : 'nothing') + ', and it should print ' + (c.out ? show(c.out) : 'nothing') + '.' };
      }
      if (c.cells) for (const k of Object.keys(c.cells)) if (r.tape[+k] !== c.cells[k]) return { ok: false, text: 'Not yet: ' + when + 'at the end cell ' + k + ' holds ' + r.tape[+k] + ', and it should hold ' + c.cells[k] + '.' };
    }
    if (t.max && n > t.max) return { ok: false, text: 'It works, but with ' + n + ' commands. Here you may use ' + t.max + ' at most.' };
    return { ok: true, n, text: 'It works, with ' + n + (n === 1 ? ' command.' : ' commands.') };
  }

  function wordProgram(word) {
    let code = '>', at = 0;
    for (const ch of String(word)) {
      const to = ch.charCodeAt(0) & 255, dlt = to - at, a = Math.abs(dlt), s = dlt > 0 ? '+' : '-';
      if (a <= 14) code += rep(s, a);
      else { const f = Math.round(Math.sqrt(a)), g = Math.floor(a / f); code += '<' + rep('+', f) + '[>' + rep(s, g) + '<-]>' + rep(s, a - f * g); }
      at = to; code += '.';
    }
    return code;
  }

  return { byId, check, wordProgram };
})();
