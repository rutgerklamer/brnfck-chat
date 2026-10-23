// The course Brainfuck basics.
(function () {
  'use strict';
  const { $, el } = Learn, core = window.LearnCore, P = window.BasicsPrograms, S = window.BFStudy, store = S.store;
  const B = window.Basics = {};

  B.LESSONS = [
    { n: 1, file: '01-machine.html', title: 'The machine', part: 'The eight commands', can: 'Put any number in a cell with plus and minus.', steps: 4 },
    { n: 2, file: '02-moving.html', title: 'Moving', part: 'The eight commands', can: 'Move the pointer and fill several cells.', steps: 4 },
    { n: 3, file: '03-letters.html', title: 'Numbers are letters', part: 'The eight commands', can: 'Print a character by its number.', steps: 4 },
    { n: 4, file: '04-loops.html', title: 'Loops', part: 'The eight commands', can: 'Repeat until a cell is zero, and empty a cell.', steps: 5 },
    { n: 5, file: '05-numbers.html', title: 'Building numbers', part: 'Putting them to work', can: 'Make a large number with a loop and print a word of your own.', steps: 4 },
    { n: 6, file: '06-input.html', title: 'Reading input', part: 'Putting them to work', can: 'Read characters and print them back.', steps: 4 },
    { n: 7, file: '07-copy.html', title: 'Moving and copying', part: 'Putting them to work', can: 'Move a value, add two values, and copy one.', steps: 4 },
    { n: 8, file: '08-deciding.html', title: 'Making a decision', part: 'Putting them to work', can: 'Do something only if a cell is not zero, and something else if it is.', steps: 4 },
    { n: 9, file: '09-program.html', title: 'A small program', part: 'On your own', can: 'Write a whole program from a description.', steps: 4 },
    { n: 10, file: '10-reading.html', title: 'Reading brainfuck', part: 'On your own', can: 'Read, comment and trace a program somebody else wrote.', steps: 4 },
  ];
  B.isSolved = (n) => store.stepsDone(n).length >= B.LESSONS[n - 1].steps;

  B.lesson = (n) => Learn.article({ n, stepsDone: store.stepsDone, markStep: store.markStep });

  B.outOf = (m) => String.fromCharCode.apply(null, m.out);

  // ---- a program to step through
  B.demo = (L, i, box, id, o) => {
    o = o || {};
    const d = P.byId[id];
    return Learn.machine($(box), Object.assign({ code: d.code, bits: 8, cells: 6, init: d.init || null, inputText: d.input || '', input: Array.from(d.input || '', (ch) => ch.charCodeAt(0)), max: 2e5 }, o.machine || {}, {
      onEnd: (m) => { if (o.when && !o.when(m)) { if (o.else) L.note(i, o.else(m)); return; } L.done(i, o.text(m)); $('v' + i).classList.add('said'); },   // watching is not answering: the line draws only its mark
    }));
  };

  // ---- a program to write
  B.task = (L, i, box, id, o) => {
    o = o || {};
    const t = P.byId[id], c0 = t.cases[0];
    const judge = (code) => {
      const r = P.check(t, code, core);
      if (r.ok) L.done(i, o.said ? o.said(r) : r.text); else L.note(i, r.text);
    };
    const m = Learn.machine($(box), Object.assign({ code: t.start, bits: 8, cells: 6, editable: true, at: 'end', init: c0.init || null, inputBox: c0.input !== undefined, inputText: c0.input || '', max: 2e5, onEdit: judge }, o.machine || {}));
    const ta = $(box).querySelector('textarea');
    ta.rows = Math.min(10, Math.max(2, t.start.split('\n').length + 1));
    S.keys(ta);
    if (o.button) Learn.hints($(o.button), o.hints || [], () => m.type(t.answer));
    return m;
  };

  // ---- the free exercise
  B.free = (box, o) => {
    const m = Learn.machine($(box), Object.assign({ code: '', bits: 8, cells: 6, editable: true, at: 'end', max: 2e5 }, o || {}));
    S.keys($(box).querySelector('textarea'));
    return m;
  };

  // ---- buttons instead of a program: the pad of ../../learn/ui.js
  B.pad = Learn.pad;

  // ---- the character table, live
  B.chart = (box, onPick) => {
    box = $(box);
    const say = el('p', 'chart-say'); say.setAttribute('aria-live', 'polite');
    const grid = el('div', 'chips chart'); grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', 'The characters with numbers 32 to 126');
    const name = (n) => (n === 32 ? 'the space' : n >= 48 && n <= 57 ? 'the digit ' + String.fromCharCode(n) : n >= 65 && n <= 90 ? 'the capital letter ' + String.fromCharCode(n) : n >= 97 && n <= 122 ? 'the small letter ' + String.fromCharCode(n) : 'the sign ' + String.fromCharCode(n));
    const keys = {};
    let cur = 0;
    const pick = (n) => {
      if (keys[cur]) keys[cur].setAttribute('aria-pressed', 'false');
      cur = n; keys[n].setAttribute('aria-pressed', 'true');
      say.textContent = ''; say.append(el('b', '', String(n)), ' is ' + name(n) + '. ', el('span', 'muted', 'A cell that holds ' + n + ' prints ' + (n === 32 ? 'a space' : String.fromCharCode(n)) + '.'));
      if (onPick) onPick(n);
    };
    for (let n = 32; n <= 126; n++) {
      const b = el('button', 'ck' + (n >= 48 && n <= 57 ? ' dig' : n >= 65 && n <= 90 ? ' cap' : n >= 97 && n <= 122 ? ' low' : ''));
      b.type = 'button'; b.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-label', name(n).replace(/^the /, '') + ', number ' + n);
      b.append(el('span', 'c', n === 32 ? '␣' : String.fromCharCode(n)), el('small', '', String(n)));
      b.addEventListener('click', () => pick(n));
      keys[n] = b; grid.append(b);
    }
    say.textContent = 'Press a character to see its number.';
    box.append(say, grid);
    return { pick };
  };

  // ---- the self-check: one question, a few answers
  B.quiz = (n, box, question, options) => {
    box = $(box);
    const fs = el('fieldset', 'picklist quiz'), lg = el('p', 'ask-q'), v = el('p', 'verdict');
    // the text says "Right." or "Not quite." itself, so the check line draws only its mark
    const say = (ok, text) => { Learn.verdict(v, ok, text); v.classList.add('said'); };
    v.setAttribute('aria-live', 'polite');
    lg.append(el('b', '', question)); lg.id = 'quiz' + n + '-q'; fs.setAttribute('aria-labelledby', lg.id);
    box.append(lg);
    options.forEach(([text, right, why], k) => {
      const lab = el('label', 'opt'), inp = el('input'); inp.type = 'radio'; inp.name = 'quiz' + n; inp.value = String(k);
      const span = el('span'); span.innerHTML = text;
      lab.append(inp, span); fs.append(lab);
      inp.addEventListener('change', () => {
        say(!!right, (right ? 'Right. ' : 'Not quite. ') + why);
        if (right) store.markQuiz(n);
      });
    });
    box.append(fs, v);
    if (store.quizDone(n)) { Learn.verdict(v, true, 'You answered this on an earlier visit.'); }
  };
})();
