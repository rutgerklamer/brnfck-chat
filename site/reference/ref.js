// The executor and the figure builder of the reference pages (reference/).
(function (root, factory) {
  var api = factory(root);
  root.RefRun = api.RefRun; root.Ref = api.Ref;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  var MAX = 3000000;

  // ---- the machine -----------------------------------------------------------------------
  function Machine(src, o) {
    o = o || {};
    this.code = String(src).replace(/[^+\-<>\[\].,]/g, '');
    this.bits = o.bits === 16 || o.bits === 32 ? o.bits : 8;
    this.eof = o.eof === '-1' || o.eof === 'same' ? o.eof : '0';
    this.input = o.input || [];
    this.size = o.size || 30000;
    this.init = o.init || null;
    this.fast = false;
    this.bad = null;                       // 'open' | 'close': brackets do not match
    var jump = this.jump = new Int32Array(this.code.length), stack = [];
    for (var i = 0; i < this.code.length; i++) {
      var c = this.code[i];
      if (c === '[') stack.push(i);
      else if (c === ']') { if (!stack.length) { this.bad = 'close'; break; } var j = stack.pop(); jump[i] = j; jump[j] = i; }
    }
    if (!this.bad && stack.length) this.bad = 'open';
    this.reset();
  }
  Machine.prototype.reset = function () {
    var A = this.bits === 8 ? Uint8Array : this.bits === 16 ? Uint16Array : Uint32Array;
    this.tape = new A(this.size);
    if (this.init) Object.keys(this.init).forEach(function (k) { this.tape[+k] = this.init[k]; }, this);
    this.p = 0; this.pc = 0; this.steps = 0; this.inPos = 0; this.out = []; this.error = null;
    return this;
  };
  Object.defineProperty(Machine.prototype, 'done', { get: function () { return !!this.bad || this.error !== null || this.pc >= this.code.length; } });
  Machine.prototype.span = function () { return this.done ? null : [this.pc, this.pc + 1]; };
  Machine.prototype.step = function () {
    if (this.done) return false;
    var t = this.tape, c = this.code[this.pc];
    if (c === '+') t[this.p]++;
    else if (c === '-') t[this.p]--;
    else if (c === '>') { if (this.p + 1 >= this.size) { this.error = 'right'; return false; } this.p++; }
    else if (c === '<') { if (this.p === 0) { this.error = 'left'; return false; } this.p--; }
    else if (c === '.') this.out.push(t[this.p] & 255);
    else if (c === ',') {
      if (this.inPos < this.input.length) t[this.p] = this.input[this.inPos++];
      else if (this.eof === '0') t[this.p] = 0;
      else if (this.eof === '-1') t[this.p] = -1;        // all ones: 255, 65,535 or 4,294,967,295
    }
    else if (c === '[') { if (t[this.p] === 0) this.pc = this.jump[this.pc]; }
    else if (c === ']') { if (t[this.p] !== 0) this.pc = this.jump[this.pc]; }
    this.pc++; this.steps++;
    return true;
  };
  Machine.prototype.run = function (max) { max = max || MAX; while (this.steps < max && this.step()); return this; };

  function bytes(text) {                    // text as bytes (UTF-8), \n = 10
    var s = String(text).replace(/\\n/g, '\n'), out = [];
    if (typeof TextEncoder === 'function') return Array.prototype.slice.call(new TextEncoder().encode(s));
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 255);
    return out;
  }
  function show(out) {                      // printed bytes as text; what cannot be shown as [n]
    var s = '', i, b, rest = [];
    for (i = 0; i < out.length; i++) {
      b = out[i];
      if (b === 10 || (b >= 32 && b < 127)) { s += flush(rest) + String.fromCharCode(b); }
      else if (b >= 128) rest.push(b);
      else s += flush(rest) + '[' + b + ']';
    }
    return s + flush(rest);
    function flush(r) {
      if (!r.length) return '';
      var t;
      try { t = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(r)); } catch (e) { t = r.map(function (x) { return '[' + x + ']'; }).join(''); }
      r.length = 0; return t;
    }
  }
  var RefRun = { Machine: Machine, bytes: bytes, show: show };

  // ---- the browser part --------------------------------------------------------------------
  var Ref = {};
  var doc = root.document, fmt = Article.fmt, el = Article.el;
  var uid = 0;

  Ref.seg = function (name, items, value, onchange) {
    var box = el('div', 'group'), lab = el('span', '', name), seg = el('span', 'seg'), cur = value;
    seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', name);
    var buttons = items.map(function (it) {
      var b = el('button', '', it[1]); b.type = 'button'; b.dataset.v = it[0];
      b.setAttribute('aria-pressed', String(it[0] === cur));
      b.addEventListener('click', function () { set(it[0]); onchange(cur); });
      seg.append(b); return b;
    });
    function set(v) { cur = v; buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === v)); }); }
    box.append(lab, seg);
    return { el: box, get: function () { return cur; }, set: set };
  };
  // a text field with a name above it
  Ref.field = function (name, value, onchange) {
    var box = el('label', 'field'), input = el('input'), id = 'rf' + (++uid);
    input.type = 'text'; input.value = value; input.id = id; input.spellcheck = false; input.autocomplete = 'off'; input.autocapitalize = 'off';
    box.append(el('span', '', name), input);
    input.addEventListener('input', function () { onchange(input.value); });
    return { el: box, get: function () { return input.value; }, input: input };
  };
  // put controls in a row of their own, under the play controls of the figure
  Ref.addControl = function (fig) {
    var row = el('div', 'ctl vals pick'), kids = Array.prototype.slice.call(arguments, 1);
    kids.forEach(function (k) { row.append(k.el || k); });
    var first = fig.querySelector(':scope > .ctl.vals'), play = fig.querySelector(':scope > .ctl:not(.vals)');
    if (first) fig.insertBefore(row, first); else if (play) play.after(row); else fig.append(row);
    return row;
  };

  function fastSay(m) {
    var op = m.ops[m.pc], p = m.p + op.mv, v = m.tape[p], what;
    var go = op.mv ? 'moves the pointer ' + Math.abs(op.mv) + (op.mv > 0 ? ' right' : ' left') + ', to cell ' + p + (op.t === 9 ? '.' : ', and ') : '';
    switch (op.t) {
      case 0: what = 'adds ' + (op.n < 0 ? '−' + (-op.n) : op.n) + ' to cell ' + p + ', which holds ' + v + '.'; break;
      case 1: what = 'prints cell ' + p + ', which holds ' + v + '.'; break;
      case 2: what = 'reads one letter into cell ' + p + '.'; break;
      case 3: what = 'asks whether cell ' + p + ' is zero. ' + (v === 0 ? 'It is, so the whole loop is skipped.' : 'It holds ' + v + ', so the loop begins.'); break;
      case 4: what = 'asks whether cell ' + p + ' is zero. ' + (v === 0 ? 'It is, so the loop is over.' : 'It holds ' + v + ', so back to the start of the loop.'); break;
      case 5: what = 'sets cell ' + p + ' to 0. The loop that counted it down is this one step.'; break;
      case 6: what = 'adds ' + op.mul.map(function (f) { return (f[1] === 1 ? '' : f[1] + ' times ') + 'cell ' + p + ' to cell ' + (p + f[0]); }).join(' and ') + ', and sets cell ' + p + ' to 0. The whole loop is this one step.'; break;
      default: what = '';
    }
    return 'Next step: ' + go + what;
  }
  function say(m) { return m.fast ? fastSay(m) : Article.nextSay(m); }

  Ref.runner = function (fig, o) {
    var prog = el('div', 'bf prog'), tape = el('div', 'tape joined'), tell = el('p', 'tell'), vals = el('div', 'ctl vals'), ctl = el('div', 'ctl');
    var printed = null, inBox = null, spec = null, m = null, sc = null, capped = false;
    prog.setAttribute('role', 'img'); tape.setAttribute('role', 'list'); tape.setAttribute('aria-label', 'The cells of this small tape'); tell.setAttribute('aria-live', 'polite');
    fig.classList.add('fig'); if (!fig.classList.contains('col')) fig.classList.add('col');
    fig.append(prog, tape);
    var inLine = null;
    if (o.input) { inLine = el('p', 'printed'); inBox = el('output'); inLine.append(el('span', 'label', 'Input'), inBox); fig.append(inLine); }
    if (o.printed) { var line = el('p', 'printed'); printed = el('output'); line.append(el('span', 'label', 'Printed'), printed); fig.append(line); }
    fig.append(tell);
    var sliders = (o.values || []).map(function (v) {
      var s = Article.slider(v.name, v.min, v.max, v.value, v.say || String);
      vals.append(s.label); s.input.addEventListener('input', load); return s;
    });
    fig.append(ctl);
    if (vals.children.length) fig.append(vals);

    function make() {
      if (spec.fast) return new LearnCore.Machine(spec.code, { bits: spec.bits || 8, size: spec.size, init: spec.init || null, input: spec.input || [], fast: true });
      return new RefRun.Machine(spec.code, { bits: spec.bits || 8, size: spec.size, init: spec.init || null, input: spec.input || [], eof: spec.eof });
    }
    function draw(k) {
      m = make();
      for (var i = 0; i < k; i++) m.step();
      var sp = m.span() || [m.code.length, m.code.length];
      prog.replaceChildren(doc.createTextNode(Article.minus(m.code.slice(0, sp[0]))), el('span', sp[0] < m.code.length ? 'now' : '', Article.minus(m.code.slice(sp[0], sp[1]))), doc.createTextNode(Article.minus(m.code.slice(sp[1]))));
      prog.setAttribute('aria-label', 'The program: ' + m.code + (m.done ? '. It has ended.' : '. The next command is number ' + (sp[0] + 1) + '.'));
      Article.drawTape(tape, m.tape, m.p, { cells: spec.cells, top: spec.top, mark: spec.mark ? function (c) { return spec.mark(m, c); } : null });
      if (printed) { var t = m.out.length ? show(m.out).replace(/ /g, '␣') : '—'; printed.textContent = t.length > 160 ? t.slice(0, 160) + '… (' + fmt(m.out.length) + ' characters so far)' : t; }
      if (inBox) {
        var inp = spec.input || [];
        inBox.replaceChildren.apply(inBox, inp.map(function (b, j) { return el('span', j === m.inPos ? 'now' : '', (b === 10 ? '↵' : Article.glyph(String.fromCharCode(b)))); }));
        inBox.setAttribute('aria-label', 'Input: ' + String.fromCharCode.apply(null, inp) + '. ' + m.inPos + ' read so far.');
      }
      if (inLine) inLine.hidden = !(spec.input && spec.input.length);
      var atEnd = sc && k >= sc.max;
      if (m.done) tell.textContent = spec.end ? spec.end(m) : m.error ? 'Stopped: the pointer went off the ' + m.error + ' end of the tape.' : 'Finished after ' + fmt(m.steps) + (m.steps === 1 ? ' step.' : ' steps.') + (m.out.length ? ' Printed: “' + show(m.out) + '”.' : '');
      else if (capped && atEnd) tell.textContent = spec.cap ? spec.cap(m) : 'Still running after ' + fmt(m.steps) + ' steps, and it does not stop by itself.';
      else tell.textContent = say(m);
    }
    function load() {
      spec = o.build(sliders.map(function (s) { return Number(s.input.value); }));
      var probe = make(), cap = spec.maxSteps || 3000;
      while (!probe.done && probe.steps < cap) probe.step();
      capped = !probe.done;
      var n = probe.steps;
      if (sc) { sc.stop(); sc.setMax(n); sc.max = n; } else { sc = Article.scrubber(ctl, { max: n, rate: o.rate, show: draw }); sc.max = n; }
      sc.show(spec.at === 'end' ? n : 0);
    }
    load();
    return { reload: load };
  };

  Ref.compare = function (fig, o) {
    var counts = el('dl', 'counts'), cells = {};
    [['plain', 'One command at a time'], ['merged', 'Runs and simple loops merged']].forEach(function (k) {
      var d = el('div'), dd = el('dd'); d.append(el('dt', '', k[1]), dd); counts.append(d); cells[k[0]] = { box: d, out: dd };
    });
    var mode = Ref.seg('Show the run', [['plain', 'One command at a time'], ['merged', 'Runs and simple loops merged']], 'plain', function () { r.reload(); });
    var r = Ref.runner(fig, {
      values: o.values, rate: o.rate, printed: o.printed, input: o.input,
      build: function (v) {
        var spec = o.build(v);
        spec.fast = mode.get() === 'merged';
        try {
          var c = LearnCore.count(spec.code, { bits: spec.bits || 8, size: spec.size, init: spec.init || null, input: spec.input || [], max: 3e6, plainMax: 3e6 });
          cells.plain.out.textContent = (c.plain.finished ? '' : 'more than ') + fmt(c.plain.steps) + ' steps';
          cells.merged.out.textContent = (c.fast.finished ? '' : 'more than ') + fmt(c.fast.steps) + ' steps';
        } catch (e) { cells.plain.out.textContent = cells.merged.out.textContent = '–'; }
        cells.plain.box.classList.toggle('on', !spec.fast); cells.merged.box.classList.toggle('on', spec.fast);
        return spec;
      }
    });
    fig.insertBefore(counts, fig.querySelector(':scope > .tell').nextSibling);
    Ref.addControl(fig, mode);
    return r;
  };

  return { RefRun: RefRun, Ref: Ref };
});
