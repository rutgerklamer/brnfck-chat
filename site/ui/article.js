// The page-independent parts of an article's figures, as window.Article.
(function () {
  'use strict';
  var fmt = function (n) { return Math.round(n).toLocaleString('en-US'); };
  var minus = function (s) { return String(s).replace(/-/g, '−'); };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function letter(v) { return v === 32 ? 'a space' : v >= 33 && v < 127 ? 'the letter ' + String.fromCharCode(v) : 'character number ' + v; }
  function glyph(ch) { return ch === ' ' ? '␣' : ch; }
  function reduced() { try { return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } }

  // ---- the row of cells -------------------------------------------------------------
  function drawTape(box, tape, p, o) {
    o = o || {};
    var n = o.cells || tape.length, kids = [];
    for (var i = 0; i < n; i++) {
      var cell = el('div', 'cell' + (i === p ? ' here' : '') + (o.mark && o.mark(i) ? ' hit' : '') + (o.pick ? ' pick' : ''));
      if (o.top) cell.append(el('span', 'top', o.top(i)));
      var num = el('i', '', String(i)); num.setAttribute('aria-hidden', 'true');
      cell.append(el('b', '', String(tape[i])), num);
      cell.setAttribute('role', 'listitem');
      cell.setAttribute('aria-label', 'Cell ' + i + ': ' + tape[i] + (i === p ? ', pointer here' : ''));
      if (o.pick) cell.addEventListener('click', o.pick.bind(null, i));
      kids.push(cell);
    }
    box.replaceChildren.apply(box, kids);
  }

  // ---- a slider with its value beside it ----------------------------------------------
  function bind(input, say) {
    var out = input.parentNode && input.parentNode.querySelector('output');
    say = say || String;
    function show() { var t = say(Number(input.value)); if (out) out.textContent = t; input.setAttribute('aria-valuetext', t); return t; }
    input.addEventListener('input', show);
    show();
    return show;
  }
  function slider(name, min, max, value, say) {
    var lab = el('label'), input = el('input'), out = el('output');
    input.type = 'range'; input.min = min; input.max = max; input.step = 1; input.value = value;
    lab.append(el('span', '', name), input, out);
    say = say || String;
    var s = { label: lab, input: input, out: out, show: function () { out.textContent = say(Number(input.value)); input.setAttribute('aria-valuetext', out.textContent); } };
    input.addEventListener('input', s.show);
    s.show();
    return s;
  }

  function scrubber(ctl, o) {
    var k = 0, max = o.max, timer = null;
    var play = el('button', 'primary', 'Play'), step = el('button', 'quiet', o.name || 'Step');
    play.type = step.type = 'button';
    step.setAttribute('aria-label', 'One ' + (o.name || 'step').toLowerCase() + ' forward');
    var pos = slider(o.name || 'Step', 0, max, 0, function (v) { return v + ' of ' + max; });
    var speed = slider('Speed', 1, 20, o.rate || 4, function (v) { return v + ' a second'; });
    pos.label.classList.add('scrub'); speed.label.classList.add('speed');
    ctl.append(play, step, pos.label, speed.label);
    function show(v) { k = Math.max(0, Math.min(max, v)); pos.input.value = k; pos.show(); step.disabled = k >= max; o.show(k); }
    function stop() { if (timer) clearInterval(timer); timer = null; play.textContent = 'Play'; }
    function start() {
      if (k >= max) show(0);
      if (reduced()) { show(max); return; }                        // no animation: the end of the run at once
      play.textContent = 'Pause';
      timer = setInterval(function () { show(k + 1); if (k >= max) stop(); }, 1000 / Number(speed.input.value));
    }
    play.addEventListener('click', function () { if (timer) stop(); else start(); });
    step.addEventListener('click', function () { stop(); show(k + 1); });
    pos.input.addEventListener('input', function () { stop(); show(Number(pos.input.value)); });
    speed.input.addEventListener('input', function () { if (timer) { stop(); start(); } });
    return { show: show, stop: stop, get k() { return k; }, setMax: function (m) { max = m; pos.input.max = m; } };
  }

  // ---- what the marked command is about to do -----------------------------------------
  function nextSay(m) {
    var c = m.code[m.pc], p = m.p, v = m.tape[p];
    switch (c) {
      case '+': return 'Next: + adds 1 to cell ' + p + ', which holds ' + v + '.';
      case '-': return 'Next: − takes 1 from cell ' + p + ', which holds ' + v + '.';
      case '>': return 'Next: > moves the pointer one cell to the right, to cell ' + (p + 1) + '.';
      case '<': return 'Next: < moves the pointer one cell to the left, to cell ' + (p - 1) + '.';
      case '.': return 'Next: . prints cell ' + p + ', which holds ' + v + ', as ' + letter(v) + '.';
      case ',': return 'Next: , reads one letter into cell ' + p + '.';
      case '[': return 'Next: [ asks whether cell ' + p + ' is zero. ' + (v === 0 ? 'It is, so everything up to the matching ] is skipped.' : 'It holds ' + v + ', so the commands between the brackets run.');
      default: return 'Next: ] asks whether cell ' + p + ' is zero. ' + (v === 0 ? 'It is, so the repeating is over.' : 'It holds ' + v + ', so back to the matching [.');
    }
  }

  // A runnable figure: o.build(slider values) gives the program, run once to count its steps, then replayed to step k.
  function runner(fig, o) {
    var prog = el('div', 'bf prog'), groups = el('div', 'groups'), tape = el('div', 'tape joined'), tell = el('p', 'tell'), vals = el('div', 'ctl vals'), ctl = el('div', 'ctl');
    var printed = null, inLine = null, inBox = null, spec = null, m = null, sc = null, more = null, moreBox = null;
    prog.setAttribute('role', 'img'); tape.setAttribute('role', 'list'); tape.setAttribute('aria-label', 'The cells of this small tape');
    tell.setAttribute('aria-live', 'polite'); groups.setAttribute('aria-hidden', 'true');
    fig.append(prog, groups, tape);
    if (o.input) { inLine = el('p', 'printed'); inBox = el('output'); inLine.append(el('span', 'label', 'Input'), inBox); fig.append(inLine); }
    if (o.printed) { var line = el('p', 'printed'); printed = el('output'); line.append(el('span', 'label', 'Printed'), printed); fig.append(line); }
    fig.append(tell);
    var sliders = (o.values || []).map(function (v) {
      var s = slider(v.name, v.min, v.max, v.value, v.say || String);
      if (v.more) {
        if (!more) { more = el('details', 'q fold more'); moreBox = el('div', 'ctl vals'); var a = el('div', 'a'); a.append(moreBox); more.append(el('summary', '', 'More controls'), a); }
        moreBox.append(s.label);
      } else vals.append(s.label);
      s.input.addEventListener('input', load);
      return s;
    });
    fig.append(ctl);
    if (vals.children.length) fig.append(vals);
    if (more) fig.append(more);

    function draw(k) {
      m.reset();
      for (var i = 0; i < k; i++) m.step();
      var sp = m.span() || [m.code.length, m.code.length];
      prog.replaceChildren(document.createTextNode(minus(m.code.slice(0, sp[0]))), el('span', sp[0] < m.code.length ? 'now' : '', minus(m.code.slice(sp[0], sp[1]))), document.createTextNode(minus(m.code.slice(sp[1]))));
      prog.setAttribute('aria-label', 'The program: ' + m.code + (m.done ? '. It has ended.' : '. The next command is number ' + (sp[0] + 1) + '.'));
      drawTape(tape, m.tape, m.p, { cells: spec.cells, top: spec.top, mark: spec.mark ? function (c) { return spec.mark(m, c); } : null });
      if (printed) printed.textContent = m.out.length ? String.fromCharCode.apply(null, m.out).replace(/ /g, '␣') : '—';
      if (inBox) {
        inBox.replaceChildren.apply(inBox, spec.input.map(function (b, j) { return el('span', j === m.inPos ? 'now' : '', glyph(String.fromCharCode(b))); }));
        inBox.setAttribute('aria-label', 'Input: ' + String.fromCharCode.apply(null, spec.input) + '. ' + m.inPos + ' read so far.');
      }
      tell.textContent = m.done ? (spec.end ? spec.end(m) : endSay(m)) : nextSay(m);
    }
    function load() {
      spec = o.build(sliders.map(function (s) { return Number(s.input.value); }));
      m = new LearnCore.Machine(spec.code, { bits: spec.bits || 8, size: spec.cells, init: spec.init || null, input: spec.input || [] });
      var cap = o.maxSteps || 5000;
      while (!m.done && m.steps < cap) m.step();
      var n = m.steps;
      groups.replaceChildren.apply(groups, (spec.groups || []).map(function (g) { return el('span', '', g); }));
      groups.hidden = !spec.groups;
      if (sc) { sc.stop(); sc.setMax(n); } else sc = scrubber(ctl, { max: n, rate: o.rate, show: draw });
      sc.show(spec.at === 'end' ? n : 0);
    }
    load();
    return { reload: load, get scrub() { return sc; }, machine: function () { return m; } };
  }
  function endSay(m) {
    if (m.error) return 'Stopped: the pointer went off the ' + m.error + ' end of the tape.';
    return 'Finished.' + (m.out.length ? ' Printed: “' + String.fromCharCode.apply(null, m.out) + '”.' : '');
  }

  // ---- one call: an element becomes a complete, runnable figure ------------------------------
  function machine(box, o) {
    var S = o.sliders || [];
    function bytes(x) { return typeof x === 'string' ? Array.from(x, function (c) { return c.charCodeAt(0); }) : (x ? Array.prototype.slice.call(x) : null); }
    function build(v) {
      if (o.build) return o.build(v);
      var code = typeof o.code === 'function' ? o.code(v) : o.code;
      S.forEach(function (s, i) { if (s.id) code = code.split('{' + s.id + '}').join(s.repeat ? s.repeat.repeat(v[i]) : String(v[i])); });
      var base = typeof o.init === 'function' ? o.init(v) : o.init, init = {};
      if (base) Object.keys(base).forEach(function (k) { init[k] = base[k]; });
      S.forEach(function (s, i) { if (s.cell !== undefined) init[s.cell] = v[i]; });
      var labels = o.labels;
      return {
        code: code, init: init, input: bytes(o.input), cells: o.cells || 8, bits: o.bits || 8,
        top: labels ? (typeof labels === 'function' ? labels : function (i) { return labels[i] || ''; }) : null,
        groups: o.groups, mark: o.mark, at: o.at,
        end: o.end ? function (m) { return o.end(m, v); } : null
      };
    }
    var probe = null;
    try { probe = build(S.map(function (s) { return s.value; })); } catch (e) { probe = null; }
    var printed = o.printed !== undefined ? o.printed : !!(probe && /\./.test(probe.code));
    box.classList.add('fig'); if (!box.classList.contains('col')) box.classList.add('col');
    return runner(box, { rate: o.rate, printed: printed, input: !!(probe && probe.input), maxSteps: o.maxSteps, values: S, build: build });
  }

  // ---- the check
  function verdict(box, ok, text) {
    box.classList.remove('ok', 'no');
    if (ok !== null && ok !== undefined) box.classList.add(ok ? 'ok' : 'no');
    if (!box.hasAttribute('role')) box.setAttribute('role', 'status');
    box.textContent = text || '';
  }

  window.Article = { el: el, fmt: fmt, minus: minus, letter: letter, glyph: glyph, drawTape: drawTape, slider: slider, bind: bind, scrubber: scrubber, runner: runner, machine: machine, verdict: verdict, nextSay: nextSay, openFromHash: openFromHash };

  // ---- an address with # that points into a fold opens it
  function openFromHash() {
    var t = null;
    try { t = location.hash.length > 1 && document.getElementById(decodeURIComponent(location.hash.slice(1))); } catch (e) { t = null; }
    var d = t && t.closest('details');
    if (d) { d.open = true; t.scrollIntoView(); }
  }
  window.addEventListener('hashchange', openFromHash);
  openFromHash();

  var wasClosed = [];
  window.addEventListener('beforeprint', function () { wasClosed = Array.prototype.slice.call(document.querySelectorAll('details:not([open])')); wasClosed.forEach(function (d) { d.open = true; }); });
  window.addEventListener('afterprint', function () { wasClosed.forEach(function (d) { d.open = false; }); wasClosed = []; });
})();
