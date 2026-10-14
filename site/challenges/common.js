// Shared by the basics course and the challenges: what is remembered in the browser.
(function () {
  'use strict';
  const S = window.BFStudy = {};
  const el = S.el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  S.fmt = (n) => Math.round(n).toLocaleString('en-US');

  // ---- STORED ------------------------------------------------------------------------------
  const KEY = 'bfStudyProgress', TAB = 'bfLearnSteps=';
  let mode = 'local', memory = null;
  try { localStorage.setItem(KEY + 'Test', '1'); localStorage.removeItem(KEY + 'Test'); } catch (e) { mode = 'tab'; }
  const blank = () => ({ v: 1, basics: {}, ch: {}, drafts: {}, proj: {} });
  const tidy = (o) => {
    const s = blank();
    if (!o || typeof o !== 'object' || Array.isArray(o)) return s;
    for (const k of ['basics', 'ch', 'drafts', 'proj']) if (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) s[k] = o[k];
    return s;
  };
  const tabObject = () => { try { const w = String(window.name || ''); if (w.indexOf(TAB) === 0) { const o = JSON.parse(w.slice(TAB.length)); if (o && typeof o === 'object' && !Array.isArray(o)) return o; } } catch (e) { } return {}; };
  function read() {
    if (mode === 'local') { try { return tidy(JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { if (e instanceof SyntaxError) return blank(); mode = 'tab'; } }
    const t = tabObject().study;
    return tidy(t || memory);
  }
  function write(s) {
    memory = s;
    if (mode === 'local') { try { localStorage.setItem(KEY, JSON.stringify(s)); return; } catch (e) { mode = 'tab'; } }
    try { const o = tabObject(); o.study = s; window.name = TAB + JSON.stringify(o); } catch (e) { }
  }
  const change = (fn) => { const s = read(); fn(s); write(s); return s; };
  const ints = (a, max) => (Array.isArray(a) ? a.filter((i) => Number.isInteger(i) && i >= 0 && i <= max) : []);

  const store = S.store = {
    remembers: () => mode === 'local',
    all: read,
    // basics
    stepsDone: (n) => { const b = read().basics[n]; return b ? ints(b.steps, 99).filter((i) => i >= 1) : []; },
    markStep: (n, i) => change((s) => { const b = s.basics[n] = s.basics[n] || {}; const a = new Set(ints(b.steps, 99)); a.add(i); b.steps = [...a].sort((x, y) => x - y); }),
    quizDone: (n) => { const b = read().basics[n]; return !!(b && b.quiz); },
    markQuiz: (n) => change((s) => { (s.basics[n] = s.basics[n] || {}).quiz = true; }),
    // challenges
    ch: (id) => { const c = read().ch[id]; return c && typeof c === 'object' ? c : {}; },
    // record a passing run; returns what is new: { first, len, steps }
    solve: (id, len, steps) => {
      const news = { first: false, len: false, steps: false };
      change((s) => {
        const c = s.ch[id] = s.ch[id] && typeof s.ch[id] === 'object' ? s.ch[id] : {};
        if (!c.solved) { news.first = true; c.solved = true; }
        if (!(c.len <= len)) { news.len = true; c.len = len; }
        if (!(c.steps <= steps)) { news.steps = true; c.steps = steps; }
      });
      return news;
    },
    hints: (id, k) => change((s) => { const c = s.ch[id] = s.ch[id] && typeof s.ch[id] === 'object' ? s.ch[id] : {}; if (!(c.hints >= k)) c.hints = k; }),
    draft: (id) => { const v = read().drafts[id]; return typeof v === 'string' ? v : ''; },
    setDraft: (id, code) => change((s) => { if (code) s.drafts[id] = String(code).slice(0, 20000); else delete s.drafts[id]; }),
    proj: (id) => { const p = read().proj[id]; return p && typeof p === 'object' ? { done: ints(p.done, 50), code: typeof p.code === 'string' ? p.code : '' } : { done: [], code: '' }; },
    setProj: (id, done, code) => change((s) => { s.proj[id] = { done, code: String(code || '').slice(0, 20000) }; }),
    forget: () => write(blank()),
    // export: a text to save as a file
    exportText: () => JSON.stringify(Object.assign({ what: 'Progress in the brainfuck basics course and challenges. Import it on the challenges page.', saved: new Date().toISOString().slice(0, 10) }, read()), null, 1),
    // import: merge a file into what is here, keeping the better of the two everywhere
    importText: (text) => {
      let o;
      try { o = JSON.parse(text); } catch (e) { return { ok: false, text: 'That file is not a progress file: it could not be read.' }; }
      if (!o || typeof o !== 'object' || o.v !== 1 || !o.ch || !o.basics) return { ok: false, text: 'That file is not a progress file of this site.' };
      const inc = tidy(o);
      let added = 0;
      change((s) => {
        for (const n of Object.keys(inc.basics)) {
          if (!/^\d{1,2}$/.test(n)) continue;
          const b = s.basics[n] = s.basics[n] || {}, a = new Set(ints(b.steps, 99));
          for (const i of ints(inc.basics[n] && inc.basics[n].steps, 99)) if (!a.has(i)) { a.add(i); added++; }
          b.steps = [...a].sort((x, y) => x - y);
          if (inc.basics[n] && inc.basics[n].quiz) b.quiz = true;
        }
        for (const id of Object.keys(inc.ch)) {
          const x = inc.ch[id];
          if (!/^[a-z0-9-]{1,40}$/.test(id) || !x || typeof x !== 'object') continue;
          const c = s.ch[id] = s.ch[id] && typeof s.ch[id] === 'object' ? s.ch[id] : {};
          if (x.solved && !c.solved) { c.solved = true; added++; }
          if (Number.isInteger(x.len) && x.len > 0 && !(c.len <= x.len)) c.len = x.len;
          if (Number.isInteger(x.steps) && x.steps > 0 && !(c.steps <= x.steps)) c.steps = x.steps;
          if (Number.isInteger(x.hints) && !(c.hints >= x.hints)) c.hints = Math.min(3, x.hints);
        }
        for (const id of Object.keys(inc.drafts)) if (/^[a-z0-9-]{1,40}$/.test(id) && typeof inc.drafts[id] === 'string' && !s.drafts[id]) s.drafts[id] = inc.drafts[id].slice(0, 20000);
        for (const id of Object.keys(inc.proj)) {
          const x = inc.proj[id];
          if (!/^[a-z0-9-]{1,40}$/.test(id) || !x || typeof x !== 'object') continue;
          const mine = s.proj[id] && typeof s.proj[id] === 'object' ? s.proj[id] : { done: [], code: '' };
          s.proj[id] = { done: [...new Set(ints(mine.done, 50).concat(ints(x.done, 50)))].sort((a, b) => a - b), code: mine.code || (typeof x.code === 'string' ? x.code.slice(0, 20000) : '') };
        }
      });
      return { ok: true, text: 'Imported. ' + (added ? added + ' new ticks were added to what was here.' : 'Nothing in the file was new.') + ' Where both had a best, the better one was kept.' };
    },
  };

  // ---- a text with its invisible characters made visible
  S.show = (s) => String(s).replace(/[\x00-\x1f\x7f-\xff]/g, (c) => (c === '\n' ? '↵' : '\\x' + (c.charCodeAt(0) + 256).toString(16).slice(1)));
  // the same, into an element: invisible characters get their own look and a spoken name
  S.showInto = (box, s, emptyText) => {
    box.textContent = '';
    if (!s.length) { box.append(el('span', 'nothing muted', emptyText || '(nothing)')); return box; }
    let run = '';
    const inv = (mark, name) => { const sp = el('span', 'inv'), m = el('span', '', mark); m.setAttribute('aria-hidden', 'true'); sp.append(m, el('span', 'sr-only', ' ' + name + ' ')); return sp; };
    const flush = () => { if (run) { box.append(document.createTextNode(run)); run = ''; } };
    for (const c of String(s).slice(0, 600)) {
      const n = c.charCodeAt(0);
      if (n === 32) { flush(); box.append(inv('␣', 'space')); }
      else if (n === 10) { flush(); box.append(inv('↵', 'line break'), el('wbr')); }
      else if (n < 32 || n > 126) { flush(); box.append(inv('\\x' + (n + 256).toString(16).slice(1), 'character number ' + n)); }
      else run += c;
    }
    flush();
    if (s.length > 600) box.append(el('span', 'nothing muted', ' … (' + S.fmt(s.length) + ' characters in all)'));
    return box;
  };
  // typed text -> the bytes a program reads (UTF-8), as a string of bytes
  S.bytes = (text) => { try { return String.fromCharCode.apply(null, Array.from(new TextEncoder().encode(String(text).slice(0, 5000)))); } catch (e) { return String(text).replace(/[^\x00-\xff]/g, '?'); } };

  // ---- the row of command keys
  const KEYS = [['+', 'plus: add one', 'add'], ['-', 'minus: take one off', 'take'], ['<', 'move left', 'left'], ['>', 'move right', 'right'], ['[', 'open a loop', 'loop'], [']', 'close a loop', 'end'], [',', 'comma: read a character', 'read'], ['.', 'full stop: print a character', 'print']];
  S.keys = (ta) => {
    const row = el('div', 'keyrow'); row.setAttribute('role', 'toolbar'); row.setAttribute('aria-label', 'Type a command into your program');
    const fire = () => ta.dispatchEvent(new Event('input', { bubbles: true }));
    const put = (text) => { const a = ta.selectionStart == null ? ta.value.length : ta.selectionStart, b = ta.selectionEnd == null ? a : ta.selectionEnd; ta.setRangeText(text, a, b, 'end'); fire(); };
    const buttons = [], pad = el('div', 'keypad'), more = el('div', 'row');
    const add = (box, label, name, fn, cls) => { const b = el('button', 'key' + (cls ? ' ' + cls : ''), label); b.type = 'button'; b.setAttribute('aria-label', name); b.tabIndex = buttons.length ? -1 : 0; b.addEventListener('click', fn); buttons.push(b); box.append(b); return b; };
    for (const [c, name, word] of KEYS) { const b = add(pad, c === '-' ? '−' : c, name, () => put(c)); b.dataset.c = c; b.append(el('small', '', word)); }
    add(more, '⌫ delete', 'delete the character before the cursor', () => { const a = ta.selectionStart, b = ta.selectionEnd; if (a !== b) ta.setRangeText('', a, b, 'end'); else if (a > 0) ta.setRangeText('', a - 1, a, 'end'); fire(); }, 'quiet del');
    row.append(pad, more);
    row.addEventListener('keydown', (e) => {
      const i = buttons.indexOf(document.activeElement); if (i < 0) return;
      let j = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % buttons.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i + buttons.length - 1) % buttons.length;
      else if (e.key === 'Home') j = 0; else if (e.key === 'End') j = buttons.length - 1;
      if (j < 0) return;
      e.preventDefault(); buttons[i].tabIndex = -1; buttons[j].tabIndex = 0; buttons[j].focus();
    });
    ta.after(row);
    return row;
  };

  // ---- save a text as a file
  S.download = (name, text) => {
    const a = el('a'); a.download = name;
    let url = '';
    try { url = URL.createObjectURL(new Blob([text], { type: 'application/json' })); } catch (e) { url = 'data:application/json;charset=utf-8,' + encodeURIComponent(text); }
    a.href = url; a.hidden = true; document.body.append(a); a.click(); a.remove();
    if (url.indexOf('blob:') === 0) setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
})();
