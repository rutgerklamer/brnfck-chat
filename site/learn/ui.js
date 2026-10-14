// Page code shared by all lessons: the list of lessons, progress that is remembered.
(function () {
  'use strict';
  const C = window.LearnCore;
  const Learn = window.Learn = { core: C };

  // ---- small helpers ----------------------------------------------------------
  const fmt = Learn.fmt = (n) => (Math.round(n) + 0).toLocaleString('en-US').replace('-', '−');
  const $ = Learn.$ = (id) => document.getElementById(id);
  const el = Learn.el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  // Read a number box or slider, kept inside its min and max.
  Learn.num = (input) => {
    const lo = Number(input.min), hi = Number(input.max);
    let v = Math.round(Number(input.value));
    if (!Number.isFinite(v)) v = lo > 0 ? lo : 0;
    return Math.min(hi, Math.max(lo, v));
  };
  Learn.verdict = (e, ok, text) => { e.className = 'verdict ' + (ok ? 'ok' : 'no'); e.textContent = text; };
  // Why a typed program did not pass a check (codes from core.js checks).
  Learn.why = (r) => ({
    brackets: 'The [ and ] do not match up yet.',
    offtape: 'The pointer walks off the tape.',
    endless: 'The program does not stop (we gave up after 2 million steps).',
    long: 'The answer is right, but the program has ' + r.got + ' commands. Use a loop.',
  }[r.why] || '');
  Learn.hints = (button, hints, answer) => {
    let k = 0;
    const name = () => { button.textContent = k === 0 ? 'Give me a hint' : k < hints.length ? 'One more hint' : 'Show me an answer'; };
    button.addEventListener('click', () => {
      if (k < hints.length) { $(hints[k]).hidden = false; k++; if (k === hints.length && !answer) button.hidden = true; else name(); }
      else { answer(); button.hidden = true; }
    });
    name();
  };
  // A folded box with the brainfuck text of a demo.
  Learn.codeBox = (box, code, title) => {
    box.textContent = '';
    const d = el('details', 'q code'), a = el('div', 'a'), text = el('div', 'bf listing', code);
    text.tabIndex = 0; text.setAttribute('role', 'group'); text.setAttribute('aria-label', 'The program');
    a.append(text);
    d.append(el('summary', '', (title || 'Show the program') + ' (' + fmt(code.length) + ' characters)'), a);
    box.append(d);
  };

  // ---- the eleven lessons: one list for the index page and for every lesson ----
  Learn.LESSONS = [
    { n: 1, file: '01-machine.html', title: 'The machine', part: 'The language', can: 'Write a program that puts any number in any cell.', steps: 7 },
    { n: 2, file: '02-copy.html', title: 'Moving and copying', part: 'The language', can: 'Use a number in a sum and still have it afterwards.', steps: 3 },
    { n: 3, file: '03-multiply.html', title: 'Multiplying by a fixed number', part: 'The language', can: 'Work out 90 × 100 and three more products, and add them up: 11,868, in eight steps.', steps: 5 },
    { n: 4, file: '04-zero.html', title: 'Obstacle 1: only one question', part: 'The four obstacles', can: 'Feel why dividing by counting is far too slow for a model.', steps: 4 },
    { n: 5, file: '05-peel.html', title: 'The way through: peeling off bits', part: 'The four obstacles', can: 'Turn 11,868 into 93 in about 120 steps instead of 130,000.', steps: 5 },
    { n: 6, file: '06-product.html', title: 'Obstacle 2: two numbers from the tape', part: 'The four obstacles', can: 'Multiply −25 by −60 in under 60 steps instead of billions.', steps: 4 },
    { n: 7, file: '07-walking.html', title: 'Obstacle 3: no addresses', part: 'The four obstacles', can: 'Do one job at 512 places with one piece of program, and fetch a number from far away.', steps: 4 },
    { n: 8, file: '08-size.html', title: 'Obstacle 4: size', part: 'The four obstacles', can: 'Write a row of weights onto the tape in a few characters each, and walk along it.', steps: 4 },
    { n: 9, file: '09-neuron.html', title: 'One number of the model', part: 'The model', can: 'Run the whole sum for one number of the model: 93. Then three such numbers in one pass.', steps: 3 },
    { n: 10, file: '10-attention.html', title: 'Looking back', part: 'The model', can: 'Let the program decide which earlier word pieces count, and how much.', steps: 3 },
    { n: 11, file: '11-together.html', title: 'Choosing the word', part: 'The model', can: 'Run one program that works out three scores and prints " Paris".', steps: 4 },
  ];

  // ---- progress, remembered between visits ----------------------------------------
  const KEY = 'bfLearnSteps';
  let storage = 'local';
  try { localStorage.setItem(KEY + 'Test', '1'); localStorage.removeItem(KEY + 'Test'); } catch (e) { storage = 'tab'; }
  let memory = '';
  const rawRead = () => {
    if (storage === 'local') { try { return localStorage.getItem(KEY) || ''; } catch (e) { storage = 'tab'; } }
    try { const w = String(window.name || ''); return w.indexOf(KEY + '=') === 0 ? w.slice(KEY.length + 1) : memory; } catch (e) { return memory; }
  };
  const rawWrite = (text) => {
    memory = text;
    if (storage === 'local') { try { localStorage.setItem(KEY, text); return; } catch (e) { storage = 'tab'; } }
    try { window.name = KEY + '=' + text; } catch (e) { }
  };
  const readAll = () => {
    let all = {};
    try { const o = JSON.parse(rawRead() || '{}'); if (o && typeof o === 'object' && !Array.isArray(o)) all = o; } catch (e) { all = {}; }
    return all;
  };
  Learn.remembers = () => storage === 'local';
  Learn.stepsDone = (n) => { const a = readAll()[n], max = Learn.LESSONS[n - 1].steps; return Array.isArray(a) ? a.filter((i) => Number.isInteger(i) && i >= 1 && i <= max) : []; };
  Learn.isSolved = (n) => Learn.stepsDone(n).length >= Learn.LESSONS[n - 1].steps;
  const markStep = (n, i) => { const all = readAll(), a = new Set(Array.isArray(all[n]) ? all[n] : []); a.add(i); all[n] = [...a].sort((x, y) => x - y); rawWrite(JSON.stringify(all)); };
  Learn.forget = () => { rawWrite('{}'); };

  // ---- the goal of the eleven lessons ------------------------------------------------
  const GOAL = [
    [3, '90 × 100 + (−25) × (−60) + 40 × 30 + 12 × 14 = 11,868'],
    [5, 'divide by 128 and round: 93'],
    [11, 'the highest of 93, 41 and −49 wins: print " Paris"'],
  ];
  Learn.goal = (box, n) => {
    box.textContent = ''; box.className = 'goal';
    box.append(el('p', 'label', 'The goal of the eleven lessons'));
    const line = el('ol', 'stepbar');
    GOAL.forEach(([from, text]) => {
      const can = n > from, li = el('li', can ? 'done' : n === from ? 'now' : ''), s = el('span');
      // said in words, not in a tooltip: a touch screen has no hover
      s.append(el('small', '', can ? 'you can do this' : n === from ? 'this lesson' : 'lesson ' + from), text);
      li.append(s); line.append(li);
    });
    box.append(line);
    const done = GOAL.filter(([from]) => n > from).length;
    box.append(el('p', 'muted small', done === 0 ? 'Small made-up numbers. The model does this same kind of sum with its own numbers, over and over.'
      : done === GOAL.length ? 'Every part has a tick: you can do all of it.' : 'A tick means: you can do this part already.'));
  };

  // ---- the steps of a lesson page: a verdict line and a "Stuck?" button for each, and which are done ----
  const skipFor = (after) => {
    const skip = el('p', 'skip'), b = el('button', 'link', 'Stuck? Show the explanation'); b.type = 'button';
    b.addEventListener('click', () => { after.hidden = false; skip.hidden = true; });
    skip.append(b);
    return skip;
  };
  const stateText = (d, N) => (d >= N ? 'You have done every step of this lesson.' : 'Steps done in this lesson: ' + d + ' of ' + N + '.');
  const track = (n, verdicts, afters, skips, done, mark, paint) => {
    const open = (i) => { afters[i - 1].hidden = false; skips[i - 1].hidden = true; };
    done.forEach((i) => { open(i); Learn.verdict(verdicts[i - 1], true, 'You did this step on an earlier visit. Do it again if you like.'); });
    paint();
    return {
      n, steps: verdicts.length,
      isDone: (i) => done.has(i),
      note: (i, text) => { Learn.verdict(verdicts[i - 1], false, text); },
      done: (i, text) => {
        Learn.verdict(verdicts[i - 1], true, text);
        open(i);
        if (!done.has(i)) { done.add(i); mark(n, i); paint(); }
      },
    };
  };

  // ---- a Model lesson
  Learn.lesson = (n) => {
    const main = document.querySelector('main');
    main.querySelectorAll('p.try').forEach((p) => p.classList.add('exercise'));
    main.querySelectorAll('section.after').forEach((s) => s.classList.add('explanation'));
    const where = main.querySelector('section.where');
    if (where) { where.classList.add('callout'); const g = el('div'); where.append(g); Learn.goal(g, n); }
    const heads = [...main.querySelectorAll('h2[id]')].filter((h) => /^s\d+$/.test(h.id));
    const N = heads.length, verdicts = [], afters = [], skips = [], done = new Set(Learn.stepsDone(n).filter((i) => i <= N));
    heads.forEach((h, k) => {
      const i = k + 1, title = h.textContent;
      h.textContent = ''; h.append(el('span', 'label', 'Step ' + i + ' of ' + N), title);
      const after = $('a' + i), widget = after.previousElementSibling;
      const v = el('p', 'verdict'); v.id = 'v' + i; v.setAttribute('aria-live', 'polite');
      const cap = widget.querySelector('figcaption'); if (cap) widget.insertBefore(v, cap); else widget.append(v);
      const skip = skipFor(after); main.insertBefore(skip, after);
      verdicts.push(v); afters.push(after); skips.push(skip);
    });
    const now = $('now'), state = el('p', 'verdict state');
    if (now) { now.classList.add('callout'); now.append(state); }
    const paint = () => {
      if (!now) return;
      const all = done.size >= N;
      now.classList.toggle('complete', all); state.classList.toggle('ok', all);
      state.textContent = stateText(done.size, N);
    };
    return track(n, verdicts, afters, skips, done, markStep, paint);
  };

  // ---- a lesson page in the article style (the Basics): step i is figure f<i> and explanation a<i>
  Learn.article = (c) => {
    const n = c.n;
    let N = 0;
    while ($('a' + (N + 1))) N++;
    const verdicts = [], afters = [], skips = [], done = new Set(c.stepsDone(n).filter((i) => i <= N));
    for (let i = 1; i <= N; i++) {
      const after = $('a' + i), fig = $('f' + i), v = el('p', 'verdict'), skip = skipFor(after);
      v.id = 'v' + i; v.setAttribute('aria-live', 'polite'); fig.append(v);
      fig.after(skip);
      verdicts.push(v); afters.push(after); skips.push(skip);
    }
    const now = $('now'), state = el('p', 'tell state');
    state.setAttribute('aria-live', 'polite');
    if (now) now.append(state);
    const paint = () => {
      if (!now) return;
      now.classList.toggle('complete', done.size >= N);
      state.textContent = stateText(done.size, N);
    };
    return track(n, verdicts, afters, skips, done, c.markStep, paint);
  };

  // ---- the front page of a course: a strip with a square for each lesson, and the lists by part
  const strip = (ol, lessons, next, isSolved, name) => {
    ol.textContent = ''; ol.classList.add('stepbar');
    for (const l of lessons) {
      const solved = isSolved(l.n), li = el('li', (solved ? 'done' : '') + (l.n === next ? ' now' : '')), link = el('a', '', String(l.n));
      link.href = l.file;
      link.setAttribute('aria-label', name + ' ' + l.n + ': ' + l.title + (solved ? ' (done)' : l.n === next ? ' (next)' : ''));
      li.append(link); ol.append(li);
    }
    // on a narrow screen the strip scrolls sideways: bring the next lesson to the middle
    const centre = () => { const li = ol.querySelector('li.now'); if (li && ol.scrollWidth > ol.clientWidth) ol.scrollLeft = li.offsetLeft - ol.offsetLeft - (ol.clientWidth - li.offsetWidth) / 2; };
    centre();
    if (!ol.dataset.watch) { ol.dataset.watch = '1'; window.addEventListener('resize', centre); }
  };
  Learn.overview = (c) => {
    const box = $('lists'); box.textContent = '';
    const next = c.lessons.find((l) => !c.isSolved(l.n)) || null;
    let stepsDone = 0, stepsAll = 0, lessonsDone = 0, started = false, part = '', ol = null;
    for (const l of c.lessons) {
      const d = c.stepsDone(l.n).filter((i) => i <= l.steps).length, solved = d >= l.steps, isNext = !!next && next.n === l.n;
      stepsDone += d; stepsAll += l.steps; if (solved) lessonsDone++; if (d) started = true;
      if (l.part !== part) {
        part = l.part;
        const head = el('div', 'grouphead'); head.append(el('h2', '', part), el('span', 'muted', c.notes[part]));
        box.append(head);
        ol = el('ol', 'toc lessons'); ol.style.counterReset = 'toc ' + (l.n - 1); box.append(ol);
      }
      const li = el('li', solved ? 'done' : ''), a = el('a'), t = el('span', 't');
      a.href = l.file;
      t.append(el('span', 'badge' + (isNext ? ' solid' : ''), solved ? 'Done' : isNext ? (d ? 'Continue here: ' + d + ' of ' + l.steps + ' steps done' : started ? 'Next' : 'Start here') : d ? d + ' of ' + l.steps + ' steps done' : l.steps + ' steps'));
      a.append(el('b', '', l.title), el('span', 'p', l.can), t);
      li.append(a); ol.append(li);
    }
    strip($('blocks'), c.lessons, next ? next.n : 0, c.isSolved, c.unit);
    return { next, started, lessonsDone, stepsDone, stepsAll };
  };

  // ---- buttons instead of a program (the very first steps of both courses) ----
  Learn.pad = (box, o) => {
    box = $(box);
    box.classList.add('machine');
    const N = o.cells, tapeBox = el('div', 'tape joined line'), ctl = el('div', 'ctl pad'), pressed = el('p', 'printed'), out = el('output');
    tapeBox.setAttribute('role', 'list'); tapeBox.setAttribute('aria-label', 'The cells of this small tape');
    pressed.append(el('span', 'label', 'You pressed'), out); out.setAttribute('aria-live', 'polite');
    let tape, ptr, line, changed;
    const btn = (text, cls, name) => { const b = el('button', cls, text); b.type = 'button'; if (name) b.setAttribute('aria-label', name); ctl.append(b); return b; };
    const left = o.move ? btn('← Left', 'quiet', 'Move the pointer one cell to the left') : null, right = o.move ? btn('Right →', 'quiet', 'Move the pointer one cell to the right') : null;
    const plus = btn('+ add one', '', 'add one to this cell'), minus = btn('− take one off', '', 'take one off this cell'), again = btn('Start again', 'quiet');
    const draw = () => {
      tapeBox.textContent = '';
      tape.forEach((v, a) => {
        const c = el('div', 'cell' + (a === ptr ? ' here' : '') + (a === changed ? ' hit' : '')), num = el('i', '', String(a));
        num.setAttribute('aria-hidden', 'true');
        c.append(el('b', '', String(v)), num);
        c.setAttribute('role', 'listitem'); c.setAttribute('aria-label', 'Cell ' + a + ': ' + v + (a === ptr ? ', pointer here' : ''));
        tapeBox.append(c);
      });
      out.textContent = line.length ? line.join(' ') : '—';
      if (left) { left.disabled = ptr === 0; right.disabled = ptr === N - 1; }
      minus.disabled = tape[ptr] === 0;
      if (line.length) o.judge(tape, ptr, line.length);
    };
    const reset = () => { tape = new Array(N).fill(0); ptr = 0; line = []; changed = -1; draw(); };
    const press = (sym, fn) => () => { changed = -1; fn(); line.push(sym); if (line.length > 60) line.shift(); draw(); };
    if (left) { left.addEventListener('click', press('<', () => { ptr--; })); right.addEventListener('click', press('>', () => { ptr++; })); }
    plus.addEventListener('click', press('+', () => { tape[ptr]++; changed = ptr; }));
    minus.addEventListener('click', press('−', () => { tape[ptr]--; changed = ptr; }));
    again.addEventListener('click', reset);
    box.append(tapeBox, pressed, ctl);
    reset();
  };

  // ---- the project's own generators --------------------------------------------
  let demos = null;
  function loadCommonJS(text, req) {
    const module = { exports: {} };
    new Function('module', 'exports', 'require', text)(module, module.exports, req);
    return module.exports;
  }
  Learn.ready = (fn) => {
    const go = () => {
      if (demos) return fn(demos);
      Promise.all(['../runtime/emit.js?v=r6', '../runtime/patterns.js?v=r6'].map((u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u + ': ' + r.status); return r.text(); })))
        .then(([e, p]) => {
          const emit = loadCommonJS(e, () => ({}));
          const pat = loadCommonJS(p, () => emit);
          demos = C.makeDemos(emit.Emitter, pat.Patterns);
        })
        .then(() => fn(demos), (err) => {
          const b = el('section', 'callout warn banner'), h1 = document.querySelector('main h1');
          b.append(el('h3', '', 'The demos could not start'), el('p', '', 'The demos on this page load runtime/emit.js and runtime/patterns.js of this site, which a browser only allows over http. Start the site with python tools/serve.py and open this page as /learn/.'), el('p', 'muted small', String(err.message || err)));
          (h1.closest('header') || h1).after(b);
        });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  };

  // ---- the machine widget ----------------------------------------------------------
  const HORIZON = 3e6;       // how far the run is laid out beforehand, when it does not end sooner
  const SAY = {
    '+': '+ added 1 to this cell',
    '-': '− took 1 from this cell',
    '>': '> moved the pointer one cell to the right',
    '<': '< moved the pointer one cell to the left',
    '.': '. printed this cell as one letter',
    ',': ', read one letter of input into this cell',
    '[z': '[ asked: is this cell zero? Yes, so it skipped the loop',
    '[n': '[ asked: is this cell zero? No, so it went into the loop',
    ']z': '] asked: is this cell zero? Yes, so the loop is over',
    ']n': '] asked: is this cell zero? No, so back to the start of the loop',
  };
  function sayStep(m, show) {
    const i = m.last;
    if (m.error) return m.error === 'left' ? 'The pointer walked off the left end of the tape. The program is lost.' : 'The pointer walked off the right end of the tape.';
    if (!i) return '';
    if (i.c) return SAY[i.c === '[' || i.c === ']' ? i.c + (i.zero ? 'z' : 'n') : i.c];
    const op = i.op, mv = op.mv ? 'moved ' + Math.abs(op.mv) + (op.mv > 0 ? ' right' : ' left') + ', then ' : '';
    switch (op.t) {
      case 0: return mv + (op.n > 0 ? 'added ' : 'took off ') + fmt(Math.abs(op.n)) + ' in one step';
      case 1: return mv + 'printed one letter';
      case 2: return mv + 'read one letter of input';
      case 3: return mv + (i.zero ? 'asked "zero?": yes, skipped the loop' : 'asked "zero?": no, into the loop');
      case 4: return mv + (i.zero ? 'asked "zero?": yes, the loop is over' : 'asked "zero?": no, round again');
      case 5: return mv + 'a whole loop in one step: the cell was set to zero';
      case 6: return mv + 'a whole loop in one step: ' + show(i.v) + ' × (' + op.mul.map((x) => fmt(x[1])).join(', ') + ') added to ' + op.mul.length + (op.mul.length === 1 ? ' cell' : ' cells');
      default: return mv.replace(/, then $/, '');
    }
  }
  const reduced = () => { try { return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } };
  // a slider with its name and its value (the same markup as Article.slider)
  const slider = (name, min, max, value, say) => {
    const lab = el('label'), input = el('input'), out = el('output');
    input.type = 'range'; input.min = min; input.max = max; input.step = 1; input.value = value;
    lab.append(el('span', '', name), input, out);
    const s = { label: lab, input, out, show() { out.textContent = say(Number(input.value)); input.setAttribute('aria-valuetext', out.textContent); } };
    input.addEventListener('input', s.show);
    s.show();
    return s;
  };

  Learn.machine = (box, o) => {
    o = Object.assign({ code: '', bits: 8, init: null, input: [], size: 2048, cells: 8, from: 0, follow: false, labels: null, signed: false, fast: false, modes: false, editable: false, inputBox: false, delay: 0, rate: 0, at: '', max: 2e7 }, o);
    box.classList.add('machine');
    let m = null, k = 0, end = null, cap = 0, timer = null, winStart = o.from, bad = null, ended = false, before = null, keep = null;
    const ui = {};
    if (o.editable) {
      ui.src = el('textarea'); ui.src.value = o.code; ui.src.spellcheck = false;
      ui.src.setAttribute('aria-label', 'Your program');
      box.append(el('p', 'label', 'Your program. Type here to change it'));
      ui.src.setAttribute('autocapitalize', 'off'); ui.src.setAttribute('autocomplete', 'off'); ui.src.setAttribute('autocorrect', 'off');
      box.append(ui.src);
      ui.src.addEventListener('input', () => { o.code = ui.src.value; load(true); if (o.onEdit) o.onEdit(o.code); });
    }
    if (o.inputBox) {
      const lab = el('label', 'stacked');
      ui.inp = el('input'); ui.inp.type = 'text'; ui.inp.value = o.inputText || ''; ui.inp.maxLength = 40;
      lab.append('Input for the program', ui.inp); box.append(lab);
      ui.inp.addEventListener('input', () => load());
    }
    ui.prog = el('div', 'bf prog'); ui.prog.setAttribute('role', 'img');
    ui.err = el('p', 'verdict no err'); ui.err.hidden = true;
    ui.tape = el('div', 'tape joined line'); ui.tape.setAttribute('role', 'list'); ui.tape.setAttribute('aria-label', 'The cells of this tape');
    ui.inLine = el('p', 'printed'); ui.in = el('output', 'in'); ui.inLine.append(el('span', 'label', 'Input'), ui.in); ui.inLine.hidden = true;
    ui.outLine = el('p', 'printed'); ui.out = el('output', 'out'); ui.outLine.append(el('span', 'label', 'Printed'), ui.out);
    ui.tell = el('p', 'tell status'); ui.tell.setAttribute('aria-live', 'polite');
    // the controls, as in Article.machine
    ui.ctl = el('div', 'ctl');
    ui.play = el('button', 'primary', 'Play'); ui.step = el('button', 'quiet', 'Step'); ui.reset = el('button', 'quiet', 'Start again');
    ui.step.setAttribute('aria-label', 'One step forward');
    ui.pos = slider('Step', 0, 1, 0, (v) => (end !== null ? fmt(v) + ' of ' + fmt(end) : fmt(v) + ' steps'));
    ui.pos.label.classList.add('scrub');
    ui.speed = slider('Speed', 1, 20, o.rate || Math.max(1, Math.min(20, Math.round(1000 / (o.delay || (o.fast ? 220 : 120))))), (v) => v + ' a second');
    ui.speed.label.classList.add('speed');
    ui.ctl.append(ui.play, ui.step, ui.pos.label, ui.speed.label);
    if (o.modes) {
      ui.seg = el('div', 'seg'); ui.mPlain = el('button', '', 'one command at a time'); ui.mFast = el('button', '', 'fast interpreter');
      ui.seg.append(ui.mPlain, ui.mFast); ui.ctl.append(ui.seg);
      ui.mPlain.addEventListener('click', () => { o.fast = false; load(); });
      ui.mFast.addEventListener('click', () => { o.fast = true; load(); });
    }
    ui.ctl.append(ui.reset);
    ui.note = el('p', 'measured'); ui.note.hidden = true;
    box.append(ui.prog, ui.err, ui.tape, ui.inLine, ui.outLine, ui.tell, ui.ctl, ui.note);
    for (const b of box.querySelectorAll('button')) b.type = 'button';

    const labelOf = (a) => (typeof o.labels === 'function' ? o.labels(a) : o.labels ? o.labels[a] : null);
    const label = (a) => { const l = labelOf(a); return l === null || l === undefined ? 'cell ' + a : l; };
    const named = (a) => { const l = labelOf(a); return l === null || l === undefined ? '' : String(l); };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } ui.play.textContent = 'Play'; };
    const norm = (src) => String(src).replace(/[−–]/g, '-');      // a typographic minus pasted from the text counts as −
    const maxStep = (want) => {
      if (end !== null) return end;
      if (want > cap && cap < o.max) cap = Math.min(o.max, want);
      return cap;
    };

    function drawProg() {
      ui.err.hidden = !bad; ui.err.textContent = bad || '';
      ui.prog.textContent = ''; ui.prog.hidden = !!bad || (o.editable && (k === 0 || m.done));
      if (bad) return;
      const code = m.code, sp = m.span() || [code.length, code.length];
      let a = 0, b = code.length;
      if (code.length > 1600) { a = Math.max(0, sp[0] - 350); b = Math.min(code.length, Math.max(sp[1], sp[0] + 200) + 350); }
      const nowEnd = Math.min(sp[1], b), show = (s) => s.replace(/-/g, '−');
      if (a > 0) ui.prog.append(el('span', 'gap muted', '… '));
      ui.prog.append(document.createTextNode(show(code.slice(a, sp[0]))));
      const now = el('span', sp[0] < code.length ? 'now' : '', show(code.slice(sp[0], nowEnd)));
      ui.prog.append(now, document.createTextNode(show(code.slice(nowEnd, b))));
      if (b < code.length) ui.prog.append(el('span', 'gap muted', ' …'));
      if (!code.length) ui.prog.append(el('span', 'gap muted', '(no commands yet)'));
      ui.prog.setAttribute('aria-label', 'The program: ' + (code.length > 200 ? code.slice(0, 200) + '…' : code) + (m.done ? '. It has ended.' : '. The next command is number ' + (sp[0] + 1) + '.'));
      if (now.textContent && ui.prog.scrollHeight > ui.prog.clientHeight) ui.prog.scrollTop = Math.max(0, now.offsetTop - ui.prog.offsetTop - 30);
    }
    function drawTape() {
      ui.tape.textContent = '';
      if (!m) return;
      const n = o.cells;
      if (o.follow) {
        if (m.p < winStart + 1 || m.p >= winStart + n - 1) winStart = Math.max(o.from, Math.min(m.p - Math.floor(n / 3), m.size - n));
      } else winStart = o.from;
      let last = winStart + n;
      if (!o.follow && m.p >= last) last = m.p + 1;            // the pointer went further than planned: show it
      let here = null;
      for (let a = winStart; a < last && a < m.size; a++) {
        const v = m.tape[a], changed = !!before && before[a] !== v, top = named(a);
        const c = el('div', 'cell' + (a === m.p ? ' here' : '') + (changed ? ' hit' : '')), num = el('i', '', String(a));
        num.setAttribute('aria-hidden', 'true');
        if (top) c.append(el('span', 'top', top));
        c.append(el('b', '', fmt(o.signed ? m.signed(v) : v)), num);
        c.setAttribute('role', 'listitem');
        c.setAttribute('aria-label', (top ? top + ', cell ' : 'Cell ') + a + ': ' + fmt(o.signed ? m.signed(v) : v) + (a === m.p ? ', pointer here' : '') + (changed ? ', just changed' : ''));
        if (a === m.p) here = c;
        ui.tape.append(c);
      }
      keep = here; inView();
    }
    // keep the pointer cell in view when the tape is wider than its box (a phone, a long tape)
    function inView() {
      if (!keep || ui.tape.scrollWidth <= ui.tape.clientWidth) return;
      ui.tape.scrollLeft = Math.max(0, keep.offsetLeft - ui.tape.offsetLeft - (ui.tape.clientWidth - keep.offsetWidth) / 2);
    }
    window.addEventListener('resize', inView);
    // what was read, and what was printed so far
    function drawIO() {
      const code = m ? m.code : '';
      ui.outLine.hidden = !/\./.test(code);
      let s = '';
      if (m && m.out.length) {
        try { s = new TextDecoder('utf-8').decode(Uint8Array.from(m.out)); } catch (e) { s = String.fromCharCode.apply(null, m.out); }
      }
      ui.out.textContent = s ? s.replace(/[\x00-\x1f]/g, '·').replace(/ /g, '␣') : '—';
      const inp = m ? m.input : [];
      ui.inLine.hidden = !(m && !ui.inp && /,/.test(code) && inp.length);
      if (!ui.inLine.hidden) {
        ui.in.replaceChildren.apply(ui.in, Array.from(inp, (b, j) => el('span', j === m.inPos ? 'now' : '', b === 32 ? '␣' : b > 32 && b < 127 ? String.fromCharCode(b) : '·')));
        ui.in.setAttribute('aria-label', 'Input: ' + Array.from(inp, (b) => String.fromCharCode(b)).join('') + '. ' + m.inPos + ' read so far.');
      }
    }
    // ---- the explanation lines: what the highlighted command is about to do
    const show = (v) => fmt(o.signed ? m.signed(v) : v);
    const wrap = (v) => { const size = 2 ** m.bits; return ((v % size) + size) % size; };
    const cellName = (a) => { const l = label(a); return l === 'cell ' + a ? l : 'the "' + l + '" cell'; };
    const chr = (v) => { const b = v & 255; return b >= 33 && b < 127 ? ' as the letter ' + String.fromCharCode(b) : b === 32 ? ' as a space' : ' as character number ' + b; };
    const nextIn = () => (m.inPos < m.input.length ? 'reads the next letter of the input (number ' + m.input[m.inPos] + ') into ' : 'finds no input left, so it puts 0 into ');
    const ask = (open, a, moved) => {
      const v = m.tape[a], q = 'asks "is ' + (moved ? 'it' : cellName(a)) + ' zero?" ';
      if (open) return q + (v === 0 ? 'Yes, so the part between the brackets is skipped.' : 'No, it holds ' + show(v) + ', so the part between the brackets starts.');
      return q + (v === 0 ? 'Yes, so the repeating is over.' : 'No, it holds ' + show(v) + ', so go round again.');
    };
    function sayNext() {
      const p = m.p, t = m.tape;
      if (!m.fast) {
        const c = m.code[m.pc], v = t[p];
        switch (c) {
          case '+': return '+ adds 1 to ' + cellName(p) + ': ' + show(v) + ' becomes ' + show(wrap(v + 1)) + (wrap(v + 1) === 0 ? ' (the cell was full and goes round)' : '') + '.';
          case '-': return '− takes 1 from ' + cellName(p) + ': ' + show(v) + ' becomes ' + show(wrap(v - 1)) + (v === 0 ? ' (below zero it goes round to the top)' : '') + '.';
          case '>': return '> moves the pointer right, to ' + cellName(p + 1) + '.';
          case '<': return p === 0 ? '< tries to move left of the first cell: the pointer will fall off the tape.' : '< moves the pointer left, to ' + cellName(p - 1) + '.';
          case '.': return '. prints ' + cellName(p) + ' (' + show(v) + ')' + chr(v) + '.';
          case ',': return ', ' + nextIn() + cellName(p) + '.';
          case '[': return '[ ' + ask(true, p);
          default: return '] ' + ask(false, p);
        }
      }
      const op = m.ops[m.pc], q = p + op.mv;
      if (q < 0 || q >= m.size) return 'moves the pointer off the tape.';
      const go = op.mv ? 'goes ' + Math.abs(op.mv) + (op.mv > 0 ? ' right' : ' left') + ' to ' + cellName(q) + ' and ' : '';
      const v = t[q], at = op.mv ? 'it' : cellName(q);
      switch (op.t) {
        case 0: return go + (op.n > 0 ? 'adds ' + fmt(op.n) + ' to ' : 'takes ' + fmt(-op.n) + ' from ') + at + ': ' + show(v) + ' becomes ' + show(wrap(v + op.n)) + '.';
        case 1: return go + 'prints ' + at + ' (' + show(v) + ')' + chr(v) + '.';
        case 2: return go + nextIn() + at + '.';
        case 3: return (op.mv ? go : '') + ask(true, q, op.mv);
        case 4: return (op.mv ? go : '') + ask(false, q, op.mv);
        case 5: return go + 'does a whole loop in one step: sets ' + at + ', which holds ' + show(v) + ', to zero.';
        case 6: {
          if (v === 0) return go + 'finds ' + (op.mv ? 'it' : cellName(q)) + ' at 0, so this whole loop does nothing.';
          const parts = op.mul.slice(0, 3).map(([off, f]) => show(v) + (f === 1 ? '' : ' × ' + fmt(f)) + ' to ' + cellName(q + off));
          return go + 'does a whole loop in one step: empties ' + at + ', which holds ' + show(v) + ', and adds ' + parts.join(', ') + (op.mul.length > 3 ? ' and ' + (op.mul.length - 3) + ' more' : '') + '.';
        }
        default: return 'moves the pointer to ' + cellName(q) + '.';
      }
    }
    function sayResult() {
      if (o.result) return o.result(m);
      const parts = [];
      for (let a = o.from; a < o.from + o.cells && parts.length < 6; a++) if (m.tape[a] !== 0) parts.push(cellName(a) + ' holds ' + show(m.tape[a]));
      const out = m.out.length ? 'It printed ' + m.out.length + (m.out.length === 1 ? ' letter. ' : ' letters. ') : '';
      return out + (parts.length ? 'At the end ' + parts.join(', ') + '.' : 'Every cell shown is zero.');
    }
    function drawTell() {
      ui.tell.textContent = '';
      if (!m) return;
      const stopped = !!m.error || (!m.done && m.steps >= o.max);
      let text;
      if (m.error) text = 'Stopped: ' + sayStep(m, show);
      else if (m.done) text = 'Finished. ' + sayResult();
      else if (stopped) text = 'Stopped: this takes more than ' + fmt(o.max) + ' steps.';
      else text = 'Next: ' + sayNext();
      ui.tell.append(el('span', 'next', text));
      if (m.last && !m.error && !m.done) ui.tell.append(' ', el('span', 'last', 'Before that: ' + sayStep(m, show) + '.'));
    }
    function draw() {
      const mx = m ? maxStep(k) : 0;
      ui.pos.input.max = mx; ui.pos.input.value = k; ui.pos.show();
      ui.play.textContent = timer ? 'Pause' : 'Play';
      if (ui.seg) { ui.mPlain.setAttribute('aria-pressed', String(!o.fast)); ui.mFast.setAttribute('aria-pressed', String(!!o.fast)); }
      drawProg(); drawTape(); drawIO(); drawTell();
      const off = !m || mx === 0;
      ui.play.disabled = off; ui.pos.input.disabled = off; ui.step.disabled = !m || k >= (end !== null ? end : o.max);
      if (m && m.bits !== 8) { ui.note.hidden = false; ui.note.textContent = 'The cells here are ' + m.bits + ' bit: each holds 0 to ' + fmt(2 ** m.bits - 1) + ', and after the highest number comes 0 again.'; } else ui.note.hidden = true;
      if (m && o.onDraw) o.onDraw(m);
    }
    function finished() {
      stop();
      if (!ended && m && m.done) { ended = true; if (o.onEnd) o.onEnd(m); }
    }
    function go(t) {
      if (!m) return;
      t = Math.max(0, Math.min(t, maxStep(t)));
      if (t < k) { m.reset(); k = 0; ended = false; }
      if (t > k) {
        if (t - 1 > k) { m.run(t - 1); k = m.steps; }
        before = m.done ? null : m.tape.slice();
        if (!m.done) m.step();
        k = t;
      } else if (t === 0) before = null;
      draw();
      if (m.done) finished();
    }
    function load(typed) {
      stop(); bad = null; ended = false; winStart = o.from; before = null; k = 0; end = null;
      const input = ui.inp ? Array.from(new TextEncoder().encode(ui.inp.value)) : o.input;
      const make = () => new C.Machine(norm(o.code), { bits: o.bits, size: o.size, init: o.init, input, fast: o.fast });
      try {
        m = make();
        // lay the run out beforehand, so that the slider knows where it ends
        const probe = make().run(Math.min(o.max, HORIZON));
        end = probe.done ? probe.steps + (probe.error ? 1 : 0) : null;
        cap = Math.min(o.max, HORIZON);
      } catch (e) { m = null; bad = e.kind === 'open' ? 'There is a [ without its ].' : e.kind === 'close' ? 'There is a ] without a [ before it.' : 'This program could not be started.'; }
      draw();
      if (typed && m && o.at === 'end' && end) { const f = o.onEnd; o.onEnd = null; go(end); o.onEnd = f; ended = false; }
    }
    ui.play.addEventListener('click', () => {
      if (timer) { stop(); draw(); return; }
      if (!m) return;
      if (k >= maxStep(k)) go(0);
      if (reduced()) { go(end !== null ? end : cap); return; }              // no animation: the end of the run at once
      timer = setInterval(() => {
        if (!m || k >= maxStep(k + 1)) { stop(); draw(); return; }
        go(k + 1);
        if (m.done || m.steps >= o.max) stop();
        draw();
      }, 1000 / Number(ui.speed.input.value));
      draw();
    });
    ui.step.addEventListener('click', () => { stop(); go(k + 1); });
    ui.pos.input.addEventListener('input', () => { stop(); go(Number(ui.pos.input.value)); });
    ui.speed.input.addEventListener('input', () => { if (timer) { ui.play.click(); ui.play.click(); } });
    ui.reset.addEventListener('click', () => load());
    load();
    return {
      get m() { return m; },
      get fast() { return !!o.fast; },
      get step() { return k; },
      go,
      set(changes) { Object.assign(o, changes); if (ui.src && changes.code !== undefined) ui.src.value = o.code; load(); },
      get code() { return norm(o.code); },
      // put a program in the box as if the reader had typed it
      type(code) { o.code = code; if (ui.src) ui.src.value = code; load(true); if (o.onEdit) o.onEdit(code); },
    };
  };
})();
