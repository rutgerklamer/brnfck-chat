// The zoomable map of a program.
(function () {
  'use strict';
  const I = window.Inside;
  const $ = (id) => document.getElementById(id);
  const cv = $('m-canvas'), frame = $('m-frame');
  if (!I || !cv || !frame) return;
  const { el, fmt, pct, rgbOf, FAM, KIND, CMD, CHUNK } = I;
  const on = (id, ev, fn, opt) => { const n = typeof id === 'string' ? $(id) : id; if (n) n.addEventListener(ev, fn, opt); return n; };
  const say = (id, t) => { const n = $(id); if (n) n.textContent = t; return n; };
  const HERO = frame.hasAttribute('data-hero'), APP = frame.hasAttribute('data-app'), mini = $('m-mini'), ctx = cv.getContext('2d');
  const UI = APP ? getComputedStyle(frame).fontFamily || 'system-ui, sans-serif' : 'system-ui, sans-serif';
  const subs = {}, emit = (ev, a) => { (subs[ev] || []).forEach((f) => { try { f(a); } catch (e) { console.error(e); } }); };
  const LOW = 8;
  let SIDE = 32768, ORDER = 15, TOP = 12;            // set from tiles.json before anything is drawn
  const calm = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ---- the folded line (Hilbert curve)
  // d2xyInto writes into out, for loops over many characters (no new array each time)
  function d2xyInto(d, out) {
    let x = 0, y = 0, lo = d % 1073741824, hi = (d - lo) / 1073741824;
    for (let s = 1, k = 0; s < SIDE; s *= 2, k++) {
      let t;
      if (k < 15) { t = lo & 3; lo >>= 2; } else { t = hi & 3; hi >>= 2; }
      const rx = 1 & (t >> 1), ry = 1 & (t ^ rx);
      if (ry === 0) { if (rx === 1) { x = s - 1 - x; y = s - 1 - y; } const q = x; x = y; y = q; }
      x += s * rx; y += s * ry;
    }
    out[0] = x; out[1] = y;
    return out;
  }
  const d2xy = (d) => d2xyInto(d, [0, 0]);
  const XY = [0, 0];
  function xy2d(x, y) {
    let d = 0;
    for (let s = SIDE >> 1; s > 0; s >>= 1) {
      const rx = (x & s) > 0 ? 1 : 0, ry = (y & s) > 0 ? 1 : 0;
      d += s * s * ((3 * rx) ^ ry);
      if (ry === 0) { if (rx === 1) { x = SIDE - 1 - x; y = SIDE - 1 - y; } const q = x; x = y; y = q; }
    }
    return d;
  }
  // The largest square that lies wholly inside the stretch [from, to) of the line.
  function bigSquare(from, to) {
    let best = null;
    for (let d = from; d < to;) { let size = 1; while (d % (size * 4) === 0 && d + size * 4 <= to) size *= 4; if (!best || size > best.size) best = { d, size }; d += size; }
    const side = Math.round(Math.sqrt(best.size)), [x, y] = d2xy(best.d);
    return { x: x - (x % side), y: y - (y % side), side };
  }
  // The box around a stretch.
  function foldBox(from, to) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let d = from; d < to;) { let size = 1; while (d % (size * 4) === 0 && d + size * 4 <= to) size *= 4; const side = Math.round(Math.sqrt(size)); let [x, y] = d2xy(d); x -= x % side; y -= y % side; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + side); y1 = Math.max(y1, y + side); d += size; }
    return { x0, y0, x1, y1 };
  }
  const lower = (arr, v) => { let lo = 0, hi = arr.length - 1; if (v < arr[0]) return -1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (arr[mid] <= v) lo = mid; else hi = mid - 1; } return lo; };

  // ---- what is where
  let W = null, E = null, TI = null, spans = null, spanFrom = null, names = null, total = 0, places = null, tree = null, picW = null;      // picW: the picture part of the writing part (brnfck-qwen3.5-0.8b-vision)
  // A program that trains a network (compiler/train): its parts as the generator marks them, in writer.json.
  // t: what it reads, from writer.json: V characters it knows, attention over T, a 'letter' or a 'character' each
  const TPART = (t) => {
    const u = t.unit, us = u + 's', T = I.words(t.T), V = t.V, kid = t.text === 'shakespeare' ? 'writes lines like Shakespeare’s' : 'makes up names';
    return {
      start: ['tset', 'Writes the markers and the seed', 'Markers', 'The writing part. It reads nothing and prints nothing: it puts a marker in every slot of 13 cells, so that the walks over them know where to stop, marks which slots draw a random start value, and writes the seed of the random numbers.'],
      init: ['tset', 'Draws the random start weights', 'Start weights', 'One walk over all the slots. In every marked slot: one step of the random numbers (x becomes 69069 x + 1), and the top bits of x as the start value of its weight. Every weight starts here, at random.'],
      read: ['tread', 'Reads a ' + u + ', moves the context on', 'Reads', 'Here the loop of the training starts: once for every step of 32 ' + us + ', and inside it once for every ' + u + '. A comma reads the ' + u + ', it becomes a token, and the context of the last ' + us + ' moves on by one.'],
      'key-forward': ['tfwd', 'Queries, keys and their scores', 'Queries', 'A walk over the ' + t.dk + ' frames of the queries and keys. In each: the query of the newest ' + u + ', the keys of the last ' + T + ' positions, and their products added to the ' + T + ' scores, which ride along to the next frame.'],
      attention: ['tatt', 'Softmax of the attention', 'Attention', 'The ' + T + ' scores become how much of each position to take: the largest of them, an exponential from a table, their sum, and 1 divided by the sum from a table.'],
      forward: ['tfwd', 'Forward through the network', 'Forward', 'A walk over the frames of the network, one frame per unit, the same piece of text for each. In a frame: the numbers the context ' + us + ' pick, a tanh from a table, and the unit’s share of the ' + V + ' logits, carried on to the next frame.'],
      head: ['thead', 'Softmax, loss and its gradient', 'Loss', 'The ' + V + ' logits become chances: the largest, an exponential from a table, the sum and 1 divided by it. The loss of the ' + u + ' is the logarithm of the sum minus the logit of the right ' + u + '; the gradient of each logit is its chance, minus one for the right ' + u + '.'],
      backward: ['tbwd', 'Back through the network', 'Backward', 'Backpropagation: a walk back over the frames, from the last to the first. Every frame takes the gradient of the logits, works out its own, and adds to the velocity of every weight it used.'],
      'attention-backward': ['tatt', 'Back through the attention softmax', 'Attention back', 'The gradient goes back through the softmax of the attention: for each of the ' + T + ' positions, how its score should change.'],
      'key-backward': ['tbwd', 'Back into the queries and keys', 'Keys back', 'A walk back over the ' + t.dk + ' frames of the queries and keys: the gradient of every score adds to the velocities of the query and the keys that made it.'],
      momentum: ['tmom', 'Moves every weight', 'Momentum', 'After 32 ' + us + ', one walk over all the slots: every weight moves by its velocity, rounded to the scale of the weight, and the velocity keeps 7/8 of itself for the next step.' + (t.text === 'shakespeare' ? ' Then every weight shrinks by 1/4096, so that no weight grows without end.' : '')],
      'print-step': ['tout', 'Prints the step and the loss', 'Prints', 'The step number and the loss of its 32 ' + us + ' become digits, and a line like “step 12 loss 2.345” goes out through the full stops.'],
      'child-weights': ['tkid', 'Prints the child’s weights', 'Child weights', 'After the last step: one walk over all the slots prints every weight as a run of + or −, then 13 times >. That is the writing part of the child program.'],
      engine: ['tkid', 'Prints the child’s engine', 'Child engine', 'The engine of the child, printed character by character: the program that ' + kid + ' with the weights above. A run of the same character is printed by a counting loop.'],
    };
  };
  function trainParts(w, e) {
    const parts = w.parts, at = (n) => parts.find((p) => p[0] === n), t = Object.assign({ V: 27, T: w.train.context, dk: w.train.dk, unit: 'letter', text: 'names' }, w.train), TP = TPART(t);
    const bigram = w.train.kind === 'bigram', SAYS = { forward: 'A walk over 27 frames, one for every letter that could come next, the same piece of text for each. In a frame: the number the last letter picks from its row of the table, rounded to a logit, queued for the head.', backward: 'A walk back over the 27 frames: each takes the gradient of its letter and adds it to the velocity of the number the last letter picked.' };
    spans = parts.map(([n, from, to]) => { const [fam, title, short, says0] = TP[n], says = bigram && SAYS[n] ? SAYS[n] : says0; return { from, to, fam, kind: 'engine', id: n, title, short, says, part: n === 'start' ? 0 : 1, row: title }; });
    spanFrom = Float64Array.from(spans, (s) => s.from);
    names = [];
    const add = (tier, from, to, text, short) => { const n = { tier, from, to, text, texts: short && short !== text ? [text, short] : [text] }; names.push(n); return n; };
    const kid = at('child-weights')[1], step = at('read')[1], after = at('momentum')[1], end = at('print-step')[2];
    add(0, 0, w.program.writer, 'WRITES MARKERS AND THE SEED', 'SETS UP');
    add(0, w.program.writer, kid, 'TRAINS THE NETWORK', 'TRAINS');
    add(0, kid, total, 'PRINTS THE CHILD PROGRAM', 'THE CHILD');
    for (const s of spans) add(1, s.from, s.to, s.title, s.short);
    names.sort((a, b) => a.from - b.from);
    const leaf = (s) => ({ text: s.title, from: s.from, to: s.to, fam: s.fam, span: s }), inside = (a, b) => spans.filter((s) => s.from >= a && s.to <= b).map(leaf);
    tree = { text: 'The program', says: 'One line of text, every character one of eight commands.', from: 0, to: total, open: true, kids: [
      { text: 'Sets up', says: 'Markers, the seed, and the random start weights.', from: 0, to: step, kids: inside(0, step) },
      { text: 'For every ' + t.unit + ' (32 per step)', says: 'Read the ' + t.unit + ', forward, loss, backward.', from: step, to: after, kids: inside(step, after) },
      { text: 'After every 32 ' + t.unit + 's', says: 'Move the weights, print the loss.', from: after, to: end, kids: inside(after, end) },
      { text: 'At the end: the child program', says: 'Print the trained weights and an engine that ' + (t.text === 'shakespeare' ? 'writes lines like Shakespeare’s' : 'makes up names') + '.', from: kid, to: total, kids: inside(kid, total) },
    ] };
    places = [{ name: 'Whole program', home: true }, { name: 'Where the training starts', at: step, z: 3, id: 'start' }];
  }
  const ready = Promise.all([I.ready, I.tiles(HERO)]).then(([all, t]) => {
    W = all.W; E = all.E; TI = t; total = W.program.chars;
    ORDER = t.order; SIDE = t.side; TOP = t.top || ORDER - 3;
    if (E.family === 'train') return trainParts(W, E);
    const SEC = I.SEC, w = W, e = E;
    spans = [];
    for (const [ri, from, to, cells, blocks, also] of w.stretches) {
      const r = w.regions[ri];
      const more = [...new Set((also || []).map((i) => w.regions[i]).filter((q) => q.kind !== r.kind || q.what !== r.what).map((q) => I.regionTitle(q).replace(/^Layer \d+: /, '').replace(/ \(.*\)$/, '')))];
      spans.push({ from, to, fam: KIND[r.kind].fam, kind: r.kind, layer: r.layer, title: I.regionTitle(r), short: I.regionShort(r), says: I.regionSays(r) + (more.length ? ' The blocks of this stretch also write: ' + more.join('; ') + '.' : ''), cells, blocks, part: 0, region: r });
    }
    spans.push({ from: w.finalMove.from, to: w.program.writer, fam: 'work', kind: 'walk', layer: -1, title: 'The walk to the engine\'s starting cell', short: 'Walk', says: 'The tape is written. ' + fmt(w.finalMove.chars) + ' steps to the left bring the pointer to the cell where the engine expects it.', part: 0 });
    for (const s of e.sections) spans.push({ from: s.from, to: s.to, fam: SEC[s.id].fam, kind: 'engine', id: s.id, title: SEC[s.id].name, short: SEC[s.id].name.replace(/^Weights × numbers: /, '× '), says: SEC[s.id].desc, part: 1 });
    spans.sort((a, b) => a.from - b.from);
    for (let i = 0; i + 1 < spans.length; i++) spans[i].to = spans[i + 1].from;       // no holes
    spanFrom = Float64Array.from(spans, (s) => s.from);
    names = [];
    const add = (tier, from, to, text, short) => { const n = { tier, from, to, text, texts: short && short !== text ? [text, short] : [text] }; names.push(n); return n; };
    const writer = add(0, 0, w.program.writer, 'WRITES THE MODEL\'S NUMBERS', 'WRITING PART'), engine = add(0, w.program.writer, total, 'THE ENGINE', 'ENGINE');
    const group = (pred, text, short) => { const g = spans.filter(pred); return g.length ? add(1, g[0].from, g[g.length - 1].to, text, short) : null; };
    const groupsW = [group((s) => s.kind === 'cls', 'Output table', 'Output')];
    for (let l = e.model.layers - 1; l >= 0; l--) groupsW.push(group((s) => s.part === 0 && s.layer === l && s.kind !== 'cls', 'Layer ' + (l + 1), 'L' + (l + 1)));
    groupsW.push(group((s) => s.kind === 'emb', 'Table of word pieces', 'Word pieces'), group((s) => s.kind === 'toktable' || s.kind === 'tokbytes', 'Vocabulary'));
    // the picture part: its regions are those of layer -2 (the part as a whole) and of layers 100 and on (its layers)
    const V = e.model.vision, isPic = (s) => s.part === 0 && (s.layer === -2 || s.layer >= 100);
    picW = V ? group(isPic, 'Picture part', 'Picture') : null;
    if (picW) {
      groupsW.push(picW);
      for (let l = 0; l < V.layers; l++) { const g = spans.filter((q) => q.part === 0 && q.layer === 100 + l); if (g.length) add(2, g[0].from, g[g.length - 1].to, 'Picture layer ' + (l + 1), 'P' + (l + 1)); }
    }
    const ids = e.sections.map((s) => s.id), range = (a, b, text, short, tier = 1) => add(tier, e.sections[ids.indexOf(a)].from, e.sections[ids.indexOf(b)].to, text, short);
    // the text of the picture part: once, before the question, in rounds over all squares
    const rounds = V ? Array.from({ length: V.layers + 1 }, (_, r) => { const ss = e.sections.filter((q) => q.id.startsWith('v' + r + '.')); return add(2, ss[0].from, ss[ss.length - 1].to, 'Round ' + (r + 1) + ' of the picture part', 'Round ' + (r + 1)); }) : [];
    const picE = V ? range('vstart', 'vend', 'Looking at the picture (once, before the question)', 'Looking at the picture') : null;
    // the text of the layers: one layer, or (brnfck-qwen3.5-0.8b) the four layers of a group, each written once
    const layerGroups = () => {
      if (!e.model.unit) return [range('xn1', 'xout', 'One layer (this text runs ' + e.model.layers + ' times)', 'One layer')];
      const per = e.model.unit.length;
      return e.model.unit.map((kind, u) => { const ss = e.sections.filter((s) => s.u === u), list = Array.from({ length: e.model.groups }, (_, i) => i * per + u + 1); return add(1, ss[0].from, ss[ss.length - 1].to, 'Layers ' + list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1] + ' (' + (kind === 'lin' ? 'DeltaNet' : 'attention') + ')', kind === 'lin' ? 'DeltaNet' : 'Attention'); });
    };
    const groupsE = [...(picE ? [picE] : []), range('ask', 'queue', 'Reading the question', 'Question'), range('take', 'emb', 'Start of a word piece', 'Word piece'), ...layerGroups(), range('xnf', 'print', 'Choosing and printing', 'Choosing')];
    for (const s of spans) if (s.to - s.from > 2000 && !names.some((n) => n.tier === 1 && n.from === s.from && n.to === s.to)) add(2, s.from, s.to, s.title.replace(/ \(.*\)$/, ''), s.short);
    for (const m of e.marks) if (m.to - m.from >= 4096) add(3, m.from, m.to, I.markLabel(m));
    names.sort((a, b) => a.from - b.from);
    const kids = (g) => spans.filter((s) => s.from >= g.from && s.to <= g.to).map((s) => ({ text: s.title, from: s.from, to: s.to, fam: s.fam, span: s }));
    // the picture part in the outline: its layers and its rounds one level deeper
    const picKids = (g) => {
      const out = [];
      for (const k of kids(g)) {
        const l = k.span.part === 0 && k.span.layer >= 100 ? k.span.layer : -1, last = out[out.length - 1];
        if (l >= 0 && last && last.layer === l) { last.kids.push(k); last.to = k.to; } else if (l >= 0) out.push({ text: 'Picture layer ' + (l - 99), layer: l, from: k.from, to: k.to, kids: [k] }); else out.push(k);
      }
      return out;
    };
    const engineKids = (g) => (g !== picE ? kids(g) : [kids({ from: g.from, to: rounds[0].from })[0], ...rounds.map((r) => ({ text: r.text, from: r.from, to: r.to, kids: kids(r) })), ...kids({ from: rounds[rounds.length - 1].to, to: g.to })]);
    tree = { text: 'The program', says: 'One line of text, every character one of eight commands.', from: 0, to: total, open: true, kids: [
      { text: 'The part that writes the model\'s numbers', says: 'It reads nothing and prints nothing. It only puts the model\'s numbers into memory, one block after another.', from: writer.from, to: writer.to, kids: groupsW.filter(Boolean).map((g) => ({ text: g.text, from: g.from, to: g.to, kids: g === picW ? picKids(g) : kids(g) })).concat(spans.filter((s) => s.kind === 'walk').map((s) => ({ text: s.title, from: s.from, to: s.to, fam: s.fam, span: s }))) },
      { text: 'The engine', says: 'It reads your question, does the model\'s sums with the numbers, and prints the answer.', from: engine.from, to: engine.to, kids: groupsE.map((g) => ({ text: g.text, from: g.from, to: g.to, kids: engineKids(g) })) },
    ] };
    const LAY = Math.min(12, e.model.layers - 1), inLayer = spans.filter((s) => s.part === 0 && s.layer === LAY && s.kind !== 'cls');
    const sample = w.samples.find((s) => s.id === 'w13') || w.samples[0], strip = spans.find((s) => s.part === 0 && s.layer === LAY && s.kind === 'bias') || spans.find((s) => s.part === 0 && s.layer === LAY && s.kind === 'gain' && s.region.what === 'ffn');
    const tok = spans.find((s) => s.kind === 'toktable'), emb = spans.find((s) => s.kind === 'emb');
    places = [
      { name: 'Whole program', home: true },
      { name: 'The engine', from: w.program.writer, to: total },
      { name: 'Weights of layer ' + (LAY + 1), from: inLayer[0].from, to: inLayer[inLayer.length - 1].to, id: 'layer' },
      { name: 'One block of weights', from: sample.off, to: sample.off + sample.len },
      { name: 'The start of a block, up close', at: sample.off + 6, z: 4, id: 'block' },
      ...(strip ? [{ name: 'Strips of constants', from: strip.from, to: strip.to }] : []),
      ...(I.QWEN && emb ? [{ name: 'The table of word pieces', from: emb.from, to: emb.to }] : []),
      { name: 'The vocabulary table', from: tok.from, to: tok.to, id: 'vocab' },
      ...(picW ? [{ name: 'The picture part', from: picW.from, to: picW.to, id: 'picture' }, { name: 'Looking at the picture', from: picE.from, to: picE.to, id: 'looking' }] : []),
      { name: 'Where the two parts meet', at: w.program.writer, z: 3 },
      ...(V ? [{ name: 'The input command of the picture', at: e.commaAll[0], z: 5, secret: true, id: 'comma' }, { name: 'The input commands of the question', at: e.commaAll[1], z: 5, id: 'comma2' }]
        : [{ name: 'The one input command', at: e.comma, z: 5, secret: true, id: 'comma' }]),
      { name: 'The one print command', at: e.dot, z: 5 },
    ];
  });
  const spanAt = (d) => spans[Math.max(0, lower(spanFrom, d))];

  let blocks = null, blocksLoading = null;
  const loadBlocks = () => blocksLoading || (blocksLoading = I.get('blocks.bin', 'buf').then((buf) => {
    const R = W.blocks.record, n = buf.byteLength / R, dv = new DataView(buf), off = new Float64Array(n);
    if (R !== 32) throw new Error('blocks.bin is of another make: run tools/map-data/writer.js again');
    for (let i = 0; i < n; i++) off[i] = dv.getFloat64(i * R, true);
    blocks = { n, dv, off, get: (i) => ({ index: i, off: off[i], len: dv.getUint32(i * R + 8, true), cell: dv.getUint32(i * R + 12, true), K: dv.getUint32(i * R + 16, true), kind: dv.getUint8(i * R + 20), D: dv.getUint8(i * R + 21), rad: dv.getUint8(i * R + 22), m: dv.getInt32(i * R + 24, true) }) };
    const all = new Float64Array(starts.length + n); all.set(starts); all.set(off, starts.length); all.sort();      // a typed array sorts by number
    starts = all;
    redraw();
  }));
  const blockAt = (d) => { if (!blocks || d >= W.finalMove.from) return null; const i = lower(blocks.off, d); return i < 0 ? null : blocks.get(i); };
  const blockSays = (b) => {
    if (b.kind === 2) return 'A run of ' + fmt(b.K) + ' empty cells is stepped over in ' + fmt(b.len) + ' characters.';
    if (b.kind === 1) return fmt(b.K) + ' cells written one by one (' + fmt(b.len) + ' characters): too few to be worth a block.';
    const R = W.blocks.radKeys[b.rad];
    return 'Block ' + fmt(b.index + 1) + ': ' + fmt(b.len) + ' characters that write cells ' + fmt(b.cell) + ' to ' + fmt(b.cell + b.K - 1) + ' of the tape (' + fmt(b.K) + ' cells, ' + b.D + ' digit positions' + (R && R !== '-' ? ', base ' + R.split(',').reverse().join(' then ') : '') + ', counted from ' + fmt(b.m) + ').';
  };
  const markAt = (d) => { let best = null; for (const m of E.marks) { if (m.from > d) break; if (d < m.to && (!best || m.to - m.from < best.to - best.from)) best = m; } return best; };

  // ---- state
  let Wd = 0, Hd = 0, dpr = 1;                    // size of the canvas in device pixels
  let layout = 'fold', mode = 'purpose', rowW = 256, labelsOn = true, fs = 1;      // fs: the reader's own font size, as a factor (names on the map follow it)
  const view = { cx: 0, cy: 0, z: -6 };           // world units are characters (cells); 2^z device pixels per cell
  let live = false, touched = false, locked = HERO, inited = false;
  let hover = null, pin = null, needs = false, fly = null, wheel = null, morph = null;
  let starts = new Float64Array(0);
  const redraw = () => { if (!needs) { needs = true; requestAnimationFrame(frameTick); } };
  // Painting new tiles is spread over frames: a frame paints for at most BUDGET ms (and at least one
  // tile), then shows what it has, with coarser tiles standing in, and asks for another frame.
  const BUDGET = 9;
  let paintUntil = Infinity, painted = 0, morePaint = false;
  const mayPaint = () => { if (painted === 0 || performance.now() < paintUntil) { painted++; return true; } morePaint = true; return false; };

  // ---- colours ----
  let PAL = null;
  const relLum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const SHADE = [1.24, 1.12, 0.58, 0.7, 1.4, 1.4, 1.6, 1.6];      // each command drawn lighter or darker than the colour of its part
  const palette = () => {
    PAL = { fam: {}, cmd: CMD.map(([, , v]) => rgbOf(v)), bg: rgbOf('--map-bg'), famCmd: {} };
    for (const f in FAM) { PAL.fam[f] = rgbOf(FAM[f].v); PAL.famCmd[f] = SHADE.map((k) => PAL.fam[f].map((c) => Math.min(255, c * k))); }
    PAL.cmdCss = PAL.cmd.map((c) => 'rgb(' + c.join(',') + ')');
    PAL.code = new Uint8Array(256).fill(255); CMD.forEach(([ch], i) => { PAL.code[ch.charCodeAt(0)] = i; });
    PAL.bgCss = 'rgb(' + PAL.bg.join(',') + ')';
  };
  const css = (c) => 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')';
  // the colour of one command at character d
  const cellRGB = (d, k) => (mode === 'purpose' ? PAL.famCmd[spanAt(d).fam][k] : PAL.cmd[k]);
  // the colour of a pixel that stands for many characters, from the counts of + - < > among them; into o
  const mixInto = (o, fam, p, m, l, r) => {
    if (mode === 'purpose') { const f = PAL.fam[fam], k = 0.6 + 0.58 * (1 - (l + r) / 15); o[0] = f[0] * k; o[1] = f[1] * k; o[2] = f[2] * k; return o; }
    const cm = PAL.cmd, rest = Math.max(0, 15 - p - m - l - r);
    for (let i = 0; i < 3; i++) o[i] = (p * cm[0][i] + m * cm[1][i] + l * cm[2][i] + r * cm[3][i] + rest * (cm[4][i] + cm[5][i]) / 2) / 15;
    return o;
  };
  const mixRGB = (fam, p, m, l, r) => mixInto([0, 0, 0], fam, p, m, l, r);

  // ---- picture tiles (levels 8..TOP): counts of + - < > per 4^(n-L) characters ----
  const rawCache = new Map(), tileCache = new Map();
  const rawTile = (L, t) => {
    const key = L + '/' + t;
    if (!rawCache.has(key)) {
      const o = { data: null, lin: null }; rawCache.set(key, o);
      fetch(I.DATA + 'tiles/' + key + '.bin').then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }).then((b) => { o.data = new Uint8Array(b); redraw(); }).catch(() => { setTimeout(() => rawCache.delete(key), 4000); });
    }
    return rawCache.get(key);
  };
  const linTile = (L, t) => {
    const o = rawTile(L, t);
    if (!o.data) return null;
    if (!o.lin) {
      if (!mayPaint()) return null;
      const cpp = 4 ** (ORDER - L), sh = 2 ** (ORDER - L), lin = new Uint8Array(CHUNK * 2), base = t * CHUNK * cpp;
      const [bx, by] = d2xy(base), ox = Math.floor(bx / sh) & ~255, oy = Math.floor(by / sh) & ~255;
      for (let i = 0; i < CHUNK; i++) { d2xyInto(base + i * cpp, XY); const q = ((Math.floor(XY[1] / sh) - oy) * 256 + Math.floor(XY[0] / sh) - ox) * 2; lin[i * 2] = o.data[q]; lin[i * 2 + 1] = o.data[q + 1]; }
      o.lin = lin;
    }
    return o.lin;
  };
  const MIX = [0, 0, 0, 0];
  const mixAt = (d, L) => {
    const cpp = 4 ** (ORDER - L), q = Math.floor(d / cpp), t = Math.floor(q / CHUNK), lin = linTile(L, t);
    if (!lin) return null;
    const i = (q - t * CHUNK) * 2; MIX[0] = lin[i] >> 4; MIX[1] = lin[i] & 15; MIX[2] = lin[i + 1] >> 4; MIX[3] = lin[i + 1] & 15;
    return MIX;
  };
  // the same from the finest level that is there already (and ask for level L)
  const mixNear = (d, L) => { let m = mixAt(d, L); for (let l = L - 1; !m && l >= LOW; l--) { const o = rawCache.get(l + '/' + Math.floor(d / (CHUNK * 4 ** (ORDER - l)))); if (o && o.data) m = mixAt(d, l); } return m; };
  const tileIndex = (L, tx, ty) => { const sh = ORDER - L, x = tx * 256 << sh, y = ty * 256 << sh; if (x < 0 || y < 0 || x >= SIDE || y >= SIDE) return -1; const t = Math.floor(xy2d(x, y) / (CHUNK * 4 ** sh)); return t < TI.levels[L].tiles ? t : -1; };
  function paintTile(L, tx, ty, data) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d'), img = g.createImageData(256, 256), px = img.data, sh = ORDER - L;
    const purpose = mode === 'purpose', N = 258, idx = new Int16Array(N * N), step = 2 ** sh, last = spanFrom.length - 1;       // which part every pixel belongs to, with a rim of one pixel around the tile
    let si = 0;                                            // the part of the pixel before: a neighbour is mostly in the same part
    for (let y = -1; y <= 256; y++) for (let x = -1; x <= 256; x++) {
      const X = (tx * 256 + x) * step, Y = (ty * 256 + y) * step; let i = -1;
      if (X >= 0 && Y >= 0 && X < SIDE && Y < SIDE) { const d = xy2d(X, Y); if (d < total) { if (d >= spanFrom[si] && (si === last || d < spanFrom[si + 1])) i = si; else { i = lower(spanFrom, d); if (i >= 0) si = i; } } }
      idx[(y + 1) * N + x + 1] = i;
    }
    const c3 = [0, 0, 0];
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const p = (y + 1) * N + x + 1, i = idx[p]; if (i < 0) continue;
      const o = (y * 256 + x) * 2, b0 = data[o], b1 = data[o + 1], q = (y * 256 + x) * 4;
      mixInto(c3, spans[i].fam, b0 >> 4, b0 & 15, b1 >> 4, b1 & 15);
      if (purpose && (idx[p + 1] !== i || idx[p + N] !== i)) { px[q] = PAL.bg[0]; px[q + 1] = PAL.bg[1]; px[q + 2] = PAL.bg[2]; }
      else if (purpose && !locked && ((idx[p - 1] !== i && idx[p - 1] >= 0) || (idx[p - N] !== i && idx[p - N] >= 0))) { px[q] = c3[0] * 0.3 + 170; px[q + 1] = c3[1] * 0.3 + 169; px[q + 2] = c3[2] * 0.3 + 164; }
      else { px[q] = Math.min(255, c3[0]); px[q + 1] = Math.min(255, c3[1]); px[q + 2] = Math.min(255, c3[2]); }
      px[q + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  }
  const tile = (L, tx, ty) => {
    const key = mode + '/' + L + '/' + tx + '/' + ty;
    let c = tileCache.get(key);
    if (c !== undefined) { if (c) { tileCache.delete(key); tileCache.set(key, c); } return c; }
    const t = tileIndex(L, tx, ty);
    if (t < 0) { tileCache.set(key, null); return null; }
    const o = rawTile(L, t);
    if (!o.data) return undefined;                         // on its way
    if (!mayPaint()) return undefined;                     // this frame has painted enough: a later one paints it
    c = paintTile(L, tx, ty, o.data);
    tileCache.set(key, c);
    if (tileCache.size > 220) tileCache.delete(tileCache.keys().next().value);
    return c;
  };

  // ---- the text itself: pieces of 65,536 characters ----
  const textCache = new Map();
  const text = (c) => {                                   // the bytes of piece c, or null while they are on their way
    let o = textCache.get(c);
    if (o) { if (o.u) { textCache.delete(c); textCache.set(c, o); } return o.u; }
    if (locked || !I.hasChunk(c)) return null;
    o = { u: null, cv: {} }; textCache.set(c, o);
    if (textCache.size > 420) textCache.delete(textCache.keys().next().value);
    I.chunk(c).then((u) => { o.u = u; redraw(); }).catch(() => { setTimeout(() => textCache.delete(c), 4000); });
    return null;
  };
  const charAt = (d) => { const o = textCache.get(Math.floor(d / CHUNK)); return o && o.u ? o.u[d % CHUNK] : 0; };
  const foldPiece = (c, k) => {
    const u = text(c); if (!u) return null;
    const o = textCache.get(c), key = 'f' + mode + k;
    if (o.cv[key]) return o.cv[key];
    if (!mayPaint()) return null;
    const n = 256 >> k, can = document.createElement('canvas'); can.width = can.height = n;
    const g = can.getContext('2d'), img = g.createImageData(n, n), px = img.data, acc = new Float32Array(n * n * 4), base = c * CHUNK, idx = new Int16Array(n * n);
    const [bx, by] = d2xy(base), ox = bx - (bx % 256), oy = by - (by % 256);
    let si = Math.max(0, lower(spanFrom, base)), fam = spans[si].fam, next = si + 1 < spans.length ? spans[si + 1].from : Infinity;
    for (let i = 0; i < u.length; i++) {
      const d = base + i; if (d >= next) { si++; fam = spans[si].fam; next = si + 1 < spans.length ? spans[si + 1].from : Infinity; }
      const ci = PAL.code[u[i]]; if (ci === 255) continue;
      d2xyInto(d, XY); const q = (((XY[1] - oy) >> k) * n + ((XY[0] - ox) >> k)) * 4, col = mode === 'purpose' ? PAL.famCmd[fam][ci] : PAL.cmd[ci];
      acc[q] += col[0]; acc[q + 1] += col[1]; acc[q + 2] += col[2]; acc[q + 3]++; idx[q >> 2] = si + 1;
    }
    for (let q = 0; q < acc.length; q += 4) if (acc[q + 3]) { px[q] = acc[q] / acc[q + 3]; px[q + 1] = acc[q + 1] / acc[q + 3]; px[q + 2] = acc[q + 2] / acc[q + 3]; px[q + 3] = 255; }
    if (k > 0 && mode === 'purpose') for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const p = y * n + x, i = idx[p], q = p * 4; if (!i) continue;
      if ((x + 1 < n && idx[p + 1] && idx[p + 1] !== i) || (y + 1 < n && idx[p + n] && idx[p + n] !== i)) { px[q] = PAL.bg[0]; px[q + 1] = PAL.bg[1]; px[q + 2] = PAL.bg[2]; }
      else if ((x > 0 && idx[p - 1] && idx[p - 1] !== i) || (y > 0 && idx[p - n] && idx[p - n] !== i)) { px[q] = px[q] * 0.3 + 170; px[q + 1] = px[q + 1] * 0.3 + 169; px[q + 2] = px[q + 2] * 0.3 + 164; }
    }
    g.putImageData(img, 0, 0);
    for (const kk in o.cv) if (kk !== key) delete o.cv[kk];
    return (o.cv[key] = can);
  };

  // ---- the layouts
  const scale = () => 2 ** view.z;
  const sx = (x) => (x - view.cx) * 2 ** view.z + Wd / 2, sy = (y) => (y - view.cy) * 2 ** view.z + Hd / 2;
  const LAYOUTS = {
    line: {
      name: 'One line', says: 'The program as it is: one line, from the first character to the last. Best to start with, and to see how long each part is. Above the ribbon stand the names of its parts; under it, the stretch under the pointer is shown 32 times closer.',
      zMin: () => Math.log2(Wd * 0.94 / total) - 0.4, zHome: () => Math.log2(Wd * 0.94 / total), home: () => ({ cx: total / 2, cy: 0 }),
      clamp() { view.cx = Math.max(0, Math.min(total, view.cx)); view.cy = 0; },
      pos: (d) => [d, -0.5], at: (x) => (x >= 0 && x < total ? Math.floor(x) : -1),
      box: (from, to) => ({ x0: from, x1: to, y0: 0, y1: 0 }), fitZ: (b) => Math.log2(Wd * 0.8 / Math.max(1, b.x1 - b.x0)),
      chars: (z) => Wd / 2 ** z, zFor: (n) => Math.log2(Wd / n),
    },
    rows: {
      name: 'Rows', says: 'Like a page of text: left to right, then the next row. This is how the file looks in an editor. The width of a row can be chosen.',
      zMin: () => Math.floor(Math.log2(Math.min(Wd * 0.9, 300 * dpr) / rowW)), zHome: () => Math.min(3, Math.floor(Math.log2(Math.min(Wd * 0.86, 1100 * dpr) / rowW))),
      home: () => ({ cx: rowW / 2, cy: (Hd / 2 - 40 * dpr) / 2 ** LAYOUTS.rows.zHome() }),
      clamp() { const rows = Math.ceil(total / rowW), half = Wd / 2 / scale(); view.cx = rowW * scale() <= Wd ? rowW / 2 : Math.max(half * 0.5, Math.min(rowW - half * 0.5, view.cx)); view.cy = Math.max(0, Math.min(rows, view.cy)); },
      pos: (d) => [d % rowW, Math.floor(d / rowW)], at: (x, y) => { if (x < 0 || x >= rowW || y < 0) return -1; const d = Math.floor(y) * rowW + Math.floor(x); return d < total ? d : -1; },
      box: (from, to) => ({ x0: 0, x1: rowW, y0: Math.floor(from / rowW), y1: Math.ceil(to / rowW) }), fitZ: (b) => Math.log2(Math.min(Wd / rowW, Hd * 0.8 / Math.max(1, b.y1 - b.y0))),
      chars: (z) => Math.min(rowW, Wd / 2 ** z) * Hd / 2 ** z, zFor: (n) => { const z = Math.log2(Math.sqrt(Wd * Hd / n)); return rowW * 2 ** z <= Wd ? Math.log2(rowW * Hd / n) : z; },
    },
    fold: {
      name: 'Folded', says: 'The line folded into a square, in such a way that neighbours in the line stay neighbours. Best to see the whole program at once.',
      zMin: () => Math.floor(Math.log2(Math.min(Wd, Hd) / SIDE)) - 1, zHome: () => (APP ? Math.floor(Math.log2(Math.min(Wd - 12 * dpr, Hd - 12 * dpr) / SIDE) * 4) / 4 : Math.floor(Math.log2(Math.min(Wd, Hd) / SIDE))),
      home: () => ({ cx: SIDE / 2, cy: SIDE / 2 }),          // in the middle: the small map shows only when zoomed in
      clamp() { view.cx = Math.max(0, Math.min(SIDE, view.cx)); view.cy = Math.max(0, Math.min(SIDE, view.cy)); },
      pos: (d) => d2xy(d), at: (x, y) => { if (x < 0 || y < 0 || x >= SIDE || y >= SIDE) return -1; const d = xy2d(Math.floor(x), Math.floor(y)); return d < total ? d : -1; },
      box: foldBox, fitZ: (b) => Math.log2(Math.min(Wd / (b.x1 - b.x0), Hd / (b.y1 - b.y0)) * 0.92),
      chars: (z) => Wd * Hd / 4 ** z, zFor: (n) => Math.log2(Math.sqrt(Wd * Hd / n)),
    },
  };
  LAYOUTS.lanes = Object.assign({}, LAYOUTS.line, { name: 'Lanes', says: 'The one line split into seven lanes, one for each command; the two brackets share a lane. Best to see where each command lives: the reads (one, or three in brnfck-qwen3.5-0.8b-vision) and the single print are lone ticks in the engine.' });
  LAYOUTS.tape = Object.assign({}, LAYOUTS.line, { name: 'What it writes', says: 'Above, the text of the program; below, the memory it fills, cell by cell. A band joins each part of the text to the cells it writes. Best to see what the text is for, and how much text a part of memory costs.' });
  let partRows = null, partFrom = null, partRow = 0;
  const partRowsOf = () => {
    if (partRows) return partRows;
    // (the picture part: the merger and its queue of vectors come before its layers in the text, the squares' weights and positions after them)
    const picL = picW ? spans.find((q) => q.part === 0 && q.layer >= 100) : null;
    const key = (q) => (q.row ? q.row : q.part ? 'The engine' : q.kind === 'cls' ? 'Output table' : q.kind === 'walk' ? 'Walk to the engine' : q.layer >= 100 ? 'Picture layer ' + (q.layer - 99) : picW && q.from >= picW.from && q.from < picW.to ? (q.from < picL.from ? 'Picture: merger' : 'Picture: squares in') : q.layer >= 0 ? 'Layer ' + (q.layer + 1) : q.kind === 'emb' ? 'Table of word pieces' : 'Vocabulary');
    partRows = [];
    for (const q of spans) { const k = key(q), last = partRows[partRows.length - 1]; if (last && (last.name === k || (!q.part && k === 'Vocabulary' && q.to - q.from < total / 5000))) last.to = q.to; else partRows.push({ name: k, from: q.from, to: q.to }); }
    if (partRows.length > 1 && partRows[0].to - partRows[0].from < total / 5000) { partRows[1].from = partRows[0].from; partRows.shift(); }      // a few free cells before the first part
    partFrom = Float64Array.from(partRows, (r) => r.from);
    const lens = partRows.filter((r) => /^Layer /.test(r.name)).map((r) => r.to - r.from).sort((a, b) => a - b);
    partRows.layer = lens.length ? lens[lens.length - 1] : total / 20; partRows.longest = Math.max(...partRows.map((r) => r.to - r.from));
    return partRows;
  };
  function partsGeo() {
    const u = dpr * fs, rows = partRowsOf(), gut = Math.round(Math.min(Wd * 0.34, 148 * u)), top = Math.round(30 * u), foot = 62 * dpr;
    const pitch = Math.max(Math.round(16 * u), Math.min(Math.round(44 * u), Math.floor((Hd - top - foot) / rows.length))), visible = Math.max(1, Math.min(rows.length, Math.floor((Hd - top - foot) / pitch)));
    return { u, gut, top, pitch, visible, rowH: pitch - Math.max(3, Math.round(4 * dpr)), w: Wd - gut };
  }
  const partX = (x) => { const g = partsGeo(); return g.gut + (x - view.cx) * 2 ** view.z + g.w / 2; };
  LAYOUTS.parts = {
    name: 'Part by part', says: 'One row for each part of the program: the output table, every layer, the table of word pieces, the vocabulary, ' + (I.VIS ? 'the picture part and its layers, ' : '') + 'the engine. All rows start at the left and have the same scale. Best to compare the layers with one another.',
    zMin: () => Math.log2(partsGeo().w * 0.9 / partRowsOf().longest) - 0.4, zHome: () => Math.log2(partsGeo().w * 0.92 / partRowsOf().layer),
    home: () => { const g = partsGeo(); partRow = Math.min(partRowsOf().length - 1, Math.floor(g.visible / 2)); return { cx: (g.w / 2 - 6 * dpr) / 2 ** LAYOUTS.parts.zHome(), cy: 0 }; },
    clamp() { const g = partsGeo(), rows = partRowsOf(); view.cx = Math.max(0, Math.min(rows.longest, view.cx)); view.cy = Math.max(0, Math.min(rows.length - g.visible, view.cy)); },
    pos: (d) => { const rows = partRowsOf(), r = Math.max(0, lower(partFrom, d)); return [d - rows[r].from, r]; },
    at: (x, y) => { const rows = partRowsOf(), r = rows[Math.floor(y)]; if (!r || x < 0 || x >= r.to - r.from) return -1; return r.from + Math.floor(x); },
    box: (from, to) => { const rows = partRowsOf(), r = Math.max(0, lower(partFrom, from)); return { x0: from - rows[r].from, x1: Math.min(to, rows[r].to) - rows[r].from, y0: r, y1: r }; },
    fitZ: (b) => Math.log2(partsGeo().w * 0.8 / Math.max(1, b.x1 - b.x0)),
    chars: (z) => partsGeo().w / 2 ** z, zFor: (n2) => Math.log2(partsGeo().w / n2),
  };
  LAYOUTS.density = Object.assign({}, LAYOUTS.line, { name: 'Mix of commands', says: 'The one line as a bar chart: in every stretch, how much of it is each command, stacked from the bottom: +, \u2212, <, >, brackets. Best to see what the text is made of, and where that changes.' });
  LAYOUTS.skyline = Object.assign({}, LAYOUTS.line, { name: 'Skyline', says: 'The one line with a height: how many loops lie inside one another there. Flat where the program only writes numbers, towers in the engine. Best to see where the program is complicated.' });
  LAYOUTS.time = Object.assign({}, LAYOUTS.line, { name: 'Text and time', says: 'Above, the text of the engine; below, the steps one word piece took, measured in a run. A band joins each section of the text to its share of the time. Best to see that a short piece of text can take most of the time.',
    zHome: () => Math.log2(Wd * 0.9 / E.chars), home: () => ({ cx: E.from + E.chars / 2, cy: 0 }) });
  LAYOUTS.three = Object.assign({}, LAYOUTS.line, { name: 'Five programs', says: 'Above, this program; below, all five programs as bars at one scale, cut into the same parts. Best to compare how long they are and what they are made of.' });
  const LINES = { line: 1, lanes: 1, tape: 1, density: 1, skyline: 1, time: 1, three: 1 }, SECOND = { tape: 1, time: 1, three: 1 };      // SECOND: the lower ribbon is something else than the same line closer
  const isLine = () => LINES[layout] === 1;
  let depthData = null, depthWait = null, cmpData = null, cmpWait = null;
  const needDepth = () => { if (!depthData && !depthWait) depthWait = I.get('depth.json').then((d) => { depthData = d; redraw(); }).catch(() => { depthData = false; redraw(); }); return depthData; };
  const needCmp = () => { if (!cmpData && !cmpWait) cmpWait = I.get('/compare.json').then((d) => { cmpData = d; redraw(); }).catch(() => { cmpData = false; redraw(); }); return cmpData; };
  const depthOf = (a, b) => {                                  // the deepest nesting between characters a and b
    const D = depthData, fine = a >= D.engine.from && b - a < D.per * 4, src = fine ? D.engine : D, base = fine ? D.engine.from : 0;
    let m = 0; for (let i = Math.max(0, Math.floor((a - base) / src.per)), e = Math.min(src.bins - 1, Math.floor((Math.max(a, b - 1e-6) - base) / src.per)); i <= e; i++) if (src.max[i] > m) m = src.max[i];
    return m;
  };
  const oneD = () => isLine() || layout === 'parts';              // one pixel is a stretch of the line, not a square of it
  const rowInView = (r, cy) => { const g = partsGeo(); return Math.max(0, Math.min(partRowsOf().length - g.visible, Math.max(r - g.visible + 1, Math.min(r, cy)))); };
  const LY = () => LAYOUTS[layout];
  const zMax = () => (locked ? LY().zHome() + 0.6 : dpr > 1.5 ? 6 : 5);
  const zMin = () => LY().zMin();
  function clampView() { view.z = Math.max(zMin(), Math.min(zMax(), view.z)); LY().clamp(); }
  // the character in the middle of the view
  const centreChar = () => {
    if (isLine()) return Math.max(0, Math.min(total - 1, Math.floor(view.cx)));
    if (layout === 'parts') { const r = partRowsOf()[partRow]; return Math.max(r.from, Math.min(r.to - 1, r.from + Math.floor(view.cx))); }
    if (layout === 'rows') return Math.max(0, Math.min(total - 1, Math.floor(view.cy) * rowW + Math.min(rowW - 1, Math.max(0, Math.floor(view.cx)))));
    return Math.min(total - 1, xy2d(Math.min(SIDE - 1, Math.max(0, Math.floor(view.cx))), Math.min(SIDE - 1, Math.max(0, Math.floor(view.cy)))));
  };
  // the view that has character d in the middle
  const centreOn = (d) => { const [x, y] = LY().pos(d); if (layout === 'parts') { partRow = y; return { cx: x + 0.5, cy: rowInView(y, view.cy) }; } return isLine() ? { cx: d + 0.5, cy: 0 } : { cx: x + 0.5, cy: y + 0.5 }; };

  function size() {
    dpr = window.devicePixelRatio || 1;
    const w = Math.round(frame.clientWidth * dpr), h = Math.round(frame.clientHeight * dpr);
    if (w !== Wd || h !== Hd) { Wd = w; Hd = h; cv.width = w; cv.height = h; }
    fs = APP ? Math.max(1, Math.min(2, parseFloat(getComputedStyle(document.documentElement).fontSize) / 16 || 1)) : 1;
    measure();
  }
  let lastScale = null;
  const sayScale = (t) => { if (t !== lastScale) { lastScale = t; say('m-scale', t); } };

  // ---- drawing
  let shownText = 0, missing = 0;
  function frameTick(now) {
    paintUntil = performance.now() + BUDGET; painted = 0; morePaint = false;
    try { frameBody(now); } finally { paintUntil = Infinity; painted = 0; if (morePaint) redraw(); }      // outside a frame there is no limit
  }
  function frameBody(now) {
    needs = false;
    if (!PAL || !spans || !Wd) return;
    if (morph) { drawMorph(now); return; }
    if (fly) {
      const s = Math.max(0, Math.min(1, (now - fly.t0) / fly.ms)), e = s < 0.5 ? 4 * s * s * s : 1 - Math.pow(-2 * s + 2, 3) / 2;
      const k = Math.min(fly.n, Math.floor(e * fly.n)), fr = e * fly.n - k, u = k >= fly.n ? 1 : fly.u[k] + (fly.u[k + 1] - fly.u[k]) * fr;
      view.z = fly.zs(e); view.cx = fly.a.cx + (fly.b.cx - fly.a.cx) * u; view.cy = fly.a.cy + (fly.b.cy - fly.a.cy) * u;
      if (s >= 1) { view.z = fly.b.z; view.cx = fly.b.cx; view.cy = fly.b.cy; const f = fly; fly = null; settled(); if (f.key) centre(); if (f.then) f.then(); } else redraw();
    } else if (wheel) {
      const dz = wheel.zt - view.z, step = Math.abs(dz) < 0.004 || calm() ? dz : dz * 0.28;
      const wx = view.cx + (wheel.px - Wd / 2) / 2 ** view.z, wy = view.cy + (wheel.py - Hd / 2) / 2 ** view.z;
      const cy0 = view.cy; view.z += step; view.cx = wx - (wheel.px - Wd / 2) / 2 ** view.z; view.cy = layout === 'parts' ? cy0 : wy - (wheel.py - Hd / 2) / 2 ** view.z;
      if (Math.abs(wheel.zt - view.z) < 1e-6) { if (now - wheel.t > 170 && wheel.zt !== Math.round(wheel.zt)) { wheel.zt = Math.round(wheel.zt); redraw(); } else if (wheel.zt === Math.round(wheel.zt)) { view.z = wheel.zt; const key = wheel.key; wheel = null; settled(); if (key) centre(); } else redraw(); } else redraw();
    } else if (drift) driftStep(now);
    clampView();
    const z = view.z, rest = !fly && !wheel && !drift && z === Math.round(z);
    if (rest && !oneD()) { const sc = scale(); view.cx = Math.round(view.cx * sc) / sc; view.cy = Math.round(view.cy * sc) / sc; }      // whole pixels: no blur
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PAL.bgCss; ctx.fillRect(0, 0, Wd, Hd);
    ctx.imageSmoothingEnabled = false;
    shownText = 0; missing = 0;
    if (layout === 'fold') drawFold(); else if (isLine()) drawLine(); else if (layout === 'parts') drawParts(); else drawRows();
    drawNames();
    // the place you chose (a heavier frame) and the place under the pointer or in the middle
    for (const [h, chosen] of [[pin, true], [hover, false]]) {
      if (!h || h.d < 0) continue;
      const boxes = [], lw = Math.max(1, Math.round(dpr)) + (chosen ? 1 : 0);
      if (isLine()) {
        const g = lineGeo(), sc = scale();
        boxes.push([Math.round(sx(h.d)), g.top, Math.max(3, Math.round(sc)), g.bh]);
        if (g.two && !SECOND[layout]) { const m = magState(), X = Math.round((h.d - m.d0) * m.sc); if (X > -m.sc && X < Wd) boxes.push([X, g.mtop, Math.max(3, Math.round(m.sc)), g.mh]); }
      } else if (layout === 'parts') {
        const g = partsGeo(), [x, y] = LY().pos(h.d), Y = g.top + (y - view.cy) * g.pitch; if (Y >= g.top - 1 && Y < Hd) boxes.push([Math.max(g.gut, Math.round(partX(x))), Math.round(Y), Math.max(3, Math.round(scale())), g.rowH]);
      } else {
        const u = layout === 'fold' ? Math.max(1, 2 ** Math.max(0, Math.ceil(-z))) : 1, [x, y] = LY().pos(h.d), S = Math.max(3, Math.round(u * scale()));
        boxes.push([Math.round(sx(x - (x % u))), Math.round(sy(y - (y % u))), S, S]);
      }
      for (const [X, Y, S, H] of boxes) {
        ctx.strokeStyle = PAL.bgCss; ctx.lineWidth = lw + 2 * Math.max(1, Math.round(dpr)); ctx.strokeRect(X - 1.5, Y - 1.5, S + 3, H + 3);
        ctx.strokeStyle = chosen ? '#fff' : 'rgba(255,255,255,.85)'; ctx.lineWidth = lw; ctx.strokeRect(X - 1.5, Y - 1.5, S + 3, H + 3);
      }
    }
    drawMini();
    // the scale, in words
    const per = z >= 0 ? 1 : oneD() ? 2 ** -z : 4 ** -z;
    let t = z >= 0 ? 'One square = one command' + (z >= 3 && layout === 'fold' ? '. The openings show the way the text runs.' : '') : 'One pixel = ' + (per >= 10 ? fmt(per) : per.toFixed(per === Math.round(per) ? 0 : 1)) + ' commands';
    if (z >= -2.001 && missing && !shownText && !locked) t += '. This server cannot send parts of the program: single commands only in the framed patches and the engine.';
    sayScale(t);
  }

  // -- folded --
  function drawFold() {
    const z = view.z, sc = scale(), x0 = view.cx - Wd / 2 / sc, y0 = view.cy - Hd / 2 / sc, x1 = view.cx + Wd / 2 / sc, y1 = view.cy + Hd / 2 / sc;
    // 1. picture tiles
    const cap = locked ? Math.min(TOP, ORDER + Math.ceil(LY().zHome())) : TOP;
    const L = Math.max(LOW, Math.min(cap, Math.ceil(ORDER + z - 1e-9))), ts = 256 * 2 ** (ORDER - L), n = 2 ** (L - 8);
    for (let ty = Math.max(0, Math.floor(y0 / ts)); ty <= Math.min(n - 1, Math.floor(y1 / ts)); ty++) for (let tx = Math.max(0, Math.floor(x0 / ts)); tx <= Math.min(n - 1, Math.floor(x1 / ts)); tx++) {
      const c = tile(L, tx, ty), X = Math.round(sx(tx * ts)), Y = Math.round(sy(ty * ts)), S = Math.round(sx((tx + 1) * ts)) - X;
      ctx.imageSmoothingEnabled = APP && S !== 256 && S < 512;
      if (c) ctx.drawImage(c, X, Y, S, S);
      else if (c === undefined) {                           // not here yet: the nearest coarser tile that is
        for (let l = L - 1, f = 2; l >= LOW; l--, f *= 2) { const p = tile(l, Math.floor(tx / f), Math.floor(ty / f)); if (p) { const w = 256 / f; ctx.drawImage(p, (tx % f) * w, (ty % f) * w, w, w, X, Y, S, S); break; } if (p === null) break; }
      }
    }
    // 2. the text itself, from 16 commands per pixel on: one pixel for 16, 4 or 1 commands
    if (z > -2.001 && !locked) {
      const k = Math.max(0, Math.min(2, Math.ceil(-z - 1e-9))), lastT = SIDE / 256 - 1;
      const tx0 = Math.max(0, Math.floor(x0 / 256)), tx1 = Math.min(lastT, Math.floor(x1 / 256)), ty0 = Math.max(0, Math.floor(y0 / 256)), ty1 = Math.min(lastT, Math.floor(y1 / 256));
      if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) <= 260) {
        ctx.imageSmoothingEnabled = z < -k;
        for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
          const c = Math.floor(xy2d(tx * 256, ty * 256) / CHUNK);
          if (c * CHUNK >= total) continue;
          if (!I.hasChunk(c)) { missing++; continue; }
          const p = foldPiece(c, k);
          if (p) { const X = Math.round(sx(tx * 256)), Y = Math.round(sy(ty * 256)), S = Math.round(sx(tx * 256 + 256)) - X; ctx.drawImage(p, X, Y, S, S); shownText++; }
        }
        ctx.imageSmoothingEnabled = false;
      }
    }
    if (z >= 3) {
      const gw = z >= 5 ? Math.max(2, Math.round(dpr * 1.5)) : 1, glyph = sc >= 11 * dpr;
      const cx0 = Math.max(0, Math.floor(x0)), cy0 = Math.max(0, Math.floor(y0)), cx1 = Math.min(SIDE - 1, Math.floor(x1)), cy1 = Math.min(SIDE - 1, Math.floor(y1));
      ctx.fillStyle = 'rgba(' + PAL.bg.join(',') + ',.9)';
      for (let x = cx0; x <= cx1 + 1; x++) ctx.fillRect(Math.round(sx(x)) - (gw >> 1), 0, gw, Hd);
      for (let y = cy0; y <= cy1 + 1; y++) ctx.fillRect(0, Math.round(sy(y)) - (gw >> 1), Wd, gw);
      if (glyph) { ctx.font = '600 ' + Math.round(sc * 0.6) + 'px ui-monospace, Consolas, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; }
      const inset = Math.max(2, Math.round(sc * 0.22));
      for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) {
        const d = xy2d(x, y); if (d >= total) continue;
        const ch = charAt(d); if (!ch) continue;
        const k = PAL.code[ch], X = Math.round(sx(x)), Y = Math.round(sy(y)), X1 = Math.round(sx(x + 1)), Y1 = Math.round(sy(y + 1)), col = cellRGB(d, k);
        if (d + 1 < total) {                                // the opening towards the next character
          const [nx, ny] = d2xy(d + 1); ctx.fillStyle = css(col);
          if (nx > x) ctx.fillRect(X1 - gw, Y + inset, gw * 2, Y1 - Y - 2 * inset); else if (nx < x) ctx.fillRect(X - gw, Y + inset, gw * 2, Y1 - Y - 2 * inset);
          else if (ny > y) ctx.fillRect(X + inset, Y1 - gw, X1 - X - 2 * inset, gw * 2); else ctx.fillRect(X + inset, Y - gw, X1 - X - 2 * inset, gw * 2);
        }
        cellMarks(d, ch, k, col, X, Y, X1, Y1, glyph, sc);
      }
    }
    // 4. frames around the pieces of the writing part that are stored at full detail
    if (TI.range === false && z >= -5 && z < 0) {
      ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = Math.max(1, Math.round(dpr));
      for (const c of TI.deep.writer) { const [x, y] = d2xy(c * CHUNK), X = sx(x - (x % 256)), Y = sy(y - (y % 256)), S = 256 * sc; if (X + S < 0 || Y + S < 0 || X > Wd || Y > Hd) continue; ctx.strokeRect(Math.round(X) + 0.5, Math.round(Y) + 0.5, Math.round(S) - 1, Math.round(S) - 1); }
    }
  }
  function cellMarks(d, ch, k, col, X, Y, X1, Y1, glyph, sc) {
    if (glyph) { ctx.fillStyle = relLum(col) > 0.179 ? '#000' : '#fff'; ctx.fillText(ch === 45 ? '−' : String.fromCharCode(ch), (X + X1) / 2, (Y + Y1) / 2 + 1); }
    if (starts.length && starts[lower(starts, d)] === d) { ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(2, Math.round(dpr * 2)); ctx.strokeRect(X + 2, Y + 2, X1 - X - 4, Y1 - Y - 4); }
    if (d === E.comma || d === E.dot) { ctx.strokeStyle = d === E.comma ? PAL.cmdCss[7] : PAL.cmdCss[6]; ctx.lineWidth = Math.max(3, Math.round(dpr * 3)); ctx.beginPath(); ctx.arc((X + X1) / 2, (Y + Y1) / 2, sc * 0.95, 0, 7); ctx.stroke(); }
  }

  const MAGK = 32;
  let magAt = null;
  const stripCans = [null, null], stripImgs = [null, null];
  function lineGeo() {
    const u = dpr * fs, pad = 8 * dpr, low = Hd < 240 * dpr, namesTop = miniShown() ? Math.round(miniBox[3] + (low ? 0.5 : 2) * pad) : pad;      // the small map has a band of its own
    const two = APP && Hd >= 380 * dpr;
    const rowH = Math.round(30 * u), rows = low ? 1 : Math.max(2, Math.min(4, Math.floor(Hd * (two ? 0.2 : 0.3) / rowH)));
    const keyH = Math.round(18 * u), rulerH = Math.round(24 * u), unitsH = Hd >= 300 * dpr ? Math.round(42 * u) : 0, headH = Math.round(26 * u);
    const top = namesTop + rows * rowH + keyH;
    const rest = Hd - top - (two ? rulerH + unitsH + headH + rulerH + 34 * dpr : Math.max(rulerH + unitsH + pad, APP ? 62 * dpr : 0));      // the buttons in the corner get a strip of their own
    const bh = Math.max((low ? 20 : 36) * dpr, Math.round(two ? rest * 0.58 : Math.min(rest, 260 * dpr)));
    const mh = two ? Math.max(30 * dpr, rest - bh) : 0, mtop = two ? top + bh + rulerH + unitsH + headH : 0;
    return { u, top, bh, rows, rowH, namesTop, keyH, rulerH, unitsH, headH, two, mtop, mh };
  }
  // which stretch the second ribbon shows: { d0, sc, closer }
  function magState() {
    const sc = scale(), max = 2 ** zMax(), d0 = view.cx - Wd / 2 / sc, d1 = d0 + Wd / sc;
    if (sc * MAGK <= max * 1.0001) {
      const msc = sc * MAGK, span = Wd / msc;
      let c = magAt !== null && magAt >= d0 && magAt <= d1 ? magAt : pin && pin.d >= d0 && pin.d <= d1 ? pin.d + 0.5 : view.cx;
      c = Math.max(Math.min(span / 2, total / 2), Math.min(total - Math.min(span / 2, total / 2), c));
      return { d0: c - span / 2, sc: msc, closer: true };
    }
    const csc = sc / MAGK, span = Wd / csc;
    const c = total <= span ? total / 2 : Math.max(span / 2, Math.min(total - span / 2, view.cx));
    return { d0: c - span / 2, sc: csc, closer: false };
  }
  const LANE = [0, 1, 2, 3, 4, 4, 5, 6];
  function drawStrip(d0, sc, top, bh, which, lo = 0, hi = total) {
    const per = 1 / sc, X = (d) => (d - d0) * sc, inLanes = layout === 'lanes' || mode === 'command';
    if (layout === 'skyline') needDepth();
    if (sc >= 3 * dpr) {                                            // cells in a row
      const a = Math.max(lo, Math.floor(d0)), b = Math.min(hi - 1, Math.ceil(d0 + Wd / sc)), gap = sc >= 6 * dpr ? Math.max(1, Math.round(dpr)) : 0, lane = layout === 'lanes', lh = bh / 7, gs = Math.min(sc, lane ? lh : bh, 34 * dpr), glyph = sc >= 11 * dpr && gs >= 10 * dpr;
      if (lane) { ctx.fillStyle = 'rgba(255,255,255,.05)'; for (let k = 0; k < 7; k++) ctx.fillRect(Math.max(0, X(a)), Math.round(top + k * lh) + 1, Math.min(Wd, X(b + 1)) - Math.max(0, X(a)), Math.round(lh) - 2); }
      if (glyph) { ctx.font = '600 ' + Math.round(gs * 0.6) + 'px ui-monospace, Consolas, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; }
      for (let c = Math.floor(a / CHUNK); c <= Math.floor(b / CHUNK); c++) { if (!I.hasChunk(c)) missing++; else if (text(c)) shownText++; }
      for (let d = a; d <= b; d++) {
        const ch = charAt(d); if (!ch) continue;
        const k = PAL.code[ch], Xa = Math.round(X(d)), Xb = Math.round(X(d + 1)), col = cellRGB(d, k);
        const skyH = layout === 'skyline' && depthData ? Math.max(Math.min(bh, 16 * dpr), Math.round(bh * depthOf(d, d + 1) / depthData.deepest)) : bh;
        const y0 = lane ? Math.round(top + LANE[k] * lh) + 1 : top + bh - skyH, y1 = lane ? Math.round(top + (LANE[k] + 1) * lh) - 1 : top + bh;
        const cc = lane || layout === 'density' ? PAL.cmd[k] : col;
        ctx.fillStyle = css(cc); ctx.fillRect(Xa + gap, y0, Xb - Xa - gap, y1 - y0);
        cellMarks(d, ch, k, cc, Xa + gap, y0, Xb, y1, glyph, gs);
      }
      return;
    }
    const xa = Math.max(0, Math.floor(X(lo))), xb = Math.min(Wd, Math.ceil(X(hi)));
    if (inLanes) {
      const L = Math.max(LOW, Math.min(TOP, ORDER - Math.floor(Math.log(Math.max(1, per)) / Math.log(4) + 1e-9))), lh = bh / 7;
      const cols = [PAL.cmdCss[0], PAL.cmdCss[1], PAL.cmdCss[2], PAL.cmdCss[3], PAL.cmdCss[4]];
      ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.fillRect(xa, top, xb - xa, bh);
      for (let Xp = xa; Xp < xb; Xp++) {
        const m = mixNear(Math.max(0, Math.floor(d0 + Xp * per)), L); if (!m) continue;
        const sh = [m[0], m[1], m[2], m[3], Math.max(0, 15 - m[0] - m[1] - m[2] - m[3])];
        for (let k = 0; k < 5; k++) if (sh[k]) { ctx.globalAlpha = 0.25 + 0.75 * sh[k] / 15; ctx.fillStyle = cols[k]; ctx.fillRect(Xp, top + k * lh + 1, 1, lh - 2); }
      }
      ctx.globalAlpha = 1;
      for (const [d, k, lane] of [[E.dot, 6, 5], [E.comma, 7, 6]]) { const Xp = Math.round(X(d)); if (Xp < -4 || Xp > Wd + 4) continue; ctx.fillStyle = PAL.cmdCss[k]; ctx.fillRect(Xp - 1, top + lane * lh + 1, 3, lh - 2); ctx.beginPath(); ctx.arc(Xp, top + (lane + 0.5) * lh, Math.min(lh * 0.42, 9 * dpr), 0, 7); ctx.strokeStyle = PAL.cmdCss[k]; ctx.lineWidth = Math.max(2, 2 * dpr); ctx.stroke(); }
      const fpx = Math.max(12, Math.min(13, lh / dpr / fs - 5)) * dpr * fs;
      if (lh >= 15 * dpr * fs) {
        ctx.font = '600 ' + Math.round(fpx) + 'px ' + UI; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ['+  add one', '−  take one off', '<  step left', '>  step right', '[ ]  loops', '.  print (once)', ',  read (once)'].forEach((t, k) => { const w = ctx.measureText(t).width + 10 * dpr; ctx.fillStyle = 'rgba(12,13,16,.86)'; ctx.fillRect(2, top + k * lh + 1, w, lh - 2); ctx.fillStyle = '#f3f1ea'; ctx.fillText(t, 2 + 5 * dpr, top + (k + 0.5) * lh + 1); });
      }
      return;
    }
    if (layout === 'density') {                                    // every pixel: the shares of the commands, stacked from the bottom
      const L = Math.max(LOW, Math.min(TOP, ORDER - Math.floor(Math.log(Math.max(1, per)) / Math.log(4) + 1e-9)));
      ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.fillRect(xa, top, xb - xa, bh);
      for (let Xp = xa; Xp < xb; Xp++) {
        const m = mixNear(Math.max(lo, Math.floor(d0 + Xp * per)), L); if (!m) continue;
        const sh = [m[0], m[1], m[2], m[3], Math.max(0, 15 - m[0] - m[1] - m[2] - m[3])]; let y = top + bh;
        for (let k = 0; k < 5; k++) if (sh[k]) { const hh = Math.round(bh * sh[k] / 15); ctx.fillStyle = PAL.cmdCss[k]; ctx.fillRect(Xp, y - hh, 1, hh); y -= hh; }
      }
      const fpx = Math.round(12 * dpr * fs); ctx.font = '700 ' + fpx + 'px ' + UI; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (bh >= 30 * dpr) ['+', '\u2212', '<', '>', '[ ]'].forEach((t, k) => { const w = (k === 4 ? 30 : 20) * dpr * fs, x = 3 * dpr + k * 23 * dpr * fs, y = top + 3 * dpr; ctx.fillStyle = PAL.bgCss; ctx.fillRect(x - dpr, y - dpr, w + 2 * dpr, fpx + 8 * dpr); ctx.fillStyle = PAL.cmdCss[k]; ctx.fillRect(x, y, w, fpx + 6 * dpr); ctx.fillStyle = relLum(PAL.cmd[k]) > 0.179 ? '#000' : '#fff'; ctx.fillText(t, x + w / 2, y + (fpx + 6 * dpr) / 2 + 1); });
      return;
    }
    // columns: one pixel is `per` characters
    if (!stripCans[which]) stripCans[which] = document.createElement('canvas');
    const can = stripCans[which];
    if (can.width !== Wd) { can.width = Wd; can.height = 1; stripImgs[which] = null; }
    const lg = can.getContext('2d'); if (!stripImgs[which]) stripImgs[which] = lg.createImageData(Wd, 1);
    const px = stripImgs[which].data; px.fill(0);
    const sky = layout === 'skyline' && needDepth() ? depthData.deepest : 0;
    const useText = per <= 64 && !locked, L = Math.max(LOW, Math.min(locked ? Math.min(TOP, LOW + 1) : TOP, ORDER - Math.floor(Math.log(Math.max(1, per)) / Math.log(4) + 1e-9)));
    for (let Xp = xa; Xp < xb; Xp++) {
      const a = Math.max(lo, d0 + Xp * per), b = Math.min(hi, a + per); if (b <= a) continue;
      const s = spanAt(Math.floor((a + b) / 2)); let col = null;
      if (useText) {
        const c = Math.floor(a / CHUNK);
        if (!I.hasChunk(c)) missing++; else if (text(c)) {
          let r = 0, g = 0, bl = 0, n = 0;
          for (let d = Math.floor(a); d < b && n < 80; d++) { const k = PAL.code[charAt(d)]; if (k === 255 || k === undefined) continue; const q = PAL.famCmd[spanAt(d).fam][k]; r += q[0]; g += q[1]; bl += q[2]; n++; }
          if (n) { col = [r / n, g / n, bl / n]; shownText++; }
        }
      }
      if (!col) { const m = mixNear(Math.floor(a), L); if (m) col = mixRGB(s.fam, m[0], m[1], m[2], m[3]); }
      if (col && sky) { const hh = Math.max(3 * dpr, Math.round(bh * depthOf(a, b) / sky)); ctx.fillStyle = css(col); ctx.fillRect(Xp, top + bh - hh, 1, hh); }
      else if (col) { px[Xp * 4] = col[0]; px[Xp * 4 + 1] = col[1]; px[Xp * 4 + 2] = col[2]; px[Xp * 4 + 3] = 255; }
    }
    if (sky) {                                                     // the scale of the skyline: lines at every ten loops, the deepest named
      ctx.fillStyle = 'rgba(243,241,234,.35)'; for (let v = 10; v < sky; v += 10) ctx.fillRect(xa, Math.round(top + bh - bh * v / sky), xb - xa, Math.max(1, Math.round(dpr)));
      const t = 'Height: loops inside loops. The top is ' + sky + ', the deepest of this program.'; ctx.font = '600 ' + Math.round(12 * dpr * fs) + 'px ' + UI; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      if (bh > 60 * dpr && ctx.measureText(t).width < Wd - 20 * dpr) { ctx.fillStyle = 'rgba(12,13,16,.85)'; ctx.fillRect(3 * dpr, top + 3 * dpr, ctx.measureText(t).width + 10 * dpr, 20 * dpr * fs); ctx.fillStyle = '#f3f1ea'; ctx.fillText(t, 8 * dpr, top + 7 * dpr); }
      return;
    }
    lg.putImageData(stripImgs[which], 0, 0);
    ctx.drawImage(can, 0, 0, Wd, 1, 0, top, Wd, bh);
    const lw = Math.max(1, Math.round(dpr));
    for (let i = Math.max(1, lower(spanFrom, Math.max(lo, d0))); i < spans.length && spans[i].from < Math.min(hi, d0 + Wd * per); i++) {
      if (spans[i].from > lo && (spans[i].to - spans[i].from) * sc > 6 * dpr && (spans[i - 1].to - spans[i - 1].from) * sc > 6 * dpr) { const Xp = Math.round(X(spans[i].from)); ctx.fillStyle = PAL.bgCss; ctx.fillRect(Xp - lw, top, lw, bh); ctx.fillStyle = 'rgba(243,241,234,.9)'; ctx.fillRect(Xp, top, lw, bh); }
    }
  }
  // the ruler under a ribbon: character numbers
  function ruler(d0, sc, y, xmax, total = W.program.chars, first = 'character 1') {
    const u = dpr * fs, want = 150 * u / sc, mag = 10 ** Math.floor(Math.log10(want)), step = Math.max(1, [1, 2, 5, 10].map((k) => k * mag).find((v) => v >= want) || mag * 10);
    ctx.fillStyle = 'rgba(243,241,234,.85)'; ctx.font = Math.round(12 * u) + 'px ' + UI; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    const a = Math.max(0, Math.round((0 - d0) * sc)), b = Math.min(Wd, Math.round((total - d0) * sc)), lw = Math.max(1, Math.round(dpr));
    ctx.fillRect(a, y + 3 * dpr, b - a, lw);
    for (let v = Math.max(0, Math.ceil(d0 / step) * step); v <= Math.min(total, d0 + Wd / sc); v += step) {
      const Xp = Math.round((v - d0) * sc), t = v === 0 ? first : fmt(v);
      ctx.fillRect(Xp, y + 3 * dpr, lw, 7 * dpr);
      if (Xp + 4 * dpr + ctx.measureText(t).width < xmax) ctx.fillText(t, Xp + 4 * dpr, y + 9 * dpr);
    }
  }
  let tapeRegs = null, tapeFrom = null;
  const cellAt = (d) => { if (d >= W.finalMove.from) return W.program.tape; const i = lower(blocks.off, Math.max(0, d)); if (i < 0) return 0; const b = blocks.get(i); return b.cell + b.K * Math.max(0, Math.min(1, (d - b.off) / b.len)); };
  function drawTape(g, d0, sc, phase) {
    const u = g.u, y = g.mtop, h = g.mh, T = W.program.tape, lw = Math.max(1, Math.round(dpr)), said = (t) => { ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#f3f1ea'; ctx.font = '600 ' + Math.round(12.5 * u) + 'px ' + UI; ctx.fillText(t, 6 * dpr, y - g.headH / 2); };
    if (!blocks) { loadBlocks(); if (phase) said('Reading where every block writes…'); return; }
    const dA = Math.max(0, d0), dB = Math.min(W.finalMove.from, d0 + Wd / sc), cA = cellAt(dA), cB = dB > dA ? cellAt(dB) : cA;
    if (cB - cA < 1) { if (phase) said(d0 + Wd / sc / 2 >= W.finalMove.from ? 'This stretch writes nothing into memory: it is the engine, which works with what is there.' : 'This stretch writes less than one cell of memory.'); return; }
    const xa = Math.max(0, (dA - d0) * sc), xb = Math.min(Wd, (dB - d0) * sc), cx = (c) => xa + (c - cA) / (cB - cA) * (xb - xa);
    if (!tapeRegs) { tapeRegs = W.regions.slice().sort((a, b) => a.from - b.from); tapeFrom = Float64Array.from(tapeRegs, (r) => r.from); }
    if (!phase) {                                               // the bands from the text to the memory, one for each named group
      for (const nm of tierNames(1)) {
        if (nm.to > W.program.writer || nm.to <= dA || nm.from >= dB) continue;
        const a = Math.max(nm.from, dA), b = Math.min(nm.to, dB), x0 = (a - d0) * sc, x1 = (b - d0) * sc, c0 = cx(cellAt(a)), c1 = cx(cellAt(b)), f = PAL.fam[spanAt(a).fam];
        ctx.fillStyle = 'rgba(' + f.map((v) => v | 0).join(',') + ',.38)'; ctx.beginPath(); ctx.moveTo(x0, g.top + g.bh); ctx.lineTo(x1, g.top + g.bh); ctx.lineTo(c1, y); ctx.lineTo(c0, y); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(243,241,234,.55)'; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(x0, g.top + g.bh); ctx.lineTo(c0, y); ctx.moveTo(x1, g.top + g.bh); ctx.lineTo(c1, y); ctx.stroke();
      }
      return;
    }
    said('The memory this text fills: cells ' + fmt(cA + 1) + ' to ' + fmt(cB) + ' of ' + fmt(T));
    // the memory itself: every pixel in the colour of the part that lies there
    let run = -1, start = 0; const letters = [];
    for (let X = Math.floor(xa); X <= Math.ceil(xb); X++) {
      const i = X >= xb ? -2 : Math.max(0, lower(tapeFrom, cA + (X - xa + 0.5) / (xb - xa) * (cB - cA)));
      if (i === run) continue;
      if (run >= 0) { const r = tapeRegs[run], f = PAL.fam[KIND[r.kind].fam], k = r.nonZero === 0 ? 0.45 : 1; ctx.fillStyle = css(f.map((v) => v * k)); ctx.fillRect(start, y, X - start, h); if (X - start > 6 * dpr && start > xa) { ctx.fillStyle = PAL.bgCss; ctx.fillRect(start - lw, y, lw, h); ctx.fillStyle = 'rgba(243,241,234,.9)'; ctx.fillRect(start, y, lw, h); } const L2 = letters[letters.length - 1]; if (L2 && FAM[L2[0]].letter === FAM[KIND[r.kind].fam].letter && L2[2] === start) L2[2] = X; else letters.push([KIND[r.kind].fam, start, X]); }
      run = i; start = X;
    }
    ctx.font = '700 ' + Math.round(11.5 * u) + 'px ' + UI; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const [f, A, B] of letters) { if (B - A < 14 * u) continue; const X = (A + B) / 2; ctx.fillStyle = 'rgba(12,13,16,.82)'; ctx.beginPath(); ctx.arc(X, y + h / 2, 8.5 * u, 0, 7); ctx.fill(); ctx.fillStyle = '#f3f1ea'; ctx.fillText(FAM[f].letter, X, y + h / 2 + 1); }
    // which cell the chosen character writes
    for (const p of [pin, hover]) if (p && p.d >= dA && p.d < dB) { const X = Math.round(cx(cellAt(p.d))); ctx.fillStyle = PAL.bgCss; ctx.fillRect(X - 2 * lw, y - 3 * dpr, 4 * lw, h + 6 * dpr); ctx.fillStyle = '#fff'; ctx.fillRect(X - lw, y - 3 * dpr, 2 * lw, h + 6 * dpr); }
    ctx.fillStyle = 'rgba(243,241,234,.85)'; ctx.font = Math.round(12 * u) + 'px ' + UI; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    const t1 = 'cell ' + fmt(cA + 1), t2 = 'cell ' + fmt(cB), yy = y + h + 6 * dpr, right = Math.min(xb, ctlLeft() - 8 * dpr);
    ctx.fillText(t1, xa + 2 * dpr, yy); if (right - ctx.measureText(t2).width > xa + ctx.measureText(t1).width + 30 * dpr) { ctx.textAlign = 'right'; ctx.fillText(t2, right, yy); }
  }
  function drawTime(g, d0, sc, phase) {
    const C = needCmp(), u = g.u, y = g.mtop, h = g.mh, lw = Math.max(1, Math.round(dpr)), said = (t) => { ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#f3f1ea'; ctx.font = '600 ' + Math.round(12.5 * u) + 'px ' + UI; let q = t; while (q.length > 20 && ctx.measureText(q).width > Wd - 12 * dpr) q = q.slice(0, -2); ctx.fillText(q === t ? t : q + '\u2026', 6 * dpr, y - g.headH / 2); };
    const me = C && C.models && C.models.find((m) => m.id === I.MODEL), st = me && me.steps && me.steps.pos24;
    if (!st) { if (phase) said(C === null ? 'Reading the measured steps\u2026' : 'No steps were measured for this program.'); return; }
    // by section of the text; brnfck-qwen3.5-0.8b counts its four copies of a step apart for this (textSteps)
    const ids = st.textSteps ? me.steps.textSections : me.steps.sections, per = st.textSteps || st.steps, tot = st.total, right = Wd, slices = []; let acc = 0;
    ids.forEach((id, i) => { const sec = E.sections.find((q) => q.id === id), x0 = acc / tot * right; acc += per[i]; if (sec) slices.push({ id, sec, x0, x1: acc / tot * right, steps: per[i] }); });
    if (!phase) {
      for (const q of slices) { const a = (q.sec.from - d0) * sc, b = (q.sec.to - d0) * sc; if (b < 0 || a > Wd || q.x1 - q.x0 < 0.5) continue; const f = PAL.fam[I.SEC[q.id].fam];
        ctx.fillStyle = 'rgba(' + f.map((v) => v | 0).join(',') + ',.4)'; ctx.beginPath(); ctx.moveTo(Math.max(0, a), g.top + g.bh); ctx.lineTo(Math.min(Wd, b), g.top + g.bh); ctx.lineTo(q.x1, y); ctx.lineTo(q.x0, y); ctx.closePath(); ctx.fill();
        if (q.x1 - q.x0 > 4 * dpr) { ctx.strokeStyle = 'rgba(243,241,234,.6)'; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(Math.max(0, a), g.top + g.bh); ctx.lineTo(q.x0, y); ctx.moveTo(Math.min(Wd, b), g.top + g.bh); ctx.lineTo(q.x1, y); ctx.stroke(); } }
      return;
    }
    said('Measured: the ' + fmt(tot) + ' steps of one word piece (position ' + st.position + ' of "' + st.question + '"). Width is steps.');
    for (const q of slices) {
      const w = q.x1 - q.x0; if (w < 0.5) continue; const fam = I.SEC[q.id].fam;
      ctx.fillStyle = css(PAL.fam[fam]); ctx.fillRect(Math.round(q.x0), y, Math.max(1, Math.round(q.x1) - Math.round(q.x0)), h);
      if (w > 6 * dpr) { ctx.fillStyle = PAL.bgCss; ctx.fillRect(Math.round(q.x0) - lw, y, lw, h); ctx.fillStyle = 'rgba(243,241,234,.9)'; ctx.fillRect(Math.round(q.x0), y, lw, h); }
      const name = I.SEC[q.id].name.replace(/^Weights × numbers: /, '\u00d7 '), share = pct(q.steps / tot, 0); ctx.font = '600 ' + Math.round(12 * u) + 'px ' + UI; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const t = [name + ' ' + share, share, FAM[fam].letter].find((x) => ctx.measureText(x).width + 14 * u < w);
      if (t) { const tw = ctx.measureText(t).width + 10 * u; ctx.fillStyle = 'rgba(12,13,16,.85)'; ctx.fillRect((q.x0 + q.x1) / 2 - tw / 2, y + h / 2 - 11 * u, tw, 22 * u); ctx.fillStyle = '#f3f1ea'; ctx.fillText(t, (q.x0 + q.x1) / 2, y + h / 2 + 1); }
    }
    const T = me.timing, foot = T ? 'Once, before the first word piece: writing the numbers, ' + T.writeSeconds + ' s. Then each word piece: about ' + T.perPiece.toFixed(1) + ' s (measured).' : '';
    ctx.font = Math.round(12 * u) + 'px ' + UI; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = 'rgba(243,241,234,.88)'; if (foot && ctx.measureText(foot).width < ctlLeft() - 16 * dpr) ctx.fillText(foot, 6 * dpr, y + h + 7 * dpr);
  }
  // -- the programs: bars at one scale, cut into the same five parts (compare.json) --
  function drawThree(g, d0, sc) {
    const C = needCmp(), u = g.u, y = g.mtop, h = g.mh + g.rulerH, said = (t) => { ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#f3f1ea'; ctx.font = '600 ' + Math.round(12.5 * u) + 'px ' + UI; ctx.fillText(t, 6 * dpr, y - g.headH / 2); };
    if (!C || !C.models) { said(C === null ? 'Reading the programs\u2026' : 'The comparison of the programs is not on this host.'); return; }
    said('The ' + (I.words(C.models.length)) + ' programs at one scale. The frame is what the ribbon above shows.');
    const big = Math.max(...C.models.map((m) => m.chars)), left = 6 * dpr, width = Math.min(Wd, ctlLeft()) - 14 * dpr, rowH = Math.floor(h / C.models.length), barH = Math.max(5 * dpr, rowH - Math.round(20 * u) - 4 * dpr), lw = Math.max(1, Math.round(dpr));
    C.models.forEach((m, r) => {
      const k = m.textKinds, inLayers = Object.keys(k).filter((x) => !['cls', 'emb', 'tokbytes', 'tokids', 'toktable', 'work', 'glob', 'picture'].includes(x)).reduce((a, x) => a + k[x], 0);
      const parts = [['Output table', k.cls, 'out'], [m.layers + ' layers', inLayers, 'ff'], ['Word pieces', k.emb, 'emb'], ['Vocabulary', (k.tokbytes || 0) + (k.toktable || 0) + (k.work || 0) + (k.glob || 0), 'text'], ...(k.picture ? [['Picture part', k.picture, 'pic']] : []), ['Engine', m.engine, 'work']];
      const yy = y + r * rowH, me = m.id === I.MODEL; let x = left;
      ctx.font = (me ? '800 ' : '600 ') + Math.round(12.5 * u) + 'px ' + UI; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = '#f3f1ea';
      ctx.fillText((me ? '\u25A0 ' : '') + m.label + ': ' + I.short(m.chars) + ' characters' + (me ? ' (this one)' : ''), left, yy);
      const by = yy + Math.round(18 * u);
      for (const [name, chars, fam] of parts) {
        const w = chars / big * width; ctx.fillStyle = css(PAL.fam[fam]); ctx.fillRect(Math.round(x), by, Math.max(1, Math.round(x + w) - Math.round(x)), barH);
        if (x > left + 1) { ctx.fillStyle = PAL.bgCss; ctx.fillRect(Math.round(x) - lw, by, lw, barH); ctx.fillStyle = 'rgba(243,241,234,.9)'; ctx.fillRect(Math.round(x), by, lw, barH); }
        ctx.font = '600 ' + Math.round(12 * u) + 'px ' + UI; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const t = [name + ' ' + pct(chars / m.chars, 0), name, name[0]].find((q) => ctx.measureText(q).width + 12 * u < w);
        if (t && barH >= 20 * u) { const tw = ctx.measureText(t).width + 8 * u; ctx.fillStyle = 'rgba(12,13,16,.85)'; ctx.fillRect(x + w / 2 - tw / 2, by + barH / 2 - 10 * u, tw, 20 * u); ctx.fillStyle = '#f3f1ea'; ctx.fillText(t, x + w / 2, by + barH / 2 + 1); }
        x += w;
      }
      if (me) { const a = Math.max(0, d0) / big * width + left, b = Math.min(total, d0 + Wd / sc) / big * width + left; ctx.lineWidth = lw * 3; ctx.strokeStyle = PAL.bgCss; ctx.strokeRect(a, by - lw, Math.max(4 * dpr, b - a), barH + 2 * lw); ctx.lineWidth = lw; ctx.strokeStyle = '#fff'; ctx.strokeRect(a, by - lw, Math.max(4 * dpr, b - a), barH + 2 * lw); }
    });
  }
  // -- part by part: a row for each part --
  function drawParts() {
    const g = partsGeo(), rows = partRowsOf(), sc = scale(), u = g.u, x0 = view.cx - g.w / 2 / sc;
    ruler(x0 - g.gut / sc, sc, 2 * dpr, Wd - 4 * dpr, rows.longest, 'start of each part');
    for (let r = Math.max(0, Math.floor(view.cy)); r < rows.length; r++) {
      const y = Math.round(g.top + (r - view.cy) * g.pitch); if (r >= Math.floor(view.cy) + g.visible) break; if (y < g.top - 1) continue;
      const row = rows[r];
      ctx.save(); ctx.beginPath(); ctx.rect(g.gut, y, g.w, g.rowH); ctx.clip();
      drawStrip(row.from + x0 - g.gut / sc, sc, y, g.rowH, 2 + r, row.from, row.to);
      // the letter of every stretch that is wide enough
      if (mode === 'purpose' && g.rowH >= 17 * u && sc < 3 * dpr) for (let i = Math.max(0, lower(spanFrom, row.from)), j; i < spans.length && spans[i].from < row.to; i = j + 1) {
        for (j = i; j + 1 < spans.length && spans[j + 1].from < row.to && FAM[spans[j + 1].fam].letter === FAM[spans[i].fam].letter; j++);
        const a = Math.max(g.gut, partX(spans[i].from - row.from)), b = Math.min(Wd, partX(spans[j].to - row.from)); if (b - a < 22 * u) continue;
        ctx.fillStyle = 'rgba(12,13,16,.82)'; ctx.beginPath(); ctx.arc(a + 11 * u, y + g.rowH / 2, 8 * u, 0, 7); ctx.fill();
        ctx.font = '700 ' + Math.round(11 * u) + 'px ' + UI; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#f3f1ea'; ctx.fillText(FAM[spans[i].fam].letter, a + 11 * u, y + g.rowH / 2 + 1);
      }
      ctx.restore();
      // its name and its length, in the margin; the row the keys work in has a mark
      const here = r === partRow; let name = row.name; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      ctx.font = (here ? '700 ' : '') + Math.round(12.5 * u) + 'px ' + UI; ctx.fillStyle = '#f3f1ea';
      const size = I.short(row.to - row.from), room = g.gut - 14 * dpr;
      if (ctx.measureText(name + '  ' + size).width > room) name = name.replace(/^Layer /, 'L').replace('Table of word pieces', 'Word pieces').replace('Walk to the engine', 'Walk');
      const full = ctx.measureText(name + '  ' + size).width <= room;
      if (ctx.measureText(name).width <= room) ctx.fillText(name, 10 * dpr, y + g.rowH / 2 + 1);
      if (full) { ctx.font = Math.round(12 * u) + 'px ' + UI; ctx.fillStyle = 'rgba(243,241,234,.8)'; ctx.textAlign = 'right'; ctx.fillText(size, g.gut - 6 * dpr, y + g.rowH / 2 + 1); }
      if (here) { ctx.fillStyle = '#f3f1ea'; ctx.fillRect(2 * dpr, y, 4 * dpr, g.rowH); }
    }
    if (rows.length > g.visible) { ctx.font = Math.round(12 * u) + 'px ' + UI; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillStyle = 'rgba(243,241,234,.85)'; const t = 'Rows ' + (Math.floor(view.cy) + 1) + ' to ' + Math.min(rows.length, Math.floor(view.cy) + g.visible) + ' of ' + rows.length, t2 = t + ': drag up or down, or use the arrow keys', room = ctlLeft() - 20 * dpr; ctx.fillText(ctx.measureText(t2).width < room ? t2 : t, 10 * dpr, Hd - 8 * dpr); }
  }
  function drawLine() {
    const g = lineGeo(), u = g.u, sc = scale(), d0 = view.cx - Wd / 2 / sc, free = ctlLeft() - 8 * dpr, m = g.two && !SECOND[layout] ? magState() : null;
    if (layout === 'tape' && g.two) drawTape(g, d0, sc, 0);
    if (layout === 'time' && g.two) drawTime(g, d0, sc, 0);
    // the lens: a light wedge from the stretch that is shown twice to the ribbon that shows it
    if (m) {
      const a = m.closer ? (m.d0 - d0) * sc : 0, b = m.closer ? a + Wd / MAGK : Wd, c = m.closer ? 0 : (d0 - m.d0) * m.sc, d = m.closer ? Wd : c + Wd / MAGK;
      ctx.fillStyle = 'rgba(243,241,234,.09)'; ctx.beginPath(); ctx.moveTo(a, g.top + g.bh); ctx.lineTo(b, g.top + g.bh); ctx.lineTo(d, g.mtop); ctx.lineTo(c, g.mtop); ctx.closePath(); ctx.fill();
    }
    drawStrip(d0, sc, g.top, g.bh, 0);
    ruler(d0, sc, g.top + g.bh, g.two ? Wd - 4 * dpr : free);
    // the same stretch in human units, so that the length is felt
    if (g.unitsH && !(SECOND[layout] && layout !== 'three' && g.two)) {
      const n = Math.min(total, Wd / sc), pages = n / 1800, secs = n, y = g.top + g.bh + g.rulerH + 2 * dpr, mid = (g.two ? Wd : free) / 2, room = (g.two ? Wd : free) - 16 * dpr;
      const dur = secs < 90 ? Math.round(secs) + ' seconds' : secs < 5400 ? Math.round(secs / 60) + ' minutes' : secs < 172800 ? Math.round(secs / 3600) + ' hours' : secs < 63072000 ? Math.round(secs / 86400) + ' days' : (secs / 31557600).toFixed(1) + ' years';
      const book = pages < 1.5 ? 'less than two pages of a book' : pages < 600 ? fmt(pages) + ' pages of a book' : fmt(pages / 300) + ' books of 300 pages, ' + (pages / 300 * 0.025 < 10 ? (pages / 300 * 0.025).toFixed(1) : fmt(pages / 300 * 0.025)) + ' m of shelf';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = 'rgba(243,241,234,.88)'; ctx.font = Math.round(12 * u) + 'px ' + UI;
      const t0 = 'In view: ' + fmt(n) + ' characters.', t1 = t0 + ' Printed: ' + book + '.', t2 = 'Read aloud, one command a second: ' + dur + '.', fits = (t) => ctx.measureText(t).width < room;
      if (fits(t1 + ' ' + t2)) ctx.fillText(t1 + ' ' + t2, mid, y + 4 * u);
      else if (fits(t1) && fits(t2)) { ctx.fillText(t1, mid, y); ctx.fillText(t2, mid, y + 17 * u); }
      else if (fits(t0)) { ctx.fillText(t0, mid, y); const b2 = 'Printed: ' + book + '.', b3 = 'Printed: ' + book.split(',')[0] + '.'; if (fits(b2)) ctx.fillText(b2, mid, y + 17 * u); else if (fits(b3)) ctx.fillText(b3, mid, y + 17 * u); }
    }
    if (layout === 'tape' && g.two) drawTape(g, d0, sc, 1);
    if (layout === 'time' && g.two) drawTime(g, d0, sc, 1);
    if (layout === 'three' && g.two) drawThree(g, d0, sc);
    if (!m) return;
    const n2 = Math.min(total, Wd / m.sc), head = m.closer ? '32 times closer: the ' + fmt(n2) + ' characters ' + (magAt !== null && magAt >= d0 && magAt <= d0 + Wd / sc ? 'under the pointer' : pin && pin.d >= d0 && pin.d <= d0 + Wd / sc ? 'around the chosen character' : 'in the middle') : '32 times wider: ' + fmt(n2) + ' characters around this view (the frame)';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#f3f1ea'; ctx.font = '600 ' + Math.round(12.5 * u) + 'px ' + UI;
    ctx.fillText(head, 6 * dpr, g.mtop - g.headH / 2);
    drawStrip(m.d0, m.sc, g.mtop, g.mh, 1);
    ruler(m.d0, m.sc, g.mtop + g.mh, free);
    // the frame around the stretch that the other ribbon shows
    const fx = m.closer ? (m.d0 - d0) * sc : (d0 - m.d0) * m.sc, fy = m.closer ? g.top : g.mtop, fh = m.closer ? g.bh : g.mh, fw = Wd / MAGK, lw = Math.max(1, Math.round(dpr));
    ctx.lineWidth = lw * 3; ctx.strokeStyle = PAL.bgCss; ctx.strokeRect(Math.round(fx) - lw * 0.5, fy - lw * 0.5, Math.round(fw) + lw, fh + lw);
    ctx.lineWidth = lw; ctx.strokeStyle = '#fff'; ctx.strokeRect(Math.round(fx) - lw * 0.5, fy - lw * 0.5, Math.round(fw) + lw, fh + lw);
  }

  // -- rows --
  const rowTiles = new Map();
  function rowTile(tx, ty) {                                        // 256 x 256 cells of the page, one pixel per command
    const key = mode + '/' + rowW + '/' + tx + '/' + ty; let c = rowTiles.get(key);
    if (c) return c;
    const w = Math.min(256, rowW - tx * 256), need = new Set();
    for (let r = 0; r < 256; r++) { const d = (ty * 256 + r) * rowW + tx * 256; if (d >= total) break; need.add(Math.floor(d / CHUNK)); need.add(Math.floor(Math.min(total - 1, d + w - 1) / CHUNK)); }
    let ok = true; for (const q of need) { if (!I.hasChunk(q)) { missing++; ok = false; } else if (!text(q)) ok = false; }
    if (!ok || !mayPaint()) return null;
    c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d'), img = g.createImageData(256, 256), px = img.data;
    for (let r = 0; r < 256; r++) {
      const d0 = (ty * 256 + r) * rowW + tx * 256; if (d0 >= total) break;
      let si = Math.max(0, lower(spanFrom, d0));
      for (let x = 0; x < w; x++) { const d = d0 + x; if (d >= total) break; while (si + 1 < spans.length && spans[si + 1].from <= d) si++; const k = PAL.code[charAt(d)]; if (k === 255 || k === undefined) continue; const col = mode === 'purpose' ? PAL.famCmd[spans[si].fam][k] : PAL.cmd[k], q = (r * 256 + x) * 4; px[q] = col[0]; px[q + 1] = col[1]; px[q + 2] = col[2]; px[q + 3] = 255; }
    }
    g.putImageData(img, 0, 0); rowTiles.set(key, c);
    if (rowTiles.size > 160) rowTiles.delete(rowTiles.keys().next().value);
    return c;
  }
  function drawRows() {
    const z = view.z, sc = scale(), rows = Math.ceil(total / rowW), x0 = view.cx - Wd / 2 / sc, y0 = view.cy - Hd / 2 / sc, x1 = view.cx + Wd / 2 / sc, y1 = view.cy + Hd / 2 / sc;
    // the page
    ctx.fillStyle = 'rgba(255,255,255,.045)'; ctx.fillRect(Math.round(sx(0)), Math.round(sy(Math.max(0, y0))), Math.round(rowW * sc), Math.round((Math.min(rows, y1) - Math.max(0, y0)) * sc));
    if (z < 3) {
      ctx.imageSmoothingEnabled = z < 0;
      for (let ty = Math.max(0, Math.floor(y0 / 256)); ty <= Math.floor(Math.min(rows, y1) / 256); ty++) for (let tx = Math.max(0, Math.floor(x0 / 256)); tx <= Math.floor((Math.min(rowW, x1) - 1) / 256); tx++) {
        const c = rowTile(tx, ty);
        if (c) { const X = Math.round(sx(tx * 256)), Y = Math.round(sy(ty * 256)), S = Math.round(sx(tx * 256 + 256)) - X; ctx.drawImage(c, X, Y, S, S); shownText++; }
      }
      ctx.imageSmoothingEnabled = false;
    } else {
      const glyph = sc >= 11 * dpr, gap = Math.max(1, Math.round(dpr)), cx0 = Math.max(0, Math.floor(x0)), cx1 = Math.min(rowW - 1, Math.floor(x1)), cy0 = Math.max(0, Math.floor(y0)), cy1 = Math.min(rows - 1, Math.floor(y1));
      if (glyph) { ctx.font = '600 ' + Math.round(sc * 0.6) + 'px ui-monospace, Consolas, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; }
      for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) {
        const d = y * rowW + x; if (d >= total) break;
        const c = Math.floor(d / CHUNK); if (!textCache.has(c)) { if (!I.hasChunk(c)) missing++; else text(c); }
        const ch = charAt(d); if (!ch) continue;
        const k = PAL.code[ch], X = Math.round(sx(x)), Y = Math.round(sy(y)), X1 = Math.round(sx(x + 1)), Y1 = Math.round(sy(y + 1)), col = cellRGB(d, k);
        ctx.fillStyle = css(col); ctx.fillRect(X + gap, Y + gap, X1 - X - gap, Y1 - Y - gap); shownText++;
        cellMarks(d, ch, k, col, X + gap, Y + gap, X1, Y1, glyph, sc);
      }
    }
    // the number of the first character of a row, in the margin
    const every = Math.max(1, 2 ** Math.ceil(Math.log2(56 * dpr / sc))), mx = Math.round(sx(0)) - 8 * dpr;
    if (mx > 60 * dpr) { ctx.fillStyle = 'rgba(243,241,234,.6)'; ctx.font = Math.round(11 * dpr) + 'px ' + UI; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; for (let y = Math.max(0, Math.ceil(y0 / every) * every); y < Math.min(rows, y1); y += every) ctx.fillText(fmt(y * rowW + 1), mx, sy(y + 0.5)); }
  }

  const FONT = ['600 13px ' + UI, '600 13px ' + UI, '12px ' + UI, '12px ' + UI];
  const fontOf = (tier) => FONT[tier].replace(/(\d+(\.\d+)?)px/, (m, v) => Math.round(v * dpr * fs) + 'px');
  let bsq = null, bsqAt = 0, bySize = null;
  // the largest square inside every block of the writing part, for its name; worked out over several
  // frames (there are hundreds of thousands), straight from blocks.bin: kind at byte 20, length at byte 8
  const blockSquares = () => {
    if (!bsq) { bsq = []; bsqAt = 0; }
    const R = W.blocks.record, dv = blocks.dv;
    while (bsqAt < blocks.n) {
      if (bsqAt % 2048 === 0 && !mayPaint()) break;
      const i = bsqAt++; if (dv.getUint8(i * R + 20) !== 0) continue;
      const from = blocks.off[i], q = bigSquare(from, from + dv.getUint32(i * R + 8, true)); q.i = i; bsq.push(q);
    }
    return bsq;
  };
  const tierNames = (tier) => { if (!bySize) bySize = [0, 1, 2, 3].map((t) => names.filter((n) => n.tier === t).sort((a, b) => (b.to - b.from) - (a.to - a.from))); return bySize[tier]; };
  function drawNames() {
    const sc = scale(), u = dpr * fs, placed = avoid.map((r) => r.slice()), bh = Math.round(22 * u), edge = 3 * dpr;
    const width = (t, tier) => { ctx.font = fontOf(tier); return ctx.measureText(t).width + 14 * u; };
    const free = (r) => { for (const p of placed) if (r[0] < p[2] && r[2] > p[0] && r[1] < p[3] && r[3] > p[1]) return false; return true; };
    const str = (t) => (typeof t === 'function' ? t() : t);
    const put = (texts, tier, X, Y, lo, hi, max) => {
      if (!labelsOn) return null;
      lo = Math.max(edge, lo); hi = Math.min(Wd - edge, hi); Y = Math.max(bh / 2 + edge, Math.min(Hd - bh / 2 - edge, Y));
      for (const raw of texts) {
        const t = str(raw); if (!t) continue;
        const bw = width(t, tier); if (bw > hi - lo || (max && bw > max)) continue;
        const x0 = Math.round(Math.max(lo, Math.min(hi - bw, X - bw / 2))), r = [x0, Math.round(Y - bh / 2), x0 + bw, Math.round(Y - bh / 2) + bh];
        if (!free(r)) continue;
        placed.push(r);
        ctx.fillStyle = tier === 0 ? 'rgba(12,13,16,.9)' : 'rgba(12,13,16,.8)';
        ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(r[0], r[1], bw, bh, 6 * dpr); else ctx.rect(r[0], r[1], bw, bh); ctx.fill();
        ctx.font = fontOf(tier); ctx.fillStyle = '#f3f1ea'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t, (r[0] + r[2]) / 2, (r[1] + r[3]) / 2 + 1);
        return r;
      }
      return null;
    };
    const letter = (fam, X, Y) => {                                // the letter of a kind of part, on a small dark disc
      const R = 8.5 * u, r = [X - R, Y - R, X + R, Y + R];
      if (r[0] < 0 || r[1] < 0 || r[2] > Wd || r[3] > Hd || !free(r)) return;
      placed.push(r);
      ctx.fillStyle = 'rgba(12,13,16,.82)'; ctx.beginPath(); ctx.arc(X, Y, R, 0, 7); ctx.fill();
      ctx.font = '700 ' + Math.round(11.5 * u) + 'px ' + UI; ctx.fillStyle = '#f3f1ea'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(FAM[fam].letter, X, Y + 1);
    };
    if (layout === 'parts') return;                              // its rows carry their own names
    if (layout === 'fold') {
      const maxSide = 1.25 * Math.max(Wd, Hd);
      const putF = (texts, tier, q) => {
        const S = q.side * sc; if ((S < 34 * dpr && tier > 0) || (tier < 3 && S > maxSide * (tier === 0 ? 1.6 : 2.2))) return;
        if (tier === 0 && S * 1.42 < 6 * dpr) return;
        const x0 = sx(q.x), y0 = sy(q.y), vx0 = Math.max(0, x0), vx1 = Math.min(Wd, x0 + S), vy0 = Math.max(0, y0), vy1 = Math.min(Hd, y0 + S);
        if (vx1 - vx0 < Math.min(S, 40 * dpr) || vy1 - vy0 < Math.min(S, 24 * dpr)) return;      // too little of it in view to hang a name on
        put(texts, tier, (vx0 + vx1) / 2, (vy0 + vy1) / 2, tier === 0 ? 0 : vx0 - (tier === 1 ? S * 0.2 : 0), tier === 0 ? Wd : vx1 + (tier === 1 ? S * 0.2 : 0), tier > 1 ? S * 0.96 : 0);
      };
      for (let tier = 3; tier >= 0; tier--) {
        if (tier === 3 && blocks && view.z >= -4) for (const q of blockSquares()) {
          const S = q.side * sc, x = sx(q.x), y = sy(q.y);                   // most blocks are too small or out of view: no name made for those
          if (S < 34 * dpr || x > Wd || y > Hd || x + S < 0 || y + S < 0) continue;
          putF([() => 'Block ' + fmt(q.i + 1)], 3, q);
        }
        for (const n of tierNames(tier)) putF(n.texts, tier, n.q || (n.q = bigSquare(n.from, n.to)));
      }
      // a letter on every part that is large enough and has no name on it
      if (mode === 'purpose' && !locked) for (const s of spans) {
        const q = s.q || (s.q = bigSquare(s.from, s.to)), S = q.side * sc; if (S < 20 * u) continue;
        const X = sx(q.x + q.side / 2), Y = sy(q.y + q.side / 2); if (X < 0 || Y < 0 || X > Wd || Y > Hd) continue;
        letter(s.fam, Math.round(X), Math.round(Y));
      }
    } else if (isLine()) {
      // a timeline: a bracket over each named stretch, the larger ones higher up
      const g = lineGeo(), d0 = view.cx - Wd / 2 / sc, d1 = d0 + Wd / sc, X = (d) => (d - d0) * sc, lw = Math.max(1, Math.round(dpr));
      const rowOf = (tier) => Math.min(tier, g.rows - 1), rowY = (tier) => g.namesTop + rowOf(tier) * g.rowH + bh / 2 + 2 * dpr;
      const putL = (texts, tier, from, to) => {
        if (to <= d0 || from >= d1) return;
        const a = X(from), b = X(to), w = b - a; if (w < (tier === 3 ? 26 : tier === 2 ? 4 : 2) * dpr) return;
        const va = Math.max(0, a), vb = Math.min(Wd, b), Y = rowY(tier);
        const r = put(texts, tier, (va + vb) / 2, Y, 0, Wd, tier === 3 ? w * 0.98 : 0); if (!r) return;
        // the bracket: from the start of the stretch to its end, under the name
        const y1 = r[3] + 3 * dpr, y2 = y1 + 4 * dpr, xa = Math.max(-20, a), xb = Math.min(Wd + 20, b);
        ctx.strokeStyle = 'rgba(243,241,234,.8)'; ctx.lineWidth = lw; ctx.beginPath();
        if (xb - xa < 3 * dpr) { ctx.moveTo((xa + xb) / 2, y1 - 2 * dpr); ctx.lineTo((xa + xb) / 2, y2 + 2 * dpr); }
        else { ctx.moveTo(xa + 0.5, y2); ctx.lineTo(xa + 0.5, y1); ctx.lineTo(xb - 0.5, y1); ctx.lineTo(xb - 0.5, y2); }
        ctx.stroke();
        placed.push([Math.max(0, xa), y1 - dpr, Math.min(Wd, xb), y2 + dpr]);
      };
      for (let tier = 3; tier >= 0; tier--) {
        if (tier === 3 && blocks && sc * 20000 > 60 * dpr) for (let i = Math.max(0, lower(blocks.off, d0)); i < blocks.n && blocks.off[i] < d1; i++) { const b = blocks.get(i); if (b.kind === 0) putL([() => 'Block ' + fmt(i + 1)], 3, b.off, b.off + b.len); }
        for (const n of tierNames(tier)) putL(n.texts, tier, n.from, n.to);
      }
      // the row of letters right above the ribbon: what kind of part every stretch is
      if (mode === 'purpose') {
        const y = g.top - g.keyH / 2;
        ctx.font = '700 ' + Math.round(11.5 * u) + 'px ' + UI; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#f3f1ea';
        let last = -1e9;
        for (let i = Math.max(0, lower(spanFrom, Math.max(0, d0))), j; i < spans.length && spans[i].from < d1; i = j + 1) {
          for (j = i; j + 1 < spans.length && spans[j + 1].from < d1 && FAM[spans[j + 1].fam].letter === FAM[spans[i].fam].letter; j++);      // neighbours of one kind share a letter
          const a = Math.max(0, X(spans[i].from)), b = Math.min(Wd, X(spans[j].to)); if (b - a < 12 * u) continue;
          const mid = (a + b) / 2; if (mid - last < 13 * u) continue;
          ctx.fillText(FAM[spans[i].fam].letter, mid, y); last = mid;
          if (b - a > 40 * u) { ctx.globalAlpha = 0.55; ctx.fillRect(a + 2 * dpr, Math.round(y), mid - a - 9 * u, lw); ctx.fillRect(mid + 7 * u, Math.round(y), b - mid - 9 * u, lw); ctx.globalAlpha = 1; }
        }
      }
    } else {
      // rows: a name where its stretch begins; the larger ones first when there is no room for all
      const y0 = view.cy - Hd / 2 / sc, y1 = view.cy + Hd / 2 / sc, d0 = Math.max(0, Math.floor(y0) * rowW), d1 = Math.min(total, Math.ceil(y1) * rowW), any = placed.length;
      const putR = (texts, tier, from, to) => {
        if (from < d0 || from >= d1) return;
        if ((to - from) / rowW * sc < 26 * dpr && tier > 0) return;
        const X = sx(from % rowW), Y = sy(Math.floor(from / rowW)) - bh / 2 - 2 * dpr, w = width(str(texts[0]), tier);
        if (put(texts, tier, X + w / 2, Y, 0, Wd, 0)) { ctx.fillStyle = '#f3f1ea'; ctx.fillRect(Math.round(X), Math.round(sy(Math.floor(from / rowW))) - 2 * dpr, Math.max(3, sc), 2 * dpr); }
      };
      for (let tier = 0; tier <= 3; tier++) {
        for (const n of tierNames(tier)) putR(n.texts, tier, n.from, n.to);
        if (tier === 3 && blocks) for (let i = Math.max(0, lower(blocks.off, d0)); i < blocks.n && blocks.off[i] < d1; i++) { const b = blocks.get(i); if (b.kind === 0) putR([() => 'Block ' + fmt(i + 1)], 3, b.off, b.off + b.len); }
      }
      // where you are, when no name begins in view
      if (placed.length === any && d0 < total) { const s = spanAt(centreChar()), t = (s.part ? 'The engine: ' : '') + s.title.replace(/ \(.*\)$/, ''); put([t, s.short], 1, Wd / 2, bh / 2 + 4 * dpr, 0, Wd, 0); }
    }
  }

  let miniStrip = null, miniBox = [0, 0, 0, 0];
  const miniShown = () => !!mini && !mini.hidden && miniBox[2] > miniBox[0];
  function drawMini() {
    if (!miniShown()) return;
    const g = mini.getContext('2d'), N = mini.width, M = mini.height, lw = Math.max(1.5, dpr);
    g.imageSmoothingEnabled = true; g.fillStyle = PAL.bgCss; g.fillRect(0, 0, N, M);
    const sc = scale();
    const frameBox = (X, Y, X1, Y1) => {
      if (X1 - X < 5 * dpr || Y1 - Y < 5 * dpr) { const mx = (X + X1) / 2, my = (Y + Y1) / 2; g.lineWidth = lw * 3; g.strokeStyle = '#000'; g.beginPath(); g.arc(mx, my, 5 * dpr, 0, 7); g.stroke(); g.lineWidth = lw; g.strokeStyle = '#fff'; g.beginPath(); g.arc(mx, my, 5 * dpr, 0, 7); g.stroke(); return; }
      g.lineWidth = lw * 3; g.strokeStyle = '#000'; g.strokeRect(X + lw, Y + lw, X1 - X - 2 * lw, Y1 - Y - 2 * lw); g.lineWidth = lw; g.strokeStyle = '#fff'; g.strokeRect(X + lw, Y + lw, X1 - X - 2 * lw, Y1 - Y - 2 * lw);
    };
    if (layout === 'fold') {
      const c = tile(8, 0, 0), s = N / SIDE, x0 = view.cx - Wd / 2 / sc, y0 = view.cy - Hd / 2 / sc, x1 = view.cx + Wd / 2 / sc, y1 = view.cy + Hd / 2 / sc;
      if (c) g.drawImage(c, 0, 0, N, M);
      frameBox(Math.max(0, x0) * s, Math.max(0, y0) * s, Math.min(SIDE, x1) * s, Math.min(SIDE, y1) * s);
      return;
    }
    // line and rows: the whole program as a strip, across for the line, downwards for the rows
    const len = isLine() ? N : M, key = mode + layout + len;
    if (!miniStrip || miniStrip.key !== key || !miniStrip.done) {
      const off = document.createElement('canvas'); off.width = len; off.height = 1;
      const og = off.getContext('2d'), im = og.createImageData(len, 1); let done = true;
      for (let i = 0; i < len; i++) { const d = Math.floor((i + 0.5) / len * total), m = mixAt(d, LOW); if (!m) { done = false; continue; } const c = mixRGB(spanAt(d).fam, m[0], m[1], m[2], m[3]); im.data[i * 4] = c[0]; im.data[i * 4 + 1] = c[1]; im.data[i * 4 + 2] = c[2]; im.data[i * 4 + 3] = 255; }
      og.putImageData(im, 0, 0);
      miniStrip = { key, done, off };
    }
    if (isLine()) {
      g.drawImage(miniStrip.off, 0, 0, N, 1, 0, 0, N, M);
      frameBox(Math.max(0, (view.cx - Wd / 2 / sc) / total) * N, 0, Math.min(1, (view.cx + Wd / 2 / sc) / total) * N, M);
    } else {
      g.save(); g.translate(N, 0); g.rotate(Math.PI / 2); g.drawImage(miniStrip.off, 0, 0, M, 1, 0, 0, M, N); g.restore();
      const rows = total / rowW; frameBox(0, Math.max(0, (view.cy - Hd / 2 / sc) / rows) * M, N, Math.min(1, (view.cy + Hd / 2 / sc) / rows) * M);
    }
  }
  let avoid = [];
  function measure() {
    const r0 = cv.getBoundingClientRect();
    avoid = [...frame.querySelectorAll('[data-avoid]')].filter((n) => !n.hidden && n.getClientRects().length).map((n) => { const r = n.getBoundingClientRect(), p = 6; return [(r.left - r0.left - p) * dpr, (r.top - r0.top - p) * dpr, (r.right - r0.left + p) * dpr, (r.bottom - r0.top + p) * dpr]; });
    miniBox = [0, 0, 0, 0];
    if (mini && !mini.hidden && mini.clientWidth) {
      const r = mini.getBoundingClientRect(), w = Math.round(r.width * Math.min(2, dpr)), h = Math.round(r.height * Math.min(2, dpr));
      if (mini.width !== w || mini.height !== h) { mini.width = w; mini.height = h; miniStrip = null; }
      miniBox = [(r.left - r0.left) * dpr, (r.top - r0.top) * dpr, (r.right - r0.left) * dpr, (r.bottom - r0.top) * dpr];
    }
  }
  // where the buttons in the lower right corner begin: text under the ribbons ends before them
  const ctlLeft = () => { let x = Wd; for (const r of avoid) if (r[3] > Hd - 70 * dpr && r[0] > Wd / 2) x = Math.min(x, r[0]); return x; };

  // ---- from one layout to another
  function schematic(lay) {
    const k = 5, n = 4 ** k, per = SIDE * SIDE / n, count = Math.ceil(total / per), out = new Float32Array(count * 4);
    if (lay === 'fold') { const S = Math.min(Wd, Hd) * 0.84, c = S / 2 ** k, ox = (Wd - S) / 2, oy = (Hd - S) / 2; for (let j = 0; j < count; j++) { const [X, Y] = d2xy(j * per); out.set([ox + Math.floor(X / 2 ** (ORDER - k)) * c, oy + Math.floor(Y / 2 ** (ORDER - k)) * c, c, c], j * 4); } }
    else if (lay === 'parts') { const g = partsGeo(), rows = partRowsOf(), sc = 2 ** LAYOUTS.parts.zHome(); for (let j = 0; j < count; j++) { const d = Math.min(total - 1, j * per), r = Math.max(0, lower(partFrom, d)); out.set([g.gut + 6 * dpr + (d - rows[r].from) * sc, g.top + r * g.pitch, Math.max(1, per * sc), g.rowH], j * 4); } }
    else if (LINES[lay]) { const g = lineGeo(), w = Wd * 0.94 / (total / per); for (let j = 0; j < count; j++) out.set([Wd * 0.03 + j * w, g.top, w, g.bh], j * 4); }
    else { const h = Hd * 0.9 / (total / per), w = Math.max(6 * dpr, Math.min(Wd * 0.3, 90 * dpr)); for (let j = 0; j < count; j++) out.set([Wd / 2 - w / 2, Hd * 0.05 + j * h, w, h], j * 4); }
    return { rects: out, count, per };
  }
  function drawMorph(now) {
    const m = morph, s = Math.max(0, Math.min(1, (now - m.t0) / m.ms)), n = m.a.count, A = m.a.rects, B = m.b.rects;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = PAL.bgCss; ctx.fillRect(0, 0, Wd, Hd);
    for (let j = 0; j < n; j++) {
      // the pieces go one after the other, from the first character on
      const local = Math.max(0, Math.min(1, s * 1.6 - (j / n) * 0.6)), e = local < 0.5 ? 2 * local * local : 1 - Math.pow(-2 * local + 2, 2) / 2, o = j * 4;
      const x = A[o] + (B[o] - A[o]) * e, y = A[o + 1] + (B[o + 1] - A[o + 1]) * e, w = A[o + 2] + (B[o + 2] - A[o + 2]) * e, h = A[o + 3] + (B[o + 3] - A[o + 3]) * e;
      ctx.fillStyle = m.cols[j]; ctx.fillRect(x, y, Math.max(1, w + 0.5), Math.max(1, h + 0.5));
    }
    if (s >= 1) { const then = m.then; morph = null; then(); }
    redraw();
  }
  const zEquivalent = (from, to, z) => Math.round(Math.max(LAYOUTS[to].zMin(), Math.min(5, z >= 0 ? z : Math.min(-0.01, LAYOUTS[to].zFor(LAYOUTS[from].chars(z))))) * 4) / 4;
  function setLayout(next, opt = {}) {
    if (next === 'tree') { fly = null; wheel = null; morph = null; showTree(true); markLayout('tree'); if (opt.then) opt.then(); return; }
    const fromTree = frame.classList.contains('tree');
    showTree(false);
    if (next === layout && !opt.force) { markLayout(next); if (fromTree) { measure(); redraw(); } if (opt.then) opt.then(); return; }
    const d = opt.d !== undefined ? opt.d : pin ? pin.d : centreChar(), wasHome = Math.abs(view.z - LY().zHome()) < 0.3, prev = layout, zOld = view.z;
    const arrive = () => {
      layout = next; markLayout(next); measure(); tileCache.clear(); bsq = null; magAt = null;
      const h = LY().home(); view.z = LY().zHome(); view.cx = h.cx; view.cy = h.cy; clampView();
      if (opt.home || (wasHome && opt.d === undefined && opt.z === undefined)) { settled(); if (APP && !opt.then) centre(); redraw(); if (opt.then) opt.then(); return; }
      const z = Math.max(zMin(), Math.min(zMax(), opt.z !== undefined ? opt.z : zEquivalent(prev, next, zOld)));
      view.z = z; const c = centreOn(d); view.z = LY().zHome();
      if (opt.jump || calm()) { view.z = z; view.cx = c.cx; view.cy = c.cy; clampView(); settled(); if (APP && !opt.then) centre(); redraw(); if (opt.then) opt.then(); }
      else flyTo({ cx: c.cx, cy: c.cy, z }, 0, opt.then || (APP ? centre : undefined));
    };
    fly = null; wheel = null; stopDrift();
    const fam = (l) => (LINES[l] ? 'line' : l);
    if (opt.jump || calm() || !inited || fam(prev) === fam(next) || fromTree) { arrive(); return; }
    const a = schematic(prev), b = schematic(next), cols = [];
    for (let j = 0; j < a.count; j++) { const dd = Math.min(total - 1, (j + 0.5) * a.per), s = spanAt(dd), m = mode === 'purpose' ? null : mixAt(dd, LOW); cols.push(m ? css(mixRGB(s.fam, m[0], m[1], m[2], m[3])) : css(PAL.fam[s.fam])); }
    morph = { a, b, cols, t0: performance.now() + 60, ms: 1500, then: arrive };
    sayScale(next === 'fold' ? 'The line is folded into a square…' : next === 'rows' ? 'The line is cut into rows…' : next === 'parts' ? 'The line is cut into its parts…' : 'The picture is unrolled into one line…');
    redraw();
  }
  const SAYS_TREE = 'An outline of the program: every named part as text, with where it is, how long it is and what it does. Open a part like a folder; "Show" goes to it on the map. Best to find something by name, and for a screen reader.';
  function markLayout(which) {
    const box = $('m-layout'); if (box) [...box.children].forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.layout === which)));
    say('m-layout-said', which === 'tree' ? SAYS_TREE : LAYOUTS[which].says);
    const rw = $('m-roww-wrap'); if (rw) rw.hidden = which !== 'rows';
    frame.dataset.layout = which; frame.dataset.shape = LINES[which] ? 'line' : which;
    emit('layout', which);
  }

  // ---- the outline
  let treeBuilt = false, lastCanvasLayout = 'fold';
  function showTree(yes) {
    const box = $('m-tree'); if (!box) return;
    box.hidden = !yes; frame.classList.toggle('tree', yes);
    if (yes && !treeBuilt) { treeBuilt = true; box.textContent = ''; box.append(el('p', 'treehint', 'The program as nested parts. For each: its name, its share of the part it lies in (the bar), its length in characters, where it starts and ends, and what it does. "Show" goes to that part on the map.'), node(tree, total)); }
  }
  function node(t, parentSize) {
    const size = t.to - t.from, row = el('span', 'trow'), bar = el('i', 'tbar'), fill = el('i'), go = el('button', 'quiet tgo', 'Show');
    fill.style.width = Math.max(1, 100 * size / parentSize) + '%'; fill.style.background = t.fam ? 'var(' + FAM[t.fam].v + ')' : 'var(--map-ink)'; bar.append(fill); bar.setAttribute('aria-hidden', 'true');
    go.type = 'button'; go.setAttribute('aria-label', 'Show on the map: ' + t.text);
    go.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); touched = true; setLayout(lastCanvasLayout, { force: true, jump: true, home: true }); flyToRange(t.from, t.to); loadBlocks(); emit('shown', t); });
    const label = el('span', 'tname'); if (t.fam) label.append(I.swatch(t.fam)); label.append(t.text);
    const num = el('span', 'tnum', fmt(size) + ' characters · ' + (size / total < 0.0005 ? 'under 0.1%' : pct(size / total)));
    const says = el('span', 'tsays', 'Characters ' + fmt(t.from + 1) + ' to ' + fmt(t.to) + '. ' + (t.span ? t.span.says : t.says || ''));
    const hasKids = t.kids ? t.kids.length > 0 : !!(t.span && t.span.part === 0 && t.span.blocks > 0);
    row.append(label, bar, num, go);
    if (!hasKids) { const d = el('div', 'tleaf'); d.append(row, says); return d; }
    const det = el('details', 'tnode'), sum = el('summary'); sum.append(row); det.append(sum, says);
    const fillKids = () => {
      if (det.dataset.done) return; det.dataset.done = '1';
      const inner = el('div', 'tkids');
      if (t.kids) t.kids.forEach((k) => inner.append(node(k, size)));
      else { inner.append(el('p', 'treehint', 'Reading the list of blocks…')); loadBlocks().then(() => { inner.textContent = ''; let n = 0; for (let i = Math.max(0, lower(blocks.off, t.from)); i < blocks.n && blocks.off[i] < t.to; i++) { const b = blocks.get(i); if (b.kind !== 0 || b.off < t.from) continue; if (++n > 60) { inner.append(el('p', 'treehint', '… and ' + fmt(t.span.blocks - 60) + ' more blocks like these.')); break; } inner.append(node({ text: 'Block ' + fmt(i + 1) + ': ' + fmt(b.K) + ' cells of the tape', from: b.off, to: b.off + b.len, fam: t.fam, says: blockSays(b) }, size)); } }); }
      det.append(inner);
    };
    det.addEventListener('toggle', () => { if (det.open) fillKids(); });
    if (t.open) { det.open = true; fillKids(); }
    return det;
  }

  // ---- moving about
  function flyTo(b, ms, then) {
    wheel = null; stopDrift();
    const a = { cx: view.cx, cy: view.cy, z: view.z };
    b = { cx: b.cx, cy: b.cy, z: Math.max(zMin(), Math.min(zMax(), b.z)) };
    const dist = Math.hypot(b.cx - a.cx, b.cy - a.cy);
    const zSee = dist > 0 ? Math.log2(Math.min(Wd, oneD() ? Wd : Hd) / (Math.max(1e-9, layout === 'parts' ? Math.abs(b.cx - a.cx) : dist) * 1.5)) : Infinity, zTop = Math.max(zMin(), Math.min(a.z, b.z, zSee));
    const dip = Math.max(0, (a.z + b.z) / 2 - zTop);
    const zs = (e) => a.z + (b.z - a.z) * e - 4 * e * (1 - e) * dip;
    const n = 240, u = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) u[i + 1] = u[i] + 2 ** -zs((i + 0.5) / n);
    for (let i = 0; i <= n; i++) u[i] /= u[n];
    const travel = (a.z - zTop) + (b.z - zTop) + dip;
    fly = { a, b, zs, u, n, t0: performance.now(), ms: ms || Math.min(5200, 700 + 330 * travel), then };
    if (calm() || (dist === 0 && a.z === b.z)) fly.ms = 1;
    redraw();
  }
  function flyToRange(from, to, then) {
    to = Math.min(to, total);
    const b = LY().box(from, to), z = Math.floor(LY().fitZ(b) * 2) / 2, [x, y] = LY().pos(from);
    pin = { x, y, d: from }; magAt = null; if (layout === 'parts') { partRow = y; b.y0 = b.y1 = rowInView(y, view.cy); }
    flyTo({ cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, z }, 0, then); describe(pin, true); touched = true;
  }
  function flyToChar(d, z, then) {
    const [x, y] = LY().pos(d); pin = { x, y, d }; magAt = null;
    const c = centreOn(d);
    flyTo({ cx: c.cx, cy: c.cy, z }, 0, then); describe(pin, true); touched = true;
  }
  const zoomBy = (dz, px, py) => { fly = null; stopDrift(); if (calm()) dz = dz > 0 ? Math.max(1, Math.round(dz)) : Math.min(-1, Math.round(dz)); const zt = Math.max(zMin(), Math.min(zMax(), (wheel ? wheel.zt : view.z) + dz)); wheel = { zt, px: px === undefined ? Wd / 2 : px, py: py === undefined ? Hd / 2 : py, t: performance.now() }; touched = true; redraw(); };
  const home = (then) => { const h = LY().home(); flyTo({ cx: h.cx, cy: h.cy, z: LY().zHome() }, 0, then); };
  const panBy = (fx, fy) => { wheel = null; const sc = scale(), dx = fx * Wd / sc, dy = fy * Hd / sc;
    if (layout === 'parts') { if (fy) { partRow = Math.max(0, Math.min(partRowsOf().length - 1, partRow + Math.sign(fy) * Math.max(1, Math.round(Math.abs(fy) * 4)))); view.cy = rowInView(partRow, view.cy); } flyTo({ cx: view.cx + dx, cy: view.cy, z: view.z }, 140); fly.key = true; touched = true; return; } flyTo({ cx: view.cx + (isLine() ? dx + fy * Wd / sc : dx), cy: view.cy + dy, z: view.z }, 140); fly.key = true; touched = true; };
  function goTo(p, opt = {}) {
    unlock(); touched = true;
    if (p.mode) setMode(p.mode);
    going = true;
    const arrived = () => { going = false; if (opt.hash) { clearTimeout(hashTimer); history.replaceState(null, '', opt.hash); } else settled(); if (opt.then) opt.then(); };
    const go = () => { if (p.home) { pin = null; magAt = null; home(() => { if (APP) centre(); arrived(); }); } else if (p.at !== undefined) flyToChar(p.at, p.z, arrived); else if (p.from !== undefined) flyToRange(p.from, p.to, arrived); else arrived(); loadBlocks(); };
    const want = p.layout || (frame.classList.contains('tree') ? lastCanvasLayout : layout);
    lastCanvasLayout = want;
    if (want !== layout || frame.classList.contains('tree')) setLayout(want, { home: true, jump: opt.jump, then: go }); else go();
  }

  // the picture on the about page moves a little by itself until someone touches it
  let drift = null;
  const stopDrift = () => { drift = null; };
  function driftStep(now) {
    const t = (now - drift.t0) / 1000, h = LY().home(), z0 = LY().zHome();
    view.z = z0 + 0.05 + 0.05 * Math.sin(t / 9 - 1.2); view.cx = h.cx + SIDE * 0.02 * Math.sin(t / 13); view.cy = h.cy + SIDE * 0.012 * Math.cos(t / 11);
    redraw();
  }

  function centre() { const d = centreChar(); if (d >= 0) { const [x, y] = LY().pos(d); hover = { x, y, d }; describe(hover, false); redraw(); } }
  let hashTimer = 0, going = false;            // going: on the way to a place; its address is written on arrival
  function settled() {
    emit('settle');
    if (!touched || HERO || going) return;
    clearTimeout(hashTimer);
    hashTimer = setTimeout(() => { history.replaceState(null, '', hashNow()); emit('hash'); }, 400);
  }
  const hashNow = () => '#map=' + (centreChar() + 1) + ',' + (Math.round(view.z * 4) / 4) + ',' + layout + (layout === 'rows' ? ',' + rowW : '') + (mode === 'command' ? ',command' : '');

  // ---- what is here
  function info(d) {
    const s = spanAt(d), part = s.part ? 'The engine' : 'The writing part';
    let more = '';
    if (s.part) { const m = markAt(d); if (m) more = 'Here: ' + I.markLabel(m).toLowerCase() + '.'; }
    else { const b = blockAt(d); if (b) more = blockSays(b); }
    return { d, span: s, part, title: s.title, says: s.says, more };
  }
  function describe(h, pinned) {
    if (!h || h.d < 0) return;
    const where = $('m-where'), what = $('m-what'), snip = $('m-snip'); if (!where) return;
    const z = fly ? fly.b.z : view.z, per = z >= 0 ? 1 : oneD() ? Math.ceil(2 ** -z) : 4 ** Math.ceil(-z - 1e-9), d = h.d, i = info(d);
    where.textContent = '';
    const name = el('b'); name.append(el('span', 'part', i.part + ' › '), i.title);
    where.append((pinned ? 'Chosen: character ' : 'Character ') + fmt(d + 1), el('span', 'of', ' of ' + fmt(total)), ' · ', name);
    if (what) { what.textContent = i.says + (i.more ? ' ' + i.more : ''); if (!i.span.part && !i.more && !locked && view.z >= LY().zHome() + 2) loadBlocks(); }
    if (!snip) return;
    snip.textContent = '';
    const c = Math.floor(d / CHUNK), u = per <= 16 ? text(c) : null;
    if (u) {
      const a = Math.max(c * CHUNK, d - 28), b = Math.min((c + 1) * CHUNK, total, d + 40); let t = '';
      for (let k = a; k < d; k++) t += String.fromCharCode(u[k - c * CHUNK]);
      const mk = document.createElement('mark'); mk.textContent = String.fromCharCode(u[d - c * CHUNK]);
      let t2 = ''; for (let k = d + 1; k < b; k++) t2 += String.fromCharCode(u[k - c * CHUNK]);
      snip.append(t, mk, t2);
    } else if (per > 1) {
      const L = Math.max(LOW, Math.min(TOP, ORDER - Math.round(Math.log(per) / Math.log(4)))), m = mixNear(d, L);
      if (m) snip.textContent = 'Around it:  +  ' + Math.round(m[0] / 15 * 100) + '%    −  ' + Math.round(m[1] / 15 * 100) + '%    <  ' + Math.round(m[2] / 15 * 100) + '%    >  ' + Math.round(m[3] / 15 * 100) + '%    [ ]  ' + Math.round(Math.max(0, 15 - m[0] - m[1] - m[2] - m[3]) / 15 * 100) + '%';
    } else if (!I.hasChunk(c) && !locked) snip.textContent = '(this server cannot send the commands of this spot)';
  }
  // the program text around character h.d, set out to be read, into #m-open
  async function openText(h) {
    const box = $('m-open'), code = $('m-open-code'); if (!box || !code) return;
    const d = h.d, s = spanAt(d);
    let from = Math.max(0, d - 160), marks = [];
    if (s.part) { const m = markAt(d); marks = E.marks.filter((q) => q.from >= s.from && q.to <= s.to).map((q) => ({ ...q, label: I.markLabel(q) })); if (m && d - m.from < 1500) from = m.from; else if (d - s.from < 1500) from = s.from; }
    else { const b = blockAt(d); if (b && d - b.off < 1500) from = b.off; }
    box.hidden = false; code.textContent = ''; say('m-open-title', 'The text from character ' + fmt(from + 1));
    const i = info(d), about = $('m-open-about'); if (about) { about.textContent = ''; about.append(el('b', '', i.part + ' › ' + i.title + '. '), i.says + (i.more ? ' ' + i.more : '')); }
    const t = await I.textAt(from, 2600);
    if (t === null) {
      const p = el('div', 'gapline', 'This web server cannot send a part of the program file, so the commands of this spot cannot be shown. Start the site with  python tools/serve.py  to read every character. ');
      const near = nearestStored(d), b = el('button', 'quiet', 'Fly to the nearest stored patch'); b.type = 'button'; b.addEventListener('click', () => flyToChar(near, 3));
      p.append(b); code.append(p); return;
    }
    code.append(I.pretty(t, from, marks, 160)); code.scrollTop = 0;
  }
  const nearestStored = (d) => { let best = TI.deep.engineFirst * CHUNK, bd = Math.abs(best - d); for (const c of TI.deep.writer) { const m = c * CHUNK + 300, q = Math.abs(m - d); if (q < bd) { bd = q; best = m; } } return Math.min(best, total - 1); };

  // ---- input
  const cellOf = (e) => {
    const r = cv.getBoundingClientRect(), px = (e.clientX - r.left) * dpr, py = (e.clientY - r.top) * dpr;
    if (isLine()) {
      const g = lineGeo();
      if (g.two && SECOND[layout] && py >= g.mtop - 4 * dpr) return null;
      if (g.two && py >= g.mtop - 4 * dpr && py <= g.mtop + g.mh + g.rulerH) { const m = magState(), d = Math.floor(m.d0 + px / m.sc); return d >= 0 && d < total ? { x: d, y: -0.5, d, px, py, second: true } : null; }
      if (py < g.namesTop || py > g.top + g.bh + g.rulerH + g.unitsH) return null;
      const d = Math.floor(view.cx + (px - Wd / 2) / scale()); return d >= 0 && d < total ? { x: d, y: -0.5, d, px, py } : null;
    }
    if (layout === 'parts') { const g = partsGeo(), r = Math.floor((py - g.top) / g.pitch + view.cy); if (px < g.gut || py < g.top) return null; const d = LY().at(view.cx + (px - g.gut - g.w / 2) / scale(), r); if (d < 0) return null; return { x: d - partRowsOf()[r].from, y: r, d, px, py }; }
    const wx = view.cx + (px - Wd / 2) / scale(), wy = view.cy + (py - Hd / 2) / scale();
    const d = LY().at(wx, wy); if (d < 0) return null;
    const [x, y] = LY().pos(d); return { x, y, d, px, py };
  };
  function unlock() {                                     // the about page: from a picture to the real map
    if (!locked) return;
    locked = false; stopDrift(); I.canRange().then((r) => { TI.range = r; redraw(); });
  }
  const ALWAYS = frame.hasAttribute('data-live');          // a page that is the map: it never has to be woken
  const setLive = (yes) => { if (!yes && ALWAYS) return; if (yes) unlock(); live = yes; frame.classList.toggle('live', yes); frame.classList.toggle('idle', !yes); };
  const ptrs = new Map(); let drag = null, pinch = null;
  cv.addEventListener('pointerdown', (e) => {
    if (!live) { if (e.pointerType === 'mouse') setLive(true); else return; }
    going = false; emit('user', 'pointer');
    cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); fly = null; wheel = null;
    if (ptrs.size === 1) { drag = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy, moved: 0 }; cv.classList.add('drag'); }
    else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: view.z }; drag = null; }
  });
  cv.addEventListener('pointermove', (e) => {
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch && ptrs.size === 2) {                         // two fingers: zoom towards the point between them, and move with it
      const [a, b] = [...ptrs.values()], r = cv.getBoundingClientRect(), d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const px = ((a[0] + b[0]) / 2 - r.left) * dpr, py = ((a[1] + b[1]) / 2 - r.top) * dpr, wx = view.cx + (px - Wd / 2) / 2 ** view.z, wy = view.cy + (py - Hd / 2) / 2 ** view.z;
      view.z = Math.max(zMin(), Math.min(zMax(), pinch.z + Math.log2(d / pinch.d)));
      view.cx = wx - (px - Wd / 2) / 2 ** view.z; if (layout !== 'parts') view.cy = wy - (py - Hd / 2) / 2 ** view.z; touched = true; redraw(); return;
    }
    if (drag) {
      const dx = (e.clientX - drag.x) * dpr, dy = (e.clientY - drag.y) * dpr; drag.moved = Math.max(drag.moved, Math.abs(dx) + Math.abs(dy));
      view.cx = drag.cx - dx / 2 ** view.z; view.cy = layout === 'parts' ? drag.cy - dy / partsGeo().pitch : drag.cy - dy / 2 ** view.z; if (layout === 'parts') { LY().clamp(); const g = partsGeo(); partRow = Math.max(Math.ceil(view.cy), Math.min(Math.floor(view.cy) + g.visible - 1, partRow)); } touched = true; redraw(); return;
    }
    if (!live && HERO) return;
    hover = cellOf(e);
    if (hover) { if (isLine() && !hover.second) magAt = hover.d + 0.5; describe(hover, false); }
    redraw();
  });
  let lastTap = null;                                    // a second tap soon after the first, in the same place: zoom in there
  const up = (e) => {
    const was = drag; ptrs.delete(e.pointerId); cv.classList.remove('drag');
    if (pinch && ptrs.size < 2) { pinch = null; wheel = { zt: Math.round(view.z), px: Wd / 2, py: Hd / 2, t: 0 }; redraw(); }
    if (ptrs.size === 0) drag = null;
    if (was && was.moved < 6 * dpr && e.type === 'pointerup') {
      const now = performance.now(), r = cv.getBoundingClientRect(), px = (e.clientX - r.left) * dpr, py = (e.clientY - r.top) * dpr;
      if (lastTap && now - lastTap.t < 350 && Math.hypot(px - lastTap.px, py - lastTap.py) < 30 * dpr) { lastTap = null; zoomBy(1, px, isLine() ? Hd / 2 : py); return; }
      lastTap = { t: now, px, py };
      const h = cellOf(e);
      if (h) { pin = h; if (layout === 'parts') partRow = h.y; if (isLine() && !h.second) magAt = h.d + 0.5; describe(h, true); loadBlocks(); if (APP) emit('select', h); else if (e.pointerType === 'mouse') openText(h); else setTimeout(() => { if (lastTap && lastTap.t === now) openText(h); }, 360); }
    }
    else if (was) settled();
    redraw();
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('pointerleave', () => { hover = null; if (pin) describe(pin, true); else if (APP && inited) { const d = centreChar(), [x, y] = LY().pos(d); describe({ x, y, d }, false); } redraw(); });
  cv.addEventListener('wheel', (e) => {
    if (!live) return;
    e.preventDefault(); going = false; emit('user', 'wheel');
    const r = cv.getBoundingClientRect(), unit = e.deltaMode === 1 ? 33 : 1;
    zoomBy(Math.max(-1, Math.min(1, -e.deltaY * unit / 240)), (e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr);
  }, { passive: false });
  cv.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || !inited) return;
    const k = e.key;
    if (k === 'Escape') { setLive(false); return; }
    if (k === 'Enter' || k === ' ') { e.preventDefault(); setLive(true); going = false; emit('user', 'key'); const d = centreChar(), [x, y] = LY().pos(d); pin = { x, y, d }; describe(pin, true); loadBlocks(); redraw(); if (APP) emit('read', pin); else openText(pin); return; }
    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown' || k === 'PageUp' || k === 'PageDown') {
      e.preventDefault(); setLive(true); going = false; emit('user', 'key');
      const s = Math.min(0.25, 90 * dpr / Math.min(Wd, Hd));
      panBy(k === 'ArrowLeft' ? -s : k === 'ArrowRight' ? s : 0, k === 'ArrowUp' ? -s : k === 'ArrowDown' ? s : k === 'PageUp' ? -0.8 : k === 'PageDown' ? 0.8 : 0);
    }
    else if (k === '+' || k === '=') { e.preventDefault(); setLive(true); going = false; emit('user', 'key'); zoomBy(1); wheel.key = true; }
    else if (k === '-' || k === '_') { e.preventDefault(); setLive(true); going = false; emit('user', 'key'); zoomBy(-1); wheel.key = true; }
    else if (k === '0' || k === 'Home') { e.preventDefault(); setLive(true); going = false; emit('user', 'key'); pin = null; magAt = null; home(() => centre()); }
  });
  document.addEventListener('pointerdown', (e) => { if (live && !frame.contains(e.target)) setLive(false); });
  on('m-in', 'click', () => { setLive(true); going = false; emit('user', 'button'); zoomBy(1); wheel.key = true; }); on('m-out', 'click', () => { setLive(true); going = false; emit('user', 'button'); zoomBy(-1); wheel.key = true; }); on('m-home', 'click', () => { setLive(true); going = false; emit('user', 'button'); touched = true; pin = null; magAt = null; home(() => centre()); });
  if (mini) {
    const miniGo = (e) => { const r = mini.getBoundingClientRect(), fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height; if (layout === 'fold') { view.cx = fx * SIDE; view.cy = fy * SIDE; } else if (isLine()) view.cx = fx * total; else view.cy = fy * total / rowW; fly = null; wheel = null; magAt = null; touched = true; redraw(); settled(); };
    mini.addEventListener('pointerdown', (e) => { setLive(true); going = false; emit('user', 'pointer'); mini.setPointerCapture(e.pointerId); miniGo(e); mini.onpointermove = miniGo; e.stopPropagation(); });
    mini.addEventListener('pointerup', () => { mini.onpointermove = null; centre(); });
    mini.addEventListener('pointercancel', () => { mini.onpointermove = null; });
  }
  const repaint = () => { tileCache.clear(); rowTiles.clear(); miniStrip = null; for (const o of textCache.values()) o.cv = {}; redraw(); };
  function setMode(m) {
    if (m !== 'purpose' && m !== 'command') return;
    const was = mode; mode = m;
    if (was !== m) { legend(); repaint(); emit('mode', m); if (inited) settled(); }
  }
  function setRowW(n) {
    if (![64, 128, 256, 512, 1024].includes(n) || n === rowW) return;
    const d = pin ? pin.d : centreChar(); rowW = n; rowTiles.clear(); const s = $('m-roww'); if (s) s.value = String(n);
    if (layout === 'rows') { view.z = Math.max(zMin(), Math.min(view.z, LAYOUTS.rows.zHome() + 2)); const c = centreOn(d); view.cx = c.cx; view.cy = c.cy; clampView(); touched = true; settled(); redraw(); }
  }
  on('m-layout', 'click', (e) => { const b = e.target.closest('button'); if (!b || !inited) return; going = false; emit('user', 'button'); unlock(); if (b.dataset.layout !== 'tree') lastCanvasLayout = b.dataset.layout; touched = true; setLayout(b.dataset.layout); });
  on('m-roww', 'change', () => setRowW(Number($('m-roww').value)));

  const SAYS_MODE = {
    purpose: 'A colour is one part of the model; its letter is in the key below and on the map. Lighter: adding and taking off. Darker: walking. Best to see what a stretch of the program is for.',
    command: 'A colour is one of the eight commands. Far out, a pixel is the mix of the commands under it; close up, every square has its sign in it. In the one-line layout it becomes lanes, one for each command. Best to see what the text itself is made of.',
  };
  function legend() {
    say('m-mode-said', SAYS_MODE[mode]);
    const box = $('m-legend'); if (!box) return; box.textContent = '';
    if (mode === 'purpose') I.LEGEND.forEach(([k, name]) => { const li = el('li'); li.append(I.swatch(k), name); box.append(li); });
    else CMD.forEach(([ch, name, v]) => { const li = el('li'), sw = el('i', 'sw cmd', ch === '-' ? '−' : ch); sw.style.background = 'var(' + v + ')'; sw.setAttribute('aria-hidden', 'true'); if (v === '--c-lt' || v === '--c-close') sw.classList.add('dark'); li.append(sw, el('code', '', ch === '-' ? '−' : ch), ' ' + name); box.append(li); });
  }
  function fromHash() {
    const m = /^#map=(\d+),(-?[\d.]+)(?:,(line|rows|fold|lanes|parts|tape|density|skyline|time|three))?(?:,(\d+))?(?:,(purpose|command))?$/.exec(location.hash);
    if (!m) return false;
    const d = Math.max(0, Math.min(total - 1, Number(m[1]) - 1));
    if (m[4] && [64, 128, 256, 512, 1024].includes(Number(m[4]))) { rowW = Number(m[4]); const s = $('m-roww'); if (s) s.value = String(rowW); }
    layout = m[3] || 'fold'; lastCanvasLayout = layout; showTree(false); markLayout(layout); measure();
    setMode(m[5] || 'purpose');
    view.z = Math.max(zMin(), Math.min(zMax(), Number(m[2]))); const c = centreOn(d); view.cx = c.cx; view.cy = c.cy; clampView(); touched = true;
    return true;
  }

  // ---- start
  frame.classList.add('idle');
  let initing = null, startedOk = null;
  const started = new Promise((r) => { startedOk = r; });
  const init = () => initing || (initing = init1());
  const init1 = async () => {
    await ready; palette(); size();
    starts = Float64Array.from([...spans.map((s) => s.from), ...E.marks.map((m) => m.from)].sort((a, b) => a - b));
    const want = frame.dataset.layout0; if (want && LAYOUTS[want]) layout = want;
    lastCanvasLayout = layout; markLayout(layout); measure();
    const h = LY().home(); view.z = LY().zHome(); view.cx = h.cx; view.cy = h.cy;
    if (!HERO && fromHash()) { setLive(true); loadBlocks(); }
    const show = HERO ? null : /^#show=(\d+),(\d+)$/.exec(location.hash);
    legend(); inited = true;
    if (ALWAYS) setLive(true);
    if (show) { const a = Math.max(0, Math.min(total - 1, Number(show[1]) - 1)), b = Math.max(a + 1, Math.min(total, Number(show[2]))); setLive(true); flyToRange(a, b); loadBlocks(); }
    if (HERO && !calm()) drift = { t0: performance.now() };
    if (APP && !show) centre();
    redraw();
    const nr = $('m-norange'); if (nr && TI.range === false) nr.hidden = false;
    new ResizeObserver(() => { const w = Wd, h = Hd; size(); if (w !== Wd || h !== Hd || APP) redraw();      /* the squares of the blocks do not depend on the size */ }).observe(frame);
    I.onTheme(() => { palette(); repaint(); });
    if (!HERO) window.addEventListener('hashchange', () => {
      const s = /^#show=(\d+),(\d+)$/.exec(location.hash);
      if (s) { const a = Math.max(0, Math.min(total - 1, Number(s[1]) - 1)); flyToRange(a, Math.max(a + 1, Math.min(total, Number(s[2])))); loadBlocks(); }
      else if (fromHash()) { redraw(); centre(); }
    });
    startedOk();
  };
  if (frame.hasAttribute('data-now')) init();
  else I.lazy(frame, init);

  const whenReady = (fn) => (...a) => { const go = () => { setLive(true); return fn(...a); }; return inited ? go() : init().then(go); };
  const onCanvas = () => { if (frame.classList.contains('tree')) setLayout(lastCanvasLayout, { force: true, jump: true, home: true }); };
  window.InsideMap = {
    on: (ev, fn) => { (subs[ev] = subs[ev] || []).push(fn); },
    ready, started, LAYOUTS, SAYS_TREE,
    goTo: whenReady(goTo),
    flyToChar: whenReady((d, z, then) => { onCanvas(); flyToChar(d, z, then); loadBlocks(); }),
    setLayout: whenReady((l, o) => { if (l !== 'tree') lastCanvasLayout = l; touched = true; setLayout(l, o); }),
    setMode: whenReady(setMode),
    setLabels: (yes) => { labelsOn = !!yes; redraw(); },
    zoomBy: whenReady((dz) => { zoomBy(dz); wheel.key = true; }), panBy: whenReady(panBy), home: whenReady(() => { pin = null; magAt = null; touched = true; home(() => centre()); }),
    openText: whenReady(openText), info: (d) => info(d), centreChar: () => centreChar(), hashNow: () => hashNow(),
    refresh: () => { if (!inited) return; size(); measure(); redraw(); },
    get spans() { return spans; }, get names() { return names; }, get places() { return places; }, get pin() { return pin; }, get total() { return total; },
    get view() { return { layout, z: view.z, zHome: LY().zHome(), Wd, zMax: zMax(), fly: !!fly, wheel: !!wheel, tree: frame.classList.contains('tree') }; },
  };
})();
