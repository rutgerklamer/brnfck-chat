// What the pages of the code patterns do in the browser.
(function () {
  'use strict';
  const C = window.PatCore, D = window.PatData, V = window.PatView, A = window.Article;
  const base = document.currentScript.src;
  const fmt = V.fmt, el = A.el;
  const fmax = (f, bits) => (f.hi && f.hi[bits]) || f.max;
  const LONG = 1000;
  const CAP = 300000;                    // the figure lays out a run up to this many steps
  let uid = 0;

  // ---- the project's generators (only the advanced patterns need them) ----------------------
  let gen = null;
  function loadCommonJS(text, req) {
    const module = { exports: {} };
    new Function('module', 'exports', 'require', text)(module, module.exports, req);
    return module.exports;
  }
  function generators() {
    if (!gen) {
      gen = Promise.all(['../runtime/emit.js?v=r7', '../runtime/patterns.js?v=r7'].map((u) => fetch(new URL(u, base)).then((r) => { if (!r.ok) throw new Error(u + ': ' + r.status); return r.text(); })))
        .then(([e, p]) => { const emit = loadCommonJS(e, () => ({})); const pat = loadCommonJS(p, () => emit); return { Emitter: emit.Emitter, Patterns: pat.Patterns }; });
    }
    return gen;
  }

  // ---- the sentence for "what the next step does"
  function explainer(get) {      // get() -> { m, label(a), signed }
    const show = (v) => { const { m, signed } = get(); return fmt(signed ? m.signed(v) : v); };
    const wrap = (v) => { const size = 2 ** get().m.bits; return ((v % size) + size) % size; };
    const cellName = (a) => { const l = get().label(a); return l === 'cell ' + a ? l : 'the “' + l + '” cell'; };
    const chr = (v) => { const b = v & 255; return b >= 33 && b < 127 ? ' as the letter ' + String.fromCharCode(b) : b === 32 ? ' as a space' : b === 10 ? ' as a newline' : ' as character number ' + b; };
    const nextIn = () => {
      const m = get().m;
      if (m.inPos < m.input.length) return 'reads the next letter of the input (number ' + m.input[m.inPos] + ') into ';
      return m.eof === 'zero' ? 'finds no input left, so it puts 0 into ' : m.eof === 'minus' ? 'finds no input left, so it puts −1 into ' : 'finds no input left, so it leaves alone ';
    };
    const ask = (open, a, moved) => {
      const v = get().m.tape[a], q = 'asks "is ' + (moved ? 'it' : cellName(a)) + ' zero?" ';
      if (open) return q + (v === 0 ? 'Yes, so the part between the brackets is skipped.' : 'No, it holds ' + show(v) + ', so the part between the brackets starts.');
      return q + (v === 0 ? 'Yes, so the repeating is over.' : 'No, it holds ' + show(v) + ', so go round again.');
    };
    function next() {
      const m = get().m, p = m.p, t = m.tape;
      if (!m.fast) {
        const c = m.code[m.pc], v = t[p];
        switch (c) {
          case '+': return '+ adds 1 to ' + cellName(p) + ': ' + show(v) + ' becomes ' + show(wrap(v + 1)) + (wrap(v + 1) === 0 ? ' (the cell was full and goes round)' : '') + '.';
          case '-': return '− takes 1 from ' + cellName(p) + ': ' + show(v) + ' becomes ' + show(wrap(v - 1)) + (v === 0 ? ' (below zero it goes round to the top)' : '') + '.';
          case '>': return p + 1 >= m.size ? '> tries to move past the last cell.' : '> moves the pointer right, to ' + cellName(p + 1) + '.';
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
          if (v === 0) return go + 'finds ' + at + ' at 0, so this whole loop does nothing.';
          const parts = op.mul.slice(0, 3).map(([off, f]) => show(v) + (f === 1 ? '' : ' × ' + fmt(f)) + ' to ' + cellName(q + off));
          return go + 'does a whole loop in one step: empties ' + at + ', which holds ' + show(v) + ', and adds ' + parts.join(', ') + (op.mul.length > 3 ? ' and ' + (op.mul.length - 3) + ' more' : '') + '.';
        }
        default: return 'moves the pointer to ' + cellName(q) + '.';
      }
    }
    return { next, show, cellName };
  }

  // ---- the values
  function stepFor(f, hi) {
    const range = hi - f.min;
    for (const s of [1000, 500, 100, 50, 10, 5]) if (range / s >= 100 && f.min % s === 0 && f.def % s === 0) return s;
    return 1;
  }
  function nameOf(v, f) { return (v.vars || []).includes(f) && f.label.length <= 2 ? f.label + ' starts at' : f.label; }
  function Controls(v, state, host, onInput) {
    const sliders = [];
    let n = 0;
    for (const f of C.fields(v)) {
      const id = 'pv' + (++uid) + '-' + (++n);
      if (f.type === 'choice') {
        const lab = el('label', 'stacked'), sel = el('select');
        lab.htmlFor = sel.id = id; lab.append(el('span', '', f.label));
        for (const [val, text] of f.options) { const op = el('option', '', text); op.value = val; sel.append(op); }
        sel.value = state.vals[f.id]; lab.append(sel); host.append(lab);
        sel.addEventListener('change', () => { state.vals[f.id] = C.parseField(f, sel.value); onInput(false); });
      } else if (f.type === 'list' || f.type === 'text') {
        const lab = el('label', 'stacked wide'), inp = el('input', 'wide');
        inp.type = 'text'; inp.id = id; lab.htmlFor = id; lab.append(el('span', '', f.label));
        inp.value = f.type === 'list' ? state.vals[f.id].join(', ') : state.vals[f.id];
        inp.autocomplete = 'off'; inp.spellcheck = false; inp.setAttribute('autocapitalize', 'off');
        if (f.type === 'text') inp.maxLength = f.max;
        lab.append(inp);
        if (f.type === 'list') { const h = el('small', '', 'numbers ' + f.min + ' to ' + f.max + ', with commas; ' + (f.len[0] === f.len[1] ? f.len[0] : f.len[0] + ' to ' + f.len[1]) + ' of them'); h.id = id + 'h'; inp.setAttribute('aria-describedby', h.id); lab.append(h); }
        host.append(lab);
        let t = null;
        const read = (tidy) => {
          state.vals[f.id] = C.parseField(f, inp.value);
          if (tidy) inp.value = f.type === 'list' ? state.vals[f.id].join(', ') : state.vals[f.id];
          onInput(false);
        };
        inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => read(false), 200); });
        inp.addEventListener('change', () => { clearTimeout(t); read(true); });
      } else {
        const hi = fmax(f, state.bits);
        const s = A.slider(nameOf(v, f), f.min, hi, state.vals[f.id], fmt);
        s.input.step = stepFor(f, hi); s.input.value = state.vals[f.id]; s.show();
        host.append(s.label);
        s.input.addEventListener('input', () => { state.vals[f.id] = Number(s.input.value); onInput(true); });
        sliders.push({ f, s });
      }
    }
    return {
      setBits(bits) {
        for (const { f, s } of sliders) {
          const hi = fmax(f, bits);
          s.input.max = hi; s.input.step = stepFor(f, hi);
          state.vals[f.id] = Math.min(hi, state.vals[f.id]); s.input.value = state.vals[f.id]; s.show();
        }
      },
    };
  }

  // ---- one form of one pattern, running
  function Figure(box, reg) {
    const p = D.byId[box.dataset.p], v = p.variants.find((x) => x.id === box.dataset.v);
    const widths = C.widths(v), eofs = v.input ? (v.eofs || [v.eof || 'zero']) : [];
    const state = { vals: C.defaults(v), bits: widths[0], eof: eofs[0] || 'zero', fast: null };
    const listeners = [];
    let G = null, pic = null, m = null, n = 0, stride = 1, addrs = [], parent = null, sc = null, ex = null;

    box.textContent = '';
    box.classList.add('fig', 'col');
    const ui = {
      prog: el('div', 'bf prog'), tape: el('div', 'tape joined wrap'), tell: el('p', 'tell'), vals: el('div', 'ctl vals'), ctl: el('div', 'ctl'),
      verdict: el('p', 'verdict'), measured: el('p', 'measured'),
    };
    ui.prog.setAttribute('role', 'img'); ui.tape.setAttribute('role', 'list'); ui.tape.setAttribute('aria-label', 'The cells this pattern works on');
    ui.tell.setAttribute('aria-live', 'polite');
    box.append(ui.prog, ui.tape);
    if (v.input) { ui.inLine = el('p', 'printed'); ui.inV = el('output', 'in'); ui.inLine.append(el('span', 'label', 'Input'), ui.inV); box.append(ui.inLine); }
    ui.outLine = el('p', 'printed'); ui.outV = el('output'); ui.outLine.append(el('span', 'label', 'Printed'), ui.outV); ui.outLine.hidden = true; box.append(ui.outLine);
    box.append(ui.tell);

    const onInput = () => build(true);
    const controls = Controls(v, state, ui.vals, onInput);
    box.append(ui.ctl);
    if (ui.vals.children.length) box.append(ui.vals);

    // More controls: cell size, the end of the input, how steps are counted
    const more = el('details', 'q fold more'), moreA = el('div', 'a'), moreBox = el('div', 'ctl vals');
    function select(name, options, current, change) {
      const lab = el('label'), sel = el('select');
      lab.append(el('span', '', name), sel);
      for (const [val, text] of options) { const op = el('option', '', text); op.value = val; sel.append(op); }
      sel.value = current; sel.addEventListener('change', () => change(sel.value));
      moreBox.append(lab);
      return sel;
    }
    if (widths.length > 1) select('Cell size', widths.map((b) => [b, b + ' bits']), state.bits, (val) => { state.bits = Number(val); controls.setBits(state.bits); build(true); });
    if (eofs.length > 1) select('At the end of the input, the comma gives', eofs.map((e) => [e, e === 'zero' ? '0' : e === 'minus' ? '−1' : 'nothing (the cell stays as it is)']), state.eof, (val) => { state.eof = val; build(true); });
    ui.mode = select('Steps are counted', [['plain', 'one command at a time'], ['fast', 'flat loops as one step (optimising interpreter)']], 'plain', (val) => { state.fast = val === 'fast'; build(false); });
    moreA.append(moreBox); more.append(el('summary', '', 'More controls'), moreA);
    box.append(more, ui.verdict, ui.measured);

    const label = (a) => (pic.labels[a] === undefined ? 'cell ' + a : pic.labels[a]);
    const show = (x) => fmt(pic.signed ? m.signed(x) : x);

    // ---- the program, with the next command and the loop it is in ----
    function drawProg() {
      const code = m.code, sp = m.span() || [code.length, code.length], out = [];
      if (!code.length) { ui.prog.replaceChildren(el('span', '', '(an empty program)')); return; }
      let ls = -1, le = -1;
      if (sp[0] < code.length) {
        let a = parent[sp[0]];
        if (code[sp[0]] === '[' && sp[1] - sp[0] === 1) a = sp[0];
        if (a >= 0) { ls = a; le = m.jump[a] + 1; }
      }
      let a = 0, b = code.length;
      if (code.length > 1400) { a = Math.max(0, sp[0] - 320); b = Math.min(code.length, Math.max(sp[1], sp[0] + 160) + 320); }
      const cut = (x) => Math.min(b, Math.max(a, x));
      const text = (x, y) => document.createTextNode(A.minus(code.slice(x, y)));
      const nowEl = (x, y) => (y > x ? el('span', 'now', A.minus(code.slice(x, y))) : null);
      const nowEnd = Math.min(sp[1], b);
      if (a > 0) out.push(document.createTextNode('… '));
      if (ls >= 0 && cut(ls) < cut(le)) {
        out.push(text(a, cut(ls)));
        const lp = el('span', 'lp');
        lp.append(text(cut(ls), cut(sp[0])));
        const now = nowEl(cut(sp[0]), cut(nowEnd)); if (now) lp.append(now);
        lp.append(text(cut(nowEnd), cut(le)));
        out.push(lp, text(cut(le), b));
      } else {
        out.push(text(a, cut(sp[0])));
        const now = nowEl(cut(sp[0]), cut(nowEnd)); if (now) out.push(now);
        out.push(text(cut(nowEnd), b));
      }
      if (b < code.length) out.push(document.createTextNode(' …'));
      ui.prog.replaceChildren(...out);
      ui.prog.setAttribute('aria-label', 'The program: ' + code.slice(0, 200) + (m.done ? '. It has ended.' : '. The next command is number ' + (sp[0] + 1) + '.'));
      const now = ui.prog.querySelector('.now');
      if (now && ui.prog.scrollHeight > ui.prog.clientHeight) ui.prog.scrollTop = Math.max(0, now.offsetTop - ui.prog.offsetTop - 40);
    }

    function result() {
      const parts = [];
      for (let a = 0; a < m.size && parts.length < 5; a++) if (m.tape[a] !== 0) parts.push(ex.cellName(a) + ' holds ' + ex.show(m.tape[a]));
      const out = m.out.length ? 'It printed “' + V.shown(C.text(m.out)) + '”. ' : '';
      return out + (parts.length ? 'At the end ' + parts.join(', ') + '. ' : 'Every cell is zero. ') + 'The pointer is on ' + ex.cellName(m.p) + '.';
    }

    // ---- step T of the run (the slider moves `stride` steps at a time when the run is long) ----
    function draw(k) {
      const T = Math.min(n, k * stride), P = Math.max(0, T - stride);
      m.reset();
      while (m.steps < P && !m.done) m.step();
      const prev = addrs.map((a) => m.tape[a]);
      while (m.steps < T && !m.done) m.step();
      const here = addrs.indexOf(m.p), changed = new Set();
      addrs.forEach((a, i) => { if (T > 0 && prev[i] !== m.tape[a]) changed.add(i); });
      const vals = addrs.map((a) => show(m.tape[a]));
      const maxLen = vals.reduce((x, s) => Math.max(x, s.length), 1);
      const maxName = addrs.reduce((x, a) => Math.max(x, (pic.labels[a] || '').length), 0);
      ui.tape.style.setProperty('--cw', Math.max(addrs.length > 8 ? 3.5 : 4.6, maxLen * 0.68 + 1.6, maxName * 0.47 + 0.5) + 'rem');
      A.drawTape(ui.tape, vals, here, { top: (i) => (pic.labels[addrs[i]] === undefined ? '' : pic.labels[addrs[i]]), mark: (i) => changed.has(i) });
      [...ui.tape.children].forEach((c, i) => {
        c.querySelector('i').textContent = addrs[i];
        const name = pic.labels[addrs[i]];
        c.setAttribute('aria-label', 'Cell ' + addrs[i] + (name ? ' (' + name + ')' : '') + ': ' + vals[i] + (i === here ? ', pointer here' : '') + (changed.has(i) ? ', changed by the last step' : ''));
        if (name) c.title = name;
      });
      // a tape that scrolls sideways keeps the pointer in the middle
      const hc = ui.tape.children[here];
      if (hc && ui.tape.scrollWidth > ui.tape.clientWidth) ui.tape.scrollLeft += hc.getBoundingClientRect().left - ui.tape.getBoundingClientRect().left - (ui.tape.clientWidth - hc.offsetWidth) / 2;
      drawProg();
      if (v.input) {
        const input = m.input;
        ui.inV.replaceChildren(...(input.length ? input.map((b, j) => el('span', j === m.inPos ? 'now' : '', A.glyph(V.shown(String.fromCharCode(b))))) : [document.createTextNode('—')]));
      }
      ui.outLine.hidden = !(m.out.length || (pic.r.want && pic.r.want.out !== undefined) || /\./.test(m.code));
      ui.outV.textContent = m.out.length ? V.shown(C.text(m.out)).replace(/ /g, '␣') : '—';
      const lead = stride > 1 ? (T === 0 ? 'At the start. ' : 'After ' + fmt(T) + ' of ' + fmt(n) + ' steps. ') : '';
      let say;
      if (m.error) say = 'Stopped: the pointer went off the ' + m.error + ' end of the tape.';
      else if (m.done) say = 'Finished' + (stride > 1 || T ? ' after ' + fmt(m.steps) + (m.steps === 1 ? ' step' : ' steps') : '') + '. ' + result();
      else if (T >= CAP) say = 'Stopped after ' + fmt(CAP) + ' steps. The figure does not go further.';
      else say = lead + 'Next: ' + ex.next() + (changed.size && T > 0 ? ' Changed by the last step: ' + [...changed].map((i) => '“' + label(addrs[i]) + '”').join(', ') + '.' : '');
      ui.tell.textContent = say;
    }

    // ---- make the run for the current values ----
    function notDefined() {
      return 'This form is not defined for these values' + (v.okText ? ': ' + v.okText : '') + '. Move a slider back; the figure still shows the last values that work.';
    }
    function build(atEnd) {
      if (v.gen && !G) return;
      if (!C.allowed(v, state.vals, state.bits)) { A.verdict(ui.verdict, null, notDefined()); return; }
      let next;
      try { next = C.picture(v, state.vals, state.bits, G, { eof: state.eof, plainMax: 2e5, fastMax: 3e6 }); }
      catch (e) { A.verdict(ui.verdict, false, 'Could not make the program: ' + e.message); return; }
      pic = next;
      const r = pic.r;
      if (state.fast === null) { state.fast = !(r.plain !== null && r.plain <= LONG); ui.mode.value = state.fast ? 'fast' : 'plain'; }
      m = new C.Machine(r.code, { bits: state.bits, size: r.size, init: r.init, input: r.input, start: r.start, eof: r.eof, fast: state.fast });
      ex = explainer(() => ({ m, label, signed: pic.signed }));
      const seen = new Set([r.start, r.p]);
      while (!m.done && m.steps < CAP) { m.step(); seen.add(m.p); }
      n = m.steps;
      const items = pic.items.filter((a) => a >= 0);
      items.forEach((a) => seen.add(a));
      const lo = Math.min(...seen), hi = Math.max(...seen);
      addrs = hi - lo < 36 ? Array.from({ length: hi - lo + 1 }, (_, i) => lo + i) : items;
      const code = m.code;
      parent = new Int32Array(code.length + 1).fill(-1);
      const stack = [];
      for (let i = 0; i < code.length; i++) { if (code[i] === ']') stack.pop(); parent[i] = stack.length ? stack[stack.length - 1] : -1; if (code[i] === '[') stack.push(i); }
      stride = n > LONG ? Math.ceil(n / LONG) : 1;
      const positions = Math.ceil(n / stride);
      if (sc) { sc.stop(); sc.setMax(positions); } else sc = A.scrubber(ui.ctl, { max: positions, name: 'Step', rate: 5, show: draw });
      sc.show(atEnd ? positions : 0);
      // the check and the small print
      const unfinished = r.problems.some((t) => /^did not finish/.test(t));
      if (unfinished) A.verdict(ui.verdict, null, 'This run is longer than this page follows (3,000,000 steps), so it is not checked here.');
      else A.verdict(ui.verdict, r.ok, r.ok ? 'For these values the finished tape, the pointer and the output are what plain JavaScript gives.' : 'Not as expected: ' + r.problems.join('; ') + '.');
      ui.measured.textContent = state.bits + '-bit cells: each holds 0 to ' + fmt(2 ** state.bits - 1) + ' and goes round past the ends. ' + (pic.signed ? 'The pattern works with signed numbers, so a cell above half its range is shown as negative. ' : '')
        + (state.fast ? 'A flat loop counts as one step here. ' : '')
        + (stride > 1 ? 'The run has ' + fmt(n) + ' steps, so the step slider moves ' + fmt(stride) + ' at a time. ' : '')
        + 'This is a small example on ' + addrs.length + (addrs.length === 1 ? ' cell' : ' cells') + '; the real tape has millions.';
      listeners.forEach((f) => f(pic));
    }

    reg[box.id] = { listen(f) { listeners.push(f); if (pic) f(pic); }, v, p };
    if (v.gen) {
      ui.tell.textContent = 'Loading the program generators…';
      generators().then((g) => { G = g; build(false); }, (err) => A.verdict(ui.verdict, false, 'This form is written by the generators emit.js and patterns.js, and they could not be loaded (' + err.message + ').'));
    } else build(false);
  }

  // ---- the program to copy
  function CodeBlock(box, reg) {
    const fig = reg[box.dataset.fig];
    const pre = box.querySelector('[data-code]'), len = box.querySelector('[data-len]'), play = box.querySelector('[data-play]'), said = box.querySelector('[data-said]'), copy = box.querySelector('[data-copy]');
    if (fig) fig.listen((pic) => {
      const r = pic.r;
      pre.textContent = r.code;
      len.textContent = fmt(r.code.length) + (r.code.length === 1 ? ' character' : ' characters');
      const names = Object.keys(pic.labels).slice(0, 12).map((a) => a + ':' + String(pic.labels[a]).replace(/[^A-Za-z0-9 ]/g, '').trim().replace(/ +/g, '-')).filter((s) => !/:$/.test(s)).join(',');
      play.href = new URL('../playground/?code=' + encodeURIComponent(r.code) + (names ? '&names=' + names : ''), base).href;
    });
    copy.addEventListener('click', () => {
      const text = pre.textContent;
      const done = (ok) => { copy.textContent = ok ? 'Copied' : 'Select the text and copy it'; said.textContent = ok ? 'The program was copied.' : 'Copying is not allowed here. Select the text and copy it.'; setTimeout(() => { copy.textContent = 'Copy'; }, 2500); };
      const old = () => { try { const ta = el('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.append(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); copy.focus(); done(ok); } catch (e) { done(false); } };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => done(true), old); else old();
    });
  }

  // ---- the cost of one form, for the values you choose
  function CostFigure(box) {
    const p = D.byId[box.dataset.p], v = p.variants.find((x) => x.id === box.dataset.v);
    const state = { vals: C.defaults(v), bits: C.widths(v)[0] };
    let G = null;
    box.textContent = '';
    box.classList.add('fig', 'col');
    const vals = el('div', 'ctl vals'), bars = el('div'), tell = el('p', 'tell'), note = el('p', 'measured');
    tell.setAttribute('aria-live', 'polite');
    Controls(v, state, vals, () => go());
    box.append(bars, tell);
    if (vals.children.length) box.append(vals);
    box.append(note);
    function go() {
      if (v.gen && !G) return;
      if (!C.allowed(v, state.vals, state.bits)) { tell.textContent = 'This form is not defined for these values. Move a slider back.'; return; }
      let r;
      try { r = C.bench(v, state.vals, state.bits, G, { plainMax: 3e6, fastMax: 3e6 }); } catch (e) { tell.textContent = 'Could not make the program: ' + e.message; return; }
      bars.innerHTML = V.barsHTML([{ label: 'plain steps', value: r.plain, cut: 3e6, kind: 'plain' }, { label: 'optimised steps', value: r.fast, kind: 'fast' }]);
      tell.textContent = V.valuesText(v, state.vals) + ': ' + (r.plain === null ? 'more than 3,000,000 plain steps' : fmt(r.plain) + (r.plain === 1 ? ' plain step' : ' plain steps')) + ' and ' + fmt(r.fast) + (r.fast === 1 ? ' optimised step' : ' optimised steps') + '. ' + V.ratioText(r.plain, r.fast);
      note.textContent = 'Measured in your browser, on ' + state.bits + '-bit cells, for the form "' + v.name + '".';
    }
    if (v.gen) generators().then((g) => { G = g; go(); }, (err) => { tell.textContent = 'The generators could not be loaded (' + err.message + ').'; });
    else go();
  }

  // ---- the front page: the search box
  function finder() {
    const q = document.getElementById('q'), said = document.getElementById('q-said');
    if (!q) return;
    const items = [...document.querySelectorAll('.plist li')], groups = [...document.querySelectorAll('[data-group]')], first = said.textContent;
    const go = () => {
      const terms = q.value.toLowerCase().split(/\s+/).filter(Boolean);
      let n = 0;
      for (const li of items) { const ok = terms.every((t) => li.dataset.k.includes(t) || li.querySelector('code').textContent.includes(t)); li.hidden = !ok; if (ok) n++; }
      for (const g of groups) g.hidden = !g.querySelector('li:not([hidden])');
      said.textContent = !terms.length ? first : n === 0 ? 'No pattern matches. Try another word, such as "copy" or "divide".' : n + (n === 1 ? ' pattern matches.' : ' patterns match.');
    };
    q.addEventListener('input', go);
    if (q.value) go();
  }

  // ---- cost.html: the live figures
  function describe(code) {
    let ops;
    try { C.matchBrackets(code); ops = C.compileFast(code); } catch (e) { return { err: e.kind === 'open' ? 'There is a [ without its ].' : 'There is a ] without a [ before it.' }; }
    const mv = (k) => (k ? Math.abs(k) + (k > 0 ? ' right' : ' left') : '');
    let folded = 0, real = 0;
    const lines = ops.map((op) => {
      const go = op.mv ? 'go ' + mv(op.mv) + ', then ' : '';
      let t, cls = '';
      switch (op.t) {
        case 0: t = go + (op.n > 0 ? 'add ' + op.n : 'take off ' + -op.n); break;
        case 1: t = go + 'print'; break;
        case 2: t = go + 'read'; break;
        case 3: t = go + 'ask "zero?" and start a loop that really goes round'; real++; cls = 'real'; break;
        case 4: t = go + 'ask "zero?" and go back to the start of that loop'; cls = 'real'; break;
        case 5: t = go + 'a flat loop, folded: set this cell to zero'; folded++; cls = 'fold'; break;
        case 6: t = go + 'a flat loop, folded: ' + op.mul.map(([off, f]) => 'add ' + (f === 1 ? '' : f + ' × ') + 'this cell to the cell ' + mv(off)).join(', ') + ', and empty this cell'; folded++; cls = 'fold'; break;
        default: t = 'move ' + mv(op.mv);
      }
      return { text: t, src: code.slice(op.s, op.e), cls };
    });
    return { lines, folded, real, n: code.length };
  }
  function costFlat(box) {
    const inp = box.querySelector('input'), out = box.querySelector('#flat-out');
    const go = () => {
      const code = C.strip(inp.value.replace(/[−–]/g, '-')), d = describe(code);
      out.textContent = '';
      if (d.err) { out.append(el('p', 'verdict no', d.err)); return; }
      const sum = el('p', 'tell');
      sum.append(el('b', '', fmt(d.n)), d.n === 1 ? ' command becomes ' : ' commands become ', el('b', '', fmt(d.lines.length)), d.lines.length === 1 ? ' step. ' : ' steps. ',
        d.folded ? fmt(d.folded) + (d.folded === 1 ? ' loop is flat and is folded. ' : ' loops are flat and are folded. ') : '',
        d.real ? fmt(d.real) + (d.real === 1 ? ' loop still goes round: its steps are paid every round.' : ' loops still go round: their steps are paid every round.') : (d.lines.length ? 'Nothing here goes round.' : ''));
      out.append(sum);
      const ol = el('ol', 'timeline flat-ops');
      for (const l of d.lines.slice(0, 60)) { const li = el('li', l.cls), b = el('b'); b.append(el('code', 'bf', l.src || ' ')); li.append(b, el('span', '', l.text)); ol.append(li); }
      out.append(ol);
      if (d.lines.length > 60) out.append(el('p', 'measured', 'Only the first 60 steps are listed.'));
    };
    inp.addEventListener('input', go); go();
  }
  const variant = (id, vid) => D.byId[id].variants.find((x) => x.id === vid);
  function costTable(box) {
    const out = box.querySelector('#ct-out'), host = box.querySelector('#ct-ctl');
    const X = A.slider('x', 0, 255, 20, fmt), Y = A.slider('y', 1, 255, 12, fmt);
    host.append(X.label, Y.label);
    const rows = [
      ['clear', 'minus', 'Set x to zero', (x) => ({ x }), true],
      ['move', 'right', 'Move x', (x) => ({ x, y: 0 }), true],
      ['copy', 'right', 'Copy x', (x) => ({ x }), true],
      ['mul-const', 'keep', 'x times 3', (x) => ({ x, f: 3 }), true],
      ['mul-cells', 'inplace', 'x times y', (x, y) => ({ x, y }), false],
      ['compare-less', 'count', 'Is x less than y?', (x, y) => ({ x, y }), false],
      ['divmod', 'cell', 'x divided by y', (x, y) => ({ n: x, d: y }), false],
      ['print-number', 'byte', 'Print x in decimal', (x) => ({ x }), false],
    ];
    const go = () => {
      const x = Number(X.input.value), y = Number(Y.input.value);
      let h = '<div class="scroll" tabindex="0" role="region" aria-label="Steps for eight patterns"><table class="ct"><thead><tr><th>Pattern</th><th>Kind</th><th class="n">Plain steps</th><th class="n">Optimised steps</th></tr></thead><tbody>';
      for (const [id, vid, name, mk, flat] of rows) {
        const r = C.bench(variant(id, vid), mk(x, y), 8, null, { plainMax: 5e6 });
        const max = Math.max(1, r.plain || 0, r.fast);
        const bar = (val, kind) => '<div class="bars"><div><div class="bar ' + kind + '" style="width:' + Math.max(0.8, 100 * val / max).toFixed(2) + '%"></div></div></div>';
        h += '<tr><th scope="row"><a href="' + id + '.html">' + name + '</a></th><td>' + (flat ? 'flat' : 'not flat') + '</td><td class="n">' + fmt(r.plain) + bar(r.plain, 'ink') + '</td><td class="n">' + fmt(r.fast) + bar(r.fast, 'b2') + '</td></tr>';
      }
      out.innerHTML = h + '</tbody></table></div>';
    };
    X.input.addEventListener('input', go); Y.input.addEventListener('input', go); go();
  }
  function costBits(box) {
    const out = box.querySelector('#cb-out'), host = box.querySelector('#cb-ctl');
    const X = A.slider('X', 0, 16000, 11868, fmt);
    host.append(X.label);
    generators().then((G) => {
      const a = variant('shift-round-clamp', 'requant'), b = variant('shift-round-clamp', 'count');
      const go = () => {
        const x = Number(X.input.value);
        const ra = C.bench(a, { k: 7, X: x }, 32, G, { plainMax: 0 }), rb = C.bench(b, { k: 7, X: x }, 32, G, { plainMax: 0 });
        out.innerHTML = V.barsHTML([{ label: 'peeling bits', value: ra.fast, kind: 'fast' }, { label: 'counting', value: rb.fast, kind: 'plain' }]);
        const t = el('p', 'tell');
        t.append(fmt(x) + ' ÷ 128, rounded, is ', el('b', '', fmt(rb.tape[1])), '. Counting took ' + (ra.fast ? fmt(rb.fast / ra.fast) : '?') + ' times as many optimised steps as peeling.' + (ra.ok && rb.ok ? '' : ' (One of the two runs gave an unexpected result.)'));
        out.append(t);
      };
      X.input.addEventListener('input', go); go();
    }, (err) => { out.textContent = 'This figure needs the files emit.js and patterns.js, and they could not be loaded (' + err.message + ').'; });
  }

  function start() {
    const reg = {};
    document.querySelectorAll('figure[data-p][data-v]:not([data-cost-fig])').forEach((f) => { try { Figure(f, reg); } catch (e) { console.error(e); } });
    document.querySelectorAll('figure[data-cost-fig]').forEach((f) => { try { CostFigure(f); } catch (e) { console.error(e); } });
    document.querySelectorAll('.code[data-fig]').forEach((b) => { try { CodeBlock(b, reg); } catch (e) { console.error(e); } });
    finder();
    const f = document.querySelector('[data-cost="flat"]'); if (f) costFlat(f);
    const t = document.querySelector('[data-cost="table"]'); if (t) costTable(t);
    const b = document.querySelector('[data-cost="bits"]'); if (b) costBits(b);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
