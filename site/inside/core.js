// What the pages about the inside of a program share: which program, its data, the names of its parts.
(function () {
  'use strict';
  const HERE = new URL('.', document.currentScript.src).href;            // .../inside/
  const LIGHT = !!(window.InsideOptions && window.InsideOptions.light);
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const pct = (x, d = 1) => (100 * x).toFixed(d) + '%';
  const short = (n) => n >= 1e12 ? (n / 1e12).toFixed(1) + ' trillion' : n >= 1e9 ? (n / 1e9).toFixed(2) + ' billion' : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + ' million' : fmt(n);
  const minus = (v) => String(v).replace('-', '−');

  // ---- which program
  const MODELS = {
    small: { short: 'brnfck-smollm2-135m', built: 'in about a minute' },
    '0.5b': { short: 'brnfck-qwen2.5-0.5b', built: 'in about two and a half minutes' },
    '1.5b': { short: 'brnfck-qwen2.5-1.5b', built: 'in about seven minutes' },
    '0.8b': { short: 'brnfck-qwen3.5-0.8b', built: 'in about six and a half minutes' },
    '0.8b-vision': { short: 'brnfck-qwen3.5-0.8b-vision' },
  };
  const MODEL = MODELS[document.documentElement.getAttribute('data-model')] ? document.documentElement.getAttribute('data-model') : '1.5b';     // brnfck-qwen2.5-1.5b, the largest, is the one a page shows when nothing is asked
  const VIS = MODEL === '0.8b-vision', QWEN = MODEL !== 'small', Q35 = MODEL === '0.8b' || VIS, ROOT = new URL('..', HERE).href;      // Q35: Qwen3.5, with DeltaNet layers; VIS: and its vision part
  let DATA = HERE + 'data/' + MODEL + '/';
  const dataBase = fetch(HERE + 'data-hosts.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({})).then((h) => { if (h && typeof h[MODEL] === 'string' && h[MODEL]) DATA = new URL(h[MODEL], HERE).href; });
  const FILES = { small: ['programs/brnfck-smollm2-135m.meta.json', 'programs/brnfck-smollm2-135m.bf'], '0.5b': ['programs/brnfck-qwen2.5-0.5b.meta.json', 'programs/brnfck-qwen2.5-0.5b.bf'], '1.5b': ['programs/brnfck-qwen2.5-1.5b.meta.json', 'programs/brnfck-qwen2.5-1.5b.bf'], '0.8b': ['programs/brnfck-qwen3.5-0.8b.meta.json', 'programs/brnfck-qwen3.5-0.8b.bf'], '0.8b-vision': ['programs/brnfck-qwen3.5-0.8b-vision.meta.json', 'programs/brnfck-qwen3.5-0.8b-vision.bf'] };
  let programP = null;
  const program = (model = MODEL) => { const go = () => (window.ProgramStart ? window.ProgramStart.find({ name: model, manifestUrl: ROOT + 'dist/' + model + '/manifest.json', metaUrl: ROOT + FILES[model][0], fileUrl: ROOT + FILES[model][1], hostsUrl: ROOT + 'program-hosts.json' }).catch(() => null) : Promise.resolve(null)); if (model !== MODEL) return go(); return programP || (programP = go()); };
  // a word of data-only: a program, 'smol', 'qwen' (the programs of Qwen2.5 and Qwen3.5) or 'qwen2' (the programs of Qwen2.5)
  const mine = (only) => only.split(/\s+/).some((t) => t === MODEL || (t === 'qwen' && QWEN) || (t === 'qwen2' && QWEN && !Q35) || (t === 'smol' && !QWEN));
  document.querySelectorAll('[data-only]').forEach((n) => { if (!mine(n.getAttribute('data-only'))) n.remove(); });
  const switches = [...document.querySelectorAll('#modelbar a[data-m], #choose a[data-m]')];
  const heads = () => [...document.querySelectorAll('main h2[id]')];
  const here = () => { let id = ''; for (const h of heads()) { if (h.getBoundingClientRect().top < window.innerHeight * 0.4) id = h.id; else break; } return id; };
  const setSwitches = () => { const id = here(); switches.forEach((a) => { a.href = '?m=' + a.dataset.m + (id ? '#' + id : ''); }); };
  switches.forEach((a) => { if (a.dataset.m === MODEL) a.setAttribute('aria-current', 'page'); a.addEventListener('click', setSwitches); a.addEventListener('focus', setSwitches); a.addEventListener('pointerenter', setSwitches); });
  setSwitches();
  let st = 0; window.addEventListener('scroll', () => { clearTimeout(st); st = setTimeout(setSwitches, 150); }, { passive: true });
  // the switch opens a list (ui/progpick.css); a press outside it or Escape closes the list again
  document.querySelectorAll('.progpick details').forEach((d) => {
    document.addEventListener('pointerdown', (e) => { if (d.open && !d.contains(e.target)) d.open = false; });
    d.addEventListener('keydown', (e) => { if (e.key === 'Escape' && d.open) { e.stopPropagation(); d.open = false; d.querySelector('summary').focus(); } });
  });

  // ---- data
  const cache = new Map();
  const get = (name, kind) => {
    const url = name[0] === '/' ? HERE + 'data' + name : DATA + name;                 // "/x": shared by all programs
    if (!cache.has(url)) cache.set(url, dataBase.then(() => fetch(name[0] === '/' ? url : DATA + name)).then((r) => { if (!r.ok) throw new Error('could not load ' + url + ' (' + r.status + ')'); return kind === 'buf' ? r.arrayBuffer() : r.json(); }));
    return cache.get(url);
  };
  const json = (name) => get(name + '.json');

  // ---- colours
  const probe = document.createElement('i'); probe.style.display = 'none'; document.body.append(probe);
  const seen = new Map();
  const rgbOf = (name) => {
    if (seen.has(name)) return seen.get(name);
    probe.style.color = 'var(' + name + ')';
    const v = getComputedStyle(probe).color, n = (v.match(/-?[\d.]+(e-?\d+)?/g) || []).map(Number);
    const c = /^color\(/.test(v) ? n.slice(0, 3).map((x) => Math.round(255 * Math.max(0, Math.min(1, x)))) : n.length >= 3 ? n.slice(0, 3).map(Math.round) : [136, 136, 136];
    seen.set(name, c); return c;
  };
  const cssVar = (name) => 'rgb(' + rgbOf(name).join(',') + ')';
  const themeFns = [];
  const onTheme = (fn) => themeFns.push(fn);
  if (window.matchMedia) { const mq = matchMedia('(prefers-color-scheme: dark)'); const f = () => themeFns.forEach((x) => x()); if (mq.addEventListener) mq.addEventListener('change', f); }

  // A canvas that is as sharp as the screen: returns a context in CSS pixels.
  const fit = (canvas) => {
    const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h, dpr };
  };
  const redrawers = [];
  const onResize = (fn) => { redrawers.push(fn); };
  let rt = 0;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => redrawers.forEach((f) => f()), 120); });
  themeFns.unshift(() => seen.clear());
  onTheme(() => redrawers.forEach((f) => f()));
  if (window.MutationObserver) new MutationObserver(() => themeFns.forEach((x) => x())).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  document.addEventListener('toggle', (e) => { const d = e.target; if (d.open && d.querySelector && d.querySelector('canvas')) { clearTimeout(rt); rt = setTimeout(() => redrawers.forEach((f) => f()), 30); } }, true);

  // ---- names
  const FAM = {
    out: { v: '--k-out', name: 'Output table', letter: 'O' },
    att: { v: '--k-att', name: 'Attention', letter: 'A' },
    att2: { v: '--k-att2', name: 'Attention, output', letter: 'A' },
    dn: { v: '--k-dn', name: 'DeltaNet', letter: 'D' },
    dn2: { v: '--k-dn2', name: 'DeltaNet, output', letter: 'D' },
    mem: { v: '--k-mem', name: 'Memory of earlier pieces', letter: 'M' },
    ff: { v: '--k-ff', name: 'Feed-forward', letter: 'F' },
    ff2: { v: '--k-ff2', name: 'Feed-forward, back', letter: 'F' },
    emb: { v: '--k-emb', name: 'Table of word pieces', letter: 'W' },
    text: { v: '--k-text', name: 'Text in and out', letter: 'T' },
    tidy: { v: '--k-tidy', name: 'Scaling and rounding', letter: 'S' },
    work: { v: '--k-work', name: 'Walking and free cells', letter: '·' },
    pic: { v: '--k-pic', name: 'Picture part', letter: 'P' },
    pic2: { v: '--k-pic2', name: 'Picture part, output and memory', letter: 'P' },
  };
  const LEGEND = [['out', 'Output table'], ['att', 'Attention'], ...(Q35 ? [['dn', 'DeltaNet']] : []), ['mem', 'Memory of earlier pieces'], ['ff', 'Feed-forward'], ['emb', 'Table of word pieces'], ['text', 'Text in and out'], ...(VIS ? [['pic', 'Picture part: looks at the picture']] : []), ['tidy', 'Scaling and rounding'], ['work', 'Walking and free cells']];
  // A swatch always carries the letter of its family, so colour is never the only sign.
  const swatch = (fam) => { const s = el('i', fam === 'att2' || fam === 'ff2' || fam === 'dn2' || fam === 'pic2' ? 'sw tint' : 'sw', FAM[fam].letter); s.style.background = 'var(' + FAM[fam].v + ')'; s.setAttribute('aria-hidden', 'true'); return s; };
  const blockSpan = (t) => el('span', '', t);
  const clearRows = (tbl) => tbl.querySelectorAll('tr').forEach((r) => r.remove());
  const KIND = {
    cls: { fam: 'out', name: 'Output table' }, qkv: { fam: 'att', name: 'Attention weights' }, o: { fam: 'att2', name: 'Attention output weights' },
    slots: { fam: 'mem', name: 'Memory slots' }, w13: { fam: 'ff', name: 'Feed-forward weights, widening' }, w2: { fam: 'ff2', name: 'Feed-forward weights, back' },
    emb: { fam: 'emb', name: 'Table of word pieces' }, tokbytes: { fam: 'text', name: QWEN ? 'Tables of bytes' : 'Table of letters' }, tokids: { fam: 'text', name: 'Work space for the question' },
    toktable: { fam: 'text', name: 'Vocabulary' }, glob: { fam: 'work', name: 'Counters' }, work: { fam: 'work', name: 'Free cells' },
    bias: { fam: 'tidy', name: 'Strips of constants: bias' }, scale: { fam: 'tidy', name: 'Strips of constants: scale per row' }, gain: { fam: 'tidy', name: 'Strips of constants: gain' },
    // the DeltaNet layers of brnfck-qwen3.5-0.8b
    lin: { fam: 'dn', name: 'DeltaNet weights' }, lino: { fam: 'dn2', name: 'DeltaNet output weights' }, conv: { fam: 'dn', name: 'DeltaNet: convolution weights' },
    state: { fam: 'mem', name: 'DeltaNet: tables of the heads' }, dscale: { fam: 'mem', name: 'DeltaNet: scale of a table' }, convwin: { fam: 'mem', name: 'DeltaNet: the last three word pieces' },
    dconst: { fam: 'tidy', name: 'Strips of constants: forgetting' },
    // the vision part of brnfck-qwen3.5-0.8b-vision
    vpos: { fam: 'pic', name: 'Picture part: where each square lies' }, vpatch: { fam: 'pic', name: 'Picture part: weights of the squares' },
    vqkv: { fam: 'pic', name: 'Picture part: attention weights' }, vo: { fam: 'pic2', name: 'Picture part: attention output weights' },
    vw13: { fam: 'pic', name: 'Picture part: feed-forward weights' }, vw2: { fam: 'pic2', name: 'Picture part: feed-forward weights, back' },
    vslots: { fam: 'pic2', name: 'Picture part: a slot for every square' }, vm1: { fam: 'pic', name: 'Picture part: merger weights' },
    vm2: { fam: 'pic2', name: 'Picture part: merger weights, out' }, vqueue: { fam: 'pic2', name: 'Picture part: the vectors for the text' },
  };
  // the layers of the picture program's vision part are numbered 100 and on in writer.json; -2 is the vision part as a whole
  const layerNo = (l) => (l >= 100 ? 'Picture layer ' + (l - 99) : 'Layer ' + (l + 1));
  const layerAbbr = (l) => (l >= 100 ? 'P' + (l - 99) : 'L' + (l + 1));
  let EJ = null, WJ = null;                       // engine.json and writer.json of this program (set in `ready`)
  const MATRIX = {
    qkv: Q35 ? 'the first matrix (question, key, gate, value)' : 'the first matrix (question, key, value)', o: 'the attention output matrix', w13: 'the widening matrix', w2: 'the matrix that brings the numbers back', lin: 'the first matrix of the DeltaNet layer', lino: 'the DeltaNet output matrix',
    vqkv: 'the first matrix of this layer (question, key, value)', vo: 'the attention output matrix of this layer', vw13: 'the widening matrix of this layer', vw2: 'the matrix of this layer that brings the numbers back', vpatch: 'the weights of the squares', vm1: 'the first matrix of the merger', vm2: 'the last matrix of the merger',
  };
  const GAIN = {
    first: 'used when the numbers are scaled at the start of layer 1', ffn: 'used when the numbers are scaled before the feed-forward part of this layer', next: 'used when the numbers are scaled after this layer', qk: 'used when every head of the questions and keys is brought to a common size', gated: 'used when the output of every head is brought to a common size',
    vfirst: 'used when the numbers of a square are scaled at the start of picture layer 1', vffn: 'used when the numbers of a square are scaled before the feed-forward part of this layer', vnext: 'used when the numbers of a square are scaled after this layer (after the last layer: before the merger)',
  };
  const where = (r) => (r.layer === -2 ? 'Picture part' : layerNo(r.layer));
  const regionTitle = (r) => {
    const d = (rows, cols) => ' (' + fmt(rows) + ' × ' + fmt(cols) + ')', m = EJ.model;
    switch (r.kind) {
      case 'cls': return 'Output table, part ' + (r.layer + 1) + ' of ' + m.chunks + d(r.rows, r.cols);
      case 'qkv': return layerNo(r.layer) + ': attention weights' + d(r.rows, r.cols);
      case 'o': return layerNo(r.layer) + ': attention output weights' + d(r.rows, r.cols);
      case 'w13': return layerNo(r.layer) + ': feed-forward weights, widening' + d(r.rows, r.cols);
      case 'w2': return layerNo(r.layer) + ': feed-forward weights, back' + d(r.rows, r.cols);
      case 'slots': return layerNo(r.layer) + ': memory of earlier word pieces (' + m.maxTokens + ' slots)';
      case 'lin': return layerNo(r.layer) + ': DeltaNet weights' + d(r.rows, r.cols);
      case 'lino': return layerNo(r.layer) + ': DeltaNet output weights' + d(r.rows, r.cols);
      case 'conv': return layerNo(r.layer) + ': convolution weights (' + fmt(r.n) + ' numbers)';
      case 'convwin': return layerNo(r.layer) + ': the last three word pieces (' + fmt(r.n) + ' cells)';
      case 'state': return layerNo(r.layer) + ': the table of head ' + (r.head + 1) + ' (' + fmt(r.cols) + ' × ' + fmt(r.rows) + ' numbers)';
      case 'dscale': return layerNo(r.layer) + ': the scale of the table of head ' + (r.head + 1);
      case 'dconst': return layerNo(r.layer) + ': strip of constants, ' + (r.what === 'dt' ? 'a shift for how fast each head forgets' : 'the forgetting rate of each head') + ' (' + fmt(r.n) + ' numbers)';
      case 'vpos': return 'Picture part: the position of every square (' + fmt(r.squares) + ' vectors)';
      case 'vpatch': return 'Picture part: the weights of the squares' + d(r.rows, r.cols);
      case 'vqkv': return layerNo(r.layer) + ': attention weights' + d(r.rows, r.cols);
      case 'vo': return layerNo(r.layer) + ': attention output weights' + d(r.rows, r.cols);
      case 'vw13': return layerNo(r.layer) + ': feed-forward weights, widening' + d(r.rows, r.cols);
      case 'vw2': return layerNo(r.layer) + ': feed-forward weights, back' + d(r.rows, r.cols);
      case 'vslots': return layerNo(r.layer) + ': a slot for every square (' + fmt(r.slots) + ' slots)';
      case 'vm1': return 'Picture part: merger, first matrix' + d(r.rows, r.cols);
      case 'vm2': return 'Picture part: merger, last matrix' + d(r.rows, r.cols);
      case 'vqueue': return 'Picture part: the ' + fmt(r.vectors) + ' vectors for the text model';
      case 'emb': return 'Table of word pieces' + d(r.rows, r.cols);
      case 'tokbytes': return QWEN ? 'Vocabulary: tables of bytes' : 'Vocabulary: table of letters';
      case 'tokids': return 'Vocabulary: work space for the question';
      case 'toktable': return QWEN ? 'Vocabulary: the joining rules of the word pieces' : 'Vocabulary: the text of every word piece and the joining rules';
      case 'glob': return 'Counters of the engine';
      case 'bias': return where(r) + ': strip of constants, the bias (' + fmt(r.n) + ' numbers)';
      case 'scale': return where(r) + ': strip of constants, a scale for every row (' + fmt(r.n) + ' numbers)';
      case 'gain': return where(r) + ': strip of constants, gains (' + fmt(r.n) + ' numbers)';
      default: return r.layer >= 0 ? layerNo(r.layer) + ': free cells' : r.layer === -2 ? 'Picture part: free cells' : 'Free cells';
    }
  };
  const regionShort = (r) => {
    switch (r.kind) {
      case 'cls': return 'Output table ' + (r.layer + 1) + '/' + EJ.model.chunks;
      case 'qkv': return 'L' + (r.layer + 1) + ' attention';
      case 'o': return 'L' + (r.layer + 1) + ' att. out';
      case 'w13': return 'L' + (r.layer + 1) + ' feed-forward';
      case 'w2': return 'L' + (r.layer + 1) + ' ff. back';
      case 'slots': return 'L' + (r.layer + 1) + ' memory';
      case 'lin': return 'L' + (r.layer + 1) + ' DeltaNet';
      case 'lino': return 'L' + (r.layer + 1) + ' DN out';
      case 'state': return 'L' + (r.layer + 1) + ' table ' + (r.head + 1);
      case 'conv': case 'convwin': case 'dscale': case 'dconst': return 'L' + (r.layer + 1) + ' ' + KIND[r.kind].name.replace(/^.*: /, '');
      case 'emb': return 'Table of word pieces';
      case 'toktable': return 'Vocabulary';
      case 'bias': return (r.layer === -2 ? 'Picture' : layerAbbr(r.layer)) + ' bias';
      case 'scale': return (r.layer === -2 ? 'Picture' : layerAbbr(r.layer)) + ' scales';
      case 'gain': return (r.layer === -2 ? 'Picture' : layerAbbr(r.layer)) + ' gains';
      case 'vqkv': return layerAbbr(r.layer) + ' attention';
      case 'vo': return layerAbbr(r.layer) + ' att. out';
      case 'vw13': return layerAbbr(r.layer) + ' feed-forward';
      case 'vw2': return layerAbbr(r.layer) + ' ff. back';
      case 'vslots': return layerAbbr(r.layer) + ' slots';
      case 'vpos': return 'Positions of squares';
      case 'vpatch': return 'Squares in';
      case 'vm1': case 'vm2': return 'Merger';
      case 'vqueue': return 'Vectors out';
      default: return KIND[r.kind].name;
    }
  };
  const regionSays = (r) => {
    const m = EJ.model, M = EJ.matrices, lay = EJ.layout, fixed = WJ.fixedSlots;
    switch (r.kind) {
      case 'cls': return QWEN
        ? 'One part of the output table: the rows of word pieces ' + fmt(r.layer * r.rows) + ' to ' + fmt((r.layer + 1) * r.rows - 1) + '. They turn the final ' + fmt(m.dim) + ' numbers into a score for each of those pieces. The numbers are those of the table of word pieces, written a second time in the order this search needs.'
        : 'These weights turn the final ' + fmt(m.dim) + ' numbers into a score for word pieces ' + fmt(r.layer * r.rows) + ' to ' + fmt((r.layer + 1) * r.rows - 1) + '.';
      case 'qkv': return Q35 ? 'These weights make four things out of the running numbers of a word piece: a question, a key, a gate for the question and a value. Attention works with those.' : 'These weights make three things out of the running numbers of a word piece: a question, a key and a value. Attention works with those.';
      case 'o': return 'These weights mix what attention has collected back into the running numbers.';
      case 'w13': return 'These weights widen the ' + fmt(m.dim) + ' running numbers to ' + fmt(M.w13.rows) + ' (two sets of ' + fmt(m.hidden) + ').';
      case 'w2': return 'These weights bring ' + fmt(m.hidden) + ' products back to ' + fmt(m.dim) + ' numbers.';
      case 'slots': return fixed ? 'The key and the value of every word piece read so far. The ' + fixed + ' pieces of the fixed opening lines are filled in by the program text; the other ' + (m.maxTokens - fixed) + ' slots are empty until the program runs.'
        : 'The key and the value of every word piece read so far, one slot for each. Only ' + (m.layers - m.types.filter((t) => t === 'lin').length) + ' of the ' + m.layers + ' layers have slots. All ' + m.maxTokens + ' are empty until the program runs: this program keeps no opening lines in memory.';
      case 'lin': return 'These weights make, out of the running numbers of a word piece, the queries, keys and values of the ' + m.deltanet.valueHeads + ' heads, a gate, and for every head how much it forgets and how strongly it writes.';
      case 'lino': return 'These weights mix the output of the ' + m.deltanet.valueHeads + ' heads back into the running numbers.';
      case 'conv': return 'Four weights for each of the ' + fmt(m.deltanet.convDim) + ' numbers of the queries, keys and values: how much of this word piece and of each of the three before it goes into them.';
      case 'convwin': return 'The queries, keys and values of the last three word pieces, which the convolution needs again. Empty until the program runs; the same size however long the conversation.';
      case 'state': return 'Everything this head of this layer keeps of the conversation: ' + fmt(r.cols) + ' columns of ' + fmt(r.rows) + ' numbers, each column with room beside it to work in. Empty until the program runs, and the same size after the first word piece as after the last. Instead of looking back, the layer writes every word piece into this table and reads from it.';
      case 'dscale': return 'One number for the table of head ' + (r.head + 1) + ': the scale the whole table is read at. Fading the table multiplies this number, not the ' + fmt(m.deltanet.keySize * m.deltanet.valueSize) + ' numbers of the table.';
      case 'dconst': return r.what === 'dt' ? 'One constant for every head: it is added to the input that says how fast the head forgets.' : 'One constant for every head, as a logarithm: how fast the head forgets for a given input.';
      case 'emb': return 'One row of ' + fmt(m.dim) + ' numbers for each of the ' + fmt(m.vocab) + ' word pieces. The first thing the engine does with a word piece is fetch its row.' + (VIS ? ' The row of the word piece that stands for a piece of the picture is all zeros: at that word piece a vector of the picture part rides along and is added instead.' : '');
      case 'vpos': return 'One vector of ' + fmt(m.vision.dim) + ' numbers for each of the ' + fmt(m.vision.squares) + ' squares of ' + m.vision.patch + ' × ' + m.vision.patch + ' pixels: where the square lies in the picture, with the bias of the weights of the squares. The run of the picture part starts every square from its vector.';
      case 'vpatch': return 'The ' + fmt(m.vision.squareBytes) + ' bytes of a square (red, green and blue of its ' + (m.vision.patch * m.vision.patch) + ' pixels) times these weights give its ' + fmt(m.vision.dim) + ' numbers.';
      case 'vqkv': return 'These weights make three things out of the numbers of a square: a question, a key and a value.';
      case 'vo': return 'These weights mix what attention has collected from all ' + fmt(m.vision.squares) + ' squares back into the numbers of a square.';
      case 'vw13': return 'These weights widen the ' + fmt(m.vision.dim) + ' numbers of a square to ' + fmt(m.vision.hidden) + '.';
      case 'vw2': return 'These weights bring the ' + fmt(m.vision.hidden) + ' numbers back to ' + fmt(m.vision.dim) + '.';
      case 'vslots': return 'One slot for each of the ' + fmt(m.vision.squares) + ' squares, with room for its key and its value, its question and its numbers. Empty until the program runs. Here every square looks at every other square, before and after it: in one round all squares store their key and value, in the next all of them read every slot.';
      case 'vm1': return 'The merger joins every ' + m.vision.perVector + ' neighbouring squares into one: their ' + fmt(m.vision.perVector * m.vision.dim) + ' numbers times these weights.';
      case 'vm2': return 'The last matrix of the merger: ' + fmt(m.vision.matrices.m2.cols) + ' numbers to ' + fmt(m.vision.out) + ', the width of the text model.';
      case 'vqueue': return 'Room for the ' + fmt(m.vision.vectors) + ' vectors of ' + fmt(m.vision.out) + ' numbers the picture part hands on. Empty until the program runs. The text model takes one of them at each of the ' + fmt(m.vision.vectors) + ' word pieces of the picture in the prompt.';
      case 'tokbytes': return QWEN
        ? 'For each possible byte: its word piece number and what kind of character it is. Characters of more than one byte have further tables of 64 entries. ' + fmt(lay.tokByteRecords) + ' records in all.'
        : 'For each of the 255 possible letter codes: its word piece number and what kind of character it is.';
      case 'tokids': return 'Where the question is cut into word pieces, and the fixed pieces that go around it.';
      case 'toktable': return QWEN
        ? 'One table of ' + fmt(lay.tokRecords) + ' records of three cells, in blocks of ' + lay.tokHop + '. A record holds a joining rule (two pieces make a third) and says how to print one piece: as one byte, or as two smaller pieces. The text of a word piece is not stored; it is built from these rules.'
        : 'One table of ' + fmt(lay.tokRecords) + ' records. It holds the text of every word piece (for printing) and the rules for joining letters into pieces (for reading).';
      case 'glob': return 'The current word piece, the position, and a few counters.';
      case 'bias': return 'One constant for every row of ' + (r.vision ? MATRIX[r.what] || 'a matrix' : 'the first matrix of this layer (question, key, value)') + '. It is added to the total of its row before the total is rounded.';
      case 'scale': return 'For every row of ' + (MATRIX[r.what] || 'a matrix') + ': how many times the total of that row is doubled before it is rounded. Every row of weights was stored at its own scale, so that ' + m.weightBits + ' bits per weight are enough. For most rows the number is 0.';
      case 'gain': return 'One multiplier for each of the ' + (r.vision ? fmt(m.vision.dim) + ' numbers of a square' : fmt(m.dim) + ' running numbers') + ', ' + (GAIN[r.what] || 'used when the numbers are scaled') + '.';
      default: return 'Cells with nothing stored in them. The engine uses them as work space while it runs.';
    }
  };
  let SEC = null;
  const markLabel = (m) => {
    const i = m.info || {};
    switch (m.name) {
      case 'sweep': return 'Weights × numbers: ' + fmt(i.rows) + ' rows, ' + fmt(i.cols) + ' columns';
      case 'unsweep': return 'Put ' + fmt(i.cols) + ' columns back';
      case 'sweepEmb': return 'Fetch one row from the table of word pieces';
      case 'slide': return i.stride === 1 ? 'Walk over ' + fmt(i.n) + ' cells, the same code for each' : 'Walk over ' + fmt(i.n) + ' records, ' + i.stride + ' cells apart';
      case 'stripRight': case 'stripRight4': return 'Move a strip ' + fmt(i.dist) + ' cells along';
      case 'mul': case 'mulAcc': return 'Multiply two numbers (bit peel of ' + i.bits + ' bits)';
      case 'bitCount': return 'Count the bits of a number';
      case 'rqN': case 'rqSplit': case 'requantCore': return i.shift ? 'Divide by 2^' + i.shift + ', round, keep to ' + i.bits + ' bits' : 'Split off the sign, keep to ' + i.bits + ' bits';
      case 'switchTree': return 'Table lookup, ' + fmt(2 ** i.bits) + ' entries';
      case 'lookupBig': case 'lookup': return 'Table lookup, ' + fmt(i.entries) + ' entries';
      case 'peel': return 'Bit peel, ' + i.bits + ' bits';
      case 'emitEncode': return 'Read the question, cut it into word pieces';
      case 'emitPopId': return 'Take the next word piece number';
      case 'emitPrint': return 'Print the text of a word piece';
      default: return m.name;
    }
  };

  // ---- everything the whole page needs, loaded once
  const F = {};
  let TR = { main: null, long: null, names: [] };
  const lineFit = (xs, ys) => { const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n; let a = 0, b = 0; xs.forEach((x, i) => { a += (x - mx) * (ys[i] - my); b += (x - mx) * (x - mx); }); const k = b ? a / b : 0; return { k, c: my - k * mx }; };
  const words = (n) => ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'][n] || String(n);
  const billions = (a, b) => { const f = (v) => (v / 1e9).toFixed(v < 1e10 ? 1 : 0); return f(a) === f(b) ? f(a) + ' billion' : f(a) + ' to ' + f(b) + ' billion'; };
  const ready = dataBase.then(() => Promise.all([json('writer'), json('engine'), json('tiles'), LIGHT ? null : json('checks'), LIGHT ? [] : json('traces').catch(() => [])]).then(async ([W, E, TI, C, names]) => {
    WJ = W; EJ = E;
    W.fixedSlots = Q35 ? 0 : 24;          // the opening lines that are in memory before a question; brnfck-qwen3.5-0.8b has none
    SEC = window.EngineSections.of(E);
    TR.names = names;
    if (names.length) { TR.main = await json('trace-' + names[0]); TR.long = names.length > 1 ? await json('trace-' + names[names.length - 1]) : TR.main; W.fixedSlots = TR.main.fixedPositions; }
    const P = W.program, m = E.model, cells = (k) => W.regions.filter((r) => r.kind === k).reduce((a, r) => a + r.to - r.from, 0);
    const kindChars = (k) => W.stretches.reduce((a, s) => a + (W.regions[s[0]].kind === k ? s[2] - s[1] : 0), 0);
    Object.assign(F, {
      modelName: W.modelName || m.name,
      chars: fmt(P.chars), charsShort: short(P.chars), writer: fmt(P.writer), engine: fmt(P.engine), engineFrom: fmt(P.writer + 1),
      writerPct: pct(P.writer / P.chars), enginePct: pct(P.engine / P.chars), charsPerCell: (P.writer / W.tape.nonZero).toFixed(1), writerShort: short(P.writer),
      patches: fmt(TI.deep.writer.length),
      layers: String(m.layers), dim: fmt(m.dim), vocab: fmt(m.vocab), heads: String(m.heads), kvHeads: String(m.kvHeads), share: String(m.share || m.heads / m.kvHeads), chunks: String(m.chunks), chunk: fmt(m.chunk),
      qkvRows: fmt(E.matrices ? E.matrices.qkv.rows : m.dim + 2 * m.kvHeads * m.headSize),
      commaAt: fmt(E.comma + 1), commaInto: fmt(Math.round((E.comma - E.from) / 1000) * 1000),
      blocks: fmt(W.encoder.blocks), weightOffset: fmt(W.tape.weightOffset), nonZero: fmt(W.tape.nonZero),
      plainShort: short(W.tape.plainCounting), plainRatio: fmt(Math.round(W.tape.plainCounting / P.writer / 1000) * 1000), entropy: W.tape.entropyBitsPerCell.toFixed(2),
      floorShort: short(W.tape.floorCharsAt3Bits), floorRatio: (P.writer / W.tape.floorCharsAt3Bits).toFixed(1),
      tape: fmt(P.tape), longestWalk: fmt(Math.max(...E.sections.map((s) => s.longestMove))),
      sums: C ? fmt(C.tapeSums.length) : '', questionsWords: C ? words(C.questions.length) : '',
      tableTwicePct: pct((kindChars('cls') + kindChars('emb')) / P.chars, 0), tableTapePct: pct((cells('cls') + cells('emb')) / P.tape, 0),
      fileSize: (P.chars / 1e9).toFixed(P.chars < 2e9 ? 0 : 1) + ' GB', metaName: (W.file || TI.file || '').split('/').pop().replace(/\.bf$/, '.meta.json'),
      logName: C ? (C.from || [])[0] || '' : '',
      headSize: String(m.headSize), rotDim: String(m.rotDim || m.headSize),
    });
    if (m.deltanet) {          // brnfck-qwen3.5-0.8b: the DeltaNet layers
      const dl = m.types.filter((t) => t === 'lin').length;
      Object.assign(F, { dnLayers: String(dl), attLayers: String(m.layers - dl), groups: String(m.groups), dnHeads: String(m.deltanet.valueHeads), dnTable: fmt(m.deltanet.keySize) + ' × ' + fmt(m.deltanet.valueSize) });
    }
    const L = TR.long;
    if (L) {
      const a = L.positions[0].position, b = L.positions[L.positions.length - 1].position;
      F.traceLimit = 'The step counts come from one question, "' + L.question + '", and from ' + L.positions.length + ' positions of its run (' + a + ' to ' + b + ' of ' + m.maxTokens + '). ' + (L.complete ? 'That is the whole run. ' : 'The run was stopped there, before the answer was complete. ') + 'What a word piece costs later in a long conversation was not measured for this program; the one number given for it under "Where the time goes" is an estimate and is marked so.';
    } else F.traceLimit = 'No step counts were made for this program.';
    const dl = $('dl-program');
    if (dl) {
      const file = TI.file || W.file;
      const PG = await program();
      if (PG && window.ProgramDownload) window.ProgramDownload.attach(dl, PG);
      else {
        const link = el('a', 'btn', 'Download this program (.bf)'); link.href = new URL('../' + file, HERE).href; link.setAttribute('download', file.split('/').pop());
        dl.textContent = '';
        dl.append(link, el('span', 'dlnote', ' ' + file.split('/').pop() + ': ' + (P.chars / 1e9).toFixed(2) + ' GB (' + fmt(P.chars) + ' bytes, one line of text). A large download; nothing is fetched until you press the button. SHA-256: '), el('code', 'sha', P.sha256));
      }
    }
    document.querySelectorAll('[data-f]').forEach((n) => { const v = F[n.getAttribute('data-f')]; if (v !== undefined) n.textContent = v; });
    const a = $('r-file'); if (a) { a.href = new URL('../' + (TI.file || W.file), HERE).href; a.textContent = TI.file || W.file; }
    return { W, E, TI, C };
  }));
  ready.catch((e) => {
    console.warn(e);
    const text = 'The data for ' + MODELS[MODEL].short + ' is not hosted here. Choose another program with the switch, or build the program and its data on your own computer (README, steps 3 and 5).';
    const frame = $('m-frame'), main = document.querySelector('main');
    if (frame) { const d = el('div', 'mapmissing', text); frame.append(d); frame.classList.add('missing'); }
    else if (main) { const p = el('p', 'callout warn', text); main.insertBefore(p, main.children[2] || null); }
  });

  // Run fn once, when the element comes near the screen (and the data above is there).
  const lazy = (node, fn) => {
    let done = false;
    const go = () => { if (done) return; done = true; ready.then(fn).catch((e) => { console.error(e); const p = el('p', 'err', 'This part could not be loaded: ' + e.message); node.prepend(p); }); };
    if (!('IntersectionObserver' in window)) return go();
    const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) { io.disconnect(); go(); } }, { rootMargin: '600px 0px' });
    io.observe(node);
  };

  // ---- the program text behind the map
  const CHUNK = 65536;
  let tilesInfo = null;
  let PROGRAM = '', programNow = null;
  program().then((PG) => { programNow = PG; });
  const bigCache = new Map();
  const fromChunks = (c, last) => {
    const m = programNow.manifest, size = m.chunkBytes, big = Math.floor(c * CHUNK / size);
    if (!bigCache.has(big)) { bigCache.set(big, window.ProgramSource.slice(m, programNow.manifestUrl, big * size, size)); if (bigCache.size > 6) bigCache.delete(bigCache.keys().next().value); }
    return bigCache.get(big).then((u) => u.slice(c * CHUNK - big * size, last + 1 - big * size).buffer);
  };
  let rangeTest = null;
  const canRange = () => rangeTest || (rangeTest = (async () => {
    const stop = new AbortController();
    const PG = await program(); if (PG && PG.manifest) return true;            // chunks: any part of the text can be read
    try { const r = await fetch(PROGRAM, { headers: { Range: 'bytes=0-0' }, signal: stop.signal, cache: 'no-store' }); if (r.status !== 206) { stop.abort(); return false; } await r.arrayBuffer(); return true; } catch (e) { return false; }
  })());
  let tilesP = null;
  const tiles = (later) => tilesP || (tilesP = ready.then(async ({ TI: t }) => { PROGRAM = new URL('../' + t.file, HERE).href; const range = later ? undefined : await canRange(); tilesInfo = t; t.deepSet = new Set(t.deep.writer); t.range = range; return t; }));
  const inDeep = (c) => (c >= tilesInfo.deep.engineFirst ? c <= tilesInfo.deep.last : tilesInfo.deepSet.has(c));
  const hasChunk = (c) => tilesInfo && (tilesInfo.range ? c >= 0 && c * CHUNK < tilesInfo.chars : inDeep(c));
  const deepPiece = (c) => fetch(DATA + 'deep/' + c + '.txt').then((r) => { if (!r.ok) throw new Error('no text for piece ' + c); return r.arrayBuffer(); });
  const chunkCache = new Map();
  const chunk = (c) => {
    if (!chunkCache.has(c)) {
      const ranged = tilesInfo && tilesInfo.range, last = tilesInfo ? Math.min((c + 1) * CHUNK, tilesInfo.chars) - 1 : 0;
      // a stored piece of 64 KiB is far less to fetch than the piece of the program around it; a site without them reads the program
      const fromProgram = () => (programNow && programNow.manifest ? fromChunks(c, last) : fetch(PROGRAM, { headers: { Range: 'bytes=' + c * CHUNK + '-' + last }, cache: 'no-store' }).then((r) => { if (r.status !== 206) throw new Error('the server did not send a part of the file'); return r.arrayBuffer(); }));
      const p = (!ranged ? deepPiece(c) : inDeep(c) ? deepPiece(c).catch(fromProgram) : fromProgram()).then((b) => new Uint8Array(b));
      p.catch(() => setTimeout(() => chunkCache.delete(c), 4000));      // a piece that failed is tried again, but not at once
      chunkCache.set(c, p);
      if (chunkCache.size > 440) chunkCache.delete(chunkCache.keys().next().value);
    }
    return chunkCache.get(c);
  };
  // Text of the file from character `from` (0-based), `len` characters; null if not stored.
  const textAt = async (from, len) => {
    await tiles();
    const to = Math.min(from + len, tilesInfo.chars), c0 = Math.floor(from / CHUNK), c1 = Math.floor((to - 1) / CHUNK);
    for (let c = c0; c <= c1; c++) if (!hasChunk(c)) return null;
    const parts = await Promise.all(Array.from({ length: c1 - c0 + 1 }, (_, i) => chunk(c0 + i)));
    let s = '';
    parts.forEach((u, i) => { const a = i === 0 ? from - c0 * CHUNK : 0, b = i === c1 - c0 ? to - c1 * CHUNK : u.length; for (let k = a; k < b; k++) s += String.fromCharCode(u[k]); });
    return s;
  };

  // ---- brainfuck, set out to be read
  const side = (n) => (n > 0 ? fmt(n) + ' right' : fmt(-n) + ' left');
  function analyse(body) {            // a loop body without brackets: what does the loop do?
    let off = 0; const d = new Map(); let adds = 0;
    for (let i = 0; i < body.length; i++) { const c = body[i]; if (c === '>') off++; else if (c === '<') off--; else if (c === '+') { d.set(off, (d.get(off) || 0) + 1); adds++; } else if (c === '-') { d.set(off, (d.get(off) || 0) - 1); adds++; } else return null; }
    if (adds === 0) return off === 0 ? 'waits for ever if the cell is not zero' : 'walk ' + (off > 0 ? 'right' : 'left') + (Math.abs(off) > 1 ? ' in steps of ' + fmt(Math.abs(off)) : '') + ' to the first zero cell';
    if (off !== 0) return null;
    if (d.get(0) !== -1) return null;
    d.delete(0);
    const t = [...d].filter(([, f]) => f !== 0);
    if (!t.length) return 'clear: set this cell to zero';
    if (t.length === 1) { const [o, f] = t[0]; return f === 1 ? 'move: empty this cell into the cell ' + side(o) : f === -1 ? 'subtract this cell from the cell ' + side(o) : 'multiply: add ' + (f < 0 ? '−' : '') + fmt(Math.abs(f)) + ' times this cell to the cell ' + side(o); }
    if (t.every(([, f]) => f === 1)) return (t.length === 2 ? 'copy: empty this cell into two cells (' : 'empty this cell into ' + t.length + ' cells (') + t.map(([o]) => side(o)).join(', ') + ')';
    return 'add this cell, times a fixed number, to ' + t.length + ' cells (' + t.map(([o, f]) => '×' + (f < 0 ? '−' : '') + fmt(Math.abs(f)) + ' at ' + side(o)).join(', ') + ')';
  }
  const tokSpan = (ch, n) => {
    const cls = ch === '+' ? 't-plus' : ch === '-' ? 't-minus' : ch === '<' || ch === '>' ? 't-mv' : ch === ',' || ch === '.' ? 't-io' : 't-br';
    const s = el('span', cls), shown = ch === '-' ? '−' : ch;
    if (n <= 8) s.textContent = shown.repeat(n); else { s.textContent = shown; const k = el('span', 'n', '×' + fmt(n)); s.append(k); }
    return s;
  };
  function pretty(text, base, marks = [], maxLines = 260) {
    const frag = document.createDocumentFragment();
    const ms = marks.filter((m) => m.from >= base && m.from < base + text.length).sort((a, b) => a.from - b.from);
    let mi = 0, depth = 0, lines = 0, i = 0;
    const n = text.length;
    const line = (spans, note, d) => {
      const row = el('div', 'ln'), src = el('span', 'src');
      src.style.paddingLeft = Math.min(d, 14) * 14 + 'px';
      spans.forEach((s, k) => { if (k) src.append(' '); src.append(s); });
      row.append(src, el('span', 'note', note || '')); frag.append(row); lines++;
    };
    const heads = () => { while (mi < ms.length && ms[mi].from <= base + i) { const h = el('div', 'head', ms[mi].label); h.style.paddingLeft = 10 + Math.min(depth, 14) * 14 + 'px'; frag.append(h); mi++; } };
    const nextStop = () => (mi < ms.length ? ms[mi].from - base : n);
    while (i < n && lines < maxLines) {
      heads();
      const c = text[i];
      if (c === '[') {
        // a loop without loops inside it: one line
        let j = i + 1; while (j < n && text[j] !== '[' && text[j] !== ']') j++;
        if (j < n && text[j] === ']') {
          const body = text.slice(i + 1, j), what = analyse(body), spans = [tokSpan('[', 1)];
          for (let k = 0; k < body.length;) { let e = k; while (e < body.length && body[e] === body[k]) e++; spans.push(tokSpan(body[k], e - k)); k = e; }
          spans.push(tokSpan(']', 1));
          line(spans, what || 'a small loop', depth); i = j + 1; continue;
        }
        line([tokSpan('[', 1)], 'repeat while this cell is not zero', depth); depth++; i++; continue;
      }
      if (c === ']') { depth = Math.max(0, depth - 1); line([tokSpan(']', 1)], 'zero? then go on, otherwise back', depth); i++; continue; }
      // a walk, then what is done there
      const spans = [], stop = nextStop(); let mv = 0, add = 0, io = '';
      while (i < n && i < stop && (text[i] === '<' || text[i] === '>')) { let e = i; while (e < n && e < stop && text[e] === text[i]) e++; spans.push(tokSpan(text[i], e - i)); mv += (text[i] === '>' ? 1 : -1) * (e - i); i = e; }
      while (i < n && i < stop && (text[i] === '+' || text[i] === '-')) { let e = i; while (e < n && e < stop && text[e] === text[i]) e++; spans.push(tokSpan(text[i], e - i)); add += (text[i] === '+' ? 1 : -1) * (e - i); i = e; }
      if (i < n && i < stop && (text[i] === ',' || text[i] === '.')) { io = text[i]; spans.push(tokSpan(io, 1)); i++; }
      const parts = [];
      if (mv) parts.push('go ' + side(mv));
      if (add) parts.push(add > 0 ? 'add ' + fmt(add) : 'take off ' + fmt(-add));
      if (io === ',') parts.push('READ one letter of the question into this cell');
      if (io === '.') parts.push('PRINT this cell as a letter');
      if (spans.length) line(spans, parts.join(', '), depth);
      else if (i < n && i >= stop) { heads(); }
    }
    if (i < n) frag.append(el('div', 'gapline', '… the text goes on (' + fmt(n - i) + ' more characters of this piece)'));
    return frag;
  }

  const CMD = [['+', 'add one', '--c-plus'], ['-', 'take one off', '--c-minus'], ['<', 'step left', '--c-lt'], ['>', 'step right', '--c-gt'], ['[', 'loop start', '--c-open'], [']', 'loop end', '--c-close'], ['.', 'print', '--c-out'], [',', 'read', '--c-in']];

  window.Inside = {
    $, el, fmt, pct, short, minus, words, billions, lineFit, json, get, lazy, ready, cssVar, rgbOf, onTheme, onResize, fit,
    MODEL, QWEN, Q35, VIS, MODELS, get DATA() { return DATA; }, program, F, FAM, KIND, CMD, LEGEND, CHUNK, swatch, blockSpan, clearRows, layerNo,
    regionTitle, regionShort, regionSays, markLabel, tiles, canRange, hasChunk, chunk, textAt, pretty,
    get SEC() { return SEC; }, get W() { return WJ; }, get E() { return EJ; }, get TR() { return TR; },
  };
})();
