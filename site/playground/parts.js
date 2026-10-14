// The two page parts that the playground and the embed share.
(function (root) {
  'use strict';
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = text; return e; };
  const fmt = (n) => n.toLocaleString('en-US');
  const COLOUR_LIMIT = 150000;      // characters; above this the editor shows plain text

  // ================================================================== Editor
  class Editor {
    constructor(host, o) {
      this.o = Object.assign({ label: 'Program', bp: '', onChange() {}, onCaret() {}, onBreakpoints() {} }, o);
      this.bp = this.o.bp; this.text = ''; this.lines = ['']; this.starts = null; this.bps = new Set(); this.marks = {}; this.plain = false;
      this.hist = [{ v: '', s: 0, e: 0 }]; this.hi = 0; this.typing = ''; this.typedAt = 0;
      host.classList.add('ed');
      this.host = host;
      this.scroll = el('div', 'ed-scroll'); this.stack = el('div', 'ed-stack');
      this.gutter = el('div', 'ed-gutter'); this.gutter.setAttribute('aria-hidden', 'true'); this.gutter.title = 'Click next to a line to set or clear a breakpoint';
      this.marksEl = el('div', 'ed-marks'); this.marksEl.setAttribute('aria-hidden', 'true');
      this.hl = el('div', 'ed-hl'); this.hl.setAttribute('aria-hidden', 'true');
      const ta = this.ta = el('textarea', 'ed-ta');
      ta.spellcheck = false; ta.setAttribute('autocapitalize', 'off'); ta.setAttribute('autocomplete', 'off'); ta.setAttribute('autocorrect', 'off'); ta.setAttribute('wrap', 'soft');
      ta.setAttribute('aria-label', this.o.label);
      if (this.o.describedby) ta.setAttribute('aria-describedby', this.o.describedby);
      this.stack.append(this.gutter, this.marksEl, this.hl, ta); this.scroll.append(this.stack); host.append(this.scroll);
      this.hl.append(this._line(''));

      ta.addEventListener('input', (e) => this._changed(e.inputType || 'other'));
      ta.addEventListener('beforeinput', (e) => {
        if (e.inputType === 'historyUndo') { e.preventDefault(); this.undo(); }
        else if (e.inputType === 'historyRedo') { e.preventDefault(); this.redo(); }
      });
      ta.addEventListener('keydown', (e) => {
        const mod = e.ctrlKey || e.metaKey;
        if (mod && !e.altKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); }
        else if (mod && !e.altKey && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); this.redo(); }
        else if (e.key.length > 1) this.typing = '';                // arrows and the like end a run of typing
      });
      ta.addEventListener('pointerdown', () => { this.typing = ''; });
      const caret = () => { if (document.activeElement === ta) { this.o.onCaret(ta.selectionStart); } };
      document.addEventListener('selectionchange', caret);
      ta.addEventListener('keyup', caret); ta.addEventListener('click', caret); ta.addEventListener('focus', caret);
      this.gutter.addEventListener('click', (e) => { const n = this._lineAtY(e.clientY); if (n >= 0) this.toggleBreakpoint(n); });
      if (typeof ResizeObserver !== 'undefined') { let w = 0; new ResizeObserver(() => { const nw = this.stack.clientWidth; if (nw !== w) { w = nw; this._place(); } }).observe(this.stack); }
    }
    get value() { return this.ta.value; }
    get caret() { return this.ta.selectionStart; }
    focus() { this.ta.focus({ preventScroll: true }); }
    setReadOnly(on) { this.ta.readOnly = !!on; this.host.classList.toggle('readonly', !!on); }
    setBp(ch) { if (ch === this.bp) return; this.bp = ch; this._render(true); }
    // put a new text in the box. history: false = start a fresh undo history (a loaded program)
    setValue(text, history) {
      text = String(text).replace(/\r\n?/g, '\n');
      this.ta.value = text; this.ta.setSelectionRange(0, 0);
      if (history === false) { this.hist = [{ v: text, s: 0, e: 0 }]; this.hi = 0; this.typing = ''; this._sync(); }
      else this._changed('program');
      this.scroll.scrollTop = 0;
    }
    // replace the selection (the command keys, paste from a tool)
    insert(text) {
      const ta = this.ta, a = ta.selectionStart, b = ta.selectionEnd;
      ta.setRangeText(text, a, b, 'end');
      this._changed('insertText');
      this._reveal(ta.selectionStart);
    }
    backspace() {
      const ta = this.ta, a = ta.selectionStart, b = ta.selectionEnd;
      if (a === b && a === 0) return;
      ta.setRangeText('', a === b ? a - 1 : a, b, 'end');
      this._changed('deleteContentBackward'); this._reveal(ta.selectionStart);
    }
    moveCaret(d) { const p = Math.max(0, Math.min(this.ta.value.length, (d < 0 ? this.ta.selectionStart : this.ta.selectionEnd) + d)); this.ta.setSelectionRange(p, p); this.typing = ''; this.o.onCaret(p); this._reveal(p); }
    select(a, b) { this.ta.setSelectionRange(a, b); this._reveal(a); this.o.onCaret(a); }
    canUndo() { return this.hi > 0; }
    canRedo() { return this.hi < this.hist.length - 1; }
    undo() { if (this.hi > 0) this._restore(--this.hi); }
    redo() { if (this.hi < this.hist.length - 1) this._restore(++this.hi); }
    _restore(k) {
      const st = this.hist[k]; this.typing = '';
      this.ta.value = st.v; this.ta.setSelectionRange(st.s, st.e);
      this._sync(); this.o.onChange(this.ta.value); this.o.onCaret(st.s); this._reveal(st.s);
    }
    _changed(type) {
      const ta = this.ta, now = Date.now(), st = { v: ta.value, s: ta.selectionStart, e: ta.selectionEnd };
      if (st.v === this.hist[this.hi].v) { this.hist[this.hi] = st; return; }
      const run = (type === 'insertText' || type === 'deleteContentBackward') && type === this.typing && now - this.typedAt < 1500 && this.hi === this.hist.length - 1 && !/\n$/.test(st.v.slice(0, st.s));
      if (run) this.hist[this.hi] = st;
      else {
        this.hist.length = this.hi + 1; this.hist.push(st); this.hi++;
        let total = 0; for (const h of this.hist) total += h.v.length;
        while (this.hist.length > 2 && (this.hist.length > 400 || total > 2e7)) { total -= this.hist[0].v.length; this.hist.shift(); this.hi--; }
      }
      this.typing = type; this.typedAt = now;
      this._sync(); this.o.onChange(st.v);
    }

    // ---- the coloured copy ----
    _cls(c) { return c === 43 ? 'p' : c === 45 ? 'n' : c === 60 || c === 62 ? 'm' : c === 91 || c === 93 ? 'l' : c === 44 ? 'r' : c === 46 ? 'o' : this.bp && c === this.bp.charCodeAt(0) ? 'b' : 'c'; }
    _line(text) { const d = el('div', 'ed-line'); this._fill(d, text); return d; }
    _fill(d, text) {
      d.textContent = '';
      for (let i = 0, n = text.length; i < n;) {
        const cls = this._cls(text.charCodeAt(i)); let j = i + 1;
        while (j < n && this._cls(text.charCodeAt(j)) === cls) j++;
        const s = document.createElement('span'); s.className = cls; s.textContent = text.slice(i, j); d.appendChild(s); i = j;
      }
    }
    _render(all) {
      const text = this.ta.value;
      this.plain = text.length > COLOUR_LIMIT;
      this.host.classList.toggle('plain', this.plain);
      if (this.plain) { this.hl.textContent = ''; this.lines = null; this.text = text; this.starts = null; this._place(); return; }
      const lines = text.split('\n'), old = all || !this.lines ? null : this.lines;
      if (!old) {
        const frag = document.createDocumentFragment();
        for (const ln of lines) frag.appendChild(this._line(ln));
        this.hl.textContent = ''; this.hl.appendChild(frag);
        if (this.lines === null) this.bps.clear();
      } else {
        let a = 0; const max = Math.min(old.length, lines.length);
        while (a < max && old[a] === lines[a]) a++;
        let b = 0; while (b < max - a && old[old.length - 1 - b] === lines[lines.length - 1 - b]) b++;
        const kids = this.hl.children, removed = old.length - a - b, added = lines.length - a - b;
        if (removed === 1 && added === 1) this._fill(kids[a], lines[a]);
        else {
          const before = kids[a + removed] || null;
          for (let i = 0; i < removed; i++) this.hl.removeChild(kids[a]);
          const frag = document.createDocumentFragment();
          for (let i = 0; i < added; i++) frag.appendChild(this._line(lines[a + i]));
          this.hl.insertBefore(frag, before);
        }
        // breakpoints move with their lines
        if (this.bps.size && removed !== added) {
          const next = new Set();
          for (const l of this.bps) { if (l < a) next.add(l); else if (l >= a + removed) next.add(l + added - removed); else if (l - a < added) next.add(l); }
          this.bps = next; this.o.onBreakpoints(this.breakpoints());
        }
      }
      this.lines = lines; this.text = text; this.starts = null;
      this._paintBps(); this._place();
    }
    _sync() { if (this.ta.value !== this.text || !this.lines) this._render(false); }
    _starts() {
      if (!this.starts) { const s = new Int32Array(this.lines.length + 1); let at = 0; for (let i = 0; i < this.lines.length; i++) { s[i] = at; at += this.lines[i].length + 1; } s[this.lines.length] = at; this.starts = s; }
      return this.starts;
    }
    lineOf(pos) {
      if (!this.lines) { let n = 0; const t = this.ta.value; for (let i = t.indexOf('\n'); i >= 0 && i < pos; i = t.indexOf('\n', i + 1)) n++; return n; }
      const s = this._starts(); let lo = 0, hi = this.lines.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (s[mid] <= pos) lo = mid; else hi = mid - 1; }
      return lo;
    }
    // the box around the character at pos, in the coordinates of the stack; null in plain mode
    _rect(pos) {
      if (!this.lines) return null;
      const ln = this.lineOf(pos), div = this.hl.children[ln]; if (!div) return null;
      let col = pos - this._starts()[ln];
      const base = this.stack.getBoundingClientRect();
      for (let n = div.firstChild; n; n = n.nextSibling) {
        const len = n.firstChild.length;
        if (col < len) {
          const r = document.createRange(); r.setStart(n.firstChild, col); r.setEnd(n.firstChild, col + 1);
          const b = r.getClientRects()[0] || r.getBoundingClientRect();
          return { left: b.left - base.left, top: b.top - base.top, width: Math.max(b.width, 6), height: b.height };
        }
        col -= len;
      }
      const b = div.getBoundingClientRect();        // the end of the line
      let left = 0; if (div.lastChild) { const r = document.createRange(); r.selectNodeContents(div.lastChild); const rs = r.getClientRects(); if (rs.length) left = rs[rs.length - 1].right - base.left; }
      return { left: left || b.left - base.left, top: b.bottom - base.top - 22, width: 6, height: 22, eol: true };
    }
    _lineAtY(y) {
      if (!this.lines) return -1;
      const kids = this.hl.children; let lo = 0, hi = kids.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (kids[mid].getBoundingClientRect().top <= y) lo = mid; else hi = mid - 1; }
      return lo;
    }
    _reveal(pos) {
      const r = this._rect(pos); if (!r) return;
      const sc = this.scroll, top = r.top;
      if (top < sc.scrollTop + 8) sc.scrollTop = Math.max(0, top - 40);
      else if (top + r.height > sc.scrollTop + sc.clientHeight - 8) sc.scrollTop = top + r.height - sc.clientHeight + 40;
    }
    // ---- marks: name -> list of text positions ----
    setMark(name, list, reveal) {
      const old = this.marks[name];
      if (old && old.length === list.length && old.every((x, i) => x === list[i])) { if (reveal && list.length) this._reveal(list[0]); return; }
      this.marks[name] = list.slice(0, 40); this._placeOne(name);
      if (reveal && list.length) this._reveal(list[0]);
    }
    _placeOne(name) {
      const list = this.marks[name] || [];
      let box = this.marksEl.querySelector('[data-m="' + name + '"]');
      if (!box) { box = el('div'); box.dataset.m = name; this.marksEl.append(box); }
      while (box.children.length > list.length) box.lastChild.remove();
      while (box.children.length < list.length) box.append(el('i', 'ed-mark ' + name));
      list.forEach((pos, i) => {
        const r = pos <= this.ta.value.length ? this._rect(pos) : null, m = box.children[i];
        if (!r) { m.style.display = 'none'; return; }
        m.style.display = ''; m.style.left = r.left + 'px'; m.style.top = r.top + 'px'; m.style.width = r.width + 'px'; m.style.height = r.height + 'px'; m.style.lineHeight = r.height + 'px';
        const ch = name === 'match' || r.eol ? '' : this.ta.value[pos]; if (m.textContent !== ch) m.textContent = ch;
      });
    }
    _place() { for (const name of Object.keys(this.marks)) this._placeOne(name); }
    // ---- breakpoints (line numbers from 0) ----
    breakpoints() { return [...this.bps].sort((a, b) => a - b); }
    setBreakpoints(lines) { this.bps = new Set(lines.filter((l) => !this.lines || l < this.lines.length)); this._paintBps(); }
    toggleBreakpoint(line) { if (this.bps.has(line)) this.bps.delete(line); else this.bps.add(line); this._paintBps(); this.o.onBreakpoints(this.breakpoints()); }
    _paintBps() {
      if (!this.lines) return;
      for (const d of this.hl.querySelectorAll('.ed-line.bp')) d.classList.remove('bp');
      for (const l of this.bps) { const d = this.hl.children[l]; if (d) d.classList.add('bp'); }
    }
  }

  // ================================================================== Tape
  const charOf = (v) => (v > 32 && v < 127 ? String.fromCharCode(v) : v === 32 ? 'space' : v === 10 ? '\\n' : v === 13 ? '\\r' : v === 9 ? '\\t' : '');
  class Tape {
    // o: { rows, overview, onPick(cell), names: () => ({cell: name}) }
    constructor(host, o) {
      this.o = Object.assign({ rows: 3, overview: true, onPick() {}, names: () => ({}) }, o);
      this.host = host; this.start = 0; this.count = 0; this.cells = []; this.follow = true; this.chars = true; this.bits = false; this.picked = -1;
      this.prev = new Map(); this.changed = new Set(); this.m = null;
      this.grid = el('div', 'tape joined tp-grid'); this.grid.setAttribute('role', 'group'); this.grid.setAttribute('aria-label', 'Tape cells. Arrow keys move from cell to cell, Page Up and Page Down show other cells, Enter names a cell or changes its value.');
      // one Tab stop for the whole tape; the arrow keys move inside it
      this.grid.addEventListener('keydown', (e) => {
        const k = this.cells.findIndex((x) => x.b === document.activeElement); if (k < 0) return;
        let j = k;
        if (e.key === 'ArrowRight') j = k + 1; else if (e.key === 'ArrowLeft') j = k - 1; else if (e.key === 'ArrowDown') j = k + this.cols; else if (e.key === 'ArrowUp') j = k - this.cols;
        else if (e.key === 'Home') j = 0; else if (e.key === 'End') j = this.count - 1;
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.cells[k].b.click(); return; }      // a cell is a div with role="button"
        else if (e.key === 'PageDown' || e.key === 'PageUp') { e.preventDefault(); this.follow = false; if (this.o.onFollow) this.o.onFollow(false); this.page(e.key === 'PageDown' ? 1 : -1); return; }
        else return;
        e.preventDefault();
        if (j < 0 || j >= this.count || this.cells[j].b.hidden) return;
        this.cells[j].b.focus();
      });
      host.append(this.grid);
      if (this.o.overview) {
        this.ov = el('canvas', 'tp-over'); this.ov.setAttribute('aria-hidden', 'true'); this.ov.height = 40;
        this.ovText = el('p', 'tp-range muted small');
        host.append(this.ov, this.ovText);
        const go = (e) => { if (!this.m) return; const r = this.ov.getBoundingClientRect(), x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); this.follow = false; this.show(Math.floor(x * this.span) - (this.count >> 1)); if (this.o.onFollow) this.o.onFollow(false); };
        this.ov.addEventListener('pointerdown', (e) => { this.ov.setPointerCapture(e.pointerId); go(e); });
        this.ov.addEventListener('pointermove', (e) => { if (e.buttons) go(e); });
      }
      if (typeof ResizeObserver !== 'undefined') { let w = 0; new ResizeObserver(() => { const nw = this.grid.clientWidth; if (nw !== w) { w = nw; this.layout(); } }).observe(this.grid); }
      if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.draw(this.m, false));
    }
    layout() {
      const w = this.grid.clientWidth; if (!w) return;
      const cs = getComputedStyle(this.grid), cw = parseFloat(cs.getPropertyValue('--cw')) * parseFloat(cs.fontSize) || 64, gap = parseFloat(cs.columnGap) || 6;
      const cols = Math.max(2, Math.floor((w + gap) / (cw + gap))), rows = typeof this.o.rows === 'function' ? this.o.rows(w) : this.o.rows, count = cols * rows;
      if (count === this.count) return;
      this.count = count; this.cols = cols; this.grid.textContent = ''; this.cells = [];
      this.grid.style.gridTemplateColumns = 'repeat(' + cols + ', minmax(0, 1fr))';
      for (let i = 0; i < count; i++) {
        const b = el('div', 'cell tc'); b.setAttribute('role', 'button'); b.tabIndex = i === 0 ? 0 : -1;
        const c = { b, idx: el('i', 'ti'), val: el('b', 'tv'), ch: el('span', 'tch'), bits: el('span', 'tb'), v: -1, i: -1, name: null, state: '' };
        b.append(c.val, c.idx, c.ch, c.bits);
        b.addEventListener('click', () => { if (c.i >= 0) this.o.onPick(c.i); });
        b.addEventListener('focus', () => { for (const x of this.cells) x.b.tabIndex = x === c ? 0 : -1; });
        this.cells.push(c); this.grid.append(b);
      }
      this.draw(this.m, false);
    }
    // move the window so that it starts at cell n
    show(n) { if (!this.m) return; this.start = Math.max(0, Math.min(Math.max(0, this.m.size - this.count), n)); this.draw(this.m, false); }
    page(d) { this.follow = false; this.show(this.start + d * Math.max(1, this.count - this.cols)); }
    draw(m, fresh, reset) {
      this.m = m; if (!m || !this.count) return;
      const t = m.tape, p = m.p, names = this.o.names(), size = m.size;
      if (this.follow) {
        if (p < this.start) this.start = Math.max(0, p - Math.floor(this.count * 2 / 3));
        else if (p >= this.start + this.count) this.start = Math.min(Math.max(0, size - this.count), p - Math.floor(this.count / 3));
      }
      if (this.start + this.count > size) this.start = Math.max(0, size - this.count);
      if (reset) { this.changed.clear(); this.prev.clear(); }
      if (fresh) {
        this.changed.clear();
        for (let k = 0; k < this.count; k++) { const i = this.start + k; if (i < size && this.prev.has(i) && this.prev.get(i) !== t[i]) this.changed.add(i); }
      }
      if (fresh || reset || this.prev.size === 0) { this.prev.clear(); for (let k = 0; k < this.count; k++) { const i = this.start + k; if (i < size) this.prev.set(i, t[i]); } }
      else for (let k = 0; k < this.count; k++) { const i = this.start + k; if (i < size && !this.prev.has(i)) this.prev.set(i, t[i]); }
      const bitsN = m.set.bits;
      this.grid.classList.toggle('with-chars', this.chars); this.grid.classList.toggle('with-bits', this.bits);
      for (let k = 0; k < this.count; k++) {
        const c = this.cells[k], i = this.start + k;
        if (i >= size) { if (c.i !== -1) { c.i = -1; c.b.hidden = true; } continue; }
        const v = t[i], name = names[i] || '', state = (i === p ? 'p' : '') + (this.changed.has(i) ? 'c' : '') + (i === this.picked ? 's' : '') + (this.bits ? 'b' : '') + (this.chars ? 'h' : '');
        if (c.i === i && c.v === v && c.name === name && c.state === state && !(fresh && this.changed.has(i))) continue;
        if (c.i === -1) c.b.hidden = false;
        if (c.i !== i || c.name !== name) { c.idx.textContent = name ? i + ' ' + name : String(i); c.b.classList.toggle('named', !!name); }
        if (c.v !== v || c.i !== i || c.state !== state) {
          c.val.textContent = fmt(v); c.b.classList.toggle('long', v > 99999);
          c.ch.textContent = this.chars ? charOf(v) : '';
          if (this.bits) { const s = v.toString(2).padStart(bitsN, '0'); c.bits.textContent = bitsN === 8 ? s : s.replace(/(.{8})(?=.)/g, '$1 '); } else c.bits.textContent = '';
        }
        c.b.classList.toggle('here', i === p); c.b.classList.toggle('hit', this.changed.has(i));
        c.b.setAttribute('aria-pressed', i === this.picked ? 'true' : 'false');
        const cn = charOf(v);
        c.b.setAttribute('aria-label', 'Cell ' + i + (name ? ', named ' + name : '') + ': ' + v + (cn && this.chars ? ', character ' + cn : '') + (i === p ? ', the pointer is here' : '') + (this.changed.has(i) ? ', changed in the last step' : ''));
        c.i = i; c.v = v; c.name = name; c.state = state;
      }
      if (this.ov) this._overview();
    }
    _overview() {
      const m = this.m, cv = this.ov, wCss = cv.clientWidth; if (!wCss) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1), W = Math.round(wCss * dpr), H = Math.round(40 * dpr);
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      const cs = getComputedStyle(this.host), col = (n) => cs.getPropertyValue(n).trim();
      const used = m.wrapped ? m.size : Math.max(m.hi + 1, this.start + this.count, 1);
      let span = m.wrapped ? m.size : 64; while (span < used) span *= 2; span = Math.min(span, m.size); this.span = span;
      const g = cv.getContext('2d'), t = m.tape, top = 10 * dpr, h = H - top - 4 * dpr;
      g.clearRect(0, 0, W, H);
      g.fillStyle = col('--sunk'); g.fillRect(0, top, W, h);
      g.fillStyle = col('--muted');
      const end = Math.min(span, m.wrapped ? m.size : m.hi + 1), bitsN = m.set.bits;
      if (span <= W) { const cwid = W / span; for (let i = 0; i < end; i++) { const v = t[i]; if (v) { const hh = Math.max(3 * dpr, h * Math.min(1, Math.log2(v + 1) / bitsN)); g.fillRect(i * cwid, top + h - hh, Math.max(1, cwid - (cwid > 3 ? 1 : 0)), hh); } } }
      else { const per = span / W; for (let x = 0; x < W; x++) { let mx = 0; const b = Math.min(end, Math.floor((x + 1) * per)); for (let i = Math.floor(x * per); i < b; i++) if (t[i] > mx) mx = t[i]; if (mx) { const hh = Math.max(3 * dpr, h * Math.min(1, Math.log2(mx + 1) / bitsN)); g.fillRect(x, top + h - hh, 1, hh); } } }
      // the frame: the cells shown above
      const x0 = this.start / span * W, x1 = Math.min(W, (this.start + this.count) / span * W);
      g.strokeStyle = col('--ink'); g.lineWidth = 2 * dpr; g.strokeRect(x0 + dpr, top - dpr, Math.max(4 * dpr, x1 - x0 - 2 * dpr), h + 2 * dpr);
      // the pointer: a triangle on top and a line
      const px = (m.p + 0.5) / span * W;
      g.fillStyle = col('--hot'); g.fillRect(px - 3 * dpr, top, 6 * dpr, h); g.strokeStyle = col('--accent');
      g.lineWidth = dpr; g.strokeRect(px - 3 * dpr, top, 6 * dpr, h);
      g.fillStyle = col('--accent'); g.beginPath(); g.moveTo(px - 7 * dpr, 0); g.lineTo(px + 7 * dpr, 0); g.lineTo(px, 10 * dpr); g.closePath(); g.fill();
      const last = Math.min(m.size, this.start + this.count) - 1;
      this.ovText.textContent = 'Overview of cells 0 to ' + fmt(span - 1) + ' of ' + fmt(m.size) + '. Bars: cells that are not zero. Triangle: the pointer (cell ' + fmt(m.p) + '). Frame: cells ' + fmt(this.start) + ' to ' + fmt(last) + ', shown above.' + (m.wrapped ? '' : ' Highest cell reached: ' + fmt(m.hi) + '.');
    }
  }

  root.PGParts = { Editor, Tape, el, fmt, charOf, COLOUR_LIMIT };
})(typeof self !== 'undefined' ? self : this);
