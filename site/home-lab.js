// The Lab on the start page (index.html): brnfck-train-names-mlp-7k training here, an answer of
// brnfck-qwen2.5-coder-0.5b run on any input, and where a square of the cat looks (vision/data/look.json).
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  if (!$('labTrain')) return;
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;
  const probe = document.createElement('i');
  probe.style.display = 'none'; document.body.append(probe);
  const colour = (v) => { probe.style.color = `var(${v})`; return getComputedStyle(probe).color; };
  // a canvas as sharp as the screen, w CSS pixels wide, h high
  function fit(cv, w, h) {
    const dpr = window.devicePixelRatio || 1;
    cv.style.width = `${w}px`; cv.style.height = `${h}px`;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return g;
  }
  // run fn once, when the element comes near the screen
  const near = (node, fn) => {
    if (!('IntersectionObserver' in window)) return fn();
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); fn(); } }, { rootMargin: '300px 0px' });
    io.observe(node);
  };

  // ---- 1. a network that trains itself ----
  (() => {
    const cv = $('ltLoss'), say = (t) => { $('ltStat').textContent = t; };
    let D = null, got = null, live = [], worker = null, t0 = 0;              // D: train/data/mlp.json, the recorded run
    const data = () => got || (got = fetch('train/data/mlp.json?v=r3').then((r) => { if (!r.ok) throw new Error('no data'); return r.json(); }).then((d) => (D = d)));
    function draw() {
      const W = cv.parentElement.clientWidth, H = Math.round(Math.min(180, Math.max(130, W * 0.45))), g = fit(cv, W, H);
      const lo = 1.6, hi = 3.4, d = D, steps = d ? d.steps : 1, X = (s) => 4 + (s / steps) * (W - 8), Y = (l) => H - 4 - ((l - lo) / (hi - lo)) * (H - 8);
      g.fillStyle = colour('--sunk'); g.fillRect(0, 0, W, H);
      if (!d) return;
      g.fillStyle = colour('--muted'); g.globalAlpha = 0.35;
      d.loss.forEach((l, i) => g.fillRect(X(i + 1) - 0.6, Y(l / 1000) - 0.6, 1.2, 1.2));
      g.globalAlpha = 1; g.fillStyle = colour('--c-in');      // (the colour of the key under the chart)
      live.forEach((l, i) => g.fillRect(X(i + 1) - 1, Y(l / 1000) - 1, 2, 2));
      if (live.length) { g.fillStyle = colour('--ink'); g.fillRect(X(live.length), 0, 1, H); }
    }
    near(cv, () => data().then((d) => {
      $('ltFacts').textContent = `${fmt(d.program.chars)} characters · ${fmt(d.parameters)} weights · ${fmt(d.steps)} steps · built in this browser`;
      draw();
    }).catch(() => say('The data of this experiment could not be loaded.')));
    function stop(text) {
      if (worker) { worker.terminate(); worker = null; }
      if (window.LeaveGuard) LeaveGuard.set('lab-train', false);
      $('ltGo').textContent = 'Train again';
      if (text) say(text);
    }
    $('ltGo').addEventListener('click', async () => {
      if (worker) return stop(`Stopped after ${fmt(live.length)} steps.`);
      let d;
      try { d = await data(); } catch (e) { return say('The data of this experiment could not be loaded.'); }
      live = []; t0 = performance.now(); $('ltNames').hidden = true; draw();
      say('Building the training program with the generator, in this browser…');
      $('ltGo').textContent = 'Stop';
      const w = worker = new Worker('train/worker.js?v=r3');
      if (window.LeaveGuard) LeaveGuard.set('lab-train', true);
      let queued = false;
      const redraw = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; draw(); }); };
      w.onmessage = (ev) => {
        const m = ev.data;
        if (w !== worker) return;
        if (m.type === 'built') say(`Built: ${fmt(m.chars)} characters of brainfuck. Compiling…`);
        else if (m.type === 'lines') {
          for (const line of m.lines) { const l = line.match(/loss (\d+)\.(\d{3})$/); live.push(l ? +l[1] * 1000 + +l[2] : NaN); }
          say(`Step ${fmt(live.length)} of ${fmt(d.steps)} · loss ${m.lines[m.lines.length - 1].replace(/^.* loss /, '')} · ${secs(performance.now() - t0)}`);
          redraw();
        } else if (m.type === 'trained') say(`brnfck-train-names-mlp-7k trained: ${fmt(d.steps)} steps in ${secs(m.ms)}. It printed its child program, ${fmt(m.child)} characters. Running the child…`);
        else if (m.type === 'names') {
          $('ltNames').textContent = m.names.trim().split('\n').slice(0, 12).join('  ');
          $('ltNames').hidden = false;
          stop(`brnfck-train-names-mlp-7k trained in ${secs(performance.now() - t0)}. The program it printed made up these names:`);
        } else if (m.type === 'error') stop(`Stopped: ${m.message}`);
      };
      w.onerror = (e) => stop(`Stopped: ${e.message || 'the worker failed'}`);
      w.postMessage({ type: 'train', key: 'mlp' });
    });
    new ResizeObserver(() => draw()).observe(cv.parentElement);
  })();

  // ---- 2. a program that writes brainfuck ----
  (() => {
    const KIND = { '+': 'p', '-': 'm', '<': 'v', '>': 'v', '[': 'b', ']': 'b', ',': 'i', '.': 'o' };
    const COLOUR = { '>': '--c-gt', '<': '--c-lt', '+': '--c-plus', '-': '--c-minus', '[': '--c-open', ']': '--c-open', ',': '--c-in', '.': '--c-out' };
    const still = matchMedia('(prefers-reduced-motion: reduce)');
    let code = '', marks = [], lit = null, anim = 0;
    // one span a command, so that the command being run can be lit; marks[k] is the span of the k-th command
    function paint(box, text) {
      box.textContent = ''; marks = [];
      for (const c of text) { const s = document.createElement('span'); s.className = KIND[c] || ''; s.textContent = c; box.append(s); if (KIND[c]) marks.push(s); }
    }
    function light(m) {
      if (lit) lit.classList.remove('now');
      lit = m && !m.done ? marks[m.pc] : null;
      if (lit) { lit.classList.add('now'); $('lcTape').style.setProperty('--cell', `var(${COLOUR[m.code[m.pc]]})`); }
    }
    function cells(m, n) {
      $('lcTape').replaceChildren(...Array.from(m.tape.slice(0, n), (v, i) => {
        const cell = document.createElement('div'), box = document.createElement('b'), no = document.createElement('i');
        box.textContent = v; no.textContent = i; cell.append(box, no);
        cell.className = i === m.p ? 'cell here' : 'cell';
        return cell;
      }));
    }
    function shown(text) {
      const out = document.createElement('b');
      if (!text) { out.textContent = 'nothing'; return out; }
      out.textContent = text.replace(/\n/g, '↵').replace(/[\x00-\x1f\x7f-￿]/g, (c) => `\\${c.charCodeAt(0)}`);
      return out;
    }
    // the run, played: the command being run lit in the program, the cells and the pointer under it, the print as it grows;
    // all its steps in about four seconds, however many there are
    function run() {
      if (!code || !window.BFEngine || !window.LearnCore) return;
      cancelAnimationFrame(anim);
      const text = $('lcIn').value, input = Array.from(text, (c) => c.charCodeAt(0) & 255);
      const r = BFEngine.run(code, { input: text, bits: 8, eof: 0 }), o = $('lcOut');
      const end = () => {
        o.removeAttribute('aria-busy'); o.textContent = '';
        if (r.status !== 'ok') { o.textContent = r.status === 'limit' ? 'Stopped after 5,000,000 steps.' : 'It stopped with an error.'; return; }
        o.append('It printed ', shown(r.out), ` in ${fmt(r.steps)} steps.`);
      };
      if (r.status !== 'ok' || r.steps > 200000) { light(null); $('lcTape').replaceChildren(); end(); return; }
      const pre = new LearnCore.Machine(code, { bits: 8, size: 256, input });
      let top = 0;
      while (!pre.done) { pre.step(); top = Math.max(top, pre.p); }
      const n = Math.min(12, Math.max(6, top + 1));
      if (still.matches) { light(null); cells(pre, n); end(); return; }
      const m = new LearnCore.Machine(code, { bits: 8, size: 256, input }), per = Math.max(1, Math.ceil(r.steps / 240));
      o.setAttribute('aria-busy', 'true');
      const frame = () => {
        for (let k = 0; k < per && !m.done; k++) m.step();
        light(m); cells(m, n);
        if (m.done) { end(); return; }
        o.textContent = '';
        o.append(`Step ${fmt(m.steps)} of ${fmt(r.steps)} · printed `, shown(String.fromCharCode(...m.out)));
        anim = requestAnimationFrame(frame);
      };
      anim = requestAnimationFrame(frame);
    }
    near($('labCode'), () => fetch('coder/data/coder.json?v=r3').then((r) => { if (!r.ok) throw new Error('no data'); return r.json(); }).then((d) => {
      const q = d.challenges.find((c) => c.id === d.run.challenge);
      code = d.run.answer;
      $('lcTask').textContent = `“${q ? q.question : d.run.challenge}”`;
      const ex = q && /(\S+) (?:gives|becomes) /.exec(q.question);         // the input of the task's own example: "38 gives 8"
      if (ex) $('lcIn').value = ex[1];
      paint($('lcCode'), code);
      $('lcFacts').textContent = `758 MB · start-up 35 to 70 s · about 2.2 s per word piece · this answer: ${d.run.pieces} word pieces`;
      run();
    }).catch(() => { $('lcOut').textContent = 'The data of this experiment could not be loaded.'; }));
    $('lcGo').addEventListener('click', run);
    $('lcIn').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); run(); } });
    $('lcAsk').addEventListener('click', () => {
      if (window.BrnfckChat) window.BrnfckChat.askCoder();
      const chat = document.querySelector('.stage') || $('q');
      chat.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    });
  })();

  // ---- 3. where a square of the cat looks ----
  (() => {
    const cv = $('lpCat'), N = 256;
    let D = null, sq = -1, layer = 4;
    const place = (s) => D.P.rc[s];
    const squareAt = (row, col) => D.P.rc.findIndex((p) => p[0] === row && p[1] === col);
    // the notepad squares of a layer: 3% or more of what a square takes in, on average over all 256 (vision/vision.js)
    const regs = {};
    function registers() {
      if (regs[layer]) return regs[layer];
      const mean = new Float64Array(N), R = new Uint8Array(N);
      for (let s = 0; s < N; s++) {
        const at = ((layer - 1) * N + s) * N;
        let all = 0; for (let u = 0; u < N; u++) all += D.look[at + u];
        if (all) for (let w = 0; w < N; w++) mean[w] += D.look[at + w] / all / N;
      }
      for (let k = 0; k < N; k++) R[k] = mean[k] >= 0.03 ? 1 : 0;
      return (regs[layer] = R);
    }
    function topOf(s) {
      const at = ((layer - 1) * N + s) * N, R = registers();
      let best = -1;
      for (let u = 0; u < N; u++) if (!R[u] && u !== s && (best < 0 || D.look[at + u] > D.look[at + best])) best = u;
      return best;
    }
    function draw() {
      if (!D) return;
      const W = Math.min(cv.parentElement.clientWidth, 360), g = fit(cv, W, W), cw = W / 16;
      g.imageSmoothingEnabled = false;
      g.drawImage(D.img, 0, 0, W, W);
      if (sq >= 0) {
        const at = ((layer - 1) * N + sq) * N, R = registers(), top = topOf(sq), max = D.look[at + top] || 1;
        for (let u = 0; u < N; u++) {
          if (R[u] || u === sq) continue;
          const v = Math.min(1, D.look[at + u] / max), p = place(u);
          g.fillStyle = `rgba(13,14,16,${(0.78 * (1 - Math.sqrt(v))).toFixed(3)})`;
          g.fillRect(p[1] * cw, p[0] * cw, cw, cw);
        }
        const me = place(sq), tp = place(top);
        g.strokeStyle = '#fff'; g.lineWidth = 3; g.strokeRect(me[1] * cw + 1.5, me[0] * cw + 1.5, cw - 3, cw - 3);
        g.strokeStyle = colour('--go'); g.strokeRect(tp[1] * cw + 1.5, tp[0] * cw + 1.5, cw - 3, cw - 3);
      }
      g.strokeStyle = 'rgba(255,255,255,0.16)'; g.lineWidth = 1;
      g.beginPath();
      for (let i = 1; i < 16; i++) { g.moveTo(i * cw + 0.5, 0); g.lineTo(i * cw + 0.5, W); g.moveTo(0, i * cw + 0.5); g.lineTo(W, i * cw + 0.5); }
      g.stroke();
    }
    function tell() {
      if (!D || sq < 0) return;
      const p = place(sq), t = place(topOf(sq));
      $('lpSaid').textContent = `The square in row ${p[0] + 1}, column ${p[1] + 1} (white), layer ${layer}: besides itself and the notepad squares, it takes in most from row ${t[0] + 1}, column ${t[1] + 1} (yellow). The darker a square, the less it takes in from there.`;
    }
    const show = () => { draw(); tell(); };
    function point(ev) {
      if (!D) return;
      const r = cv.getBoundingClientRect(), col = Math.floor((ev.clientX - r.left) / r.width * 16), row = Math.floor((ev.clientY - r.top) / r.height * 16);
      const s = squareAt(Math.max(0, Math.min(15, row)), Math.max(0, Math.min(15, col)));
      if (s >= 0 && s !== sq) { sq = s; show(); }
    }
    near(cv, () => fetch('vision/data/look.json?v=1').then((r) => { if (!r.ok) throw new Error('no data'); return r.json(); }).then((J) => {
      const P = J.pictures.find((x) => x.name === 'cat'), img = new Image();
      const gotImg = new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = `vision/${P.file}`; });
      const gotBin = fetch(`vision/${P.look}?v=1`).then((r) => { if (!r.ok) throw new Error('no data'); return r.arrayBuffer(); });
      return Promise.all([gotImg, gotBin]).then(([, buf]) => { D = { P, img, look: new Uint8Array(buf) }; sq = squareAt(8, 5); show(); });
    }).catch(() => { $('lpSaid').textContent = 'The data of this experiment could not be loaded.'; }));
    cv.addEventListener('pointermove', point);
    cv.addEventListener('pointerdown', point);
    cv.addEventListener('keydown', (e) => {
      if (!D || sq < 0) return;
      const d = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
      if (!d) return;
      e.preventDefault();
      const p = place(sq), s = squareAt(Math.max(0, Math.min(15, p[0] + d[0])), Math.max(0, Math.min(15, p[1] + d[1])));
      if (s >= 0) { sq = s; show(); }
    });
    $('lpLayer').addEventListener('input', () => { layer = Number($('lpLayer').value); $('lpLayerN').textContent = layer; show(); });
    new ResizeObserver(() => draw()).observe(cv.parentElement);
    new MutationObserver(() => draw()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  })();
})();
