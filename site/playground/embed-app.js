// The page code of embed.html, the small playground that other pages show in a frame.
(function () {
  'use strict';
  const { Editor, Tape, el, fmt } = PGParts;
  const $ = (id) => document.getElementById(id);
  const q = new URLSearchParams(location.search);
  let st = { code: q.get('code') || '', input: q.get('input') || '', names: {}, settings: {}, escapes: false };
  for (const part of (q.get('names') || '').split(',')) { const m = /^(\d+):(.+)$/.exec(part); if (m) st.names[m[1]] = m[2].slice(0, 24); }
  for (const k of ['bits', 'size']) if (q.has(k)) st.settings[k] = +q.get(k);
  for (const k of ['overflow', 'edge', 'eof', 'newline', 'bp']) if (q.has(k)) st.settings[k] = q.get(k);
  st.settings.ask = false;
  const readonly = q.get('readonly') === '1', showExplain = q.get('explain') !== '0', rows = Math.min(4, Math.max(1, +q.get('rows') || 1));
  if (q.get('title')) $('e-title').textContent = q.get('title').slice(0, 80);
  if (q.get('link') === '0') $('e-open').hidden = true;

  let settings = PG.cleanSettings(st.settings), names = st.names, m = null, prog = null, timer = 0, running = false;
  const speed = Math.min(1000, Math.max(1, +q.get('speed') || 8));
  const nameOf = (i) => 'cell ' + fmt(i) + (names[i] ? ' (' + names[i] + ')' : '');
  const input = () => PG.inputBytes($('e-in').value, settings.newline, st.escapes);
  const editor = new Editor($('e-editor'), { label: 'Program', onChange: () => { stop(); build(); } });
  const tape = new Tape($('e-tape'), { rows, overview: false, names: () => names });
  const say = (t) => { $('e-live').textContent = ''; setTimeout(() => { $('e-live').textContent = t; }, 30); };

  function build() {
    prog = PG.parse(editor.value, settings.bp);
    m = new PG.Machine(prog, settings, input());
    const e = prog.errors;
    $('e-err').hidden = !e.length; $('e-err').textContent = ''; if (e.length) $('e-err').append(el('span', 'badge solid', 'Brackets'), e[0].message + '.');
    editor.setMark('err', e.map((x) => x.pos));
    $('e-in-box').hidden = !(st.input || editor.value.indexOf(',') >= 0);
    openLink(); draw(false, true);
  }
  function openLink() {
    const u = new URL('./', location.href), p = new URLSearchParams();
    p.set('code', editor.value); if ($('e-in').value) p.set('input', $('e-in').value);
    const n = Object.keys(names).map((k) => k + ':' + names[k]).join(','); if (n) p.set('names', n);
    for (const k of ['bits', 'size', 'overflow', 'edge', 'eof', 'newline', 'bp']) if (settings[k] !== PG.DEFAULTS[k]) p.set(k, settings[k]);
    u.search = p.toString(); $('e-open').href = u.href;
  }
  function draw(fresh, reset) {
    const live = m.state === 'ready' && m.pc < prog.n;
    editor.setMark('exec', live ? [prog.pos[m.pc]] : [], !!fresh);
    let loop = [];
    if (live) { const exit = m.loopExit(m.pc); if (exit > 0) loop = [prog.pos[prog.jump[exit - 1]], prog.pos[exit - 1]].filter((x) => x !== prog.pos[m.pc]); }
    editor.setMark('loop', loop);
    tape.draw(m, !!fresh, !!reset);
    const s = running ? 'running' : m.state === 'done' ? 'done' : m.state === 'error' ? 'error' : m.steps ? 'paused' : 'ready';
    $('e-state').className = 'state ' + s;
    $('e-state').textContent = (s === 'running' ? 'Running' : s === 'done' ? 'Finished' : s === 'error' ? 'Error' : s === 'paused' ? 'Paused' : 'Ready') + ' · step ' + fmt(m.steps);
    $('e-run').textContent = running ? 'Pause' : 'Play';
    const next = $('e-next'); next.textContent = ''; next.hidden = !showExplain; next.classList.toggle('err', m.state === 'error' && !prog.errors.length);
    if (prog.errors.length) next.hidden = true;
    else if (m.state === 'error') next.append(el('span', 'badge solid', 'Error'), m.error.message);
    else if (m.state === 'done') next.append(el('span', 'badge', 'Finished'), prog.n ? 'The program ended after ' + fmt(m.steps) + ' steps. The pointer is on ' + nameOf(m.p) + ', which holds ' + fmt(m.tape[m.p]) + '.' : 'Type a program: any of + - < > [ ] . ,');
    else next.append(el('span', 'badge', 'Next'), PG.explainNext(m, nameOf));
    const out = $('e-out'), bytes = m.output(), clean = bytes.indexOf(13) < 0 ? bytes : bytes.filter((b) => b !== 13), last = m.last();
    out.textContent = '';
    if (fresh && last && prog.op[last.pc] === 5 && clean.length) { let cut = clean.length - 1; while (cut > 0 && (clean[cut] & 0xc0) === 0x80) cut--; const t = PG.fromUtf8(clean.subarray(cut)); out.append(PG.fromUtf8(clean.subarray(0, cut)), el('mark', '', t === '\n' ? '↵\n' : t)); }
    else out.append(PG.fromUtf8(clean));
    out.scrollTop = out.scrollHeight;
    $('e-back').setAttribute('aria-disabled', m.hLen ? 'false' : 'true');
    size();
  }
  function stop() { running = false; clearTimeout(timer); }
  function finish() { say(m.state === 'done' ? 'Finished after ' + fmt(m.steps) + ' steps. ' + (m.outLen ? 'Printed: ' + PG.fromUtf8(m.output().subarray(0, 200)) : PG.describeTape(m, nameOf, 6)) : m.state === 'error' ? m.error.message : 'Paused. ' + PG.explainNext(m, nameOf)); }
  function run() {
    if (running) { stop(); draw(false); finish(); return; }
    if (prog.errors.length) return;
    if (m.state !== 'ready') m.reset(input());
    running = true;
    let lastT = performance.now(), acc = 1;
    const tick = () => {
      if (!running) return;
      const now = performance.now(); acc += Math.min(0.25, (now - lastT) / 1000) * speed; lastT = now;
      // a long program speeds up by itself, so that an embed never runs for minutes
      const n = Math.floor(acc) * (m.steps > 3000 ? 2000 : m.steps > 400 ? 20 : 1);
      if (n >= 1) { acc -= Math.floor(acc); const r = m.run(n); if (r !== 'limit') { running = false; draw(true); finish(); return; } draw(true); }
      timer = setTimeout(tick, 30);
    };
    draw(false); tick();
  }
  $('e-run').addEventListener('click', run);
  $('e-step').addEventListener('click', () => { stop(); if (m.state === 'ready') { m.run(1); draw(true); say(PG.explainLast(m, nameOf) + (m.state === 'ready' ? ' Next: ' + PG.explainNext(m, nameOf) : ' The program has ended.')); } else { draw(false); say(m.state === 'done' ? 'The program has ended. Reset to start again.' : m.error.message); } });
  $('e-back').addEventListener('click', () => { stop(); if (m.back()) { draw(true); say('One step back. Next: ' + PG.explainNext(m, nameOf)); } else say('This is the start of the program.'); });
  $('e-reset').addEventListener('click', () => { stop(); m.reset(input()); draw(false, true); say('Started again.'); });
  $('e-in').addEventListener('input', () => { if (m.steps === 0) { m.reset(input()); draw(false); } openLink(); });
  let lastH = 0;
  function size() { const h = Math.ceil(document.documentElement.getBoundingClientRect().height); if (h !== lastH && window.parent !== window) { lastH = h; window.parent.postMessage({ type: 'bf-embed-height', height: h }, '*'); } }
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(size).observe(document.body);

  async function init() {
    if (/^#[zu]=/.test(location.hash)) { try { const s = await PG.decodeShare(location.hash); st = s; settings = PG.cleanSettings(Object.assign({}, s.settings, { ask: false })); names = s.names; } catch (e) { } }
    $('e-in').value = st.input;
    editor.setBp(settings.bp); editor.setReadOnly(readonly);
    editor.setValue(st.code, false);
    build();
    if (q.get('autorun') === '1') run();
  }
  init();
})();
