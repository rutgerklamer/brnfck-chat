// "Trained in brainfuck", Shakespeare: the loss of brnfck-shakespeare-attn-55k, what each pass wrote, a child run here
// and where it looks. Data: data/shakespeare.json, data/shakespeare/pass-NN.bin (tools/site-shakespeare.js).
(function () {
  'use strict';
  const T = self.Train, m = T.spec.MODELS.shakespeare, L = T.layout.layout(m);
  const $ = (id) => document.getElementById(id);
  const num = (n) => Math.round(n).toLocaleString('en-US');
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue('--' + name).trim();
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const hm = (s) => (s < 3600 ? Math.round(s / 60) + ' min' : Math.floor(s / 3600) + ' h ' + pad(Math.round((s % 3600) / 60)) + ' min');
  const secs = (ms) => (ms / 1000).toFixed(1) + ' s';
  const SEED = T.spec.SAMPLE_SEED;

  function fit(cv, w, h) {
    const r = window.devicePixelRatio || 1;
    cv.width = Math.round(w * r); cv.height = Math.round(h * r);
    cv.style.height = h + 'px';
    const g = cv.getContext('2d');
    g.setTransform(r, 0, 0, r, 0, 0);
    return g;
  }

  let D = null, sel = 0;
  const shown = () => (D ? D.passes.length : 0);
  const sampleOf = (p) => (p ? D.passes[p - 1].sample : D.pass0.sample);

  // the weights of a pass's child, and the same as parameters for the forward pass
  const W = {}, P = {};
  const weightsOf = (p) => W[p] || (W[p] = fetch('data/shakespeare/pass-' + pad(p) + '.bin?v=r1')
    .then((r) => { if (!r.ok) throw new Error('the weights of pass ' + p + ' are not on this server'); return r.arrayBuffer(); })
    .then((b) => new Int16Array(b)));
  async function paramsOf(p) {
    if (P[p]) return P[p];
    const w = await weightsOf(p);
    let off = 0;
    const vals = L.regions.map((Rg) => { const v = w.subarray(off, off + Rg.regionSlots); off += Rg.regionSlots; return v; });
    return (P[p] = T.layout.setFromValues(L, T.reference.initParams(m), vals));
  }

  // a text as a play: the name of a speaker (capitals before a colon) stands out
  function script(text) {
    return text.split('\n').map((line) => {
      if (!line) return '<div class="ln gap"></div>';
      const i = line.indexOf(':'), head = i > 0 ? line.slice(0, i) : '';
      if (head && /^[A-Z$&' ]+$/.test(head) && /[A-Z]{2}/.test(head)) return '<div class="ln"><b class="who">' + esc(head) + ':</b>' + esc(line.slice(i + 1)) + '</div>';
      return '<div class="ln">' + esc(line) + '</div>';
    }).join('');
  }

  // ---- the numbers of the run ----------------------------------------------------------------

  function stats() {
    // a pass whose only difference was a printed step number has equal weights, velocities and child
    const n = shown(), last = D.passes[n - 1], eq = D.passes.filter((p) => p.equal || p.stepDigits).length, digits = D.passes.filter((p) => p.stepDigits);
    $('sh-st-passes').textContent = n + ' of ' + D.passesPlanned;
    $('sh-st-chars').textContent = num(n * D.charsPerPass);
    $('sh-st-time').textContent = n ? hm(D.passes.reduce((a, p) => a + p.seconds, 0)) : '–';
    $('sh-st-held').textContent = last ? last.held.toFixed(3) : '–';
    const same = $('sh-st-same');
    same.textContent = n ? eq + ' of ' + n : '–';
    same.className = n && eq === n ? 'ok' : n ? 'no' : '';
    if (digits.length) same.textContent += ' *';
    const passes = digits.map((p) => p.pass), list = passes.length === 1 ? 'pass ' + passes[0] : 'passes ' + passes[0] + ' to ' + passes[passes.length - 1];
    $('sh-st-note').hidden = !digits.length;
    $('sh-st-note').textContent = '* In ' + list + ' the weights, the velocities and the child are equal to the reference, but not every line it printed: from step 100,000 on, the program printed only the last five digits of the step number (step 100000 came out as step 0). Its lines are not compared after the first wrong one. The generator was fixed after pass 4: seven digits.';
    const fill = { name: D.name, hidden: num(D.hidden), params: num(D.parameters), program: num(D.programChars) };
    document.querySelectorAll('#shakespeare [data-sh]').forEach((e) => { e.textContent = fill[e.dataset.sh]; });
  }

  // ---- the loss over the run -----------------------------------------------------------------

  const lossCv = $('sh-loss');
  let geom = null;
  function drawLoss() {
    if (!D) return;
    const Wd = lossCv.parentElement.clientWidth, H = Math.min(380, Math.max(260, Math.round(Wd * 0.48)));
    const g = fit(lossCv, Wd, H), padL = 40, padR = 12, padT = 26, padB = 30, narrow = Wd < 560;
    const x0 = padL, x1 = Wd - padR, y0 = padT, y1 = H - padB, lo = 1.8, hi = 4.4;
    const n = shown(), per = D.stepsPerPass, maxStep = Math.max(1, n) * per;
    // steps on a square-root scale: the first minutes, when most is learned, get room
    const X = (s) => x0 + Math.sqrt(Math.max(0, s) / maxStep) * (x1 - x0), Y = (l) => y1 - ((l - lo) / (hi - lo)) * (y1 - y0);
    geom = { x0, x1, maxStep, per };
    g.fillStyle = css('panel'); g.fillRect(0, 0, Wd, H);
    g.font = '11px ' + css('mono'); g.lineWidth = 1;
    for (let l = 2; l <= 4; l += 0.5) { g.strokeStyle = css('line'); g.beginPath(); g.moveTo(x0, Y(l) + 0.5); g.lineTo(x1, Y(l) + 0.5); g.stroke(); g.fillStyle = css('muted'); g.fillText(l.toFixed(1), 6, Y(l) + 4); }
    // the passes: a number where the square-root scale leaves room, the last one always
    const lastX = X(n * per) - g.measureText('pass ' + n).width - 8;
    let room = -1e9;
    for (let p = 0; p <= n; p++) {
      const x = Math.round(X(p * per)) + 0.5;
      g.strokeStyle = css('line'); g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke();
      g.fillStyle = css('muted');
      if (p === n && n) { g.textAlign = 'right'; g.fillText('pass ' + p, x1, H - 10); }
      else if (p && x - room > 26 && x < lastX) { g.textAlign = 'center'; g.fillText(String(p), x, H - 10); room = x; }
      g.textAlign = 'left';
    }
    g.fillStyle = css('ink'); g.globalAlpha = 0.07; g.fillRect(X(Math.max(0, sel - 1) * per), y0, sel ? X(sel * per) - X((sel - 1) * per) : 3, y1 - y0); g.globalAlpha = 1;
    g.fillStyle = css('muted'); g.textAlign = 'center';
    for (const [s, label] of [[100, '100'], [1000, '1,000 steps']]) if (s < per && (s > 100 || X(1000) - X(100) > 70)) { g.fillRect(Math.round(X(s)), y1, 1, 5); g.fillText(label, X(s), H - 10); }
    g.textAlign = 'left';
    // what simpler guesses score
    g.setLineDash([5, 4]); g.strokeStyle = css('rule');
    const bases = narrow ? [[D.base.uniform, 'all alike'], [D.base.letters, 'letter counts'], [D.base.pairs, 'letter pairs']]
      : [[D.base.uniform, 'every character equally likely'], [D.base.letters, 'how often each character comes'], [D.base.pairs, 'the character before only']];
    for (const [v, label] of bases) {
      g.beginPath(); g.moveTo(x0, Y(v) + 0.5); g.lineTo(x1, Y(v) + 0.5); g.stroke();
      g.fillStyle = css('muted'); g.textAlign = 'right'; g.fillText(label + ' ' + v.toFixed(2), x1 - 4, Y(v) - 5); g.textAlign = 'left';
    }
    g.setLineDash([]);
    // the loss while training: the first steps from the reference, then the progress lines of the run
    g.strokeStyle = css('d2'); g.lineWidth = 2; g.beginPath();
    D.early.forEach(([s, l], i) => { const x = X(s - 10), y = Y(Math.min(hi, l / 1000)); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    for (const [s, k, l] of D.curve) if (s - k / 2 > D.early[D.early.length - 1][0] && s <= maxStep) g.lineTo(X(s - k / 2), Y(l / 1000));
    g.stroke();
    // the loss on unseen text after every pass
    g.font = '600 11px ' + css('mono');
    D.passes.forEach((d, i) => {
      const x = X(d.step), y = Y(d.held);
      g.fillStyle = css('ink'); g.beginPath(); g.arc(x, y, i + 1 === sel ? 5.5 : 3.5, 0, 2 * Math.PI); g.fill();
      if (i + 1 === sel || i === n - 1) { g.textAlign = x > x1 - 50 ? 'right' : 'center'; g.fillText(d.held.toFixed(3), x > x1 - 50 ? x - 8 : x, y - 10); g.textAlign = 'left'; }
    });
    g.fillStyle = css('muted'); g.font = '11px ' + css('mono'); g.fillText('nats per character', 6, 14);
  }

  // the loss on unseen text after every pass, on a scale that fits those numbers only
  const heldCv = $('sh-held');
  function drawHeld() {
    if (!D || !heldCv) return;
    const ps = D.passes, Wd = heldCv.parentElement.clientWidth, H = 170, g = fit(heldCv, Wd, H);
    const padL = 44, padR = 14, padT = 18, padB = 26, x0 = padL, x1 = Wd - padR, y0 = padT, y1 = H - padB;
    g.fillStyle = css('panel'); g.fillRect(0, 0, Wd, H);
    if (!ps.length) return;
    const vals = ps.map((d) => d.held), lo = Math.floor(Math.min(...vals) * 200) / 200 - 0.005, hi = Math.ceil(Math.max(...vals) * 200) / 200 + 0.005;
    const X = (p) => x0 + ((p - 0.5) / ps.length) * (x1 - x0), Y = (v) => y1 - ((v - lo) / (hi - lo)) * (y1 - y0);
    const best = ps.reduce((a, d) => (d.held < a.held ? d : a));
    g.font = '11px ' + css('mono'); g.lineWidth = 1;
    for (let v = Math.ceil(lo * 100) / 100; v <= hi + 1e-9; v += 0.01) { g.strokeStyle = css('line'); g.beginPath(); g.moveTo(x0, Math.round(Y(v)) + 0.5); g.lineTo(x1, Math.round(Y(v)) + 0.5); g.stroke(); g.fillStyle = css('muted'); g.fillText(v.toFixed(2), 4, Y(v) + 4); }
    g.textAlign = 'center';
    const step = Math.max(1, Math.ceil(ps.length / Math.max(1, Math.floor((x1 - x0) / 26))));
    ps.forEach((d) => { if (d.pass % step === 0 || d.pass === 1) { g.fillStyle = css('muted'); g.fillText(String(d.pass), X(d.pass), H - 8); } });
    g.strokeStyle = css('d2'); g.lineWidth = 2; g.beginPath();
    ps.forEach((d, i) => (i ? g.lineTo(X(d.pass), Y(d.held)) : g.moveTo(X(d.pass), Y(d.held)))); g.stroke();
    ps.forEach((d) => {
      g.fillStyle = d.pass === sel ? css('ink') : css('d2'); g.beginPath(); g.arc(X(d.pass), Y(d.held), d.pass === sel ? 5 : 3.5, 0, 2 * Math.PI); g.fill();
    });
    g.font = '600 11px ' + css('mono'); g.fillStyle = css('ink');
    // the first, the last, and the best (a ring; its number under it when the last is close by)
    const last = ps[ps.length - 1], near = best !== last && X(last.pass) - X(best.pass) < 70;
    g.strokeStyle = css('ink'); g.lineWidth = 1.5; g.beginPath(); g.arc(X(best.pass), Y(best.held), 8, 0, 2 * Math.PI); g.stroke();
    g.textAlign = 'left'; g.fillText(ps[0].held.toFixed(3), X(1) + 8, Y(ps[0].held) - 6);
    g.textAlign = 'right'; if (best !== last) g.fillText(last.held.toFixed(3), x1, Y(last.held) - 10);
    g.textAlign = 'center'; g.fillText((best === last ? last.held.toFixed(3) + ', ' : '') + 'best ' + (best === last ? '' : best.held.toFixed(3)), X(best.pass), near || best === last ? Y(best.held) + 22 : Y(best.held) - 13);
    g.textAlign = 'left'; g.font = '11px ' + css('mono'); g.fillStyle = css('muted'); g.fillText('loss on unseen text, after each pass', x0, 12);
  }

  if (heldCv) heldCv.addEventListener('click', (ev) => {
    if (!D || !D.passes.length) return;
    const r = heldCv.getBoundingClientRect(), f = (ev.clientX - r.left - 44) / (r.width - 58);
    setPass(Math.max(1, Math.min(D.passes.length, Math.floor(f * D.passes.length) + 1)));
  });

  function lossKey() {
    $('sh-loss-key').innerHTML = '<span><i class="sw" style="background:var(--d2)"></i>loss while training</span>' +
      '<span><i class="sw dot" style="background:var(--ink)"></i>loss on unseen text, after each pass</span>' +
      '<span><i class="sw dash"></i>simpler guesses, on the same text</span>';
  }

  const passAt = (ev) => {
    const r = lossCv.getBoundingClientRect(), f = Math.max(0, (ev.clientX - r.left - geom.x0) / (geom.x1 - geom.x0)), s = f * f * geom.maxStep;
    return Math.max(0, Math.min(shown(), Math.ceil(s / geom.per)));
  };
  lossCv.addEventListener('click', (ev) => { if (geom) setPass(passAt(ev)); });
  lossCv.addEventListener('mousemove', (ev) => {
    if (!geom) return;
    const p = passAt(ev), d = D.passes[p - 1];
    $('sh-loss-said').textContent = p ? 'Pass ' + p + ': steps ' + num((p - 1) * D.stepsPerPass + 1) + ' to ' + num(d.step) + ', loss ' + d.loss.toFixed(3) + ' while training and ' + d.held.toFixed(3) + ' on the unseen text, in ' + hm(d.seconds) + '. Click to read what its child wrote.' : 'The start.';
  });

  // ---- what each pass wrote --------------------------------------------------------------------

  const slider = $('sh-pass');
  function setPass(p) {
    sel = p;
    slider.value = p;
    const n = shown();
    $('sh-pass-out').textContent = p ? p + ' of ' + n : 'start';
    const d = D.passes[p - 1];
    $('sh-pass-said').textContent = p
      ? 'Pass ' + p + ', after ' + num(d.step) + ' steps, ' + num(p * D.charsPerPass) + ' characters read: loss ' + d.held.toFixed(3) + ' on the unseen text. Its child, ' + num(d.childChars) + ' characters of brainfuck, wrote:'
      : 'Pass 0, the random weights the training starts from. Its child, ' + num(D.pass0.childChars) + ' characters of brainfuck, wrote:';
    $('sh-text').innerHTML = script(sampleOf(p));
    $('sh-rs-pass').textContent = String(p);
    drawLoss();
    drawHeld();
    attention();
  }
  slider.addEventListener('input', () => setPass(+slider.value));

  let playing = 0;
  function play() {
    if (playing) { clearInterval(playing); playing = 0; $('sh-play').textContent = 'Play from the start'; return; }
    let p = 0;
    setPass(0);
    $('sh-play').textContent = 'Stop';
    playing = setInterval(() => {
      if (++p > shown()) { clearInterval(playing); playing = 0; $('sh-play').textContent = 'Play from the start'; return; }
      setPass(p);
    }, 1600);
  }
  $('sh-play').addEventListener('click', play);

  // ---- run a child here ------------------------------------------------------------------------

  let wk = null, lines = 40;
  const set = (id, text, cls) => { const e = $(id); e.textContent = text; e.className = cls || ''; };
  function done(said) {
    if (wk) wk.terminate();
    wk = null;
    if (window.LeaveGuard) LeaveGuard.set('child', false);
    $('sh-go').textContent = 'Run the child';
    if (said) $('sh-run-said').textContent = said;
  }
  async function runChild() {
    if (wk) { done('Stopped.'); return; }
    const p = sel, seed = Math.max(1, Math.min(999999, Math.round(+$('sh-seed').value) || SEED)), same = seed === SEED && lines === D.samples;
    $('sh-seed').value = seed;
    let w;
    try { w = await weightsOf(p); } catch (e) { $('sh-run-said').textContent = e.message; return; }
    set('sh-rs-pass', String(p)); set('sh-rs-chars', '…'); set('sh-rs-build', '…'); set('sh-rs-run', '–'); set('sh-rs-same', same ? '…' : 'other seed');
    $('sh-out').innerHTML = '';
    $('sh-run-said').textContent = 'Building the child of pass ' + p + ' from its weights…';
    $('sh-go').textContent = 'Stop';
    const me = wk = new Worker('worker.js?v=r6');
    if (window.LeaveGuard) LeaveGuard.set('child', true);
    let text = '', built = 0, pending = false;
    const show = () => { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; const o = $('sh-out'); o.innerHTML = script(text) + '<span class="cursor"></span>'; o.scrollTop = o.scrollHeight; }); };
    me.onmessage = (ev) => {
      if (me !== wk) return;
      const msg = ev.data;
      if (msg.type === 'child-built') { built = msg.ms; set('sh-rs-chars', num(msg.chars)); $('sh-run-said').textContent = 'Built: ' + num(msg.chars) + ' characters of brainfuck. Compiling it to WebAssembly…'; }
      else if (msg.type === 'child-compiled') { set('sh-rs-build', num(built + msg.ms) + ' ms'); $('sh-run-said').textContent = 'Running: the program writes, one character at a time.'; }
      else if (msg.type === 'child-text' || msg.type === 'child-done') {
        text += msg.text;
        set('sh-rs-run', num(text.length) + ' ch · ' + secs(msg.ms));
        show();
        if (msg.type === 'child-done') {
          requestAnimationFrame(() => { $('sh-out').innerHTML = script(text); });
          if (same) { const ok = text === sampleOf(p); set('sh-rs-same', ok ? 'yes' : 'no', ok ? 'ok' : 'no'); }
          done('The child of pass ' + p + ', run as brainfuck in your browser, wrote ' + num(text.length) + ' characters in ' + secs(msg.ms) + (same ? (text === sampleOf(p) ? ': the same text as the program the training printed, character for character.' : ': not the same as the program the training printed.') : ', with seed ' + seed + '.'));
        }
      } else if (msg.type === 'error') done('Stopped: ' + msg.message);
    };
    me.onerror = (e) => done('Stopped: ' + (e.message || 'the worker failed'));
    me.postMessage({ type: 'child', key: 'shakespeare', w: w.slice(), seed, lines });
  }
  $('sh-go').addEventListener('click', runChild);
  $('sh-dice').addEventListener('click', () => { $('sh-seed').value = 1 + Math.floor(Math.random() * 999999); });
  $('sh-lines').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    lines = +b.dataset.n;
    $('sh-lines').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  });

  // ---- where it looks --------------------------------------------------------------------------

  const EXAMPLES = [
    ['KING RICHARD III', 'KING RICHARD III:\nNow is the winter of our disconte'],
    ['ROMEO', 'ROMEO:\nBut soft, what light through yon'],
    ['To be', 'HAMLET:\nTo be, or not to b'],
    ['A new speech', 'And so I leave you.\n\n'],
  ];
  $('sh-att-pick').innerHTML = EXAMPLES.map(([label], i) => '<button type="button" data-i="' + i + '">' + esc(label) + '</button>').join('');
  const shownCh = (c) => (c === ' ' ? '·' : c === '\n' ? '↵' : c);
  let attTop = null, attN = 0;
  async function attention() {
    if (!D) return;
    const p = sel, n = ++attN, params = await paramsOf(p).catch(() => null);
    if (n !== attN) return;
    if (!params) { $('sh-att-said').textContent = 'The weights of pass ' + p + ' are not on this server.'; return; }
    const text = $('sh-att-text').value, toks = [...text].map((c) => m.chars.indexOf(c)).filter((t) => t >= 0).slice(-m.T);
    const ctx = Array(m.T - toks.length).fill(0).concat(toks);
    const f = T.reference.forward(m, params, ctx, T.spec.SC), sm = T.reference.softmax(f.u);
    const real = m.T - toks.length, most = Math.max(...f.att);
    $('sh-att-row').innerHTML = ctx.map((c, i) => {
      const pc = Math.round((f.att[i] * 100) / 256);
      return '<div class="att-cell"><div class="bar"><i style="height:' + (f.att[i] / most) * 100 + '%"></i></div><b class="' + (i < real ? 'pad' : '') + (i === m.T - 1 ? ' last' : '') + '">' + esc(shownCh(m.chars[c])) + '</b><span>' + pc + '</span></div>';
    }).join('');
    const guesses = sm.e.map((e, j) => [j, e / sm.S]).sort((a, b) => b[1] - a[1]).slice(0, 8);
    attTop = m.chars[guesses[0][0]];
    $('sh-att-next').innerHTML = guesses.map(([j, q]) => '<div><b>' + esc(shownCh(m.chars[j])) + '</b><span class="m"><i style="width:' + (q / guesses[0][1]) * 100 + '%"></i></span><span>' + (q * 100).toFixed(q < 0.1 ? 1 : 0) + '%</span></div>').join('');
    const top = f.att.indexOf(Math.max(...f.att)), name = (c) => (c === ' ' ? 'a space' : c === '\n' ? 'an end of line' : '“' + c + '”');
    $('sh-att-said').textContent = 'The child of pass ' + p + ' takes in most from ' + (top < real ? 'a place before the text' : name(m.chars[ctx[top]]) + ', ' + (m.T - top === 1 ? 'the last character' : (m.T - top) + ' characters back')) +
      ' (' + Math.round((f.att[top] * 100) / 256) + '%), and its first guess for the next character is ' + name(attTop) + ' (' + Math.round(guesses[0][1] * 100) + '%).';
  }
  $('sh-att-text').addEventListener('input', attention);
  $('sh-att-pick').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { $('sh-att-text').value = EXAMPLES[+b.dataset.i][1]; attention(); } });
  $('sh-att-take').addEventListener('click', () => { if (attTop !== null) { $('sh-att-text').value += attTop; attention(); } });

  // ---- start -------------------------------------------------------------------------------------

  fetch('data/shakespeare.json', { cache: 'no-cache' }).then((r) => r.json()).then((d) => {
    D = d;
    slider.max = shown();
    stats(); lossKey();
    setPass(shown());
  }).catch(() => { $('sh-pass-said').textContent = 'The data of the run is not on this server (site/train/data/shakespeare.json).'; });

  let rt = 0;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { drawLoss(); drawHeld(); }, 120); });
  new MutationObserver(() => { drawLoss(); drawHeld(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
})();
