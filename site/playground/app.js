// The page code of the playground (index.html).
(function () {
  'use strict';
  const { Editor, Tape, el, fmt } = PGParts;
  const $ = (id) => document.getElementById(id);
  const EDIT_LIMIT = 300000, FILE_LIMIT = 64 * 1024 * 1024, OUT_TAIL = 100000;
  const SPEEDS = [1, 2, 5, 10, 25, 100, 1000, 10000, 100000, Infinity];
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  };
  const view = Object.assign({ explain: true, prev: true, chars: true, bits: false, follow: true, speed: 3, keys: null, out: 'text' }, store.get('bf-playground-view', {}));
  const saveView = () => store.set('bf-playground-view', view);

  const S = {
    settings: PG.cleanSettings({}), names: {}, escapes: false, big: null, prog: null, m: null, bpArr: null, depth: null,
    run: null,            // { kind, stopPc, acc, last } while the debugger is running
    resume: null,         // what to continue after input was given
    fast: null,
    lastFast: null, kept: null, note: '', loaded: false,
  };
  const app = $('app'), main = $('main');

  // ---- one screen
  const mq = (q) => (window.matchMedia ? window.matchMedia(q) : { matches: false, addEventListener() {} });
  const ALL = mq('(min-width: 48em) and (min-height: 48em), (min-width: 64em) and (min-height: 30em)');      // every pane at once; otherwise one pane and a switch
  const COL = mq('(min-width: 105em) and (min-height: 30em)');
  const FLOW = mq('(max-width: 35.99em), (max-height: 19.99em)');                   // a phone held upright, or too low for one screen: the page scrolls
  const oneScreen = () => !FLOW.matches;

  // ------------------------------------------------------------------ the parts
  const editor = new Editor($('editor'), {
    label: 'Program', describedby: 'editor-help brackets',
    onChange: () => { onEdit(); },
    onCaret: (pos) => { showMatch(pos); },
    onBreakpoints: () => { buildBps(); saveDraft(); announceBps(); },
  });
  const tape = new Tape($('tape'), {
    rows: (w) => tapeRows(w), names: () => S.names,
    onPick: (i) => pickCell(i), onFollow: (on) => { view.follow = on; $('t-follow').checked = on; },
  });
  tape.follow = view.follow; tape.chars = view.chars; tape.bits = view.bits;

  function tapeRows(w) {
    if (!oneScreen()) return w < 480 ? 2 : 3;
    const body = $('tape-body'), g = tape.grid, n = tape.count ? Math.round(tape.count / tape.cols) : 0;
    if (!n || !g.offsetHeight) { setTimeout(fitTape, 0); return 2; }      // nothing to measure yet
    if (!$('cell-form').hidden || $('tape-more').open) return n;          // the cells stay where they are under a form that is open
    const cs = getComputedStyle(body), gap = parseFloat(getComputedStyle(g).rowGap) || 0, rowH = (g.offsetHeight + gap) / n;
    const top = body.firstElementChild.getBoundingClientRect().top, pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const rest = (e) => e.getBoundingClientRect().bottom - top - g.offsetHeight + pad;
    const free = body.clientHeight + gap, all = Math.floor((free - rest($('tape-more'))) / rowH);
    return Math.min(8, all >= 2 ? all : Math.max(1, Math.min(2, Math.floor((free - rest($('tape'))) / rowH))));
  }
  function fitTape() { tape.layout(); }
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fitTape).observe($('tape-body'));
  FLOW.addEventListener('change', fitTape);

  const code = () => (S.big !== null ? S.big : editor.value);
  const nameOf = (i) => 'cell ' + fmt(i) + (S.names[i] ? ' (' + S.names[i] + ')' : '');
  const inputNow = () => PG.inputBytes($('input').value, S.settings.newline, S.escapes);
  const say = (text) => { $('live').textContent = ''; setTimeout(() => { $('live').textContent = text; }, 30); };

  // ------------------------------------------------------------------ program -> machine
  let editTimer = 0;
  function onEdit() {
    stopAll();
    clearTimeout(editTimer);
    if (editor.value.length > 30000) editTimer = setTimeout(rebuild, 180); else rebuild();
    saveDraft();
    updateEditButtons();
  }
  function rebuild(newMachine) {
    const src = code();
    S.prog = PG.parse(src, S.settings.bp);
    main.classList.toggle('empty', !src.trim());      // one screen: the starter programs show on a phone while there is no program
    if (!S.m || newMachine) S.m = new PG.Machine(S.prog, S.settings, inputNow());
    else { S.m.prog = S.prog; S.m.reset(inputNow()); }
    S.kept = null; S.lastFast = null; S.note = '';
    // loop depth of every command, for the picture of the program
    const n = S.prog.n, d = new Uint16Array(n + 1); let cur = 0, max = 0;
    for (let k = 0; k < n; k++) { const o = S.prog.op[k]; if (o === 8 && cur > 0) cur--; d[k] = cur; if (o === 7) { cur++; if (cur > max) max = cur; } }
    S.depth = d; S.maxDepth = max; S.mapKey = '';
    buildBps();
    // bracket errors: say which and where, and mark them
    const errs = S.prog.errors;
    $('brackets').textContent = errs.length ? errs[0].message + (errs.length > 1 ? '. ' + fmt(errs.length - 1) + ' more unbalanced ' + (errs.length === 2 ? 'bracket' : 'brackets') + ' after it.' : '.') : '';
    editor.setMark('err', S.big !== null ? [] : errs.map((e) => e.pos));
    hideAsk();
    draw(false, true);
    scheduleAnalysis();
  }
  function buildBps() {
    const lines = editor.breakpoints(), p = S.prog;
    if (!p || !lines.length || S.big !== null) { S.bpArr = null; return; }
    const set = new Set(lines), a = new Uint8Array(p.n + 1);
    for (let k = 0; k < p.n; k++) if (set.has(p.line[k])) a[k] = 1;
    S.bpArr = a; S.mapKey = '';
  }
  function announceBps() { const l = editor.breakpoints(); say(l.length ? 'Breakpoints on ' + (l.length === 1 ? 'line ' : 'lines ') + l.map((x) => x + 1).join(', ') + '.' : 'No breakpoints.'); summary(); }

  // ------------------------------------------------------------------ drawing
  function stateOf() {
    const m = S.m;
    if (S.fast) return S.fast.waiting ? 'input' : 'running';
    if (S.run) return 'running';
    if (m.state === 'input') return 'input';
    if (m.state === 'done') return 'done';
    if (m.state === 'error') return 'error';
    return m.steps > 0 ? 'paused' : 'ready';
  }
  const WORD = { ready: 'Ready', running: 'Running', paused: 'Paused', input: 'Waiting for input', done: 'Finished', error: 'Stopped: error' };
  function draw(fresh, reset) {
    const m = S.m, p = S.prog, st = stateOf(), full = S.run && S.run.rate === Infinity;
    // -- the command that runs next, and the loop around it
    if (S.big === null && !editor.plain && !S.fast) {
      const live = m.state === 'ready' || m.state === 'input' || (m.state === 'error' && !p.errors.length);
      editor.setMark('exec', live && m.pc < p.n ? [p.pos[m.pc]] : [], !!fresh);
      let loop = [];
      if (live && m.pc <= p.n) { const exit = m.loopExit(Math.min(m.pc, p.n)); if (exit > 0) loop = [p.pos[p.jump[exit - 1]], p.pos[exit - 1]].filter((x) => x !== p.pos[m.pc] || m.pc >= p.n); }
      editor.setMark('loop', loop);
    } else { editor.setMark('exec', []); editor.setMark('loop', []); }
    // -- tape
    tape.draw(m, !!fresh, !!reset);
    // -- state
    const lc = m.pc < p.n ? PG.lineCol(p.src, p.pos[m.pc]) : null;
    $('state').className = 'kv readout pg-state ' + st;
    $('state-word').className = 'badge' + (st === 'running' || st === 'error' ? ' solid' : '');
    $('state-word').textContent = S.fast ? (S.fast.waiting ? 'Waiting for input' : 'Running fast') : WORD[st];
    let rest;
    if (S.fast) rest = ((performance.now() - S.fast.t0) / 1000).toFixed(1) + ' s · ' + (S.fast.engine === 'wasm' ? 'WebAssembly' : 'checked interpreter') + ' · ' + fmt(S.fast.outLen) + ' bytes printed';
    else rest = fmt(m.steps) + (lc && S.big === null ? ' · line ' + lc.line + ', column ' + lc.col : '') + (S.lastFast ? ' · fast run: ' + S.lastFast : '') + (S.note ? ' · ' + S.note : '');
    $('state-rest').textContent = rest;
    $('b-run').textContent = S.run ? 'Pause' : 'Play';
    // -- explanation
    drawExplain(st, full);
    drawMap();
    drawOutput(fresh);
    drawInputPos();
    if (!S.run && !S.fast) {
      $('tape-words').textContent = PG.describeTape(m, nameOf);
      updateRunButtons(st);
    }
  }
  function tagLine(node, tag, text, err) {
    node.textContent = ''; node.classList.toggle('err', !!err);
    if (!text) return;
    node.append(el('span', 'badge' + (err ? ' solid' : ''), tag), text);
  }
  function drawExplain(st, full) {
    const m = S.m, next = $('ex-next'), prev = $('ex-prev');
    if (S.fast) { tagLine(next, S.fast.waiting ? 'Waiting' : 'Running fast', S.fast.waiting ? 'The program wants to read a byte and the input has run out. Type it in the box under Input.' : 'The program runs in the background. Stop ends it at once.'); prev.textContent = ''; return; }
    if (st === 'error') tagLine(next, 'Error', m.error.message, true);
    else if (st === 'done') tagLine(next, 'Finished', m.prog.n === 0 ? 'There is no command in the program yet. Type one of + - < > [ ] . , or choose an example.' : 'The program ended after ' + fmt(m.steps) + (m.steps === 1 ? ' step' : ' steps') + '. It printed ' + fmt(m.outLen) + (m.outLen === 1 ? ' byte.' : ' bytes.') + ' The pointer is on ' + nameOf(m.p) + ', which holds ' + fmt(m.tape[m.p]) + '.');
    else if (st === 'input') tagLine(next, 'Waiting', 'The , wants to read a byte into ' + nameOf(m.p) + ', and the input has run out. Type it in the box under Input, or say that the input has ended.');
    else if (full) tagLine(next, 'Running', 'At full speed, with the tape drawn 60 times a second. Pause to read what a command does.');
    else tagLine(next, 'Next', PG.explainNext(m, nameOf));
    if (full) prev.textContent = ''; else tagLine(prev, 'Before that', PG.explainLast(m, nameOf));
  }
  function drawMap() {
    const cv = $('map'), p = S.prog, m = S.m, w = cv.clientWidth; if (!w) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), W = Math.round(w * dpr), H = Math.round(30 * dpr);
    const cs = getComputedStyle(cv), ink = cs.getPropertyValue('--ink').trim(), loud = cs.getPropertyValue('--hot').trim(), bg = cs.getPropertyValue('--bg').trim();
    const key = [p.n, W, ink, bg, editor.breakpoints().join(',')].join('|');
    if (key !== S.mapKey) {
      S.mapKey = key;
      const off = S.mapImg = document.createElement('canvas'); off.width = W; off.height = H;
      const g = off.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, W, H); g.fillStyle = ink;
      const n = p.n, unit = (H - 4 * dpr) / (S.maxDepth + 1);
      if (n) for (let x = 0; x < W; x++) {
        const a = Math.floor(x * n / W), b = Math.max(a + 1, Math.floor((x + 1) * n / W)); let d = 0, bp = false;
        for (let k = a; k < b && k < n; k += Math.max(1, (b - a) >> 6)) { if (S.depth[k] > d) d = S.depth[k]; if (S.bpArr && S.bpArr[k]) bp = true; }
        const h = Math.max(3 * dpr, (d + 1) * unit); g.fillRect(x, H - h, 1, h);
        if (bp) { g.fillRect(x, 0, 1, 4 * dpr); }
      }
    }
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const g = cv.getContext('2d'); g.drawImage(S.mapImg, 0, 0);
    if (p.n && !S.fast) {
      const x = Math.min(W - 4 * dpr, Math.max(0, Math.round(m.pc / p.n * W) - 2 * dpr));
      g.fillStyle = loud; g.fillRect(x, 0, 6 * dpr, H); g.strokeStyle = ink; g.lineWidth = 2 * dpr; g.strokeRect(x, dpr, 6 * dpr, H - 2 * dpr);
    }
    const d = m.pc < p.n ? S.depth[m.pc] : 0;
    $('map-text').textContent = p.n ? 'Program map (height = loop depth): ' + (m.pc >= p.n ? 'at the end' : 'at command ' + fmt(m.pc + 1) + ' of ' + fmt(p.n)) + (d ? ', inside ' + d + (d === 1 ? ' loop' : ' loops') : '') + '.' : 'No commands yet.';
  }
  // ---- output ----
  function outBytes() { if (S.fast) return S.fast.out.subarray(0, S.fast.outLen); if (S.kept) return S.kept; return S.m.output(); }
  let outKey = '';
  const PEEK = 120;      // bytes of output shown in the status
  function drawOutput(fresh) {
    const bytes = outBytes(), running = !!(S.run || S.fast), last = S.m.last();
    const justPrinted = !S.fast && !S.kept && fresh && last && S.prog.op[last.pc] === 5 && bytes.length > 0;
    const key = bytes.length + '|' + view.out + '|' + running + '|' + justPrinted + '|' + (S.fast ? 1 : 0);
    if (key === outKey && !fresh) return;
    outKey = key;
    const pre = $('out'), from = Math.max(0, bytes.length - (view.out === 'text' ? OUT_TAIL : 20000)), part = bytes.subarray(from);
    pre.textContent = ''; pre.classList.toggle('live', running);
    if (view.out === 'text') {
      const clean = part.indexOf(13) < 0 ? part : part.filter((b) => b !== 13);
      if (justPrinted && clean.length) {
        let cut = clean.length - 1; while (cut > 0 && (clean[cut] & 0xc0) === 0x80) cut--;     // keep a UTF-8 character whole
        const tail = PG.fromUtf8(clean.subarray(cut));
        pre.append(PG.fromUtf8(clean.subarray(0, cut)), el('mark', '', tail === '\n' ? '↵\n' : tail));
      } else pre.append(PG.fromUtf8(clean));
    } else {
      const parts = new Array(part.length);
      for (let i = 0; i < part.length; i++) parts[i] = view.out === 'hex' ? (part[i] < 16 ? '0' : '') + part[i].toString(16).toUpperCase() : String(part[i]);
      pre.append(parts.join(' '));
    }
    if (running || S.m.state === 'input') pre.append(el('span', 'cur'));
    pre.scrollTop = pre.scrollHeight;
    $('out-peek').hidden = !bytes.length;
    if (bytes.length) $('out-peek-text').textContent = (bytes.length > PEEK ? '\u2026' : '') + PG.fromUtf8(bytes.subarray(Math.max(0, bytes.length - PEEK))).replace(/\r?\n/g, ' \u21b5 ');
    $('out-info').textContent = bytes.length ? fmt(bytes.length) + (bytes.length === 1 ? ' byte' : ' bytes') + ' printed' + (from ? ' (the last ' + fmt(part.length) + ' are shown)' : '') + (view.out === 'text' ? '. Shown as UTF-8 text.' : view.out === 'hex' ? '. Shown as hexadecimal bytes.' : '. Shown as numbers, one for each byte.') : 'Nothing printed yet.';
  }
  function drawInputPos() {
    const m = S.m;
    if (S.fast) { $('in-pos').textContent = ''; return; }
    $('in-pos').textContent = m.inLen ? fmt(m.inPos) + ' of ' + fmt(m.inLen) + ' bytes read' + (m.inPos < m.inLen ? '; next: ' + m.inp[m.inPos] + ' (' + PG.charName(m.inp[m.inPos]).replace(/^the character /, '') + ')' : '') : 'no input';
  }
  function updateRunButtons(st) {
    const bad = S.prog.errors.length > 0;
    $('b-run').disabled = bad; $('b-fast').disabled = bad;
    $('b-step').disabled = bad; $('b-over').disabled = bad; $('b-out').disabled = bad; $('b-cursor').disabled = bad || S.big !== null;
    $('b-back').setAttribute('aria-disabled', S.m.hLen ? 'false' : 'true');
  }
  function updateEditButtons() {
    $('e-undo').setAttribute('aria-disabled', editor.canUndo() ? 'false' : 'true'); $('e-redo').setAttribute('aria-disabled', editor.canRedo() ? 'false' : 'true');
  }
  let matchTimer = 0;
  function showMatch(pos) {
    clearTimeout(matchTimer);
    matchTimer = setTimeout(() => {
      const p = S.prog; if (!p || S.big !== null || p.src !== editor.value) return;
      for (const at of [pos, pos - 1]) {
        if (at < 0) continue;
        const ch = p.src[at];
        if (ch !== '[' && ch !== ']') continue;
        const k = PG.opAt(p, at);
        if (p.pos[k] !== at) continue;
        if (p.errors.some((e) => e.pos === at)) { editor.setMark('match', []); return; }
        editor.setMark('match', [at, p.pos[p.jump[k]]]); return;
      }
      editor.setMark('match', []);
    }, 40);
  }

  // ------------------------------------------------------------------ running in the page
  function stopRun() { if (S.run) { cancelAnimationFrame(S.run.raf); S.run = null; } }
  function stopAll() { stopRun(); S.resume = null; if (S.fast) endFast(null); }
  function freshStart() { S.m.reset(inputNow()); S.kept = null; S.lastFast = null; S.note = ''; hideAsk(); }
  function noteFor(r) {
    const m = S.m, p = S.prog;
    if (r === 'bp') S.note = 'paused at the breakpoint on line ' + (p.line[m.pc] + 1);
    else if (r === 'break') S.note = 'paused by the breakpoint character ' + p.bp;
  }
  function ended(r, kind) {
    const m = S.m, p = S.prog;
    const lc = m.pc < p.n ? PG.lineCol(p.src, p.pos[m.pc]) : null;
    if (r === 'input') { showAsk(); return; }
    let text = '';
    if (r === 'done') { const out = PG.fromUtf8(m.output().subarray(0, 300)); text = 'Finished after ' + fmt(m.steps) + ' steps. ' + (m.outLen ? 'Printed: ' + out : 'Nothing printed.'); }
    else if (r === 'error') text = 'Stopped by an error. ' + m.error.message;
    else if (r === 'bp') { text = 'Paused at the breakpoint on line ' + lc.line + '. Next: ' + PG.explainNext(m, nameOf); }
    else if (r === 'break') { text = 'Paused by the breakpoint character ' + p.bp + '.'; }
    else if (r === 'cursor') text = (kind === 'cursor' ? 'Reached the cursor. ' : 'Paused. ') + 'Next: ' + PG.explainNext(m, nameOf);
    else text = 'Paused at step ' + fmt(m.steps) + '. Next: ' + PG.explainNext(m, nameOf);
    say(text + (r === 'done' || r === 'error' ? '' : ' ' + PG.describeTape(m, nameOf, 4)));
  }
  function go(kind, stopPc) {
    const m = S.m;
    stopRun(); if (S.fast) return;
    if (S.prog.errors.length) { say($('brackets').textContent); return; }
    if (kind === 'run' && (m.state === 'done' || m.state === 'error')) freshStart();
    if (m.state === 'input') { showAsk(); return; }
    if (m.state !== 'ready') { draw(false); say(m.state === 'done' ? 'The program has ended. Press Start again to run it once more.' : m.error.message); return; }
    S.note = ''; S.kept = null;
    const rate = kind === 'run' ? SPEEDS[view.speed] : Infinity;
    S.run = { kind, stopPc: stopPc === undefined ? -1 : stopPc, rate, acc: rate === Infinity ? 0 : 1, last: performance.now(), raf: 0 };
    if (kind === 'run') say('Running.');
    const frame = (now) => {
      const R = S.run; if (!R) return;
      let r = 'limit';
      if (R.rate === Infinity) { const t0 = performance.now(); while (r === 'limit' && performance.now() - t0 < 12) r = m.run(40000, R.stopPc, S.bpArr); }
      else {
        R.rate = SPEEDS[view.speed];
        R.acc += Math.min(0.25, (now - R.last) / 1000) * R.rate; R.last = now;
        const n = Math.floor(R.acc);
        if (n >= 1) { R.acc -= n; r = m.run(n, R.stopPc, S.bpArr); } else { R.raf = requestAnimationFrame(frame); return; }
        if (R.rate === Infinity) R.acc = 0;
      }
      if (r === 'limit') { draw(true); R.raf = requestAnimationFrame(frame); return; }
      const k = R.kind; S.run = null;
      if (r === 'input') S.resume = { kind: k, stopPc: R.stopPc };
      noteFor(r); draw(true); ended(r, k);
    };
    draw(false);
    S.run.raf = requestAnimationFrame(frame);
  }
  function pause() { if (!S.run) return; stopRun(); draw(false); ended('pause'); }
  function step() {
    if (S.fast) return;
    const was = !!S.run; stopRun();
    const m = S.m;
    if (was) { draw(false); ended('pause'); return; }
    if (m.state === 'input') { showAsk(); return; }
    if (m.state !== 'ready') { say(m.state === 'done' ? 'The program has ended. Press Start again, or step back.' : m.error ? m.error.message : ''); return; }
    S.note = ''; S.kept = null;
    const r = m.run(1);
    noteFor(r); draw(true);
    if (r === 'limit' || r === 'cursor' || r === 'bp' || r === 'break') say(PG.explainLast(m, nameOf) + ' Next: ' + PG.explainNext(m, nameOf));
    else ended(r);
  }
  function back() {
    if (S.fast) return;
    stopRun(); hideAsk(); S.resume = null;
    const m = S.m;
    if (!m.back()) { S.note = m.steps ? 'no older step is kept: step back remembers the last ' + fmt(PG.HISTORY) + ' steps' : ''; draw(false); say(m.steps ? 'No older step is kept. Step back remembers the last ' + fmt(PG.HISTORY) + ' steps.' : 'This is the start of the program.'); return; }
    S.note = ''; draw(true);
    say('One step back, to step ' + fmt(m.steps) + '. Next: ' + PG.explainNext(m, nameOf));
  }
  function over() { const m = S.m, p = S.prog; if (m.state === 'ready' && p.op[m.pc] === 7) go('over', p.jump[m.pc] + 1); else step(); }
  function out() { const m = S.m; if (m.state !== 'ready') { step(); return; } const exit = m.loopExit(m.pc); if (exit < 0) { say('The next command is not inside a loop.'); S.note = 'not inside a loop'; draw(false); return; } go('out', exit); }
  function toCursor() {
    if (S.big !== null) return;
    const p = S.prog, k = PG.opAt(p, editor.caret);
    if (k >= p.n) { say('There is no command at or after the cursor.'); S.note = 'no command at or after the cursor'; draw(false); return; }
    if (S.m.state === 'done' || S.m.state === 'error') freshStart();
    go('cursor', k);
  }
  function reset() { stopAll(); freshStart(); draw(false, true); say('Started again. The tape is empty and the program is at its first command.'); }

  // ------------------------------------------------------------------ asking for input
  function showAsk() {
    $('ask').hidden = false; setView('io'); draw(false);
    $('ask-text').focus();
    say('The program asks for input. Type characters and press Send, or choose End of input.');
  }
  function hideAsk() { $('ask').hidden = true; $('ask-text').value = ''; }
  function answer(bytes, eof) {
    if (S.fast) { S.fast.waiting = false; if (eof) S.fast.worker.postMessage({ type: 'eof' }); else { S.fast.input.push(...bytes); S.fast.worker.postMessage({ type: 'input', bytes }); } hideAsk(); draw(false); return; }
    const m = S.m; if (eof) m.endInput(); else m.provide(bytes);
    hideAsk();
    const r = S.resume; S.resume = null;
    if (r) go(r.kind, r.stopPc); else { draw(false); say('Input received. Next: ' + PG.explainNext(m, nameOf)); $('b-step').focus(); }
  }
  $('ask').addEventListener('submit', (e) => { e.preventDefault(); const t = $('ask-text').value; if (!t) { say('Type at least one character, or choose End of input.'); return; } answer(PG.inputBytes(t, S.settings.newline, S.escapes)); });
  $('ask-line').addEventListener('click', () => answer(PG.inputBytes($('ask-text').value + '\n', S.settings.newline, S.escapes)));
  $('ask-eof').addEventListener('click', () => answer(null, true));

  // ------------------------------------------------------------------ fast mode
  function runFast() {
    stopAll();
    if (S.prog.errors.length) { say($('brackets').textContent); return; }
    const set = S.settings, wasmOk = set.overflow === 'wrap' && set.eof === 'zero';
    const engine = set.engine === 'wasm' && wasmOk ? 'wasm' : 'checked';
    freshStart();
    S.note = set.engine === 'wasm' && !wasmOk ? 'WebAssembly needs wrapping cells and end of input 0: the checked interpreter was used' : '';
    let worker;
    try { worker = new Worker('fastworker.js?v=r7'); } catch (e) { S.note = 'this browser could not start a background worker'; draw(false); say('Fast mode could not start.'); return; }
    const input = inputNow();
    const F = S.fast = { worker, t0: performance.now(), engine, out: new Uint8Array(65536), outLen: 0, waiting: false, input: Array.from(input), timer: 0 };
    worker.onmessage = (ev) => {
      const d = ev.data; if (S.fast !== F) return;
      if (d.type === 'out') {
        if (F.outLen + d.bytes.length > F.out.length) { const b = new Uint8Array(Math.max(F.out.length * 2, F.outLen + d.bytes.length)); b.set(F.out.subarray(0, F.outLen)); F.out = b; }
        F.out.set(d.bytes, F.outLen); F.outLen += d.bytes.length;
      } else if (d.type === 'need') { F.waiting = true; showAsk(); }
      else if (d.type === 'end') endFast(d);
    };
    worker.onerror = (ev) => { endFast({ state: 'error', error: 'Fast mode failed: ' + (ev.message || 'the worker stopped'), crashed: true, ms: 0, steps: 0 }); };
    worker.postMessage({ type: 'run', src: code(), settings: set, input, engine });
    $('b-fast').hidden = true; $('b-stop').hidden = false; $('b-fpause').hidden = engine === 'wasm';
    $('b-stop').focus();
    F.timer = setInterval(() => draw(false), 100);
    draw(false); say('Running fast. Press Stop or Escape to end it.');
  }
  // d: the worker's last message, or null when the user pressed Stop
  function endFast(d) {
    const F = S.fast; if (!F) return;
    clearInterval(F.timer); F.worker.terminate(); S.fast = null;
    const hadFocus = document.activeElement === $('b-stop') || document.activeElement === $('b-fpause');
    $('b-fast').hidden = false; $('b-stop').hidden = true; $('b-fpause').hidden = true; hideAsk();
    const out = F.out.slice(0, F.outLen), secs = (performance.now() - F.t0) / 1000;
    const m = S.m;
    if (!d) { m.reset(inputNow()); S.kept = out; S.lastFast = 'stopped by you after ' + secs.toFixed(1) + ' s; what it printed until then is kept below'; say('Fast run stopped after ' + secs.toFixed(1) + ' seconds.'); }
    else if (d.crashed) {
      m.reset(inputNow()); S.kept = out;
      S.lastFast = 'failed';
      const why = /unreachable|out of bounds|memory/i.test(d.error || '') ? 'The WebAssembly engine stopped: the pointer probably left the tape. Choose the checked interpreter in Settings to see where.' : d.error;
      m.state = 'error'; m.error = { kind: 'fast', message: why }; say(why);
    } else {
      const time = d.ms < 1000 ? d.ms.toFixed(d.ms < 10 ? 1 : 0) + ' ms' : (d.ms / 1000).toFixed(2) + ' s';
      m.load({ tape: d.tape, p: d.p, textPos: d.textPos < 0 ? 0 : d.textPos, done: d.done, steps: d.steps < 0 ? 0 : d.steps, out, inPos: d.inPos, eofSent: d.eofSent, input: F.input, error: d.state === 'error' ? d.error + ' Run it in the debugger (Play at full speed) to stop exactly on the command.' : null });
      S.lastFast = (d.state === 'paused' ? 'paused after ' : d.state === 'error' ? 'stopped after ' : 'finished in ') + time + (d.steps >= 0 ? ', ' + (d.steps > 9e15 ? 'about ' + d.steps.toExponential(2).replace('e+', ' × 10^') : fmt(d.steps)) + ' steps' : ', steps not counted') + ' (' + (F.engine === 'wasm' ? 'WebAssembly' : 'checked interpreter') + ')';
      say('Fast run ' + S.lastFast + '. ' + (d.state === 'error' ? d.error : d.state === 'paused' ? 'You can step from here.' : (out.length ? 'Printed: ' + PG.fromUtf8(out.subarray(0, 300)) : 'Nothing printed.')));
    }
    if (hadFocus) $('b-fast').focus();
    draw(false, true);
  }

  // ------------------------------------------------------------------ run bar wiring
  $('b-run').addEventListener('click', () => { if (S.run) pause(); else go('run'); });
  $('b-step').addEventListener('click', step);
  $('b-back').addEventListener('click', back);
  $('b-over').addEventListener('click', over);
  $('b-out').addEventListener('click', out);
  $('b-cursor').addEventListener('click', toCursor);
  $('b-reset').addEventListener('click', reset);
  $('b-fast').addEventListener('click', runFast);
  $('b-stop').addEventListener('click', () => { endFast(null); });
  $('b-fpause').addEventListener('click', () => { if (S.fast) S.fast.worker.postMessage({ type: 'pause' }); });
  const speedText = (i) => (SPEEDS[i] === Infinity ? 'full speed' : fmt(SPEEDS[i]) + (SPEEDS[i] === 1 ? ' step a second' : ' steps a second'));
  function setSpeed(i) { view.speed = i; $('speed').value = i; $('speed-out').textContent = speedText(i); $('speed').setAttribute('aria-valuetext', speedText(i)); if (S.run && S.run.kind === 'run') { S.run.rate = SPEEDS[i]; S.run.last = performance.now(); } saveView(); }
  $('speed').addEventListener('input', () => setSpeed(+$('speed').value));

  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey, k = e.key;
    let f = null;
    if (k === 'Enter' && mod && e.shiftKey) f = runFast;
    else if ((k === 'Enter' && mod) || (k === 'F8' && !e.shiftKey)) f = () => { if (S.run) pause(); else go('run'); };
    else if (k === 'F8' && e.shiftKey) f = reset;
    else if (k === 'F10' && !e.shiftKey || (k === '.' && mod)) f = step;
    else if (k === 'F7' || (k === ',' && mod)) f = back;
    else if (k === 'F2') f = e.shiftKey ? out : over;
    else if (k === 'F4' && !e.altKey) f = toCursor;
    else if (k === 'F9') f = () => { if (S.big === null) editor.toggleBreakpoint(editor.lineOf(editor.caret)); };
    else if (k === 'Escape') { if (S.fast) f = () => endFast(null); else if (S.run) f = pause; else if (!$('cell-form').hidden && $('cell-form').contains(document.activeElement)) f = closeCell; }
    if (f) { e.preventDefault(); f(); }
  });

  // ------------------------------------------------------------------ editor tools
  $('e-undo').addEventListener('click', () => { if (S.big === null) { editor.undo(); updateEditButtons(); } });
  $('e-redo').addEventListener('click', () => { if (S.big === null) { editor.redo(); updateEditButtons(); } });
  $('e-format').addEventListener('click', () => {
    if (S.big !== null) return;
    const r = PG.format(editor.value, S.settings.bp);
    if (!r.ok) { say('Cannot format: ' + r.message); $('brackets').textContent = r.message + '. Fix the brackets first, then format.'; return; }
    if (r.text !== editor.value) { editor.setBreakpoints([]); editor.setValue(r.text); }
    say('Formatted: one loop level for each step of indent. Undo brings the old layout back.');
  });
  $('e-minify').addEventListener('click', () => {
    if (S.big !== null) return;
    const t = PG.minify(editor.value, S.settings.bp);
    if (t !== editor.value) { editor.setBreakpoints([]); editor.setValue(t + (t ? '\n' : '')); }
    say('Minified: comments and white space are gone. Undo brings them back.');
  });
  $('e-bp').addEventListener('click', () => { if (S.big === null) editor.toggleBreakpoint(editor.lineOf(editor.caret)); });
  // the command keys
  const keys = $('keys');
  function showKeys(on) { keys.hidden = !on; $('e-keys').setAttribute('aria-pressed', on ? 'true' : 'false'); if (!on) undock(); }
  $('e-keys').addEventListener('click', () => { view.keys = keys.hidden; showKeys(view.keys); saveView(); });
  keys.addEventListener('pointerdown', (e) => { if (e.target.closest('button') && document.activeElement === editor.ta) e.preventDefault(); });
  keys.addEventListener('mousedown', (e) => { if (e.target.closest('button') && document.activeElement === editor.ta) e.preventDefault(); });
  keys.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || S.big !== null) return;
    const a = b.dataset.a;
    const k = b.dataset.c !== undefined ? b.dataset.c : b.dataset.k;      // data-c: a command key of the .keypad; data-k: new line, space
    if (k !== undefined) editor.insert(k);
    else if (a === 'left') editor.moveCaret(-1); else if (a === 'right') editor.moveCaret(1);
    else if (a === 'bs') editor.backspace(); else if (a === 'undo') editor.undo();
    else if (a === 'done') { editor.ta.blur(); undock(); }
    updateEditButtons();
  });
  // on a phone the keys sit just above the on-screen keyboard while the editor has the focus
  function undock() { keys.classList.remove('docked'); keys.style.top = ''; document.documentElement.style.removeProperty('--keys-h'); }
  function dock() {
    const vv = window.visualViewport, root = document.documentElement, at = document.activeElement;
    const up = !!vv && vv.height <= window.innerHeight * 0.78;      // the on-screen keyboard is up
    const typing = up && oneScreen() && !ALL.matches && (vv.scale || 1) < 1.05 && !!at && /^(INPUT|TEXTAREA|SELECT)$/.test(at.tagName);
    document.body.classList.toggle('kb', typing);
    if (typing) { root.style.setProperty('--vvh', Math.round(vv.height) + 'px'); if (window.scrollY || vv.offsetTop) window.scrollTo(0, 0); } else root.style.removeProperty('--vvh');
    if (!up || keys.hidden || at !== editor.ta) { undock(); return; }
    keys.classList.add('docked'); keys.style.top = Math.round(vv.offsetTop + vv.height - keys.offsetHeight) + 'px';
    root.style.setProperty('--keys-h', keys.offsetHeight + 'px');
  }
  if (window.visualViewport) { window.visualViewport.addEventListener('resize', dock); window.visualViewport.addEventListener('scroll', dock); }
  editor.ta.addEventListener('focus', () => setTimeout(dock, 300)); editor.ta.addEventListener('blur', () => setTimeout(dock, 50));

  // ------------------------------------------------------------------ tape tools
  $('t-prev').addEventListener('click', () => { tape.page(-1); followBox(false); });
  $('t-next').addEventListener('click', () => { tape.page(1); followBox(false); });
  function followBox(on) { view.follow = on; tape.follow = on; $('t-follow').checked = on; saveView(); }
  function jump() { const n = Math.floor(+$('t-jump').value); if (!(n >= 0)) return; const c = Math.min(S.m.size - 1, n); followBox(false); tape.show(c - Math.floor(tape.cols / 2)); pickCell(c, true); say('Showing ' + nameOf(c) + ', which holds ' + fmt(S.m.tape[c]) + '.'); }
  $('t-go').addEventListener('click', jump);
  $('t-jump').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); jump(); } });
  $('t-ptr').addEventListener('click', () => { followBox(true); tape.draw(S.m, false); say(PG.describeTape(S.m, nameOf, 4)); });
  $('t-follow').addEventListener('change', () => { followBox($('t-follow').checked); tape.draw(S.m, false); });
  $('t-chars').addEventListener('change', () => { view.chars = tape.chars = $('t-chars').checked; saveView(); tape.draw(S.m, false); fitTape(); });
  $('t-bits').addEventListener('change', () => { view.bits = tape.bits = $('t-bits').checked; saveView(); tape.draw(S.m, false); fitTape(); });
  function pickCell(i, quiet) {
    tape.picked = i; tape.draw(S.m, false);
    $('cell-form').hidden = false; $('cell-h').textContent = 'Cell ' + fmt(i);
    $('cell-name').value = S.names[i] || ''; $('cell-value').value = S.m.tape[i]; $('cell-value').max = S.m.max;
    const v = S.m.tape[i];
    $('cell-info').textContent = 'Value ' + fmt(v) + ' · hex ' + v.toString(16).toUpperCase() + ' · binary ' + v.toString(2).padStart(S.settings.bits, '0').replace(/(.{8})(?=.)/g, '$1 ') + (PGParts.charOf(v) ? ' · character ' + PGParts.charOf(v) : '') + '. Changing a value by hand clears the step-back history.';
    if (!quiet) $('cell-name').focus();
  }
  function closeCell() { const i = tape.picked; $('cell-form').hidden = true; tape.picked = -1; tape.draw(S.m, false); fitTape(); const c = tape.cells.find((x) => x.i === i); if (c) c.b.focus(); }
  $('cell-close').addEventListener('click', closeCell);
  $('cell-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const i = tape.picked, name = $('cell-name').value.trim().slice(0, 24), v = Math.floor(+$('cell-value').value);
    if (name) S.names[i] = name; else delete S.names[i];
    if (v >= 0 && v <= S.m.max && v !== S.m.tape[i] && !S.run && !S.fast) { S.m.tape[i] = v; S.m.hHead = 0; S.m.hLen = 0; if (i > S.m.hi) S.m.hi = i; }
    saveDraft(); draw(false); pickCell(i, true);
    say(nameOf(i) + ' now holds ' + fmt(S.m.tape[i]) + '.');
  });

  // ------------------------------------------------------------------ input and output wiring
  $('input').addEventListener('input', () => { if (S.m.steps === 0 && !S.run && !S.fast && S.m.state !== 'input') { S.m.reset(inputNow()); draw(false); } saveDraft(); });
  $('in-eof').addEventListener('change', () => applySettings({ eof: $('in-eof').value }));
  $('in-ask').addEventListener('change', () => applySettings({ ask: $('in-ask').checked }));
  $('in-esc').addEventListener('change', () => { S.escapes = $('in-esc').checked; if (S.m.steps === 0) { S.m.reset(inputNow()); draw(false); } saveDraft(); });
  for (const b of document.querySelectorAll('[data-out]')) b.addEventListener('click', () => { view.out = b.dataset.out; for (const x of document.querySelectorAll('[data-out]')) x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); saveView(); outKey = ''; drawOutput(false); });
  async function copyText(text, msg, okText) {
    try { await navigator.clipboard.writeText(text); msg.textContent = okText; msg.className = 'verdict plain ok'; return true; }
    catch (e) { msg.textContent = 'Copying is not allowed here. Select the text and copy it yourself.'; msg.className = 'verdict plain no'; return false; }
  }
  $('out-copy').addEventListener('click', async () => { const info = $('out-info'), t = $('out').textContent; try { await navigator.clipboard.writeText(t); say('Printed text copied.'); info.textContent = 'Copied.'; } catch (e) { say('Copying is not allowed here.'); info.textContent = 'Copying is not allowed here: select the output and copy it yourself.'; } });

  // ------------------------------------------------------------------ settings
  function showSettings() {
    const s = S.settings, f = $('settings');
    for (const k of ['bits', 'overflow', 'edge', 'eof', 'newline', 'bp', 'engine', 'ask']) for (const r of f.querySelectorAll('[name="' + k + '"]')) r.checked = r.value === String(s[k]);
    f.elements.size.value = s.size;
    $('in-eof').value = s.eof; $('in-ask').checked = s.ask; $('in-esc').checked = S.escapes;
    $('conf-text').textContent = PG.isClassic(s) ? 'Classic interpreter: 8-bit wrapping cells, 30,000 cells, end of input is 0.' : 'Interpreter: ' + PG.describeSettings(s) + '.';
    document.querySelector('.pg-conf').classList.toggle('custom', !PG.isClassic(s));
  }
  function applySettings(change, quiet) {
    stopAll();
    S.settings = PG.cleanSettings(Object.assign({}, S.settings, change));
    editor.setBp(S.settings.bp);
    showSettings(); rebuild(true); saveDraft();
    if (!quiet) say('Settings changed and the program reset. ' + $('conf-text').textContent);
  }
  $('settings').addEventListener('change', (e) => {
    const t = e.target; if (!t.name) return;
    if (t.name === 'size') { const n = Math.floor(+t.value); if (!(n >= 1)) { t.value = S.settings.size; return; } applySettings({ size: n }); }
    else applySettings({ [t.name]: t.name === 'bits' ? +t.value : t.name === 'ask' ? t.value === 'true' : t.value });
  });
  $('settings').addEventListener('submit', (e) => e.preventDefault());
  $('set-classic').addEventListener('click', () => applySettings(Object.assign({}, PG.DEFAULTS)));
  $('conf-change').addEventListener('click', () => { setView('tools'); selectTab('settings', true); });

  // ------------------------------------------------------------------ tabs and views
  const tabs = [...document.querySelectorAll('.pg-tabs [role="tab"]')];
  function selectTab(name, focus) {
    for (const t of tabs) {
      const on = t.id === 'tab-' + name; t.setAttribute('aria-selected', on ? 'true' : 'false'); t.tabIndex = on ? 0 : -1; $(t.getAttribute('aria-controls')).hidden = !on;
      if (on && focus) t.focus();
      if (on && t.offsetParent) t.parentNode.scrollLeft = Math.max(0, t.offsetLeft - t.parentNode.offsetLeft - (t.parentNode.clientWidth - t.offsetWidth) / 2);      // one screen: on a phone the strip of tabs scrolls sideways
    }
    if (name === 'save') renderSaved();
  }
  for (const t of tabs) {
    t.addEventListener('click', () => selectTab(t.id.slice(4)));
    t.addEventListener('keydown', (e) => {
      const i = tabs.indexOf(t); let j = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % tabs.length; else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i + tabs.length - 1) % tabs.length; else if (e.key === 'Home') j = 0; else if (e.key === 'End') j = tabs.length - 1;
      if (j >= 0) { e.preventDefault(); selectTab(tabs[j].id.slice(4), true); }
    });
  }
  const toolsBtn = $('tools-toggle');
  function setTools(open, byUser) {
    main.classList.toggle('tools-open', open);
    toolsBtn.setAttribute('aria-expanded', open ? 'true' : 'false'); toolsBtn.textContent = open ? 'Hide tools' : 'Show tools';
    if (!open && $('tools').contains(document.activeElement)) toolsBtn.focus();
    if (byUser) { view.tools = open; saveView(); }
    fitTape();
  }
  function setView(name, keep) {
    for (const b of document.querySelectorAll('.pg-views button')) b.setAttribute('aria-pressed', b.dataset.view === name ? 'true' : 'false');
    for (const p of document.querySelectorAll('.pane')) p.classList.toggle('active', p.dataset.pane === name);
    if (name === 'tools') setTools(true); else if (!keep && !COL.matches) setTools(false);
    if (FLOW.matches) {
      const pane = document.querySelector('.pane[data-pane="' + name + '"]');
      for (const f of folds) if (pane === f.frame || pane.contains(f.frame)) f.set(true);
      if (!navigator.userActivation || navigator.userActivation.hasBeenActive) pane.scrollIntoView({ block: 'start' });
    }
    fitTape();
  }
  const folds = [];
  for (const head of document.querySelectorAll('main.pg .frame > .frame-head')) {
    const frame = head.parentElement, body = frame.querySelector(':scope > .frame-body'), b = el('button', 'pg-fold');
    b.type = 'button'; b.append(...head.childNodes); head.append(b);
    if (!body.id) body.id = head.id + '-body';
    b.setAttribute('aria-controls', body.id);
    const f = { frame, b, set(open) { frame.classList.toggle('folded', !open); if (FLOW.matches) b.setAttribute('aria-expanded', open ? 'true' : 'false'); } };
    b.addEventListener('click', () => { if (!FLOW.matches) return; f.set(frame.classList.contains('folded')); fitTape(); });
    folds.push(f);
  }
  const syncFolds = () => { for (const f of folds) { f.b.tabIndex = FLOW.matches ? 0 : -1; if (FLOW.matches) f.b.setAttribute('aria-expanded', f.frame.classList.contains('folded') ? 'false' : 'true'); else f.b.removeAttribute('aria-expanded'); } };
  $('tools').classList.add('folded');      // the long one: examples, help, settings
  syncFolds(); FLOW.addEventListener('change', syncFolds);
  const toggler = (button, box, cls, after) => button.addEventListener('click', () => { const open = !box.classList.contains(cls); box.classList.toggle(cls, open); button.setAttribute('aria-expanded', open ? 'true' : 'false'); if (after) after(); });
  toggler($('b-more'), document.querySelector('.pg-run'), 'more-open');
  toggler($('where-toggle'), $('status'), 'where-open', () => { S.mapKey = ''; draw(false); });      // the map is drawn at the width it now has
  for (const b of document.querySelectorAll('.pg-views button')) b.addEventListener('click', () => setView(b.dataset.view));
  $('out-peek-go').addEventListener('click', () => { setView('io'); if (!oneScreen()) $('out').scrollIntoView({ block: 'center' }); $('out').focus({ preventScroll: true }); });
  toolsBtn.addEventListener('click', () => { const open = !main.classList.contains('tools-open'); setView(open ? 'tools' : 'code', true); setTools(open, true); });
  $('o-explain').addEventListener('change', () => { view.explain = $('o-explain').checked; app.classList.toggle('no-explain', !view.explain); saveView(); });
  $('o-prev').addEventListener('change', () => { view.prev = $('o-prev').checked; app.classList.toggle('no-prev', !view.prev); saveView(); });

  // ------------------------------------------------------------------ loading a program
  function loadState(st, history) {
    stopAll();
    const text = String(st.code || '');
    S.names = Object.assign({}, st.names); S.escapes = !!st.escapes;
    if (st.settings) S.settings = PG.cleanSettings(st.settings);
    $('input').value = st.input || '';
    editor.setBp(S.settings.bp);
    $('cell-form').hidden = true; tape.picked = -1; fitTape();
    if (text.length > EDIT_LIMIT) {
      S.big = text; editor.setReadOnly(true);
      editor.setValue(text.slice(0, 4000) + '\n\n(This program has ' + fmt(text.length) + ' characters. Only its beginning is shown and it cannot be edited here. Play, Play fast, Step and the analysis use the whole program.)', false);
    } else {
      S.big = null; editor.setReadOnly(false);
      editor.setValue(text, history);
      editor.setBreakpoints(st.breakpoints || []);
    }
    showSettings(); followBox(true);
    rebuild(true); saveDraft(); updateEditButtons();
  }
  function currentState() { return { code: code(), input: $('input').value, escapes: S.escapes, settings: S.settings, names: S.names, breakpoints: S.big === null ? editor.breakpoints() : [] }; }
  let draftTimer = 0;
  function saveDraft() {
    if (!S.loaded) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => { const st = currentState(); if (st.code.length <= 500000) store.set('bf-playground-draft', PG.packState(st)); }, 400);
  }

  // ------------------------------------------------------------------ examples
  function useExample(ex) {
    const set = ex.settings ? Object.assign({}, S.settings, ex.settings) : S.settings;
    const changed = ex.settings && Object.keys(ex.settings).some((k) => S.settings[k] !== ex.settings[k]);
    loadState({ code: ex.code, input: ex.input || '', names: ex.names || {}, settings: set, breakpoints: [] }, true);
    setView('code');
    say('Example loaded: ' + ex.title + '. ' + ex.about + (changed ? ' The settings were changed for it: ' + PG.describeSettings(S.settings) + '.' : ''));
    if (changed) { S.note = 'this example changed the settings'; draw(false); }
    $('b-step').focus({ preventScroll: true }); $('main').scrollIntoView({ block: 'start' });
  }
  function renderExamples(groups, box) {
    for (const g of groups) {
      const sec = el('section', 'pg-ex'); sec.append(el('h3', '', g.title), el('p', 'muted small', g.about));
      const ul = el('ul', 'tiles');
      for (const ex of g.items) {
        const li = el('li'), b = el('button'); b.type = 'button';
        b.append(el('b', '', ex.title), el('span', '', ex.about));
        b.addEventListener('click', () => useExample(ex));
        li.append(b); ul.append(li);
      }
      sec.append(ul); box.append(sec);
    }
  }
  // the starter programs under the title: three of the examples
  for (const b of document.querySelectorAll('[data-example]')) b.addEventListener('click', () => { const ex = PGExamples.find(b.dataset.example); if (ex) useExample(ex); });
  function loadCommonJS(text, req) { const module = { exports: {} }; new Function('module', 'exports', 'require', text)(module, module.exports, req); return module.exports; }
  function initExamples() {
    const box = $('examples');
    renderExamples(PGExamples.groups, box);
    const gen = el('div'); box.append(gen);
    // the project's own generators: the files themselves, as the lessons use them
    Promise.all(['../runtime/emit.js?v=r7', '../runtime/patterns.js?v=r7'].map((u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u + ': ' + r.status); return r.text(); })))
      .then(([e, p]) => { const emit = loadCommonJS(e, () => ({})); const pat = loadCommonJS(p, () => emit); renderExamples(PGExamples.generated(emit.Emitter, pat.Patterns), gen); })
      .catch(() => { gen.append(el('p', 'muted small', 'The examples made by emit.js and patterns.js could not be loaded: those two files were not found next to this folder.')); });
    const sec = el('section', 'pg-ex'); sec.append(el('h3', '', 'Famous programs, elsewhere'), el('p', 'muted small', 'Not included here: they belong to their authors. Copy one from its source, paste it in the editor and run it. These links leave this site.'));
    const ul = el('ul', 'linklist');
    for (const f of PGExamples.famous) { const li = el('li', 'famous'), a = el('a'); a.href = f.url; a.rel = 'noopener noreferrer external'; a.append(el('b', '', f.title + ' (' + f.by + ')'), el('span', '', f.about)); li.append(a); ul.append(li); }
    sec.append(ul); box.append(sec);
  }

  // ------------------------------------------------------------------ analysis
  let anTimer = 0;
  function scheduleAnalysis() { clearTimeout(anTimer); anTimer = setTimeout(analysis, code().length > 20000 ? 400 : 60); }
  let lastAn = null;
  function summary() {
    const a = lastAn; if (!a) return;
    const box = $('summary'); box.textContent = '';
    const bl = S.big === null ? editor.breakpoints().length : 0;
    box.append(fmt(a.commands) + (a.commands === 1 ? ' command' : ' commands') + ' · ' + fmt(a.comment) + ' comment characters · deepest loop: ' + a.depth + ' · ' + (a.warnings.length ? a.warnings.length + (a.warnings.length === 1 ? ' warning' : ' warnings') : 'no warnings') + (bl ? ' · ' + bl + (bl === 1 ? ' breakpoint' : ' breakpoints') : '') + '. ');
    const b = el('button', 'link', 'Show the analysis'); b.type = 'button'; b.addEventListener('click', () => { setView('tools'); selectTab('analysis', true); }); box.append(b);
  }
  function analysis() {
    const a = lastAn = PG.analyse(S.prog, S.settings), box = $('analysis');
    summary(); box.textContent = '';
    const grid = el('dl', 'kv pg-counts');
    for (const c of ['>', '<', '+', '-', '.', ',', '[', ']']) { const dt = el('dt'); dt.append(el('code', '', c)); grid.append(dt, el('dd', '', fmt(a.counts[c]))); }
    box.append(el('h3', '', 'Counts'), grid, el('p', '', fmt(a.commands) + ' commands in all, ' + fmt(a.comment) + ' comment characters. The deepest loop is ' + a.depth + (a.depth === 1 ? ' level' : ' levels') + ' deep.' + (a.breakpoints ? ' ' + a.breakpoints + ' breakpoint characters.' : '')));
    const jumpTo = (it) => () => { if (S.big !== null) return; setView('code', ALL.matches); editor.focus(); editor.select(it.pos, it.end); };
    const list = (items, cls, f) => { const ul = el('ul', 'tiles pg-list ' + cls); for (const it of items) { const li = el('li'), b = el('button'); b.type = 'button'; f(b, it); b.addEventListener('click', jumpTo(it)); li.append(b); ul.append(li); } return ul; };
    box.append(el('h3', '', 'Warnings'));
    if (a.errors.length) box.append(list(a.errors.slice(0, 20).map((e) => ({ pos: e.pos, end: e.pos + 1, text: e.message })), 'warn', (b, it) => { const s = el('span'); s.append(el('span', 'badge', '!'), ' ' + it.text + '.'); b.append(s); }), el('p', 'muted small', 'The rest of the analysis needs balanced brackets.'));
    else if (!a.warnings.length) box.append(el('p', '', 'None. This does not prove that the program ends: only the obvious cases are looked for (an empty loop, a loop that cannot reach zero, a pointer that is certainly left of cell 0).'));
    else box.append(list(a.warnings, 'warn', (b, it) => { const at = el('b', 'at'); at.append(el('span', 'badge', '!'), ' Line ' + it.line + ', column ' + it.col); b.append(at, el('span', '', it.text)); }));
    if (!a.errors.length) {
      box.append(el('h3', '', 'What the optimiser recognises'));
      if (!a.idioms.length) box.append(el('p', '', 'No loop here is one of the shapes an optimising interpreter does in a single step.'));
      else {
        box.append(el('p', 'muted small', fmt(a.idiomCount) + (a.idiomCount === 1 ? ' loop' : ' loops') + ' recognised; ' + fmt(a.optimised) + ' of them fast mode does in one step' + (a.idiomCount > a.idioms.length ? ' (the first ' + a.idioms.length + ' are listed)' : '') + '. Press one to select it in the editor.'));
        box.append(list(a.idioms, '', (b, it) => { const s = el('span'); s.append(el('code', 'bf', it.code), ' ' + it.text + '.'); b.append(el('b', 'at', 'Line ' + it.line + ', column ' + it.col), s); }));
      }
    }
  }

  // ------------------------------------------------------------------ text to brainfuck
  let made = null;
  $('tx-make').addEventListener('click', () => {
    made = PG.textToBf($('tx-in').value, { loops: $('tx-loops').checked, comments: $('tx-notes').checked });
    $('tx-out').hidden = false; $('tx-out').textContent = made.code || '(the text is empty, so the program is empty)';
    const box = $('tx-explain'); box.textContent = ''; box.append(el('h3', '', 'How it works')); for (const s of made.explain) box.append(el('p', '', s));
    $('tx-use').disabled = false; say('Program made: ' + fmt(made.commands) + ' commands.');
  });
  $('tx-use').addEventListener('click', () => { if (!made) return; loadState({ code: made.code, input: '', names: { 0: 'letter', 1: 'counter' }, settings: S.settings, breakpoints: [] }, true); setView('code'); say('The program is in the editor. Undo brings the old one back.'); });

  // ------------------------------------------------------------------ link, saving, files
  async function makeLink(page) {
    const h = await PG.encodeShare(currentState());
    return new URL(page + '#' + h, location.href).href;
  }
  $('s-link').addEventListener('click', async () => {
    const url = await makeLink('./'), box = $('s-link-out'), msg = $('s-link-msg');
    box.hidden = false; box.value = url;
    const ok = await copyText(url, msg, 'Link copied (' + fmt(url.length) + ' characters).');
    if (ok && url.length > 8000) msg.textContent += ' It is long: some programs cut links of more than 2,000 characters. For a big program, download the .bf file instead.';
    if (!ok) { box.focus(); box.select(); }
  });
  $('s-embed').addEventListener('click', async () => {
    const url = await makeLink('embed.html'), box = $('s-link-out'), msg = $('s-link-msg');
    const html = '<iframe src="' + url + '" title="Runnable brainfuck program" loading="lazy" style="width:100%;height:30rem;border:0"></iframe>';
    box.hidden = false; box.value = html;
    const ok = await copyText(html, msg, 'Embed code copied.');
    if (!ok) { box.focus(); box.select(); }
  });
  const saved = () => store.get('bf-playground-saved', {});
  function renderSaved() {
    const all = saved(), ul = $('s-list'), names = Object.keys(all).sort((a, b) => a.localeCompare(b));
    ul.textContent = '';
    if (!names.length) { const li = el('li'); li.append(el('p', 'empty', 'Nothing saved yet.')); ul.append(li); return; }
    for (const name of names) {
      const li = el('li'), label = el('span'), it = all[name];
      label.append(el('b', '', name), el('small', 'muted', fmt((it.c || '').length) + ' characters' + (it.t ? ' · ' + new Date(it.t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '')));
      const load = el('button', 'quiet', 'Load'), del = el('button', 'quiet', 'Delete');
      load.type = del.type = 'button'; load.setAttribute('aria-label', 'Load ' + name); del.setAttribute('aria-label', 'Delete ' + name);
      load.addEventListener('click', () => { try { loadState(PG.unpackState(it), true); $('s-name').value = name; msgSave('Loaded "' + name + '".', true); setView('code'); } catch (e) { msgSave('This saved program cannot be read.', false); } });
      del.addEventListener('click', () => {
        if (del.dataset.sure) { const a = saved(); delete a[name]; store.set('bf-playground-saved', a); renderSaved(); msgSave('Deleted "' + name + '".', true); $('s-name').focus(); }
        else { del.dataset.sure = '1'; del.textContent = 'Really delete?'; setTimeout(() => { if (del.isConnected) { delete del.dataset.sure; del.textContent = 'Delete'; } }, 4000); }
      });
      li.append(label, load, del); ul.append(li);
    }
  }
  function msgSave(text, ok) { const m = $('s-msg'); m.textContent = text; m.className = 'verdict plain ' + (ok ? 'ok' : 'no'); }
  $('s-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('s-name').value.trim();
    if (!name) { msgSave('Give the program a name first.', false); $('s-name').focus(); return; }
    const all = saved(), had = name in all, st = PG.packState(currentState()); st.t = Date.now();
    all[name] = st;
    if (store.set('bf-playground-saved', all)) { msgSave((had ? 'Saved over "' : 'Saved as "') + name + '".', true); renderSaved(); }
    else msgSave('The browser refused to store it: the program is too large for browser storage, or storage is switched off. Download it as a .bf file instead.', false);
  });
  function download(name, text, type) {
    const a = el('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  $('s-export').addEventListener('click', () => { const all = saved(); download('brainfuck-programs.json', JSON.stringify({ format: 'bf-playground-programs', version: 1, programs: all }, null, 1), 'application/json'); msgSave(Object.keys(all).length + ' saved programs written to brainfuck-programs.json.', true); });
  $('s-import').addEventListener('click', () => $('s-import-file').click());
  $('s-import-file').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) openFile(f); });
  $('f-open').addEventListener('click', () => $('f-file').click());
  $('f-file').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) openFile(f); });
  $('f-save').addEventListener('click', () => { const name = ($('s-name').value.trim() || 'program').replace(/[^\w.-]+/g, '-') + '.bf'; download(name, code(), 'text/plain'); fileMsg('Downloaded as ' + name + '.', true); });
  function fileMsg(text, ok) { const m = $('f-msg'); m.textContent = text; m.className = 'verdict plain ' + (ok ? 'ok' : 'no'); say(text); }
  async function openFile(f) {
    setView('tools'); selectTab('save');
    if (f.size > FILE_LIMIT) { fileMsg('"' + f.name + '" is ' + fmt(Math.round(f.size / 1048576)) + ' MB. The limit is 64 MB, so it was not opened.', false); return; }
    let text;
    try { text = new TextDecoder('utf-8').decode(await f.arrayBuffer()); } catch (e) { fileMsg('"' + f.name + '" could not be read.', false); return; }
    if (/\.json$/i.test(f.name)) {
      try {
        const o = JSON.parse(text), progs = o && o.format === 'bf-playground-programs' ? o.programs : null;
        if (!progs) throw new Error('format');
        const all = saved(); let n = 0;
        for (const k of Object.keys(progs)) { PG.unpackState(progs[k]); all[k.slice(0, 60)] = progs[k]; n++; }
        if (!store.set('bf-playground-saved', all)) throw new Error('storage');
        renderSaved(); msgSave(n + ' programs imported from ' + f.name + '. A program with the same name was replaced.', true); say(n + ' programs imported.');
      } catch (e) { msgSave('"' + f.name + '" is not a file exported by this playground' + (e.message === 'storage' ? ', or the browser storage is full' : '') + '.', false); }
      return;
    }
    loadState({ code: text, input: $('input').value, names: {}, settings: S.settings, breakpoints: [] }, text.length <= EDIT_LIMIT);
    $('s-name').value = f.name.replace(/\.(bf|b|txt)$/i, '');
    fileMsg('Opened ' + f.name + ': ' + fmt(text.length) + ' characters, ' + fmt(S.prog.n) + ' commands.' + (text.length > EDIT_LIMIT ? ' It is too large to edit here, but it can be run, stepped and analysed. Use Play fast.' : text.length > PGParts.COLOUR_LIMIT ? ' It is shown without colours because it is large.' : ''), true);
    if (text.length <= EDIT_LIMIT) setView('code');
  }
  // drag and drop, anywhere on the page
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].indexOf('Files') >= 0;
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('drop').hidden = false; });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; $('drop').hidden = true; } });
  window.addEventListener('drop', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth = 0; $('drop').hidden = true; const f = e.dataTransfer.files[0]; if (f) openFile(f); });

  // ------------------------------------------------------------------ start
  async function init() {
    $('o-explain').checked = view.explain; $('o-prev').checked = view.prev; app.classList.toggle('no-explain', !view.explain); app.classList.toggle('no-prev', !view.prev);
    $('t-follow').checked = view.follow; $('t-chars').checked = view.chars; $('t-bits').checked = view.bits;
    for (const x of document.querySelectorAll('[data-out]')) x.setAttribute('aria-pressed', x.dataset.out === view.out ? 'true' : 'false');
    setSpeed(Math.min(SPEEDS.length - 1, Math.max(0, view.speed | 0)));
    const touch = window.matchMedia && (window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(max-width: 61.99em)').matches);
    showKeys(view.keys === null ? !!touch : view.keys);
    setTools(COL.matches && view.tools !== false);      // one screen: Tools is open at the start where it has a column of its own
    initExamples();
    let st = null, from = '';
    const q = new URLSearchParams(location.search);
    try {
      if (/^#[zu]=/.test(location.hash)) { st = await PG.decodeShare(location.hash); from = 'link'; }
      else if (q.has('code')) {
        const names = {}; for (const part of (q.get('names') || '').split(',')) { const m = /^(\d+):(.+)$/.exec(part); if (m) names[m[1]] = m[2].slice(0, 24); }
        const set = {}; for (const k of ['bits', 'size']) if (q.has(k)) set[k] = +q.get(k); for (const k of ['overflow', 'edge', 'eof', 'newline', 'bp', 'engine']) if (q.has(k)) set[k] = q.get(k); if (q.has('ask')) set.ask = q.get('ask') === '1';
        st = { code: q.get('code'), input: q.get('input') || '', settings: PG.cleanSettings(set), names, breakpoints: [] }; from = 'link';
      }
    } catch (e) { S.note = 'the link could not be read (' + e.message + ')'; }
    if (!st) { const d = store.get('bf-playground-draft', null); if (d) { try { st = PG.unpackState(d); from = 'draft'; } catch (e) { st = null; } } }
    if (!st) { const ex = PGExamples.find('hello'); st = { code: ex.code, input: '', settings: PG.cleanSettings({}), names: {}, breakpoints: [] }; }
    const note = S.note;
    loadState(st, false);
    S.loaded = true;
    if (from === 'link') { try { history.replaceState(null, '', location.pathname); } catch (e) { } saveDraft(); }
    if (note) { S.note = note; draw(false); }
    window.addEventListener('resize', () => { S.mapKey = ''; drawMap(); fitTape(); dock(); });
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { S.mapKey = ''; draw(false); });
  }
  init();
})();
