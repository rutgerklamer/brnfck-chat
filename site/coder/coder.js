// "Brainfuck that writes brainfuck" (coder/index.html): what brnfck-qwen2.5-coder-0.5b wrote, run on the test cases.
(function () {
  'use strict';
  var C = self.BFData, E = self.BFEngine;
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  var num = function (n) { return Math.round(n).toLocaleString('en-US'); };
  var D = null, state = { set: 'challenges', ver: null, id: null }, results = {};

  // a text as it is shown in a table cell: line breaks and spaces made visible
  function shown(s) {
    if (s === '') return el('span', 'none', 'nothing');
    var span = el('span', 'txt');
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c === 10) span.append(el('i', 'ctl', '↵'));
      else if (c === 32) span.append(el('i', 'sp', '·'));
      else if (c < 32 || c > 126) span.append(el('i', 'ctl', '\\' + c));
      else span.append(s[i]);
    }
    return span;
  }
  // brainfuck coloured by command; anything else it printed in grey
  var KIND = { '+': 'p', '-': 'm', '<': 'v', '>': 'v', '[': 'b', ']': 'b', ',': 'i', '.': 'o' };
  function paint(pre, code) {
    pre.textContent = '';
    var i = 0;
    while (i < code.length) {
      var k = KIND[code[i]] || 'x', j = i + 1;
      while (j < code.length && (KIND[code[j]] || 'x') === k) j++;
      pre.append(el('span', k, code.slice(i, j)));
      i = j;
    }
    if (!code) pre.append(el('span', 'x', '(nothing)'));
  }

  // ---- the tasks and their test cases
  function tasks(set) {
    if (set === 'blind') return D.blind.map(function (t) { return { id: t.id, title: t.id, question: t.question, tests: t.tests, bits: 8, eof: 0 }; });
    return D.challenges.map(function (q) { var ch = C.byId[q.id]; return { id: q.id, title: ch.title, group: ch.group, question: q.question, tests: ch.tests, bits: ch.bits, eof: ch.eof, ban: ch.ban, ch: ch }; });
  }
  function judge(task, code) {
    var src = E.strip(code), cases = task.tests.map(function (t) {
      var r = E.run(src, { input: t.in, bits: t.bits || task.bits || 8, eof: t.eof !== undefined ? t.eof : task.eof === undefined ? 0 : task.eof });
      return { input: t.in, want: t.out, got: r.out, status: r.status, steps: r.steps, pass: r.status === 'ok' && r.out === t.out };
    });
    var banned = task.ban ? task.ban.split('').some(function (c) { return src.indexOf(c) >= 0; }) : false;
    return { cases: cases, pass: src.length > 0 && !banned && cases.every(function (c) { return c.pass; }), banned: banned };
  }
  function answer(ver, set, id) { var a = D.answers[ver] && D.answers[ver][set]; return a && a[id] != null ? a[id] : null; }
  function scoreAll() {
    D.versions.forEach(function (v) {
      results[v.key] = {};
      ['challenges', 'blind'].forEach(function (set) {
        results[v.key][set] = {};
        tasks(set).forEach(function (t) { var a = answer(v.key, set, t.id); results[v.key][set][t.id] = a == null ? null : judge(t, a); });
      });
    });
  }
  function count(ver, set) { var r = results[ver][set], n = 0, all = 0; for (var k in r) { if (r[k]) { all++; if (r[k].pass) n++; } } return [n, all]; }

  // ---- What it wrote
  function seg(box, items, current, onPick) {
    box.textContent = '';
    items.forEach(function (it) {
      var b = el('button', '', it[1]); b.type = 'button'; b.dataset.k = it[0];
      b.setAttribute('aria-pressed', String(it[0] === current));
      b.addEventListener('click', function () { onPick(it[0]); });
      box.append(b);
    });
  }
  function fillTasks() {
    var sel = $('ask-task'), list = tasks(state.set);
    sel.textContent = '';
    if (state.set === 'challenges') {
      C.GROUPS.forEach(function (g) {
        var og = el('optgroup'); og.label = g.title;
        list.filter(function (t) { return t.group === g.id; }).forEach(function (t) { og.append(option(t)); });
        sel.append(og);
      });
    } else list.forEach(function (t) { sel.append(option(t)); });
    if (!list.some(function (t) { return t.id === state.id; })) state.id = list[0].id;
    sel.value = state.id;
    function option(t) { var o = el('option', '', (results[state.ver][state.set][t.id] && results[state.ver][state.set][t.id].pass ? '✓ ' : ' ') + t.title); o.value = t.id; return o; }
  }
  function show() {
    seg($('ask-set'), [['challenges', 'The 51 challenges'], ['blind', '60 blind tasks']], state.set, function (k) { state.set = k; fillTasks(); show(); });
    seg($('ask-ver'), D.versions.map(function (v) { return [v.key, v.name]; }), state.ver, function (k) { state.ver = k; fillTasks(); show(); drawWrong(); });
    var task = tasks(state.set).filter(function (t) { return t.id === state.id; })[0];
    var code = answer(state.ver, state.set, task.id) || '', res = results[state.ver][state.set][task.id];
    $('ask-q').textContent = task.question;
    paint($('ask-code'), code);
    var bf = E.strip(code).length;
    $('ask-len').textContent = num(code.length) + ' characters' + (bf !== code.length ? ', ' + num(bf) + ' of them commands' : '');
    var tb = $('ask-cases').tBodies[0];
    tb.textContent = '';
    res.cases.forEach(function (c) {
      var tr = el('tr', c.pass ? 'ok' : 'no');
      var td = function (node, cls) { var d = el('td', cls); d.append(node); tr.append(d); };
      td(shown(c.input)); td(shown(c.want)); td(c.status === 'ok' ? shown(c.got) : el('span', 'none', { limit: 'ran too long', left: 'stepped off the left end', right: 'ran off the tape', flood: 'printed too much', brackets: 'brackets do not match' }[c.status] || c.status));
      td(document.createTextNode(num(c.steps)), 'r');
      td(el('span', 'mk', c.pass ? '✓' : '✗'), 'mk');
      tb.append(tr);
    });
    var ok = res.cases.filter(function (c) { return c.pass; }).length;
    var who = { base: 'the downloaded model', v1: 'the first round', v2: 'the second round' }[state.ver];
    $('ask-said').textContent = (res.pass ? 'Right: ' : 'Wrong: ') + 'the program that ' + who + ' wrote passes ' + ok + ' of ' + res.cases.length + ' test case' + (res.cases.length === 1 ? '' : 's') +
      (res.banned ? ', but it uses a command the task forbids' : '') + '.';
    own();
    document.querySelectorAll('#board .sq').forEach(function (s) { s.classList.toggle('here', s.dataset.id === state.id && s.dataset.set === state.set); });
  }
  function own() {
    var code = answer(state.ver, state.set, state.id) || '', task = tasks(state.set).filter(function (t) { return t.id === state.id; })[0];
    var r = E.run(E.strip(code), { input: $('ask-in').value, bits: task.bits || 8, eof: task.eof === undefined ? 0 : task.eof });
    var out = $('ask-out'); out.textContent = '';
    out.append(r.status === 'ok' ? shown(r.out) : el('span', 'none', r.status));
  }
  function go(id, set) { state.id = id; if (set && set !== state.set) { state.set = set; } fillTasks(); show(); }

  // ---- the scoreboard
  function drawBoard() {
    var box = $('board'); box.textContent = '';
    D.versions.forEach(function (v) {
      var row = el('div', 'row'), who = el('span', 'who'); who.append(el('b', '', v.name), el('small', '', v.note));
      var sq = el('div', 'cols');
      var group = function (title, cls, list, set) {
        var g = el('span', 'grp' + (cls ? ' ' + cls : '')), s = el('span', 'sqs');
        list.forEach(function (t) { s.append(square(v, set, t)); });
        g.append(el('small', '', title), s); sq.append(g);
      };
      C.GROUPS.forEach(function (g) { group(g.title, '', tasks('challenges').filter(function (t) { return t.group === g.id; }), 'challenges'); });
      group('Blind tasks', 'blind', tasks('blind'), 'blind');
      var a = count(v.key, 'challenges'), b = count(v.key, 'blind'), cnt = el('span', 'cnt');
      cnt.append(el('b', '', a[0] + ' / ' + a[1]), el('small', '', 'challenges'), el('b', '', b[0] + ' / ' + b[1]), el('small', '', 'blind'));
      row.append(who, sq, cnt);
      box.append(row);
    });
    function square(v, set, t) {
      var r = results[v.key][set][t.id], b = el('button', 'sq' + (r && r.pass ? ' on' : ''));
      b.type = 'button'; b.dataset.id = t.id; b.dataset.set = set;
      b.title = t.title + ': ' + (r && r.pass ? 'right' : 'wrong') + ' (' + v.name + ')';
      b.setAttribute('aria-label', b.title);
      b.addEventListener('click', function () { state.ver = v.key; go(t.id, set); $('ask').scrollIntoView({ behavior: 'smooth' }); });
      return b;
    }
  }

  // ---- one answer, to scale
  function drawTime() {
    var r = D.run, read = r.firstPiece - r.startup, write = r.total - r.firstPiece, box = $('time');
    var parts = [['startup', 'It writes its own weights', r.startup], ['read', 'It reads the question', read], ['write', 'It writes the answer', write]];
    var bar = el('div', 'bar');
    parts.forEach(function (p) { var s = el('span', p[0]); s.style.flexGrow = p[2]; bar.append(s); });
    var ticks = el('div', 'ticks');
    for (var i = 0; i < r.pieces; i++) { var t = el('i'); t.style.left = (100 * (r.firstPiece + i * write / r.pieces) / r.total) + '%'; ticks.append(t); }
    bar.append(ticks);
    var key = el('div', 'legend');
    parts.forEach(function (p) { var k = el('span', p[0]); k.append(el('i', 'sw'), el('b', '', p[1]), el('small', '', p[2].toFixed(1) + ' s')); key.append(k); });
    box.textContent = ''; box.append(bar, key);
    var ans = el('pre', 'bf'); paint(ans, r.answer); box.append(el('p', 'label', 'What it wrote: ' + r.pieces + ' word pieces, ' + r.answer.length + ' characters'), ans);
    $('time-said').textContent = 'Of ' + r.total.toFixed(0) + ' seconds, ' + Math.round(100 * read / r.total) + '% go to reading the ' + r.questionBytes + ' bytes of the question and ' + Math.round(100 * write / r.total) +
      '% to writing. The program it writes has ' + r.answer.length + ' characters; the program that writes it has ' + num(D.program.chars) + '.';
    $('time-src').textContent = 'Measured on the command line (compiler/qwen/program/ask.js), Node.js 24 on 8 cores, one run, the question of the challenge Count the a; a tick is a word piece printed.';
  }

  // ---- the training
  var NAMES = { text: 'Print a text', repeat: 'Repeat a character', range: 'A row of characters', lines: 'Lines and triangles', cat: 'Copy the input', echoTimes: 'One character, n times', shift: 'One character, shifted',
    order: 'Characters in another order', skip: 'Skip the first ones', each: 'Every character n times', every: 'Every n-th character', first: 'The first n', until: 'Up to a stop character', countChar: 'Count a character',
    length: 'A mark per character', addConst: 'A digit plus or minus n', addThree: 'Three digits added', mulConst: 'A digit times n', digitChars: 'That many characters', countUp: 'Count up', countDownTo1: 'Count down to 1',
    reverse: 'Backwards', mirror: 'Forwards and back', repeatAll: 'The whole input n times', caseAll: 'Capitals or small letters', shiftAll: 'Every character shifted', wrap: 'Between two characters', append: 'A character before or after',
    swapPairs: 'Swap pairs', isEmpty: 'Empty or not', isChar: 'This character or not', same: 'Two the same or not', parity: 'Even or odd length', replace: 'Replace a character', remove: 'Remove a character',
    lastChar: 'The last character', lengthDigit: 'The length, one digit', lengthNumber: 'The length, in decimal', twoDigits: 'Two digits: + − × larger', productNumber: 'A product, in decimal', divide: 'A digit divided',
    charCode: 'A character’s code', readNumber: 'A code to a character', countDown: 'Count down to 0', rotate: 'One letter on, z to a', noPlus: 'Without a plus', balanced: 'Do the brackets match' };
  function drawFams() {
    var box = $('fams'); box.textContent = '';
    D.families.forEach(function (f) {
      var card = el('div', 'fam' + (f.added ? ' added' : ''));
      var h = el('p', 'h'); h.append(el('b', '', NAMES[f.key] || f.key)); if (f.added) h.append(el('span', 'new', 'new'));
      var pre = el('pre', 'bf'); paint(pre, f.code);
      card.append(h, el('p', 'q', f.question), pre);
      box.append(card);
    });
  }
  function drawCurve() {
    var pts = D.curve.filter(function (p) { return p[0] > 0; }), box = $('curve'), tr = D.training;
    box.textContent = '';
    if (!pts.length) { box.append(el('p', 'tell', 'The second round is still training.')); return; }
    var W = 640, H = 220, L = 44, R = 12, T = 12, B = 34, maxS = tr[1].steps, x = function (s) { return L + (W - L - R) * s / maxS; }, y = function (v) { return T + (H - T - B) * (1 - v / 100); };
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Test examples written exactly right, by step"><g class="grid">';
    [0, 25, 50, 75, 100].forEach(function (v) { svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + v + '%</text>'; });
    for (var s = 0; s <= maxS; s += 1000) svg += '<text x="' + x(s) + '" y="' + (H - 12) + '" text-anchor="middle">' + num(s) + '</text>';
    svg += '</g><polyline class="line" points="' + pts.map(function (p) { return x(p[0]).toFixed(1) + ',' + y(p[2]).toFixed(1); }).join(' ') + '"/>';
    pts.forEach(function (p) { svg += '<circle class="dot" cx="' + x(p[0]).toFixed(1) + '" cy="' + y(p[2]).toFixed(1) + '" r="3.5"><title>step ' + num(p[0]) + ': ' + p[2] + '%</title></circle>'; });
    var last = pts[pts.length - 1];
    svg += '<text class="end" x="' + (x(last[0]) - 6) + '" y="' + (y(last[2]) - 10) + '" text-anchor="end">' + last[2] + '%</text>';
    svg += '<text class="ax" x="' + (W - R) + '" y="' + (H - 1) + '" text-anchor="end">steps of 32 examples</text></svg>';
    box.innerHTML = svg;
    $('curve-src').textContent = 'The second round: the share of ' + num(272) + ' test examples, never trained on, whose whole program the model writes token for token, every 500 steps (compiler/coder/train.py). The first round ended at ' + tr[0].exact + '% after ' + num(tr[0].steps) + ' steps on ' + num(tr[0].examples) + ' examples of ' + tr[0].families + ' kinds. Exactly the same program is a strict measure: another program that also works counts as wrong here.';
  }

  // ---- where it goes wrong
  function drawWrong() {
    var box = $('wrongs'); box.textContent = '';
    var picks = [];
    ['challenges', 'blind'].forEach(function (set) {
      tasks(set).forEach(function (t) {
        var r = results[state.ver][set][t.id];
        if (!r || r.pass) return;
        var c = r.cases.filter(function (k) { return !k.pass && k.status === 'ok'; })[0];
        if (c) picks.push({ set: set, t: t, c: c });
      });
    });
    var v = D.versions.filter(function (x) { return x.key === state.ver; })[0];
    box.append(el('p', 'label', v.name + ': ' + picks.length + ' wrong answers that run and print something'));
    picks.slice(0, 9).forEach(function (p) {
      var card = el('button', 'w'); card.type = 'button';
      card.append(el('b', '', p.t.title), el('span', 'q', p.t.question));
      var dl = el('dl');
      var row = function (k, node) { var d = el('div'); d.append(el('dt', '', k)); var dd = el('dd'); dd.append(node); d.append(dd); dl.append(d); };
      row('Input', shown(p.c.input)); row('Should print', shown(p.c.want)); row('Printed', shown(p.c.got));
      card.append(dl);
      card.addEventListener('click', function () { go(p.t.id, p.set); $('ask').scrollIntoView({ behavior: 'smooth' }); });
      box.append(card);
    });
  }

  // ---- Ask it yourself: the program itself, in a worker, as on the chatbot (home.js)
  // challenges whose answer passes the challenge's test cases (the same four as the chatbot)
  var EXAMPLES = ['abc', 'swap-two', 'no-spaces', 'count-a'];
  var L = { P: null, worker: null, ready: false, id: 0, run: null, t0: 0 };
  var size = function (n) { return self.ProgramStart ? ProgramStart.size(n) : num(n / 1e6) + ' MB'; };
  function liveSay(t) { $('live-said').textContent = t; }
  function stage(t, part) { $('live-prog').hidden = false; $('live-stage').textContent = t; if (part != null) $('live-bar').value = part; }
  function liveFind() {
    EXAMPLES.forEach(function (id) {
      var q = D.challenges.filter(function (c) { return c.id === id; })[0].question, b = el('button', 'chip', C.byId[id].title);
      b.type = 'button'; b.title = q;
      b.addEventListener('click', function () { $('live-q').value = q; });
      $('live-chips').append(b);
    });
    $('live-q').value = D.challenges.filter(function (c) { return c.id === 'swap-two'; })[0].question;
    $('lf-chars').textContent = (D.program.chars / 1e9).toFixed(2) + ' billion characters';
    $('lf-chars').title = num(D.program.chars) + ' characters';
    ProgramStart.find({ name: 'coder-0.5b', manifestUrl: '../dist/coder-0.5b/manifest.json', metaUrl: '../programs/brnfck-qwen2.5-coder-0.5b.meta.json',
      fileUrl: '../programs/brnfck-qwen2.5-coder-0.5b.bf', hostsUrl: '../program-hosts.json' }).then(function (P) {
      L.P = P;
      $('lf-down').textContent = P.mode === 'chunks' ? (P.downloadBytes ? size(P.downloadBytes) : 'none, it is kept') : size(P.meta.programBytes) + ' (one file)';
      $('live-q').maxLength = P.meta.maxQuestionBytes;
    }).catch(function () { $('lf-down').textContent = 'not on this host'; $('live-go').disabled = true; liveSay('This copy of the site has no copy of the program.'); });
    var unfit = ProgramStart.device(4);
    if (unfit) liveSay(unfit.kind === 'phone' ? 'A phone or a tablet cannot run this program: it needs about 4 GB of free memory in one tab.' : 'This computer seems to have too little memory for this program: it needs about 4 GB free in one tab.');
    $('live-go').addEventListener('click', liveGo);
    $('live-q').addEventListener('keydown', function (e) { if (e.key === 'Enter') liveGo(); });
    $('live-in').addEventListener('input', liveRun);
  }
  function liveGo() {
    var q = $('live-q').value.trim();
    if (!q || !L.P || L.run) return;
    if (L.ready) return ask(q);
    if (L.worker) return;
    $('live-go').disabled = true;
    stage('Getting memory for the program.', 0);
    try { L.worker = new Worker('../workers/brnfck-qwen2.5-coder-0.5b.js?v=r1'); } catch (e) { return liveFail('Could not start the background worker (' + e.message + ').'); }
    L.worker.onmessage = function (ev) { onLive(ev.data); };
    L.worker.onerror = function (ev) { liveFail('The background worker stopped' + (ev && ev.message ? ' (' + ev.message + ')' : '') + '. The usual cause is too little free memory.'); };
    L.worker.postMessage(Object.assign({ type: 'load', again: false }, L.P.loadMessage()));
    L.t0 = performance.now();
  }
  function ask(q) {
    L.run = { id: ++L.id, q: q, code: '', pieces: 0, t0: performance.now(), dec: new TextDecoder('utf-8') };
    $('live-go').disabled = true; $('live-ans').hidden = false; $('live-run').hidden = true;
    $('live-code').textContent = ''; $('live-len').textContent = '';
    stage('Reading your task, one word piece at a time (about 2.2 s each). Nothing is printed until it has read all of it.', null);
    L.worker.postMessage({ type: 'ask', id: L.run.id, question: q });
  }
  function onLive(m) {
    if (m.type === 'progress') {
      if (m.stage === 'program' && m.loaded !== undefined) {
        var part = m.loaded / m.total;
        stage((m.net ? 'Downloading the program and running it: ' : 'Running the program: it writes its own weights into memory. ') + Math.floor(100 * part) + '% · ' + num(m.loaded / 1e6) + ' of ' + num(m.total / 1e6) + ' million characters' + (m.net ? ' · ' + size(m.net) + ' downloaded' : ''), part);
      } else if (m.stage === 'compile') stage('Compiling the part of the program that does the thinking.', 1);
    } else if (m.type === 'ready') {
      L.ready = true;
      $('live-go').textContent = 'Ask';
      liveSay('Loaded in ' + Math.round((performance.now() - L.t0) / 1000) + ' s. It stays loaded: the next task starts reading right away.');
      ask($('live-q').value.trim());
    } else if (m.type === 'output' && L.run && m.id === L.run.id) {
      if (L.run.pieces === 0) { L.run.first = performance.now(); stage('Writing the program, one word piece at a time.', null); }
      L.run.pieces = m.piece;
      L.run.code += L.run.dec.decode(m.bytes, { stream: true });
      paint($('live-code'), L.run.code);
      $('live-len').textContent = num(L.run.code.length) + ' characters, ' + m.piece + ' word pieces';
    } else if (m.type === 'done' && L.run && m.id === L.run.id) {
      var r = L.run, secs = function (a, b) { return ((b - a) / 1000).toFixed(0); };
      L.run = null;
      $('live-prog').hidden = true; $('live-go').disabled = false;
      $('live-run').hidden = !r.code;
      liveSay(r.pieces ? 'Read your task in ' + secs(r.t0, r.first) + ' s and wrote ' + r.pieces + ' word pieces in ' + secs(r.first, performance.now()) + ' s. ' + (E.strip(r.code).length === r.code.length ? 'Every character is a brainfuck command.' : 'Not everything it wrote is a brainfuck command; the rest is ignored when it runs.') : 'It wrote nothing.');
      L.code = r.code;
      $('live-pg').href = '../playground/#u=' + b64(JSON.stringify({ c: r.code, i: $('live-in').value }));
      liveRun();
      if (!m.reusable) { L.worker.terminate(); L.worker = null; L.ready = false; $('live-go').textContent = 'Load and ask'; }
    } else if (m.type === 'error') liveFail(m.message);
  }
  function liveRun() {
    if (L.code == null) return;
    var r = E.run(E.strip(L.code), { input: $('live-in').value, bits: 8, eof: 0, maxSteps: 5e6 }), out = $('live-out');
    out.textContent = '';
    out.append(r.status === 'ok' ? shown(r.out) : el('span', 'none', { limit: 'ran too long', left: 'stepped off the left end', right: 'ran off the tape', flood: 'printed too much', brackets: 'its brackets do not match' }[r.status] || r.status));
    $('live-pg').href = '../playground/#u=' + b64(JSON.stringify({ c: L.code, i: $('live-in').value }));
  }
  function liveFail(msg) {
    if (L.worker) { L.worker.terminate(); L.worker = null; }
    L.ready = false; L.run = null;
    $('live-prog').hidden = true; $('live-go').disabled = false; $('live-go').textContent = 'Load and ask';
    liveSay(String(msg).replace(/\.?$/, '.') + ' Close other tabs and programs until about 4 GB is free, and try again.');
  }
  function b64(s) { var u = new TextEncoder().encode(s), t = ''; for (var i = 0; i < u.length; i++) t += String.fromCharCode(u[i]); return btoa(t).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

  // ---- numbers in the text
  function fillNumbers() {
    var p = D.program, words = function (n) { return (n / 1e9).toFixed(2).replace(/0$/, '') + ' billion'; };
    document.querySelectorAll('[data-v]').forEach(function (e) {
      var k = e.dataset.v;
      if (k === 'chars') e.textContent = words(p.chars);
      if (k === 'writer') e.textContent = words(p.writer);
      if (k === 'tape') e.textContent = Math.round(p.tape / 1e6) + ' million';
    });
  }

  fetch('data/coder.json?v=r1').then(function (r) { return r.json(); }).then(function (d) {
    D = d;
    state.ver = D.versions[D.versions.length - 1].key;
    scoreAll(); fillNumbers();
    fillTasks(); show(); drawBoard(); drawTime(); drawFams(); drawCurve(); drawWrong(); liveFind();
    $('ask-task').addEventListener('change', function () { go(this.value); });
    $('ask-prev').addEventListener('click', function () { var l = tasks(state.set), i = l.findIndex(function (t) { return t.id === state.id; }); go(l[(i + l.length - 1) % l.length].id); });
    $('ask-next').addEventListener('click', function () { var l = tasks(state.set), i = l.findIndex(function (t) { return t.id === state.id; }); go(l[(i + 1) % l.length].id); });
    $('ask-in').addEventListener('input', own);
  });
})();
