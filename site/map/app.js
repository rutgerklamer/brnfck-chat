// The page around the map (map/index.html): the panel with its three tabs (Places, Tours, Display).
(function () {
  'use strict';
  const I = window.Inside, M = window.InsideMap;
  const $ = (id) => document.getElementById(id);
  if (!I || !M || !$('m-panel')) return;
  const { el, fmt, pct, short } = I;
  const main = $('main'), panel = $('m-panel'), stage = $('m-stage'), frame = $('m-frame'), cv = $('m-canvas'), mini = $('m-mini');
  const tabsBox = $('m-tabs'), reader = $('m-open'), live = $('m-live');
  const SHEET = matchMedia('(max-width: 40em), (max-width: 56.25em) and (orientation: portrait)');     // the same query as in map.css
  const isSheet = () => SHEET.matches;
  const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const on = (n, ev, fn, opt) => { if (typeof n === 'string') n = $(n); if (n) n.addEventListener(ev, fn, opt); return n; };
  const say = (id, t) => { const n = $(id); if (n) n.textContent = t; };
  const lc = (s) => s[0].toLowerCase() + s.slice(1);

  // ---- words for a screen reader
  let liveT = 0;
  const announce = (t) => { clearTimeout(liveT); live.textContent = ''; liveT = setTimeout(() => { live.textContent = t; }, 120); };
  const LNAME = { tree: 'Outline' }; for (const k in M.LAYOUTS) LNAME[k] = M.LAYOUTS[k].name;
  const BASIC = ['fold', 'line', 'rows', 'tree'], MORE = ['lanes', 'density', 'skyline', 'parts', 'tape', 'time', 'three'];      // the order of the layouts, everywhere
  const SAYS = (k) => (k === 'tree' ? M.SAYS_TREE : M.LAYOUTS[k].says).replace('Best to start with, and to see how long', 'Best to see how long');
  const whereText = () => {
    const v = M.view; if (v.tree) return 'Outline of the program.';
    const d = M.centreChar(), i = M.info(d);
    return LNAME[v.layout] + '. The middle of the view is character ' + fmt(d + 1) + ' of ' + fmt(M.total) + ', in ' + lc(i.part) + ': ' + i.title + '. ' + $('m-scale').textContent + '.';
  };
  let sayWhere = false, whereT = 0;
  M.on('user', (how) => { if (how === 'key' || how === 'button') sayWhere = true; pauseTour(); });
  M.on('settle', () => { if (!sayWhere) return; clearTimeout(whereT); whereT = setTimeout(() => { if (M.view.fly || M.view.wheel) return; sayWhere = false; announce(whereText()); }, 450); });

  // ---- shown, not only said
  const flash = (n) => { if (typeof n === 'string') n = $(n); if (!n) return; n.classList.remove('flash'); void n.offsetWidth; n.classList.add('flash'); };
  let posKey = '';
  setInterval(() => {
    const v = M.view; if (!M.total || !v.Wd) return;
    const linear = v.layout === 'line' || v.layout === 'lanes' || v.layout === 'tape', c = (M.centreChar() + 0.5) / M.total, w = linear ? Math.min(1, v.Wd / 2 ** v.z / M.total) : 0;
    const key = c.toFixed(5) + '/' + w.toFixed(5) + v.tree; if (key === posKey) return; posKey = key;
    const i = $('m-pos-i'); i.style.left = 'max(0%, min(calc(100% - 10px), ' + (100 * Math.max(0, c - w / 2)).toFixed(3) + '%))'; i.style.width = 'max(10px, ' + (100 * w).toFixed(3) + '%)'; $('m-pos').hidden = v.tree;
    placeMini();                                               // the small map comes and goes while you zoom
  }, 200);
  new MutationObserver(() => flash('m-scale')).observe($('m-scale'), { childList: true, characterData: true, subtree: true });

  // ---- the tabs
  const tabs = [...panel.querySelectorAll('[role="tab"]')];
  function showTab(t, focus) {
    tabs.forEach((b) => { const yes = b === t; b.setAttribute('aria-selected', String(yes)); b.tabIndex = yes ? 0 : -1; $(b.getAttribute('aria-controls')).hidden = !yes; });
    if (focus) t.focus();
  }
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => showTab(t));
    t.addEventListener('keydown', (e) => {
      const k = e.key, n = tabs.length;
      const to = k === 'ArrowRight' ? (i + 1) % n : k === 'ArrowLeft' ? (i + n - 1) % n : k === 'Home' ? 0 : k === 'End' ? n - 1 : -1;
      if (to >= 0) { e.preventDefault(); showTab(tabs[to], true); }
    });
  });

  // ---- the panel
  const SHEETS = ['peek', 'half', 'full'], SNAME = { peek: 'small', half: 'half the screen', full: 'the whole screen' };
  let sheet = 'peek', panelShown = true;
  function setSheet(s, quiet) {
    sheet = s; panel.dataset.sheet = s; panel.style.height = '';
    $('m-sheet-down').disabled = s === 'peek'; $('m-sheet-up').disabled = s === 'full';
    const vis = s === 'peek' ? 'Places, tours, display' : 'Drag, or press an arrow';
    say('m-grip-t', vis);
    $('m-grip').setAttribute('aria-label', vis + '. Panel height: ' + SNAME[s] + '. Press to make the panel ' + (s === 'full' ? 'small again' : 'larger') + '.');
    const sh = isSheet(); $('m-read').inert = sh && s !== 'peek'; frame.querySelector('.mapctl').inert = sh && s !== 'peek'; frame.inert = sh && s === 'full'; $('m-bar').inert = sh && s === 'full';
    if (!quiet && isSheet()) announce('Panel: ' + SNAME[s] + '.');
  }
  function arrange() {                                    // which of the two layouts, and in which order the parts are read
    const sh = isSheet();
    if (sh) { if (panel.previousElementSibling !== stage) main.insertBefore(panel, stage.nextSibling); panel.hidden = false; }
    else { if (panel.nextElementSibling !== stage) main.insertBefore(panel, stage); panel.hidden = !panelShown; }
    main.classList.toggle('nopanel', !sh && !panelShown);
    setSheet(sh ? sheet : 'peek', true);
    M.refresh();
  }
  (SHEET.addEventListener ? SHEET.addEventListener.bind(SHEET, 'change') : SHEET.addListener.bind(SHEET))(arrange);
  function showPanel(yes) {
    panelShown = yes; const b = $('m-panel-toggle');
    b.setAttribute('aria-expanded', String(yes)); say('m-panel-toggle-t', yes ? 'Hide panel' : 'Show panel');
    arrange();
  }
  on('m-panel-toggle', 'click', () => showPanel(!panelShown));
  on('m-sheet-up', 'click', () => { setSheet(SHEETS[Math.min(2, SHEETS.indexOf(sheet) + 1)]); if (sheet === 'full') $('m-sheet-down').focus(); });
  on('m-sheet-down', 'click', () => { setSheet(SHEETS[Math.max(0, SHEETS.indexOf(sheet) - 1)]); if (sheet === 'peek') $('m-sheet-up').focus(); });
  // the handle: press it to step through the three heights, or drag it
  (function () {
    const grip = $('m-grip'); let d = null, dragged = false;
    grip.addEventListener('pointerdown', (e) => { if (!isSheet()) return; d = { y: e.clientY, h: panel.getBoundingClientRect().height, moved: 0, last: e.clientY, dir: 0 }; dragged = false; grip.setPointerCapture(e.pointerId); });
    grip.addEventListener('pointermove', (e) => {
      if (!d) return;
      const dy = e.clientY - d.y; d.moved = Math.max(d.moved, Math.abs(dy)); if (d.moved < 6) return;
      if (!dragged) { dragged = true; panel.classList.add('dragging'); if (sheet === 'peek') { panel.dataset.sheet = 'half'; } }
      d.dir = e.clientY - d.last || d.dir; d.last = e.clientY;
      const H = main.getBoundingClientRect().height; panel.style.height = Math.max(80, Math.min(H, d.h - dy)) + 'px';
    });
    const end = () => {
      if (!d) return; const was = d; d = null; panel.classList.remove('dragging');
      if (!dragged) return;
      const H = main.getBoundingClientRect().height, h = panel.getBoundingClientRect().height, peek = parseFloat(getComputedStyle(main).getPropertyValue('--peek')) * parseFloat(getComputedStyle(document.documentElement).fontSize);
      const stops = [peek, H * 0.58, H]; let best = 0;
      stops.forEach((s, k) => { if (Math.abs(s - h) < Math.abs(stops[best] - h)) best = k; });
      const from = SHEETS.indexOf(sheet); if (best === from && was.moved > 30) best = Math.max(0, Math.min(2, from + (was.dir < 0 || h > was.h ? 1 : -1)));
      setSheet(SHEETS[best]);
    };
    grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
    grip.addEventListener('click', () => { if (dragged) { dragged = false; return; } setSheet(sheet === 'peek' ? 'half' : sheet === 'half' ? 'full' : 'peek'); });
  })();

  // ---- the small map, the names, the layout, the colours
  // the small map: on when chosen under Display, and only while part of the program is out of view
  // (with the whole program in view it would show the same picture twice)
  let miniWanted = true;
  let mapUp = false;
  function placeMini() {
    const v = M.view; if (!mapUp || v.fly) return;
    const show = miniWanted && !v.tree && v.z > v.zHome + 0.2;
    if (mini.hidden !== !show) { mini.hidden = !show; M.refresh(); }
  }
  function setMini(yes) { miniWanted = yes; $('m-mini-on').checked = yes; placeMini(); }
  on('m-mini-on', 'change', (e) => setMini(e.target.checked));
  M.on('settle', placeMini);
  M.on('layout', placeMini);
  M.started.then(() => { mapUp = true; placeMini(); });
  on('m-labels', 'change', (e) => M.setLabels(e.target.checked));
  // the layouts as cards (Display): a small picture of each, its name and what it is best for
  const PIC = {      // 28 x 20 pictures, drawn with the ink colour
    line: '<rect x="2" y="7" width="24" height="6"/>', rows: '<path d="M4 4h20M4 8h20M4 12h20M4 16h12" stroke-width="2"/>', fold: '<path d="M5 16V4h6v8h6V4h6v12" fill="none" stroke-width="2"/>',
    tree: '<path d="M3 4h10M7 9h12M7 14h9M4 4v10" fill="none" stroke-width="2"/>', lanes: '<path d="M2 4h24M2 8h14M10 12h16M2 16h3M20 16h1" stroke-width="2"/>',
    density: '<path d="M2 18V8h5v10zM8 18V4h5v14zM14 18V10h5v8zM20 18V6h5v12z"/>', skyline: '<path d="M2 18v-2h13v-9h3v-4h3v8h3v-3h2v10z"/>', parts: '<path d="M2 4h22M2 8h14M2 12h15M2 16h13" stroke-width="2.5"/>',
    tape: '<rect x="2" y="3" width="24" height="4"/><rect x="2" y="13" width="24" height="4"/><path d="M8 7l-4 6M18 7l4 6" fill="none" stroke-width="1.5"/>',
    time: '<rect x="2" y="3" width="24" height="4"/><rect x="2" y="13" width="24" height="4"/><path d="M12 7L3 13M14 7l11 6" fill="none" stroke-width="1.5"/>', three: '<rect x="2" y="2" width="3" height="2.5"/><rect x="2" y="6.5" width="9" height="2.5"/><rect x="2" y="11" width="16" height="2.5"/><rect x="2" y="15.5" width="24" height="2.5"/>',
  };
  const BEST = (t) => { const m = /Best [^.]*\./.exec(t); return m ? m[0] : t; };
  const cardBox = $('m-layout-cards'), cards = {};
  [['Basic layouts', BASIC], ['More layouts', MORE]].forEach(([head, list]) => {
    const ul = el('ul', 'tiles'); cardBox.append(el('p', 'label', head), ul);      // .tiles of ../site.css: the chosen layout has aria-pressed="true"
    list.forEach((k) => {
      const li = el('li'), b = el('button'); b.type = 'button'; b.setAttribute('aria-pressed', 'false');
      b.innerHTML = '<svg viewBox="0 0 28 20" aria-hidden="true" focusable="false" fill="currentColor" stroke="currentColor" stroke-width="0">' + PIC[k] + '</svg>';
      b.append(el('b', '', LNAME[k]), el('span', '', BEST(SAYS(k))));
      b.addEventListener('click', () => { sayWhere = true; M.setLayout(k); }); cards[k] = b; li.append(b); ul.append(li);
    });
  });
  const modeRadios = [...document.querySelectorAll('input[name="m-mode"]')];
  on('m-layout-sel', 'change', (e) => { sayWhere = true; M.setLayout(e.target.value); });
  on('m-more', 'change', (e) => { if (e.target.value) { sayWhere = true; M.setLayout(e.target.value); } });
  on('m-to-outline', 'click', () => { M.setLayout('tree'); $('m-tree').focus(); });
  modeRadios.forEach((r) => r.addEventListener('change', () => { if (r.checked) M.setMode(r.value); }));
  M.on('layout', (which) => {
    for (const k in cards) cards[k].setAttribute('aria-pressed', String(k === which)); say('m-layout-name', LNAME[which]); $('m-layout-sel').value = which; $('m-more').value = BASIC.includes(which) ? '' : which; say('m-layout-said', SAYS(which));
    if (which === 'tree') { say('m-where', 'Outline of the program: every named part as text.'); say('m-what', 'Open a part like a folder. "Show" goes to it on the map.'); say('m-snip', ''); say('m-scale', ''); }
  });
  M.on('mode', (m) => { modeRadios.forEach((r) => { r.checked = r.value === m; }); announce(m === 'purpose' ? 'Colours by purpose.' : 'Colours by command.'); });
  M.on('shown', (t) => { announce('The map shows: ' + t.text + '.'); });
  document.querySelectorAll('.movepad button').forEach((b) => b.addEventListener('click', () => {
    sayWhere = true;
    if (b.dataset.pan) { const [x, y] = b.dataset.pan.split(',').map(Number); M.panBy(x * 0.25, y * 0.25); } else if (b.dataset.zoom) M.zoomBy(Number(b.dataset.zoom)); else M.home();
  }));
  document.querySelectorAll('#m-progs a').forEach((a) => { if (a.dataset.m === I.MODEL) a.setAttribute('aria-current', 'page'); });
  const ins = $('m-inside'); if (ins) { if (I.VIS) { ins.href = '../vision/'; ins.textContent = 'Looking at a picture'; } else ins.href = '../inside/?m=' + I.MODEL; }

  // ---- the program text at a chosen spot
  let readerFrom = null, chosen = null;
  function openReader(h, from) {
    readerFrom = from || document.activeElement;
    if (isSheet()) { if (sheet === 'peek') setSheet('half', true); } else if (!panelShown) showPanel(true);
    tabsBox.hidden = true;
    M.openText(h).then(() => { $('m-open-title').focus({ preventScroll: true }); });
    reader.hidden = false; $('m-open-title').focus({ preventScroll: true });
  }
  function closeReader() {
    if (reader.hidden) return false;
    reader.hidden = true; tabsBox.hidden = false;
    if (isSheet()) setSheet('peek', true);
    const to = readerFrom && readerFrom.isConnected && readerFrom.getClientRects().length ? readerFrom : cv; readerFrom = null;
    to.focus({ preventScroll: true });
    return true;
  }
  on('m-open-close', 'click', closeReader);
  const hereOrChosen = () => { const p = M.pin; if (p) return p; const d = M.centreChar(); return { d }; };
  on('m-readbtn', 'click', () => openReader(hereOrChosen(), $('m-readbtn')));
  on('m-now-read', 'click', () => openReader(hereOrChosen(), $('m-grip')));
  M.on('read', (h) => openReader(h, cv));
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (e.target && e.target.id === 'm-filter' && e.target.value) return;          // the box clears itself first
    if (closeReader()) { e.preventDefault(); return; }
    if (isSheet() && sheet !== 'peek') { setSheet('peek'); $('m-grip').focus(); e.preventDefault(); return; }
    pauseTour();
  });

  // ---- the card on the smallest sheet
  function setNow() {
    const prev = $('m-now-prev'), next = $('m-now-next'), play = $('m-now-play'), read = $('m-now-read'), also = $('m-now-also');
    also.hidden = true; also.textContent = ''; $('m-now-scroll').scrollTop = 0;
    if (tour && now === 'tour') {
      const s = tour.t.stops[tour.i];
      say('m-now-kick', 'Tour · stop ' + (tour.i + 1) + ' of ' + tour.t.stops.length); say('m-now-title', s.title); say('m-now-text', s.text);
      prev.textContent = 'Back'; prev.disabled = tour.i === 0; next.textContent = tour.i === tour.t.stops.length - 1 ? 'Done' : 'Next'; next.hidden = false; prev.hidden = false;
      play.hidden = calm(); play.setAttribute('aria-pressed', String(!!tour.auto)); play.textContent = tour.auto ? 'Pause' : 'Play'; read.hidden = true;
    } else if (now === 'spot' && chosen) {
      const i = M.info(chosen.d);
      say('m-now-kick', 'Chosen · character ' + fmt(chosen.d + 1)); say('m-now-title', i.title); say('m-now-text', i.says + (i.more ? ' ' + i.more : ''));
      prev.hidden = true; next.hidden = true; play.hidden = true; read.hidden = false;
    } else {
      const p = lastPlace || flat[0]; if (!p) return;
      const k = flat.indexOf(p);
      say('m-now-kick', 'Place ' + (k + 1) + ' of ' + flat.length + ' · ' + p.group); say('m-now-title', p.title); say('m-now-text', p.text);
      prev.textContent = 'Previous'; next.textContent = 'Next'; prev.hidden = false; next.hidden = false; prev.disabled = k <= 0; next.disabled = k >= flat.length - 1; play.hidden = true; read.hidden = true;
      if (p.cmp) fillAlso(also, p);
    }
  }
  let now = 'place';
  on('m-now-prev', 'click', () => { if (tour && now === 'tour') tourStep(-1); else { const k = flat.indexOf(lastPlace || flat[0]); if (k > 0) applyPlace(flat[k - 1], { stay: true }); } });
  on('m-now-next', 'click', () => { if (tour && now === 'tour') tourStep(1); else { const k = flat.indexOf(lastPlace || flat[0]); if (k < flat.length - 1) applyPlace(flat[k + 1], { stay: true }); } });
  on('m-now-play', 'click', () => toggleAuto());
  M.on('select', (h) => { chosen = h; if (isSheet()) { now = 'spot'; setNow(); } });

  // ---- places
  let groups = [], flat = [], current = null, lastPlace = null;
  const others = () => ['small', '0.5b', '1.5b', '0.8b'].filter((m) => m !== I.MODEL);
  const fillAlso = (box, p) => { box.textContent = ''; box.append('The same place in '); const o = others(); o.forEach((m, k) => { if (k) box.append(k === o.length - 1 ? ' or ' : ', '); const a = el('a', '', I.MODELS[m].short); a.href = '?m=' + m + '#preset=' + p.id; box.append(a); }); box.append('.'); box.hidden = false; };
  // a section of the engine by its id, or (brnfck-qwen3.5-0.8b, whose layers are written four times) the first one of that name
  const secOf = (E, id) => E.sections.find((s) => s.id === id) || E.sections.find((s) => s.key === id);
  // the text of the layers: one layer, or the four layers of a group of brnfck-qwen3.5-0.8b
  const layerText = (E) => {
    const n = E.model;
    if (!n.unit) return { from: secOf(E, 'xn1').from, to: secOf(E, 'xout').to, text: 'The text for one layer. It is written once; a loop runs it ' + n.layers + ' times, each time on the next layer’s weights.' };
    const ss = E.sections.filter((s) => s.u !== undefined);
    return { from: ss[0].from, to: ss[ss.length - 1].to, text: 'The text for four layers: three DeltaNet layers and one attention layer, each written out. A loop runs the four ' + n.groups + ' times, each time on the next four layers’ weights.' };
  };
  // brnfck-qwen3.5-0.8b-vision: the stretches of its picture part
  const picOf = (E) => {
    const V = E.model.vision; if (!V) return null;
    const P = (id) => M.places.find((p) => p.id === id), sec = (id) => secOf(E, id), last = V.layers;
    const round = (r) => M.names.find((x) => x.text === 'Round ' + (r + 1) + ' of the picture part'), layer = (l) => M.names.find((x) => x.text === 'Picture layer ' + l);
    const mid = Math.ceil(V.layers / 2);
    return { V, W: P('picture'), E: P('looking'), round, layer, mid, sec, last, merger: { from: sec('v' + last + '.mnorm').from, to: sec('v' + last + '.mback').to }, see: sec('v' + mid + '.att'), walk: sec('vend'), patch: sec('v0.patch') };
  };
  function makePlaces(C) {
    const W = I.W, E = I.E, total = M.total, spans = M.spans, n = E.model;
    const P = (id) => M.places.find((p) => p.id === id), sec = (id) => secOf(E, id), Q35 = !!n.unit, LT = layerText(E);
    const emb = spans.find((s) => s.kind === 'emb'), cls = spans.filter((s) => s.kind === 'cls'), LAY = Math.min(12, n.layers - 1);
    const strip = spans.find((s) => s.kind === 'bias' && s.layer === LAY) || spans.find((s) => s.kind === 'gain' && s.layer === LAY && s.region && s.region.what === 'ffn');
    const layerSays = Q35 ? ': a DeltaNet layer. Four matrices of weights, and between them the room for the tables of its ' + n.deltanet.valueHeads + ' heads, empty until the program runs.' : ': four matrices of weights, and the memory of the fixed opening lines.';
    const G = [], g = (name, list) => G.push({ name, list: list.filter(Boolean) });
    g('Start here', [      // the first place is the view the map opens with
      { id: 'folded', title: 'The whole program, folded', layout: 'fold', mode: 'purpose', home: true, text: 'All ' + fmt(total) + ' characters at once. The program is one line; here it is folded into a square, so that neighbours in the line stay neighbours. A colour is one part of the model.' },
      { id: 'line', title: 'The same program, as one line', layout: 'line', mode: 'purpose', home: true, text: 'The program as it is: one line of ' + fmt(total) + ' characters, from the first to the last. Best to see how long each part is.' },
      { id: 'commands', title: 'Zoom until you can read it', layout: 'line', mode: 'purpose', at: P('block').at, z: 4, text: 'Close up, the line is commands, one after another. These few write some of the model’s numbers into memory.' },
    ]);
    g('The two parts', [
      { id: 'writer', title: 'The writing part', layout: 'fold', mode: 'purpose', from: 0, to: W.program.writer, text: 'The first ' + pct(W.program.writer / total) + ' of the text reads nothing and prints nothing. It only puts the model’s numbers into memory.' },
      { id: 'engine', title: 'The engine', layout: 'fold', mode: 'purpose', from: W.program.writer, to: total, text: 'The last ' + pct(E.chars / total) + ' of the text. It reads your question, does the model’s sums with the numbers, and prints the answer.' },
      { id: 'border', title: 'Where the two parts meet', layout: 'line', mode: 'purpose', at: W.program.writer, z: 3, text: 'Character ' + fmt(W.program.writer + 1) + ': the last steps of the writing part, and the first commands of the engine.' },
    ]);
    g('Inside the writing part', [
      { id: 'layer', title: 'The weights of one layer', layout: 'fold', mode: 'purpose', from: P('layer').from, to: P('layer').to, text: P('layer').name.replace('Weights of l', 'L') + ' of ' + n.layers + layerSays },
      { id: 'block', title: 'One block, up close', layout: 'fold', mode: 'purpose', at: P('block').at, z: 4, text: 'The start of a block: a short piece of text that writes up to 8,192 numbers at once. The white frame marks its first command.' },
      { id: 'vocab', title: 'The vocabulary', layout: 'fold', mode: 'purpose', from: P('vocab').from, to: P('vocab').to, text: 'The table that says which letters make which word piece. The program needs it to read your question and to print its answer.' },
      I.QWEN && emb && cls.length ? { id: 'twice', title: 'The table that is written twice', layout: 'line', mode: 'purpose', home: true, text: 'This model uses one table to read word pieces and to choose them. The program writes it twice: as the output table at the start of the line (letter O) and as the table of word pieces near the end (letter W). Together ' + pct((emb.to - emb.from + cls.reduce((a, s) => a + s.to - s.from, 0)) / total, 0) + ' of the text.' } : null,
      strip ? { id: 'strips', title: 'A strip of constants', layout: 'fold', mode: 'purpose', from: strip.from, to: strip.to, text: strip.kind === 'bias' ? 'Between the big matrices lie thin strips: one constant for every row. This one is the bias of ' + strip.title.split(':')[0].toLowerCase() + '.' : 'Between the big matrices lie thin strips of constants. This one holds a gain for each of the ' + fmt(n.dim) + ' running numbers of ' + strip.title.split(':')[0].toLowerCase() + '.' } : null,
    ]);
    g('Inside the engine', [
      { id: 'ask', title: 'Reading the question', layout: 'fold', mode: 'purpose', from: sec('ask').from, to: sec('ask').to, text: 'The first thing the engine does: read the letters of your question and cut them into word pieces.' },
      { id: 'fetch', title: 'Looking up a word piece', layout: 'fold', mode: 'purpose', from: sec('emb').from, to: sec('emb').to, text: 'For every word piece the engine fetches one row of ' + fmt(n.dim) + ' numbers from the table of word pieces.' },
      { id: 'onelayer', title: Q35 ? 'Four layers of the model' : 'One layer of the model', layout: 'fold', mode: 'purpose', from: LT.from, to: LT.to, text: LT.text },
      Q35 ? { id: 'deltanet', title: 'Writing into a table', layout: 'fold', mode: 'purpose', from: sec('dn.decay').from, to: sec('dn.next').to, text: 'One head of a DeltaNet layer: it fades a table of ' + fmt(n.deltanet.keySize) + ' × ' + fmt(n.deltanet.valueSize) + ' numbers, writes the new word piece into it and reads from it. The text is written once and runs for each of the ' + n.deltanet.valueHeads + ' heads.' } : null,
      { id: 'back', title: 'Looking back at earlier words', layout: 'fold', mode: 'purpose', from: sec('att').from, to: sec('att').to, text: 'The engine walks past every word piece it has seen so far and takes something from each. This is how the model remembers the conversation.' + (Q35 ? ' In this model only ' + (n.layers - n.types.filter((t) => t === 'lin').length) + ' of the ' + n.layers + ' layers do it.' : '') },
      { id: 'choose', title: 'Choosing the next word piece', layout: 'fold', mode: 'purpose', from: sec('cls').from, to: sec('cls').to, text: 'A score for each of the ' + fmt(n.vocab) + ' rows of the table; the highest wins and is printed.' },
    ]);
    const pic = picOf(E);
    if (pic) {
      const V = pic.V, wl = pic.layer(pic.mid), rd = pic.round(pic.mid);
      g('The picture part', [
        { id: 'picture', title: 'The numbers of the picture part', layout: 'fold', mode: 'purpose', from: pic.W.from, to: pic.W.to, text: 'The vision part of the model, written at the far end of memory, after the vocabulary: ' + short(pic.W.to - pic.W.from) + ' characters, ' + pct((pic.W.to - pic.W.from) / total) + ' of the program. Where each of the ' + V.squares + ' squares lies, the weights of the squares, ' + V.layers + ' layers of its own and the merger.' },
        wl ? { id: 'piclayer', title: 'One layer of the picture part', layout: 'fold', mode: 'purpose', from: wl.from, to: wl.to, text: 'Picture layer ' + pic.mid + ' of ' + V.layers + ': four matrices of weights, strips of constants, and a slot for each of the ' + V.squares + ' squares, empty until the program runs.' } : null,
        { id: 'looking', title: 'Looking at the picture', layout: 'fold', mode: 'purpose', from: pic.E.from, to: pic.E.to, text: 'The first ' + pct((pic.E.to - pic.E.from) / E.chars) + ' of the engine runs once, before the question. It reads the ' + V.squares + ' squares of the picture and takes all of them through ' + V.layers + ' layers, in ' + (V.layers + 1) + ' rounds. Unlike the layers of the text, every round is written out: each layer has its own widths.' },
        rd ? { id: 'picround', title: 'One round over all the squares', layout: 'line', mode: 'purpose', from: rd.from, to: rd.to, text: 'Round ' + (pic.mid + 1) + ': the second half of picture layer ' + pic.mid + ' and the first half of picture layer ' + (pic.mid + 1) + '. This text runs ' + V.squares + ' times, once for every square.' } : null,
        { id: 'picsee', title: 'Every square looks at every square', layout: 'fold', mode: 'purpose', from: pic.see.from, to: pic.see.to, text: 'In the text a word piece only looks back. Here a square looks at all ' + V.squares + ' squares, before and after it: in one round every square stores its key and value, in the next every square reads all the slots.' },
        { id: 'merger', title: 'Four squares, one word piece', layout: 'fold', mode: 'purpose', from: pic.merger.from, to: pic.merger.to, text: 'After the last layer every ' + V.perVector + ' neighbouring squares are joined into one vector of ' + fmt(V.out) + ' numbers: ' + V.vectors + ' vectors for ' + V.squares + ' squares. The text model reads them at the ' + V.vectors + ' word pieces of the picture in the prompt.' },
        { id: 'picwalk', title: 'The longest walk', layout: 'line', mode: 'purpose', from: pic.walk.from, to: pic.walk.to, text: 'When the picture part is done, the pointer walks from the far end of memory back to the vocabulary to read the question: one run of ' + fmt(pic.walk.longestMove) + ' steps to the left' + (W.counts.longestRunLeft === pic.walk.longestMove ? ', the longest in the program.' : '.') },
      ]);
    }
    g('Where it reads and prints', [
      pic ? { id: 'comma', title: 'The place it reads the picture', layout: 'fold', mode: 'purpose', at: E.commaAll[0], z: 5, text: 'A comma, in the green ring, that takes in the picture: it is run ' + fmt(pic.V.squares * pic.V.squareBytes) + ' times, once for every byte of the ' + pic.V.squares + ' squares.' } : null,
      pic ? { id: 'comma2', title: 'The places it reads the question', layout: 'fold', mode: 'purpose', at: E.commaAll[1], z: 5, text: 'Two more commas read your question: one its first letter, the other the rest, in a loop. These three are the only commands in ' + fmt(total) + ' characters that take anything in.' }
        : { id: 'comma', title: 'The one place it reads', layout: 'fold', mode: 'purpose', at: E.comma, z: 5, text: 'A single comma, in the green ring: the only command in ' + fmt(total) + ' characters that takes anything in. It is used once for every letter of your question.' },
      { id: 'dot', title: 'The one place it prints', layout: 'fold', mode: 'purpose', at: E.dot, z: 5, text: 'A single full stop, in the ring: the only command that prints. Every letter of every answer goes out through it.' },
    ]);
    const midLayer = spans.filter((s) => s.part === 0 && s.layer === Math.min(12, n.layers - 1) && s.kind !== 'cls');
    g('Other layouts and colours', [
      { id: 'lanes', title: 'Where each command lives', layout: 'lanes', mode: 'purpose', home: true, text: 'Seven lanes along the line, one for each command. The writing part is all adding, taking off and stepping left. ' + (pic ? 'The three reads and the single print are lone ticks in the engine.' : 'The single read and the single print are lone ticks near the right end.') },
      { id: 'parts', title: 'The layers, one under the other', layout: 'parts', mode: 'purpose', home: true, text: 'Every part of the program on a row of its own, all at the same scale. The ' + n.layers + ' layers show ' + (Q35 ? 'two patterns, three DeltaNet layers and then an attention layer, again and again' : 'the same pattern, one after the other') + '; the output table and the table of word pieces run far off to the right.' },
      { id: 'memory', title: 'From text to memory', layout: 'tape', mode: 'purpose', home: true, text: 'Above, the text; below, the ' + fmt(W.program.tape) + ' cells of memory it fills. A band joins each part of the text to its cells. The engine, at the right end, has no band: it writes nothing here.' },
      { id: 'mix', title: 'What the text is made of', layout: 'density', mode: 'purpose', home: true, text: 'A bar chart along the line: in every stretch, the share of each command, stacked. Nearly all of it is +, \u2212 and <; the brackets are a thin edge at the top.' },
      { id: 'skyline', title: 'Where the loops pile up', layout: 'skyline', mode: 'purpose', from: W.program.writer - E.chars, to: total, text: 'Height is how many loops lie inside one another. The writing part never goes deeper than ' + W.counts.maxDepthWriter + '; the engine, at the right, goes up to ' + W.counts.maxDepthEngine + '.' },
      pic ? null : { id: 'time', title: 'A little text, most of the time', layout: 'time', mode: 'purpose', home: true, text: 'Above, the text of the engine; below, the steps of one word piece as measured in a run. A band joins each section to its share of the steps.' },
      { id: 'three', title: 'The five programs at one scale', layout: 'three', mode: 'purpose', home: true, text: 'This program above; below it the five programs as bars at one scale, each cut into the output table, the layers, the table of word pieces, the vocabulary, the picture part of brnfck-qwen3.5-0.8b-vision and the engine.' },
      midLayer.length ? { id: 'memlayer', title: 'One layer, and the memory it fills', layout: 'tape', mode: 'purpose', from: midLayer[0].from, to: midLayer[midLayer.length - 1].to, text: 'The text of one layer above its cells. Where a band is wide above and narrow below, a cell costs much text; darker cells are left empty.' } : null,
      { id: 'bycommand', title: 'The square, coloured by command', layout: 'fold', mode: 'command', home: true, text: 'The folded program with a colour for each command instead of each part. The engine stands out: it is where the loops and the steps to the right are.' },
    ]);
    const CM = C && C.models ? C.models.filter((m) => !m.vision) : [];
    if (CM.length > 1) {
      const cm = Object.fromEntries(CM.map((m) => [m.id, m])), ids = CM.map((m) => m.id), me = cm[I.MODEL];
      const and = (t) => (t.length > 1 ? t.slice(0, -1).join(', ') + ' and ' + t[t.length - 1] : t[0] || ''), count = I.words(ids.length);
      const memory = (m) => ['slots', 'state', 'dscale', 'convwin'].reduce((a, k) => a + (m.tapeKinds[k] || 0), 0);
      const longest = CM.reduce((a, m) => (m.engine > a.engine ? m : a));
      const each = (fn) => ids.map((id) => cm[id].label + ': ' + fn(cm[id])).join('; ');
      const layers = spans.filter((s) => s.part === 0 && s.layer >= 0 && s.kind !== 'cls'), lay = P('layer');
      const hasStrips = (m) => !!(m.textKinds.bias || m.textKinds.scale || m.textKinds.gain);
      const tables = (m) => pct((m.textKinds.cls + m.textKinds.emb) / m.chars, 0);
      if (me) g('Compare the ' + count + ' programs', [
        { id: 'cmp-size', title: 'How long each one is', layout: 'line', mode: 'purpose', home: true, text: 'This is ' + I.MODELS[I.MODEL].short + ', ' + short(me.chars) + ' characters on one line. All ' + count + ': ' + each((m) => short(m.chars)) + '.' },
        { id: 'cmp-engine', title: 'A short engine', layout: 'line', mode: 'purpose', from: W.program.writer, to: total, text: 'The engine in characters, and as a share of its program. ' + each((m) => short(m.engine) + ' (' + pct(m.engine / m.chars) + ')') + '. In every program nearly all the text is numbers. The longest engine is that of ' + longest.label + (longest.family === 'qwen3.5' ? ', which writes out the text of four layers of two kinds' : '') + '.' },
        layers.length ? { id: 'cmp-layers', title: 'How many layers', layout: 'line', mode: 'purpose', from: layers[0].from, to: layers[layers.length - 1].to, text: 'The weights of the layers, one stretch of the line for each. Layers, and how many numbers run through each: ' + each((m) => m.layers + ' layers of ' + fmt(m.dim)) + '.' } : null,
        { id: 'cmp-tables', title: 'The two big tables', layout: 'line', mode: 'purpose', home: true, text: 'The output table (letter O, at the start of the line) and the table of word pieces (letter W, near its end) have a row for every word piece. Word pieces, and the share of the text the two tables take: ' + each((m) => fmt(m.vocab) + ', ' + tables(m)) + '.' },
        lay ? { id: 'cmp-strips', title: 'Strips of constants: ' + (ids.filter((id) => !hasStrips(cm[id])).length === 1 ? 'all but one' : 'in ' + I.words(ids.filter((id) => hasStrips(cm[id])).length)), layout: 'fold', mode: 'purpose', from: strip ? strip.from : lay.from, to: strip ? strip.to : lay.to, text: (strip ? 'A thin strip of constants between two matrices. ' : 'One layer of this program: matrices and memory, with nothing between them. ') + 'Such strips (a scale for every row, gains, and in the Qwen2.5 programs a bias) are in ' + and(ids.filter((id) => hasStrips(cm[id])).map((id) => I.MODELS[id].short)) + '; ' + and(ids.filter((id) => !hasStrips(cm[id])).map((id) => I.MODELS[id].short)) + ' has none.' } : null,
        lay ? { id: 'cmp-memory', title: 'Room to remember', layout: 'tape', mode: 'purpose', from: lay.from, to: lay.to, text: 'Cells of the tape kept for what the model remembers of the conversation: ' + each((m) => short(memory(m))) + '. The memory slots grow full as the conversation goes on; the tables of the DeltaNet layers of brnfck-qwen3.5-0.8b stay the same size. ' + (Q35 ? 'In this program they take ' + short(me.tapeKinds.state || 0) + ' of its cells.' : 'This program has no such tables.') } : null,
        { id: 'cmp-depth', title: 'Loops inside loops', layout: 'fold', mode: 'command', from: W.program.writer, to: total, text: 'The engine, coloured by command. Its loops sit inside one another; the deepest nesting is ' + each((m) => String(m.engineDepth)) + '. The writing part of this program never goes deeper than ' + W.counts.maxDepthWriter + '.' },
        { id: 'cmp-io', title: 'One comma, one full stop', layout: 'line', mode: 'purpose', at: E.comma, z: 5, text: 'Each of the ' + count + ' programs reads through a single comma and prints through a single full stop. This is the comma of this one, character ' + fmt(E.comma + 1) + '.' },
      ].map((p) => (p ? Object.assign(p, { cmp: true }) : p)));
    }
    groups = G; flat = [];
    G.forEach((gr) => gr.list.forEach((p) => { p.group = gr.name; flat.push(p); }));
  }
  function drawPlaces() {
    const box = $('m-places'); box.textContent = '';
    groups.forEach((G, gi) => {
      const sec = el('section', 'pgroup'), h = el('h3'), b = el('button', 'quiet'), ul = el('ul', 'tiles');
      b.type = 'button'; b.setAttribute('aria-expanded', 'true'); b.setAttribute('aria-controls', 'pg-' + gi); b.append(el('span', '', G.name), el('span', 'n muted', G.list.length + ' places'));
      ul.id = 'pg-' + gi;
      b.addEventListener('click', () => { const open = b.getAttribute('aria-expanded') !== 'true'; b.setAttribute('aria-expanded', String(open)); G.shut = !open; filter(); });
      G.list.forEach((p) => {
        const li = el('li'), pb = el('button', 'place'); pb.type = 'button'; pb.dataset.preset = p.id;
        pb.append(el('b', '', p.title), el('span', '', p.text)); pb.addEventListener('click', () => applyPlace(p)); p.btn = pb; p.li = li;
        li.append(pb); ul.append(li);
      });
      h.append(b); sec.append(h, ul); G.sec = sec; G.btn = b; G.ul = ul; box.append(sec);
    });
    filter();
  }
  function filter() {
    const q = $('m-filter').value.trim().toLowerCase(); let n = 0;
    groups.forEach((G) => {
      let any = 0;
      G.list.forEach((p) => { const hit = !q || (p.title + ' ' + p.text).toLowerCase().includes(q); p.li.hidden = !hit; if (hit) any++; });
      n += any; G.sec.hidden = !any; G.ul.hidden = q ? false : !!G.shut; G.btn.setAttribute('aria-expanded', String(q ? true : !G.shut));
    });
    say('m-filter-count', q ? (n === 0 ? 'No place has "' + q + '" in its name or its sentence.' : n === 1 ? '1 place found.' : n + ' places found.') : '');
  }
  on('m-filter', 'input', filter);
  const markCurrent = () => flat.forEach((p) => { if (p.btn) { if (p === current) p.btn.setAttribute('aria-current', 'true'); else p.btn.removeAttribute('aria-current'); } });
  // opt.jump: no flight (a link from another page); opt.stay: the focus stays where it is
  function applyPlace(p, opt = {}) {
    pauseTour(); current = p; lastPlace = p; now = 'place'; markCurrent(); setNow(); flash('m-now-title'); flash(p.btn);
    announce(p.title + '. ' + p.text);
    M.goTo(p, { jump: opt.jump, hash: '#preset=' + p.id });
    if (isSheet() && sheet !== 'peek' && !opt.stay) { const inTabs = tabsBox.contains(document.activeElement); setSheet('peek', true); if (inTabs) $('m-now-title').focus({ preventScroll: true }); }
  }
  M.on('hash', () => { if (current) { current = null; markCurrent(); } });       // you moved on: no place is "here" any more

  // ---- tours
  let tours = [], tour = null, tourTimer = 0;
  function makeTours() {
    const W = I.W, E = I.E, total = M.total, n = E.model, F = I.F, SEC = I.SEC;
    const P = (id) => M.places.find((p) => p.id === id), sec = (id) => secOf(E, id), place = (id) => flat.find((p) => p.id === id), Q35 = !!n.unit, LT = layerText(E);
    const sample = W.samples.find((s) => s.id === 'w13') || W.samples[0];
    const wparts = M.names.filter((x) => x.tier === 1 && x.to <= W.program.writer).sort((a, b) => a.from - b.from), firstLayer = wparts.find((x) => /^Layer /.test(x.text));
    const stop = (title, text, view) => Object.assign({ title, text }, view), pic = picOf(E);
    tours = [
      { id: 'grand', title: 'The whole program in nine stops', text: 'From the one line to the one comma: what the program is made of.', stops: [
        stop('One line', 'This is the whole program as it is: one line of ' + fmt(total) + ' characters, from left to right. A colour is one part of the model; its letter stands above it.', { layout: 'line', mode: 'purpose', home: true }),
        stop('Seven lanes', 'The same line with a lane for each command. Almost everything is adding, taking off and stepping left; the loops are thin ticks.', { layout: 'lanes', home: true }),
        stop('Single commands', 'Zoom in far enough and the line is commands, one after another. These write a few of the model’s numbers into memory.', { layout: 'line', at: P('block').at, z: 4 }),
        stop('Folded into a square', 'A line this long cannot be taken in at once. So it is folded into a square, in such a way that neighbours in the line stay neighbours.', { layout: 'fold', home: true }),
        stop('Part by part', 'Cut at its parts and laid out in rows, the program shows its ' + n.layers + ' layers: ' + (Q35 ? 'three DeltaNet layers and an attention layer' : 'the same pattern') + ', again and again.', { layout: 'parts', home: true }),
        stop('The weights', 'The big fields are the weights of the model, written layer after layer. This is ' + lc(P('layer').name.replace('Weights of ', '')) + '.', { layout: 'fold', from: P('layer').from, to: P('layer').to }),
        stop('The vocabulary', 'The vocabulary: the table that says which letters make which word piece.', { layout: 'fold', from: P('vocab').from, to: P('vocab').to }),
        stop('The engine', 'The engine: the last ' + pct(E.chars / total) + ' of the text. Everything before it only stores numbers. This part does the sums.', { layout: 'fold', from: W.program.writer, to: total }),
        E.model.vision ? stop('The first comma', 'And here, in the ring, is where the program first reads: a comma that takes in the picture, byte by byte. Two more commas, further on, read your question.', { layout: 'fold', at: E.commaAll[0], z: 5 })
          : stop('The one comma', 'And here, in the ring, is the one place where the program reads: a single comma, used once for every letter of your question.', { layout: 'fold', at: E.comma, z: 5 }),
      ] },
      { id: 'writing', title: 'How ' + short(W.tape.nonZero) + ' numbers get written', text: 'The first ' + pct(W.program.writer / total) + ' of the program does nothing but put numbers into memory. How?', stops: [
        stop('Almost all of it writes', 'The first ' + pct(W.program.writer / total) + ' of the line does one thing: it puts a number into each of ' + fmt(W.tape.nonZero) + ' cells of memory. It reads nothing and prints nothing.', { layout: 'line', mode: 'purpose', from: 0, to: W.program.writer }),
        wparts.length > 1 ? stop('In the order of memory', 'The program fills memory from left to right, so the line follows memory. It starts with the ' + lc(wparts[0].text) + ' and ends with the ' + lc(wparts[wparts.length - 1].text) + (firstLayer ? '; of the layers, ' + lc(firstLayer.text) + ' comes first' : '') + '.', { layout: 'line', mode: 'purpose', home: true }) : null,
        stop('One layer', P('layer').name.replace('Weights of l', 'L') + ' of ' + n.layers + (Q35 ? ': a DeltaNet layer. Four matrices of weights, and between them the room for the tables of its ' + n.deltanet.valueHeads + ' heads, empty until the program runs.' : ': four matrices of weights, and the memory of the fixed opening lines.'), { layout: 'fold', from: P('layer').from, to: P('layer').to }),
        stop('One block', 'The numbers are written block by block. This block is ' + fmt(sample.len) + ' characters long and writes ' + fmt(sample.K) + ' cells. The program has ' + fmt(W.encoder.blocks) + ' blocks.', { layout: 'fold', from: sample.off, to: sample.off + sample.len }),
        stop('The start of a block', 'Close up, a block is plain commands. The white frame marks its first one.', { layout: 'fold', at: sample.off + 6, z: 4 }),
        stop('Text above, memory below', 'The same line with the memory under it: ' + fmt(W.program.tape) + ' cells. A band joins each part of the text to the cells it writes.', { layout: 'tape', home: true }),
        stop('What it costs', 'In all, about ' + F.charsPerCell + ' characters of program for each number. Plain counting, a plus sign for every unit, would have taken ' + F.plainShort + ' characters.', { layout: 'line', home: true }),
        stop('The walk back', 'The last ' + fmt(W.finalMove.chars) + ' characters of the writing part are steps to the left. They bring the pointer to the cell where the engine expects it.', { layout: 'line', from: W.finalMove.from, to: W.program.writer }),
      ].filter(Boolean) },
      { id: 'question', title: 'Follow one question through the engine', text: 'The engine from left to right is the way your question takes: in through the comma, out through the full stop.', stops: [
        stop('The engine', 'The last ' + pct(E.chars / total) + ' of the line is the engine. Read it from left to right and you follow a question through the model.', { layout: 'line', mode: 'purpose', from: W.program.writer, to: total }),
        pic ? stop('First the picture', 'Before the question, the picture part has run: ' + pct((pic.E.to - pic.E.from) / E.chars) + ' of the engine, once. It left ' + pic.V.vectors + ' vectors for the text model.', { layout: 'line', from: pic.E.from, to: pic.E.to }) : null,
        stop('It reads', pic ? 'Then the question comes in, letter by letter, through these two commas.' : 'First the question comes in, letter by letter, through this one comma.', { layout: 'line', at: pic ? E.commaAll[1] : E.comma, z: 5 }),
        stop('Letters become word pieces', 'This stretch reads the question and cuts it into word pieces, by looking pairs up in the vocabulary table.', { layout: 'line', from: sec('ask').from, to: sec('ask').to }),
        stop('A row of numbers', 'For every word piece the engine fetches one row of ' + fmt(n.dim) + ' numbers from the table of word pieces.', { layout: 'line', from: sec('emb').from, to: sec('emb').to }),
        stop(Q35 ? 'Four layers' : 'One layer', LT.text, { layout: 'line', from: LT.from, to: LT.to }),
        Q35 ? stop('Writing into a table', 'A DeltaNet layer does not look back. For each of its ' + n.deltanet.valueHeads + ' heads this text fades a table of ' + fmt(n.deltanet.keySize * n.deltanet.valueSize) + ' numbers, writes the new word piece into it and reads from it.', { layout: 'line', from: sec('dn.decay').from, to: sec('dn.next').to }) : null,
        pic ? null : stop('Text and time', 'Text is not time. Below the engine lie the steps of one word piece, as measured: a band joins each section to its share.', { layout: 'time', home: true }),
        stop('The largest matrix', SEC.sweep3.desc, { layout: 'line', from: sec('sweep3').from, to: sec('sweep3').to }),
        stop('Looking back', 'The engine walks past every word piece it has seen so far and takes something from each. This is how the model remembers the conversation.' + (Q35 ? ' Here only one layer in four does it.' : ''), { layout: 'line', from: sec('att').from, to: sec('att').to }),
        stop('Choosing', 'A score for each of the ' + fmt(n.vocab) + ' word pieces; the highest wins.', { layout: 'line', from: sec('cls').from, to: sec('cls').to }),
        stop('Loops inside loops', 'The same stretch as a skyline: the height is how many loops lie inside one another. The engine goes up to ' + W.counts.maxDepthEngine + '.', { layout: 'skyline', from: W.program.writer, to: total }),
        stop('It prints', 'The chosen word piece goes out through this one full stop. Then the engine goes round again for the next piece.', { layout: 'line', at: E.dot, z: 5 }),
      ].filter(Boolean) },
    ];
    if (pic) {
      const V = pic.V, wl = pic.layer(pic.mid);
      tours.splice(1, 0, { id: 'picture', title: 'How the program looks at a picture', text: 'The vision part of the model: its numbers, then the text that runs once over the ' + V.squares + ' squares, before the question.', stops: [
        stop('The picture part', 'At the far end of the writing part lie the numbers of the vision part of the model: ' + short(pic.W.to - pic.W.from) + ' characters.', { layout: 'line', mode: 'purpose', from: pic.W.from, to: pic.W.to }),
        wl ? stop('Its own layers', 'Picture layer ' + pic.mid + ' of ' + V.layers + ': four matrices of weights, and a slot for every square.', { layout: 'fold', from: wl.from, to: wl.to }) : null,
        stop('Looking at the picture', 'In the engine, before anything about the question: the text of the picture part, in ' + (V.layers + 1) + ' rounds, each written out.', { layout: 'line', from: pic.E.from, to: pic.E.to }),
        stop('A square comes in', 'Its ' + fmt(V.squareBytes) + ' bytes come in through this comma, one by one: red, green and blue of ' + V.patch * V.patch + ' pixels.', { layout: 'line', at: E.commaAll[0], z: 5 }),
        stop('Its numbers', 'The bytes times the weights of the squares: ' + fmt(V.dim) + ' numbers for the square, added to where it lies in the picture.', { layout: 'line', from: pic.patch.from, to: pic.patch.to }),
        stop('Every square looks at every square', 'With its question in hand a square walks past all ' + V.squares + ' slots, before and after it.', { layout: 'line', from: pic.see.from, to: pic.see.to }),
        stop('Four squares, one word piece', 'After the last layer every ' + V.perVector + ' squares become one vector of ' + fmt(V.out) + ' numbers, the width of the text model.', { layout: 'line', from: pic.merger.from, to: pic.merger.to }),
        stop('The long walk back', 'Done: ' + fmt(pic.walk.longestMove) + ' steps to the left in one run, from the far end of memory to the vocabulary.', { layout: 'line', from: pic.walk.from, to: pic.walk.to }),
        stop('Then the question', 'Now the question is read, and the text model goes through the prompt. At each of its ' + V.vectors + ' word pieces of the picture it takes one of the vectors instead of a row of the table.', { layout: 'line', from: sec('ask').from, to: sec('ask').to }),
      ].filter(Boolean) });
    }
    const cmp = flat.filter((p) => p.cmp);
    if (cmp.length) tours.push({ id: 'compare', title: 'Spot the difference between the four programs', text: 'What changes between brnfck-smollm2-135m, the two Qwen2.5 programs and brnfck-qwen3.5-0.8b, and what stays the same. Shown on ' + I.MODELS[I.MODEL].short + ', with the numbers of all four.', stops: cmp.map((p) => Object.assign({}, p, { place: p })) });
  }
  function drawTours() {
    const ul = $('m-tours'); ul.textContent = '';
    tours.forEach((t) => {
      const li = el('li'), b = el('button', 'quiet', 'Start this tour'); b.type = 'button'; b.setAttribute('aria-label', 'Start this tour: ' + t.title);
      b.addEventListener('click', () => startTour(t)); t.btn = b;
      li.append(el('h3', '', t.title), el('p', 'muted small', t.text + ' ' + t.stops.length + ' stops.'), b); ul.append(li);
    });
  }
  const stopSeconds = (s) => 4500 + 55 * s.text.length;                 // time to read a stop when the tour plays by itself
  function showStop(i, quiet) {
    if (!tour) return;
    const t = tour.t, s = t.stops[i]; tour.i = i; clearTimeout(tourTimer); now = 'tour';
    say('m-tour-count', 'Stop ' + (i + 1) + ' of ' + t.stops.length); const pr = $('m-tour-prog'); pr.max = t.stops.length; pr.value = i + 1;
    say('m-tour-text', s.text); flash('m-tour-text'); flash('m-now-title');
    const also = $('m-tour-also'); also.hidden = true; if (s.place) fillAlso(also, s.place);
    $('m-tour-prev').disabled = i === 0; $('m-tour-next').textContent = i === t.stops.length - 1 ? 'Done' : 'Next';
    [...$('m-tour-stops').children].forEach((li, k) => { const b = li.firstChild; if (k === i) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
    setNow();
    if (!quiet) announce('Stop ' + (i + 1) + ' of ' + t.stops.length + ': ' + s.title + '. ' + s.text);
    M.goTo(s, { then: () => { if (tour && tour.auto && tour.i === i && i < t.stops.length - 1) tourTimer = setTimeout(() => { if (tour && tour.auto && tour.i === i) showStop(i + 1); }, stopSeconds(s)); else if (tour && tour.auto && tour.i === i) setAuto(false); } });
  }
  function startTour(t) {
    endTour(true); current = null; markCurrent();
    tour = { t, i: 0, auto: false };
    say('m-tour-name', 'Tour: ' + t.title);
    const ol = $('m-tour-stops'); ol.textContent = '';
    t.stops.forEach((s, k) => { const li = el('li'), b = el('button'); b.append(el('b', '', s.title)); b.type = 'button'; b.addEventListener('click', () => { setAuto(false); showStop(k); }); li.append(b); ol.append(li); });
    $('m-tour').hidden = false; $('m-tour-play').hidden = calm(); $('m-tour-calm').hidden = !calm(); setAuto(false);
    showTab($('t-tours'));
    showStop(0);
    if (isSheet()) { setSheet('peek', true); $('m-now-title').focus({ preventScroll: true }); }
    else { $('p-tours').scrollTop = 0; $('m-tour-next').focus({ preventScroll: true }); }
  }
  function endTour(quiet) {
    if (!tour) return; clearTimeout(tourTimer); const t = tour.t; tour = null; $('m-tour').hidden = true; now = 'place'; setNow();
    if (!quiet) { announce('The tour has stopped. The map stays where it is.'); if (isSheet()) $('m-grip').focus(); else if (t.btn) t.btn.focus(); }
  }
  function tourStep(by) {
    if (!tour) return; setAuto(false);
    const i = tour.i + by; if (i < 0) return;
    if (i >= tour.t.stops.length) endTour(); else showStop(i);
  }
  function setAuto(yes) {
    if (!tour) return; if (yes && calm()) yes = false;
    tour.auto = yes; clearTimeout(tourTimer);
    const b = $('m-tour-play'); b.setAttribute('aria-pressed', String(yes)); b.textContent = yes ? 'Pause' : 'Play by itself';
    const nb = $('m-now-play'); nb.setAttribute('aria-pressed', String(yes)); nb.textContent = yes ? 'Pause' : 'Play';
  }
  function toggleAuto() { if (!tour) return; const yes = !tour.auto; setAuto(yes); announce(yes ? 'The tour plays by itself. Press Pause to stop it.' : 'The tour is paused.'); if (yes) { if (tour.i >= tour.t.stops.length - 1) showStop(0); else tourTimer = setTimeout(() => { if (tour && tour.auto) showStop(tour.i + 1); }, 1200); } }
  function pauseTour() { if (tour && tour.auto) { setAuto(false); } }
  on('m-tour-next', 'click', () => tourStep(1)); on('m-tour-prev', 'click', () => tourStep(-1));
  on('m-tour-play', 'click', toggleAuto); on('m-tour-stop', 'click', () => endTour());

  // ---- go to a character, copy a link
  on('m-goto', 'submit', (e) => {
    e.preventDefault();
    const box = $('m-goto-n'), raw = box.value.replace(/[\s,.  ']/g, ''), v = /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!(v >= 1 && v <= M.total)) { box.setAttribute('aria-invalid', 'true'); say('m-goto-err', raw === '' ? 'Type the number of a character first: a whole number from 1 to ' + fmt(M.total) + '.' : 'That is not a character of this program. Type a whole number from 1 to ' + fmt(M.total) + ', for example ' + fmt(Math.round(M.total / 2)) + '.'); box.focus(); return; }
    box.removeAttribute('aria-invalid'); say('m-goto-err', ''); pauseTour();
    if (M.view.tree) M.setLayout(M.view.layout);
    M.flyToChar(v - 1, Math.max(4, Math.min(M.view.zMax, Math.round(M.view.z))), () => { const i = M.info(v - 1); announce('Character ' + fmt(v) + ' is in the middle of the map, in the white frame. ' + i.part + ': ' + i.title + '.'); });
    if (isSheet()) setSheet('peek', true);
  });
  on('m-goto-n', 'input', () => { if ($('m-goto-n').hasAttribute('aria-invalid')) { $('m-goto-n').removeAttribute('aria-invalid'); say('m-goto-err', ''); } });
  on('m-link', 'click', async () => {
    if (!current && !M.view.tree) history.replaceState(null, '', M.hashNow());
    let t; try { await navigator.clipboard.writeText(location.href); t = 'The link is copied. It opens the map at this view.'; } catch (e) { t = 'The link could not be copied by the page. It is in the address bar: ' + location.href; }
    say('m-link-said', t); flash('m-link-said');
  });

  // ---- start
  setSheet('peek', true); arrange();
  on('m-first-tour', 'click', () => { if (tours[0]) startTour(tours[0]); });
  const byId = (id) => flat.find((p) => p.id === id);
  const fromHash = (jump) => { const m = /^#preset=([a-z0-9-]+)$/.exec(location.hash), p = m && byId(m[1]); if (p) applyPlace(p, { jump, stay: true }); return !!p; };
  M.started.then(async () => {
    let C = null; try { C = await I.get('/compare.json'); } catch (e) { }
    makePlaces(C); drawPlaces(); makeTours(); drawTours();
    if (!fromHash(true)) { if (!location.hash) { current = flat[0]; lastPlace = flat[0]; markCurrent(); } else lastPlace = null; }
    setNow();
    window.addEventListener('hashchange', () => { if (!fromHash(false) && current) { current = null; markCurrent(); } });      // an address that is not a place: no place is "here"
    M.refresh();
  }).catch((e) => { console.error(e); });
  M.ready.catch(() => {
    const t = 'The data for ' + I.MODELS[I.MODEL].short + ' is not hosted here. Choose another program above, or build the program and its data on your own computer (README, steps 3 and 5).';
    $('m-places').textContent = ''; $('m-places').append(el('p', 'callout warn', t)); say('m-where', t); say('m-now-title', 'No data for this program'); say('m-now-text', t);
    ['m-now-prev', 'm-now-next', 'm-readbtn'].forEach((id) => { $(id).hidden = true; });
  });
})();
