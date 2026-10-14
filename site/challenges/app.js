// The page of one challenge (play.html?c=id) or one project (play.html?p=id).
(function () {
  'use strict';
  const D = window.BFData, E = window.BFEngine, S = window.BFStudy, store = S.store, el = S.el, fmt = S.fmt, $ = (id) => document.getElementById(id);
  const TIME_LIMIT = 5000;
  const q = new URLSearchParams(location.search);
  const ch = D.byId[q.get('c') || ''] || null, proj = D.PROJECTS.find((p) => p.id === q.get('p')) || null;
  const main = $('main');
  const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // text with `code` in it -> nodes
  const rich = (box, text) => { String(text).split('`').forEach((part, k) => { if (k % 2) box.append(el('code', '', part)); else if (part) box.append(document.createTextNode(part)); }); return box; };
  const eofText = (eof) => (eof === 0 ? 'the cell becomes 0' : eof === 255 ? 'the cell becomes 255' : 'the cell is left unchanged');
  // the trail in the kicker (the shared .kicker.crumbs): Play / Challenges / where you are
  const trail = (...parts) => { const k = $('kicker'); k.textContent = ''; k.append(el('span', '', 'Play')); const a = el('a', '', 'Challenges'); a.href = './'; k.append(a); parts.forEach((p) => { if (typeof p === 'string') k.append(el('span', '', p)); else { const g = el('a', '', p[0]); g.href = p[1]; k.append(g); } }); };
  const strip = (course, unit, n, total, prev, next) => {
    for (const id of ['prevnext', 'prevnext-end']) {
      const nav = $(id); nav.textContent = '';
      const a = (cls, rel, lab, to) => { const x = el('a', cls); x.href = to[0]; x.rel = rel; x.append(el('span', '', lab), to[1]); return x; };
      const count = el('p', 'count'); count.append(unit + ' ', el('b', '', String(n)), ' of ' + total);
      nav.append(el('p', 'course', course), count, a('prev', 'prev', 'Previous', prev), a('next', 'next', 'Next', next));
    }
  };
  const links = (box, list) => { list.forEach(([t, href], k) => { if (k) box.append(' · '); const a = el('a', '', t); a.href = href; box.append(a); }); return box; };

  if (!ch && !proj) {
    trail(); $('title').textContent = 'No such challenge';
    $('statement').textContent = 'This address does not name a challenge. ';
    const a = el('a', '', 'Go to the list of challenges.'); a.href = './'; $('statement').append(a);
    for (const id of ['examples', 'write', 'watchsec', 'hints', 'after', 'checksec']) $(id).hidden = true;
    return;
  }

  // ---- the machine that shows the program running
  let eofRule = 0;
  const Base = window.LearnCore.Machine;
  class Machine extends Base {
    step() {
      if (eofRule !== 0 && !this.done && !this.fast && this.code[this.pc] === ',' && this.inPos >= this.input.length) {
        if (eofRule === 255) this.tape[this.p] = 255;
        this.pc++; this.steps++; this.last = { c: ',' };
        return this.last;
      }
      return super.step();
    }
    run(max) { if (eofRule === 0) return super.run(max); while (!this.done && this.steps < (max || 2e7)) this.step(); this.last = null; return this; }
  }
  window.LearnCore.Machine = Machine;

  const code = $('code');
  const bytesOf = (s) => Array.from(s, (c) => c.charCodeAt(0) & 255);
  let machine = null, watchCases = [];        // [{ label, input, eof, bits }]
  function setupMachine(bits) {
    machine = Learn.machine($('machine'), { code: code.value, bits, size: E.TAPE, cells: 8, follow: true, input: [], max: 2e6,
      onDraw: () => {
        if (eofRule === 0) return;
        const n = $('machine').querySelector('.status .next');     // the lessons' sentence says "puts 0"; say what this rule does
        if (n && /finds no input left/.test(n.textContent)) n.lastChild.textContent = n.lastChild.textContent.replace(/finds no input left, so it puts 0 into (.*)\.$/, eofRule === 255 ? 'finds no input left, so it puts 255 into $1 (the rule of this case).' : 'finds no input left, so it leaves $1 as it is (the rule of this case).');
      } });
  }
  function fillWatch(keep) {
    const sel = $('watchcase'), was = keep === undefined ? sel.value : String(keep);
    sel.textContent = '';
    watchCases.forEach((w, k) => { const o = el('option', '', w.label); o.value = String(k); sel.append(o); });
    const own = el('option', '', 'My own input'); own.value = 'own'; sel.append(own);
    sel.value = was && [...sel.options].some((o) => o.value === was) ? was : watchCases.length ? '0' : 'own';
    showWatch();
  }
  function showWatch() {
    const v = $('watchcase').value, own = v === 'own';
    $('ownrow').hidden = !own;
    const w = own ? { input: S.bytes($('owninput').value), eof: ch ? ch.eof : 0, bits: ch ? ch.bits : 8 } : watchCases[+v];
    eofRule = w.eof;
    machine.set({ code: code.value, input: bytesOf(w.input), bits: w.bits });
    const say = $('watchsay'); say.textContent = 'Input: ';
    say.append(S.showInto(el('code', 'io'), w.input, '(none)'));
    if (w.eof !== 0) say.append(' · at the end of the input ' + eofText(w.eof));
  }
  $('watchcase').addEventListener('change', showWatch);
  $('owninput').addEventListener('input', showWatch);

  // ---- the editor
  S.keys(code);
  let saveTimer = null;
  const count = () => {
    const n = E.length(code.value), c = $('count'); c.textContent = '';
    c.append(el('b', '', fmt(n)), n === 1 ? ' command' : ' commands', ' (everything else is a comment and is not counted)');
  };
  const save = () => { if (ch) store.setDraft(ch.id, code.value); else store.setProj(proj.id, checked(), code.value); };
  code.addEventListener('input', () => {
    count();
    clearTimeout(saveTimer); saveTimer = setTimeout(() => { save(); showWatch(); }, 250);
  });
  code.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && ch) { e.preventDefault(); runTests(); } });
  window.addEventListener('pagehide', () => { clearTimeout(saveTimer); save(); });

  let checked = () => [];
  if (proj) {
    document.title = 'Project: ' + proj.title + ' · brnfck.chat';
    trail(['Projects', './#projects']);
    $('title').textContent = proj.title;
    rich($('statement'), proj.text);
    $('statement').append(el('br'), el('br'), 'A project has no single answer and is not checked by the page. Tick off what your program can do, and stop where you like.');
    for (const id of ['hints', 'after', 'runrow', 'summary', 'blocks', 'detail', 'settings']) $(id).hidden = true;
    // things to try
    const tb = $('iotable'); tb.textContent = '';
    tb.append(el('caption', '', 'Table 1. Inputs to try, and what a finished program could print.'));
    const hr = el('tr'); hr.append(el('th', '', 'Input'), el('th', '', 'Output')); tb.append(hr);
    for (const [i, o] of proj.tries) { const tr = el('tr'), a = el('td'), b = el('td'); a.append(S.showInto(el('code', 'io'), i)); b.append(S.showInto(el('code', 'io'), o)); tr.append(a, b); tb.append(tr); }
    $('examples-h').textContent = 'Things to try';
    // checklist
    const saved = store.proj(proj.id), list = $('checklist'), boxes = [];
    checked = () => boxes.map((b, k) => (b.checked ? k : -1)).filter((k) => k >= 0);
    const tally = () => { $('checkcount').textContent = checked().length + ' of ' + boxes.length + ' ticked.'; };
    proj.checklist.forEach((t, k) => {
      const lab = el('label'), inp = el('input'); inp.type = 'checkbox'; inp.checked = saved.done.indexOf(k) >= 0;
      inp.addEventListener('change', () => { save(); tally(); });
      lab.append(inp, rich(el('span'), t)); list.append(lab); boxes.push(inp);
    });
    tally();
    const tips = $('tips'); proj.tips.forEach((t) => tips.append(rich(el('li'), t)));
    links($('projlinks'), proj.learn);
    code.value = saved.code; count();
    watchCases = proj.tries.map(([i], k) => ({ label: 'Input ' + (k + 1) + ': ' + S.show(i).slice(0, 30), input: i, eof: 0, bits: 8 }));
    setupMachine(8); fillWatch();
    const k = D.PROJECTS.indexOf(proj), prev = D.PROJECTS[k - 1], next = D.PROJECTS[k + 1];
    strip('Projects', 'Project', k + 1, D.PROJECTS.length, prev ? ['play.html?p=' + prev.id, prev.title] : ['play.html?c=' + D.CHALLENGES[D.CHALLENGES.length - 1].id, 'The last challenge'], next ? ['play.html?p=' + next.id, next.title] : ['./', 'All challenges']);
    return;
  }

  $('checksec').hidden = true;
  const group = D.GROUPS.find((g) => g.id === ch.group), N = ch.tests.length;
  document.title = ch.title + ': challenge ' + ch.n + ' · brnfck.chat';
  trail([group.title, './#g-' + group.id]);
  $('title').textContent = ch.title;
  rich($('statement'), ch.text);

  // examples and settings
  const shown = ch.tests.map((t, i) => ({ t, i })).filter((x) => !x.t.hidden);
  {
    const tb = $('iotable'), perCase = shown.some((x) => x.t.eof !== undefined);
    tb.append(el('caption', '', 'Table 1. Examples. Your program is also run on ' + (N - shown.length) + (N - shown.length === 1 ? ' hidden case' : ' hidden cases') + ' that test the edges.'));
    const hr = el('tr'); hr.append(el('th', '', 'Input'), el('th', '', 'Expected output')); if (perCase) hr.append(el('th', '', 'At the end of the input')); tb.append(hr);
    for (const { t } of shown) {
      const tr = el('tr'), a = el('td'), b = el('td');
      a.append(S.showInto(el('code', 'io'), t.in, '(no input)')); b.append(S.showInto(el('code', 'io'), t.out, '(nothing)'));
      tr.append(a, b); if (perCase) tr.append(el('td', '', eofText(t.eof))); tb.append(tr);
    }
    const dl = $('settings'), row = (k, v) => { dl.append(el('dt', '', k), el('dd', '', v)); };
    row('Level', ch.level + ' of 5');
    row('Cells', ch.bits + ' bit: they hold 0 to ' + fmt(2 ** ch.bits - 1) + ' and go round at both ends');
    row('End of input', ch.tests.some((t) => t.eof !== undefined) ? 'differs per case: 0, 255 or unchanged (that is the challenge)' : 'a comma finds nothing: ' + eofText(ch.eof));
    row('Tape', fmt(E.TAPE) + ' cells, the pointer starts on cell 0 and may not go left of it');
    row('Limits', fmt(E.MAX_STEPS) + ' steps per case, ' + TIME_LIMIT / 1000 + ' seconds in all');
    if (ch.ban) row('Not allowed', 'the command ' + ch.ban.split('').join(' '));
    if (shown.some((x) => /[ \n]/.test(x.t.in + x.t.out) || /[^\x20-\x7e]/.test(x.t.in + x.t.out))) { const p = $('legend'); p.hidden = false; }
  }

  // editor, restored
  code.value = store.draft(ch.id); count();
  watchCases = shown.map(({ t, i }, k) => ({ label: 'Example ' + (k + 1) + ': ' + (t.in ? S.show(t.in).slice(0, 24) : 'no input') + (t.eof !== undefined ? ' (end: ' + (t.eof === 'same' ? 'unchanged' : t.eof) + ')' : ''), input: t.in, eof: t.eof !== undefined ? t.eof : ch.eof, bits: ch.bits, i }));
  setupMachine(ch.bits); fillWatch();

  // ---- the blocks, one per case
  const blocks = $('blocks'), detail = $('detail'), summary = $('summary');
  let results = new Array(N).fill(null), openCase = -1;
  const caseName = (i) => 'Case ' + (i + 1) + (ch.tests[i].hidden ? ' (hidden)' : '');
  function paintBlocks() {
    blocks.textContent = '';
    ch.tests.forEach((t, i) => {
      const r = results[i], b = el('button');
      b.type = 'button';
      b.append(el('span', 'm', r ? (r.pass ? '✓' : r.status === 'skip' ? '–' : '✗') : t.hidden ? '?' : '·'), el('span', '', String(i + 1)));
      b.setAttribute('aria-label', caseName(i) + ': ' + (r ? (r.pass ? 'passed' : r.status === 'skip' ? 'not run' : 'failed') : 'not run yet'));
      b.setAttribute('aria-expanded', String(openCase === i)); b.setAttribute('aria-pressed', String(openCase === i));
      b.addEventListener('click', () => { openCase = openCase === i ? -1 : i; paintBlocks(); paintDetail(); });
      blocks.append(b);
    });
  }
  const WHY = {
    limit: () => 'Your program was still running after ' + fmt(E.MAX_STEPS) + ' steps on this input, so it was stopped. Most likely a loop never ends: a loop stops only when the cell under the pointer is zero at its ]. Watch the case run to see which loop it is.',
    timeout: () => 'The time ran out (' + TIME_LIMIT / 1000 + ' seconds) while this case was running, so the program was stopped. Most likely a loop never ends.',
    left: () => 'The pointer moved left of cell 0, and there is nothing there. The program was stopped at that point.',
    right: () => 'The pointer ran off the right end of the tape (' + fmt(E.TAPE) + ' cells). A loop that keeps moving right never found the empty cell it was looking for.',
    flood: () => 'The program printed more than ' + fmt(E.MAX_OUT) + ' characters and was stopped. A loop that prints probably never ends.',
    crash: () => 'The checker itself failed on this case. That is our mistake, not yours.',
    skip: () => 'This case was not run, because an earlier one stopped the checker.',
  };
  function whyWrong(t, r) {
    const a = t.out, b = r.out;
    if (!b.length) return 'The program ended without printing anything.';
    if (!a.length) return 'Nothing should be printed for this input, and the program printed ' + b.length + (b.length === 1 ? ' character.' : ' characters.');
    let k = 0; while (k < a.length && k < b.length && a[k] === b[k]) k++;
    if (k === a.length) return 'The output starts right, and then ' + (b.length - a.length) + ' more ' + (b.length - a.length === 1 ? 'character follows' : 'characters follow') + ' (' + S.show(b.slice(k, k + 8)) + '). A character with number 0 counts too.';
    if (k === b.length) return 'The output is right as far as it goes, but it stops too early: ' + (a.length - b.length) + ' more ' + (a.length - b.length === 1 ? 'character was' : 'characters were') + ' expected.';
    return (k === 0 ? 'The very first character is different' : 'The first ' + k + (k === 1 ? ' character is' : ' characters are') + ' right; character ' + (k + 1) + ' is different') + ': expected ' + S.show(a[k]) + ' (number ' + a.charCodeAt(k) + '), printed ' + S.show(b[k]) + ' (number ' + b.charCodeAt(k) + ').';
  }
  function paintDetail() {
    detail.textContent = '';
    if (openCase < 0) return;
    const i = openCase, t = ch.tests[i], r = results[i], box = el('div', 'card casedetail'), solved = !!store.ch(ch.id).solved;
    const h = el('h3', '', caseName(i) + ': ' + (r ? (r.pass ? '✓ passed' : r.status === 'skip' ? 'not run' : '✗ failed') : 'not run yet'));
    box.append(h);
    const secret = t.hidden && !(r && !r.pass && r.status !== 'skip') && !solved;
    if (t.note && !secret) box.append(el('p', 'why', 'What this case tests: ' + t.note + '.'));
    if (secret) { box.append(el('p', 'why', r && r.pass ? 'A hidden edge case. Your program passed it. Its input is shown once you have solved the challenge.' : 'A hidden edge case. Its input is shown if your program fails it.')); detail.append(box); return; }
    if (r && !r.pass) box.append(el('p', 'why', WHY[r.status] ? WHY[r.status]() : whyWrong(t, r)));
    const side = el('div', 'sidebyside');
    const col = (label, text, empty, cls) => { const d = el('div', 'card' + (cls ? ' ' + cls : '')); d.append(el('p', 'label', label), S.showInto(el('code', 'val'), text, empty)); side.append(d); };
    col('Input', t.in, '(no input)');
    col('Expected', t.out, '(nothing)');
    if (r && r.status !== 'skip') col(r.pass ? '✓ Printed' : '✗ Printed', r.out, '(nothing)', 'got' + (r.pass ? '' : ' wrong'));
    box.append(side);
    const facts = [];
    if (t.eof !== undefined) facts.push('In this case, at the end of the input ' + eofText(t.eof) + '.');
    if (r && r.status !== 'skip') facts.push('Steps: ' + fmt(r.steps) + '.');
    if (facts.length) box.append(el('p', 'muted small', facts.join(' ')));
    const row = el('div', 'row'), w = el('button', '', 'Watch this case run, step by step'); w.type = 'button';
    w.addEventListener('click', () => {
      let k = watchCases.findIndex((x) => x.i === i);
      if (k < 0) { watchCases.push({ label: caseName(i).replace(' (hidden)', '') + ': ' + (t.in ? S.show(t.in).slice(0, 24) : 'no input'), input: t.in, eof: t.eof !== undefined ? t.eof : ch.eof, bits: ch.bits, i }); k = watchCases.length - 1; }
      fillWatch(k);
      $('watchsec').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    });
    row.append(w); box.append(row);
    detail.append(box);
  }

  // ---- running the tests
  let worker = null, job = 0, running = false, killTimer = null, noWorker = false;
  const runBtn = $('run'), stopBtn = $('stop');
  const setRunning = (on) => { running = on; runBtn.disabled = on; stopBtn.hidden = !on; };
  function say(cls, text) { summary.className = 'verdict summary' + (cls === 'ok' ? ' ok' : cls === 'bad' ? ' no' : ''); summary.textContent = text; }
  function finish(timedOut) {
    clearTimeout(killTimer); setRunning(false);
    if (timedOut) { const k = results.findIndex((r) => !r); if (k >= 0) results[k] = { pass: false, status: 'timeout', out: '', steps: 0 }; }
    for (let i = 0; i < N; i++) if (!results[i]) results[i] = { pass: false, status: 'skip', out: '', steps: 0 };
    const src = code.value, len = E.length(src), failed = results.filter((r) => !r.pass && r.status !== 'skip').length, firstFail = results.findIndex((r) => !r.pass && r.status !== 'skip');
    let banned = '';
    if (ch.ban) for (const c of ch.ban) if (E.strip(src).indexOf(c) >= 0) banned += c;
    if (results[0].status === 'brackets') {
      openCase = -1;
      say('bad', 'The brackets do not match: ' + (results[0].why === 'open' ? 'there is a [ without its ].' : 'there is a ] without a [ before it.') + ' Nothing was run.');
    } else if (failed) {
      openCase = firstFail;
      say('bad', (N - failed - results.filter((r) => r.status === 'skip').length) + ' of ' + N + ' cases pass. ' + caseName(firstFail) + ' fails first: it is opened below.' + (timedOut ? ' The program was stopped after ' + TIME_LIMIT / 1000 + ' seconds.' : ''));
    } else if (banned) {
      openCase = -1;
      say('bad', 'The output is right in every case, but this challenge does not allow the command ' + banned + ', and your program uses it.');
    } else {
      openCase = -1;
      const steps = results.reduce((a, r) => a + r.steps, 0), news = store.solve(ch.id, len, steps), medal = D.medal(ch, len);
      say('ok', 'Solved. All ' + N + ' cases pass. ' + fmt(len) + ' commands, ' + fmt(steps) + ' steps.' + (medal ? ' ' + medal.charAt(0).toUpperCase() + medal.slice(1) + ' length.' : '') + (news.first ? '' : news.len && news.steps ? ' A new best for both.' : news.len ? ' Your shortest yet.' : news.steps ? ' Your fewest steps yet.' : ''));
      paintAfter(true);
    }
    paintBlocks(); paintDetail();
  }
  function reveal(i, r) {
    const t = ch.tests[i];
    results[i] = { pass: r.status === 'ok' && r.out === t.out, status: r.status === 'ok' ? 'wrong' : r.status, why: r.why, out: r.out, steps: r.steps };
    if (results[i].pass) results[i].status = 'ok';
    paintBlocks();
  }
  function runTests() {
    if (running) return;
    const src = code.value;
    clearTimeout(saveTimer); save();
    if (!E.length(src)) { say('bad', 'There is no program yet. Type one in the box above.'); return; }
    results = new Array(N).fill(null); openCase = -1; detail.textContent = '';
    setRunning(true); paintBlocks(); say('', 'Running ' + N + ' cases …');
    const cases = ch.tests.map((t) => Object.assign({ input: t.in }, E.settings(ch, t)));
    const id = ++job;
    if (!noWorker) {
      try {
        if (!worker) worker = new Worker('worker.js?v=r6');
        worker.onmessage = (e) => { const m = e.data; if (m.id !== job) return; if (m.done) finish(false); else reveal(m.i, m); };
        worker.onerror = () => { if (id !== job) return; noWorker = true; try { worker.terminate(); } catch (x) { } worker = null; clearTimeout(killTimer); slow(id, src, cases); };
        worker.postMessage({ id, code: src, cases });
        killTimer = setTimeout(() => { if (id !== job || !running) return; worker.terminate(); worker = null; job++; finish(true); }, TIME_LIMIT);
        return;
      } catch (e) { noWorker = true; worker = null; }
    }
    slow(id, src, cases);
  }
  function slow(id, src, cases) {
    const t0 = Date.now(); let i = 0;
    const tick = () => {
      if (id !== job || !running) return;
      if (i >= cases.length) return finish(false);
      if (Date.now() - t0 > TIME_LIMIT) return finish(true);
      const r = E.run(src, Object.assign({}, cases[i], { maxSteps: Math.min(cases[i].maxSteps, 1e6) }));
      reveal(i, r); i++;
      if (r.status === 'brackets') return finish(false);
      setTimeout(tick, 0);
    };
    setTimeout(tick, 0);
  }
  runBtn.addEventListener('click', runTests);
  stopBtn.addEventListener('click', () => { if (!running) return; if (worker) { worker.terminate(); worker = null; } job++; finish(true); });
  paintBlocks();

  // ---- hints
  const hintList = $('hintlist'), hintBtn = $('hintbtn'), giveUp = $('giveup');
  let hintsShown = 0;
  const paintHints = () => {
    hintList.textContent = '';
    for (let k = 0; k < hintsShown; k++) { const c = el('div', 'callout'); c.append(el('h3', '', 'Hint ' + (k + 1)), rich(el('p'), ch.hints[k])); hintList.append(c); }
    hintBtn.hidden = hintsShown >= ch.hints.length;
    hintBtn.textContent = hintsShown === 0 ? 'Give me a hint (1 of ' + ch.hints.length + ')' : 'One more hint (' + (hintsShown + 1) + ' of ' + ch.hints.length + ')';
    giveUp.hidden = hintsShown < ch.hints.length || !$('after').hidden;
    $('hintsay').textContent = hintsShown ? hintsShown + ' of ' + ch.hints.length + ' hints shown.' : 'Three hints, from a nudge to nearly the answer. They appear one at a time.';
  };
  hintBtn.addEventListener('click', () => { hintsShown++; store.hints(ch.id, hintsShown); paintHints(); const li = hintList.lastChild; if (li) { li.tabIndex = -1; li.focus({ preventScroll: false }); } });
  giveUp.addEventListener('click', () => { paintAfter(false, true); giveUp.hidden = true; $('after').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }); });
  hintsShown = Math.min(ch.hints.length, store.ch(ch.id).hints || 0);
  links($('learnlinks'), ch.learn);

  // ---- after solving
  function paintAfter(justNow, gaveUp) {
    const me = store.ch(ch.id), sec = $('after');
    if (!me.solved && !gaveUp) { sec.hidden = true; return; }
    sec.hidden = false;
    $('after-h').textContent = me.solved ? 'Solved' : 'A solution';
    const flag = $('solvedflag'); flag.hidden = !me.solved; flag.textContent = ''; flag.append(el('span', 'badge solid', '✓ Solved' + (me.solved && D.medal(ch, me.len) ? ' · ' + D.medal(ch, me.len) : '')));
    const T = ch.targets, tg = $('targets'); tg.textContent = '';
    const fact = (name, n, unit, badge) => { const d = el('div'), dt = el('dt', '', name), dd = el('dd', '', n); if (badge) dt.append(' ', el('span', 'badge solid', badge)); dd.append(el('span', 'small muted', unit)); d.append(dt, dd); tg.append(d); };
    if (me.solved) {
      fact('Your best', fmt(me.len), ' commands · ' + fmt(me.steps) + ' steps');
    }
    for (const [name, n] of [['Bronze', T.bronze], ['Silver', T.silver], ['Gold', T.gold]]) {
      fact(name, fmt(n), ' commands or fewer', me.solved && me.len <= n ? '✓ reached' : '');
    }
    $('beat').textContent = me.solved && me.len < T.gold ? 'Your program is shorter than the shortest one we have. You beat the author.' : me.solved && me.len === T.gold ? 'That is as short as the shortest program we have.' : 'Gold is the length of the shortest program we have. Every target was reached by a program stored with this challenge.';
    const box = $('solutions'); box.textContent = '';
    ch.solutions.forEach((s, k) => {
      const j = E.judge(ch, s.code);
      box.append(el('h3', '', (k === 0 ? 'Our solution: ' : 'Shorter: ') + s.name));
      box.append(el('p', 'muted small', fmt(s.length) + ' commands, ' + fmt(j.steps) + ' steps over the ' + N + ' cases.' + (me.solved ? ' Yours: ' + fmt(me.len) + ' commands, ' + fmt(me.steps) + ' steps.' : '')));
      const pre = el('pre', 'solution', s.text); pre.tabIndex = 0; pre.setAttribute('aria-label', 'Program: ' + s.name);
      box.append(pre);
      if (s.note) box.append(el('p', '', s.note));
      const row = el('div', 'row'), b = el('button', 'quiet', 'Watch this solution run'); b.type = 'button';
      b.addEventListener('click', () => { if (code.value.trim() && code.value !== s.text && !confirm('Put this solution in the editor? Your own program in the editor is replaced. (Your bests are kept.)')) return; code.value = s.text; code.dispatchEvent(new Event('input', { bubbles: true })); $('watchsec').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }); });
      row.append(b); box.append(row);
    });
    $('explain').textContent = ''; rich($('explain'), ch.explain);
    paintHints();
  }
  paintHints();
  paintAfter(false);

  // ---- previous and next
  {
    const prev = D.CHALLENGES[ch.n - 2], next = D.CHALLENGES[ch.n];
    strip('Challenges', 'Challenge', ch.n, D.CHALLENGES.length, prev ? ['play.html?c=' + prev.id, prev.n + '. ' + prev.title] : ['./', 'All challenges'], next ? ['play.html?c=' + next.id, next.n + '. ' + next.title] : ['play.html?p=' + D.PROJECTS[0].id, 'The projects']);
  }
})();
