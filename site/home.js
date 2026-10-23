// The chat on the home page (index.html): land, type, read.
(async () => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;
  const size = ProgramStart.size;

  const MODELS = {
    small: { name: 'small', label: 'brnfck-smollm2-135m', model: 'SmolLM2-135M-Instruct', worker: 'workers/brnfck-smollm2-135m.js?v=r10',
      manifestUrl: 'dist/small/manifest.json', metaUrl: 'programs/brnfck-smollm2-135m.meta.json', fileUrl: 'programs/brnfck-smollm2-135m.bf',
      needGB: 1.5, download: '180 MB', startup: '9 to 16 s', perPiece: '0.6 to 1.0 s' },
    '0.5b': { name: '0.5b', label: 'brnfck-qwen2.5-0.5b', model: 'Qwen2.5-0.5B-Instruct', worker: 'workers/brnfck-qwen2.5-0.5b.js?v=r10',
      manifestUrl: 'dist/0.5b/manifest.json', metaUrl: 'programs/brnfck-qwen2.5-0.5b.meta.json', fileUrl: 'programs/brnfck-qwen2.5-0.5b.bf',
      needGB: 4, download: '749 MB', startup: '33 to 47 s', perPiece: 'about 2.3 s' },
    '1.5b': { name: '1.5b', label: 'brnfck-qwen2.5-1.5b', model: 'Qwen2.5-1.5B-Instruct', worker: 'workers/brnfck-qwen2.5-1.5b.js?v=r10',
      manifestUrl: 'dist/1.5b/manifest.json', metaUrl: 'programs/brnfck-qwen2.5-1.5b.meta.json', fileUrl: 'programs/brnfck-qwen2.5-1.5b.bf',
      needGB: 8, download: 'about 2.1 GB', startup: '2 min 27 s', perPiece: 'about 9 s', wide: true },
    '0.8b': { name: '0.8b', label: 'brnfck-qwen3.5-0.8b', model: 'Qwen3.5-0.8B', worker: 'workers/brnfck-qwen3.5-0.8b.js?v=r3',
      manifestUrl: 'dist/0.8b/manifest.json', metaUrl: 'programs/brnfck-qwen3.5-0.8b.meta.json', fileUrl: 'programs/brnfck-qwen3.5-0.8b.bf',
      needGB: 5, download: '1.36 GB', startup: '2 min 10 s to 2 min 37 s', perPiece: 'about 5.6 s', loadsEach: true },
    // with its part for pictures: reads a picture (pics below) before the question
    '0.8b-vision': { name: '0.8b-vision', label: 'brnfck-qwen3.5-0.8b-vision', model: 'Qwen3.5-0.8B, with pictures', worker: 'workers/brnfck-qwen3.5-0.8b-vision.js?v=r2',
      manifestUrl: 'dist/0.8b-vision/manifest.json', metaUrl: 'programs/brnfck-qwen3.5-0.8b-vision.meta.json', fileUrl: 'programs/brnfck-qwen3.5-0.8b-vision.bf',
      needGB: 7, download: '1.51 GB', startup: '1 min 40 s, then 14 min', perPiece: 'about 5.6 s', loadsEach: true, wide: true, picture: true },
    // answers with a brainfuck program of its own (coder/data/coder.json: its measured run); the answer can be run under it
    'coder-0.5b': { name: 'coder-0.5b', label: 'brnfck-qwen2.5-coder-0.5b', model: 'Qwen2.5-Coder-0.5B-Instruct, taught brainfuck', worker: 'workers/brnfck-qwen2.5-coder-0.5b.js?v=r2',
      manifestUrl: 'dist/coder-0.5b/manifest.json', metaUrl: 'programs/brnfck-qwen2.5-coder-0.5b.meta.json', fileUrl: 'programs/brnfck-qwen2.5-coder-0.5b.bf',
      needGB: 4, download: '758 MB', startup: '35 to 70 s', perPiece: 'about 2.2 s', code: true, noMap: true },      // no Program map data
  };
  const EXAMPLES = ['What is the capital of France?', 'What is 12 + 30?', 'Who wrote Romeo and Juliet?', 'Hello'];
  const PICTURE_EXAMPLES = ['Describe this picture in one sentence.', 'What colour are the eyes?', 'How many windmills are there?', 'What is in this picture?'];
  // four of the challenges of challenges/ that brnfck-qwen2.5-coder-0.5b solves, in their own words, with an input to run its answer on
  const CODE_EXAMPLES = ['Print ABC. There is no input.', 'Read two characters and print them in the opposite order.', 'Print the input without its spaces: a b c becomes abc.',
    'Read two digits and print the larger of the two: 38 gives 8. If they are equal, print that digit once.'];
  const CODE_INPUT = { [CODE_EXAMPLES[1]]: 'ab', [CODE_EXAMPLES[2]]: 'a b c', [CODE_EXAMPLES[3]]: '38' };
  const examples = () => (model.picture ? PICTURE_EXAMPLES : model.code ? CODE_EXAMPLES : EXAMPLES);

  let loadStart = 0, state = 'finding', model = null, P = null, worker = null, run = null, pending = null, last = '', nextId = 1, lastStep = '', noStore = false, env = null;

  // ---- what the page says ----
  const TITLE = document.title;
  const title = (text) => { document.title = text ? `${text} · brnfck.chat` : TITLE; };   // for a visitor who is in another tab
  const status = (text) => { $('status').textContent = text; };
  const announce = (text) => { $('live').textContent = text; };
  const step = (text) => { if (text && text !== lastStep) { lastStep = text; announce(text); } };
  const sentence = (text) => { text = String(text).trim(); return text.charAt(0).toUpperCase() + text.slice(1) + (/[.!?]$/.test(text) ? '' : '.'); };
  const whole = () => !!P && P.mode === 'chunks' && P.stored.chunks === P.manifest.chunks.length;
  const loadSize = () => (!P ? model.download : P.mode === 'file' ? size(P.meta.programBytes) : size(P.downloadBytes));

  function describe() {
    const loaded = state === 'loading' || state === 'ready' || state === 'running';
    $('go').textContent = loaded || whole() || state === 'unfit' ? 'Ask' : `Ask · loads ${loadSize()}`;
    let line;
    if (state === 'unfit') line = 'Nothing has been downloaded.';
    else if (state === 'loading') line = 'Your question is waiting for the program. A new question replaces it.';
    else if (loaded) line = `One question at a time, at most ${$('q').maxLength} characters. It does not remember earlier questions, and its answers can be wrong.`;
    else if (whole()) line = `The program is stored in this browser, so nothing is downloaded. Starting it needs about ${model.needGB} GB of free memory.`;
    else if (P && P.mode === 'file') line = `Your first question loads the program (${loadSize()}) from the server this page came from. It needs about ${model.needGB} GB of free memory.`;
    else line = `Your first question downloads the program (${loadSize()}) and keeps it in this browser. It needs about ${model.needGB} GB of free memory. The model is loaded only when you run a question.`;
    if (noStore && loaded) line += ' This browser did not let the page keep the download: a next visit downloads it again.';
    const d = state === 'idle' ? ProgramStart.device(model.needGB) : null;
    if (d && d.kind === 'memory') line += ` The browser says this computer has about ${navigator.deviceMemory} GB of memory in all, so it may not fit.`;
    $('consent').textContent = line;

    $('modelText').textContent = model.model;
    $('programSize').textContent = P ? `${fmt(P.meta.programBytes)} characters` : 'Finding the program…';
    for (const r of document.getElementsByName('model')) r.checked = r.value === model.name;
    const kept = !!P && P.mode === 'chunks' && P.stored.chunks > 0;
    $('storeLine').hidden = !kept;
    if (kept) $('storeText').textContent = `${whole() ? 'A copy' : 'A part'} of this program is stored in this browser (${size(P.stored.bytes)}).`;
  }

  // the eight commands under the name: the pointer stands on the one the program is at
  const point = (c, text) => {
    for (const s of $('cmds').children) s.classList.toggle('at', s.dataset.c === c);
    $('cmdText').textContent = text;
    $('main').style.setProperty('--now', { '+': 'var(--c-plus)', '.': 'var(--c-out)' }[c] || 'var(--c-in)');
  };
  // program text with each command in its colour, runs of one command in one span
  const KIND = { '+': 'p', '-': 'm', '<': 'v', '>': 'v', '[': 'b', ']': 'b', ',': 'i', '.': 'o' };
  function paint(box, text) {
    box.textContent = '';
    for (const part of text.match(/(.)\1*/gs) || []) {
      const s = document.createElement('span');
      s.className = KIND[part[0]] || '';
      s.textContent = part;
      box.append(s);
    }
  }
  const previews = fetch('home-source.json').then(r => r.ok ? r.json() : null).catch(() => null);
  // the window shows the chosen program (brnfck-qwen2.5-1.5b when none can be chosen), if the excerpt's SHA-256 matches
  async function showSource(name, meta) {
    const all = await previews, sample = all && all[name];
    if (choice && model && model.name !== name) return;      // another model was chosen in the meantime
    if (!sample || sample.sha256 !== meta.sha256) { $('programWindow').hidden = true; return; }
    $('fieldHead').textContent = `Inside ${MODELS[name].label}`;
    paint($('sourcePreview'), sample.text);
    $('sourcePosition').textContent = `${MODELS[name].label} · characters ${fmt(sample.from + 1)}–${fmt(sample.from + sample.text.length)} · engine excerpt`;
    $('sourceMap').href = `map/?m=${encodeURIComponent(name)}#show=${sample.from + 1},${sample.from + sample.text.length}`;
    $('programWindow').hidden = false;
  }
  const AT = { finding: [',', 'waits for your question'], idle: [',', 'waits for your question'], ready: [',', 'waits for your question'],
    loading: ['+', 'writes the model into memory'], running: [',', 'reads your question'] };

  const WORD = { finding: 'finding the program', idle: 'nothing loaded', loading: 'loading', ready: 'ready', running: 'running', unfit: 'not on this device', failed: 'stopped on an error' };
  function setState(s) {
    state = s;
    if (window.LeaveGuard) LeaveGuard.set('chat', s === 'loading' || s === 'running');   // leaving would lose the load or the answer
    $('main').dataset.state = s;
    $('figState').textContent = WORD[s] || '';
    point(...(AT[s] || ['', '']));
    const can = s === 'idle' || s === 'loading' || s === 'ready';
    $('go').disabled = !can;
    $('q').disabled = s === 'unfit';
    for (const b of $('chips').children) b.disabled = !can;
    $('stop').hidden = s !== 'loading' && s !== 'running';
    $('bar').hidden = s !== 'loading';
    $('tapeBox').hidden = s !== 'loading';
    for (const r of document.getElementsByName('model')) r.disabled = s === 'loading' || s === 'running';
    describe();
  }

  // ---- what you see happening
  function setStep(n, now = true) {
    [...$('steps').children].forEach((li, i) => {
      li.className = i < n ? 'done' : i === n && now ? 'now' : '';
      if (i === n && now) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
  }
  function drawTape(part, text) {
    const cells = $('tape').children, n = Math.floor(part * cells.length);
    for (let i = 0; i < cells.length; i++) cells[i].className = i < n ? 'on' : i === n && part > 0 ? 'now' : '';
    $('tapeText').textContent = text;
  }
  const emptyTape = () => { drawTape(0, '0%'); $('src').hidden = true; $('srcLab').hidden = true; $('tape').hidden = false; $('tapeLive').hidden = true; $('memBox').hidden = true; };

  // ---- the tape and its memory slots, as the worker reads them (runtime/peek.js), drawn by ui/tapeview.js
  const live = { L: null, fill: null, pointer: null, mem: null, fixed: 0, question: 0, newest: -1, limit: 0 };
  function drawLive() {
    if (!live.L) return;
    if (!$('tapeLive').hidden) TapeView.drawStrip($('tapeStrip'), live.L, live);
    if (!$('memBox').hidden) {
      TapeView.drawGrid($('memGrid'), live.L, live.mem, live);
      $('memEnd').textContent = `position ${TapeView.shownColumns(live.L, live)}`;
    }
  }
  $('memZoom').addEventListener('click', () => {
    live.zoom = !live.zoom;
    $('memZoom').setAttribute('aria-pressed', String(live.zoom));
    $('memZoom').textContent = live.zoom ? 'Show all the slots, to scale' : 'Zoom in on the filled slots';
    drawLive();
  });
  function watch(w) {
    Object.assign(live, { L: null, fill: null, pointer: null, mem: null });
    if (model.noMap) return;
    TapeView.layout(model.name).then((L) => {
      if (w !== worker) return;
      live.L = L;
      w.postMessage({ type: 'watch', ...L.watch });
      $('tapeEnd').textContent = `cell ${fmt(L.size)}`;
      $('memEnd').textContent = `position ${L.positions}`;
      $('memGrid').style.setProperty('--layers', L.layers);
      $('tape').hidden = true; $('tapeLive').hidden = false;
      drawLive();
    }).catch(() => { });                                     // without the data of the map, the plain bar stays
  }
  function sayMemory(n) {
    const L = live.L, q = live.question - live.fixed, a = Math.max(0, n - live.question);
    $('memText').textContent = `${n} of ${L.positions} slots`;
    let s;
    if (!run && !a) s = `The program comes with its fixed opening lines already in memory: ${live.fixed} of the ${L.positions} slots, in each of the ${L.layers} layers. Every word piece of your question and of the answer fills one more.`;
    else if (run && !run.mem) s = `The program is reading your question into the next slots. This picture is read from the tape each time the program prints, so it changes with the first piece of the answer.`;
    else if (run) s = `Your question took ${q} slots. Each word piece of the answer is read back and takes one more: ${a} so far. A slot is ${fmt(L.slotCells)} cells, in each of the ${L.layers} layers.`;
    else s = `This conversation filled ${n} of the ${L.positions} slots: ${live.fixed} for the opening lines, ${q} for your question, ${a} for the answer. ${fmt(n * L.layers)} slots of ${fmt(L.slotCells)} cells each.`;
    $('memSay').textContent = s;
  }
  // one plain sentence: what is happening now, and why there is a wait
  const explain = (text) => { $('explain').textContent = text; };
  const once = () => model.loadsEach ? 'This program cannot clear its memory after an answer yet, so it does this for every question.' : 'This happens once; after that, questions are answered without this wait.';
  const WHY = {
    load: () => live.L
      ? `The model is one brainfuck program of ${fmt(P.meta.programBytes)} characters. Your browser is running it now, and it is writing the model into memory. The strip is that memory, all ${fmt(live.L.size)} cells to scale: a part lights up when the page reads numbers there, and the mark is where the program is. ${once()}`
      : `The model is one brainfuck program of ${fmt(P.meta.programBytes)} characters. Your browser is running it now, and it is writing the model into memory: each lit block is a part that is done. ${once()}`,
    engine: 'Almost ready: preparing the last part of the program, the part that does the thinking.',
    read: () => model.picture
      ? `The program is reading the picture, square by square, and looking at it through 12 layers; then it reads the 64 word pieces the picture became and your question, one at a time (${model.perPiece} each). Nothing is printed until it has read all of it.`
      : `The program is reading your question, one word piece at a time (${model.perPiece} each). Nothing is printed until it has read all of it.`,
    write: () => `The program is printing the answer, one word piece at a time (${model.perPiece} each). The highlighted piece is the newest.`,
    done: 'Done. The model stays loaded: ask another question and it starts reading right away.',
    again: 'Done. This program cannot clear its memory after an answer yet, so the next question loads it again.',
  };
  // how long the loading still takes, from how fast it went so far
  const left = (part) => {
    const s = (performance.now() - loadStart) / 1000 * (1 - part) / part;
    return part < 0.03 ? '' : s < 90 ? ` · about ${Math.max(1, Math.round(s))} s left` : ` · about ${Math.round(s / 60)} min left`;
  };

  // Say what went wrong and what to do, in one sentence each, and stop.
  function fail(stage, message) {
    const fit = `Close other tabs and programs until about ${model.needGB} GB is free and try again, or choose a smaller model below.`;
    const help = {
      meta: 'Choose another model below.',
      support: 'brnfck-smollm2-135m, brnfck-qwen2.5-0.5b and brnfck-qwen3.5-0.8b run in any current browser; brnfck-qwen2.5-1.5b and brnfck-qwen3.5-0.8b-vision need a current desktop browser.',
      program: 'Check the connection and try again: what was downloaded is kept.',
      compile: 'A current desktop version of Chrome, Edge or Firefox is needed.',
      memory: fit,
      worker: `The usual cause is too little free memory. ${fit}`,
      ask: 'Try again: the program starts afresh.',
    }[stage] || '';
    if (worker) { worker.terminate(); worker = null; }
    if (run) endRun('');
    pending = null;
    status('');
    setStep(-1); emptyTape(); explain(''); title('');
    $('errorText').textContent = `${sentence(message)} ${help}`;
    $('error').hidden = false;
    setState('failed');
  }

  // ---- choosing a model
  async function refreshStored() {
    if (!P || P.mode !== 'chunks') return;
    P.stored = await ProgramSource.stored(P.manifest, P.manifestUrl);
    P.downloadBytes = Math.max(0, P.manifest.compressedBytes - P.stored.bytes);
  }
  async function select(name) {
    if (worker) { worker.terminate(); worker = null; }
    model = MODELS[name]; P = null; noStore = false;
    $('error').hidden = true; $('unfit').hidden = true; $('memBox').hidden = true;
    setState('finding');
    let found;
    try {
      found = await ProgramStart.find({ name, manifestUrl: model.manifestUrl, metaUrl: model.metaUrl, fileUrl: model.fileUrl, hostsUrl: 'program-hosts.json' });
    } catch (e) {
      if (model.name === name) fail('meta', `This site has no copy of the program of ${model.label}`);
      return;
    }
    if (model.name !== name) return;                         // another model was chosen in the meantime
    P = found;
    showSource(name, P.meta);
    $('q').maxLength = P.meta.maxQuestionBytes;
    $('pics').hidden = !model.picture;
    [...$('chips').children].forEach((b, i) => { b.textContent = examples()[i]; });
    $('q').placeholder = model.code ? 'Describe a program, as in the examples…' : 'Type a short question…';
    $('codeRun').hidden = true;
    ProgramDownload.attach($('download'), P);                // the .bf itself: nothing starts without a click
    setState('idle');
    if (pending) startWorker();
  }

  function unfit() {
    model = MODELS.small;
    $('unfitText').textContent = env.phone
      ? 'A phone or a tablet cannot run this: the program needs at least 1.5 GB of free memory in one browser tab, so please come back on a desktop or laptop computer.'
      : 'This computer seems to have too little memory to run this: the program needs at least 1.5 GB of free memory in one browser tab.';
    $('unfit').hidden = false;
    setState('unfit');
  }

  // ---- the worker: loads the program, keeps its tape, runs it per question ----
  const has64 = () => { try { return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 5, 3, 1, 4, 1])); } catch (e) { return false; } };
  function startWorker() {
    if (model.wide && !has64()) return fail('support', `This browser has no 64-bit WebAssembly memory, which ${model.label} needs`);
    setState('loading');
    $('bar').value = 0;
    lastStep = '';
    setStep(0); emptyTape(); explain('Getting memory for the model.');
    loadStart = performance.now();
    try { worker = new Worker(model.worker); } catch (e) { return fail('worker', `Could not start the background worker (${e.message})`); }
    const w = worker;
    w.onmessage = (ev) => { if (w === worker) onMessage(ev.data); };
    w.onerror = (ev) => { if (w === worker) fail('worker', `The background worker stopped by itself${ev && ev.message ? ` (${ev.message})` : ''}`); };
    w.postMessage({ type: 'load', ...P.loadMessage(), again: false });
    watch(w);
  }

  function onMessage(m) {
    if (m.type === 'progress' && state === 'loading') {
      if (m.stage === 'program' && m.loaded !== undefined) {
        // the same step, two names: while pieces still come from the network it is mostly a download
        const verb = m.net ? 'Loading the program' : 'Writing the model onto the tape';
        let text = `${Math.floor(100 * m.loaded / m.total)}%${left(m.loaded / m.total)} · ${fmt(m.loaded / 1e6)} of ${fmt(m.total / 1e6)} million characters run`;
        if (m.source === 'chunks' && m.net) text += ` · ${size(m.net)} downloaded`;
        $('bar').value = m.loaded / m.total;
        title(`${Math.floor(100 * m.loaded / m.total)}% loaded`);
        drawTape(m.loaded / m.total, `${Math.floor(100 * m.loaded / m.total)}%`); explain(WHY.load());
        if (live.L && m.fill) {
          live.fill = m.fill; live.pointer = m.pointer;
          $('tapeWhere').textContent = `The pointer is at cell ${fmt(m.pointer)}: ${live.L.at(m.pointer).title}`;
          drawLive();
        }
        status(text); step(verb);
      } else {
        const text = { memory: 'Getting memory for the tape', compile: 'Compiling the engine', copy: 'Keeping a copy of the tape' }[m.stage];
        if (m.stage !== 'memory') { drawTape(1, '100%'); explain(WHY.engine); }
        if (text) { status(text); step(text); }
      }
    } else if (m.type === 'slots' && live.L) {
      const n = TapeView.filled(live.L, m);
      if (m.id === 0) Object.assign(live, { fixed: n, question: n, newest: -1 });
      else if (run && m.id === run.id) { if (!run.mem) { run.mem = true; live.question = n; } live.newest = n - 1; }
      else return;
      live.mem = m; live.limit = n;
      $('memBox').hidden = false;
      sayMemory(n); drawLive();
    } else if (m.type === 'sample') {
      paint($('src'), m.text.slice(0, 480));                 // real program text, from the middle: weights being written
      $('src').hidden = false; $('srcLab').hidden = false;
    } else if (m.type === 'ready') {
      setStep(1, false); explain('');
      noStore = m.source === 'chunks' && !m.storing;
      refreshStored().then(describe);
      setState('ready');
      if (pending) { const text = pending; pending = null; send(text); } else { status('Ready.'); step('Ready'); }
    } else if (m.type === 'output' && run && m.id === run.id) {
      const t = performance.now() - run.t0;
      if (run.pieces === 0) { run.firstMs = t; $('answer').textContent = ''; $('answer').classList.remove('wait', 'muted'); setStep(2); explain(WHY.write()); point('.', 'prints the answer'); title('Answering'); step('The answer is arriving'); }
      if (m.piece !== run.pieces || !run.span) {             // a new word piece: its own span, marked as the newest
        if (run.span) run.span.className = '';
        run.span = document.createElement('span'); run.span.className = 'new';
        $('answer').append(run.span);
      }
      run.pieces = m.piece;
      run.lastMs = t;
      run.span.textContent += run.decoder.decode(m.bytes, { stream: true });        // a character may arrive in two halves
      if (model.code) { run.code = (run.code || '') + run.span.textContent; run.span.textContent = ''; paintCode($('answer'), run.code); run.span = null; }
    } else if (m.type === 'done' && run && m.id === run.id) {
      endRun(m.pieces === 0 ? 'The model gave an empty answer.' : '');
      if (live.mem) { live.newest = -1; sayMemory(live.limit); drawLive(); }
      // without a way to put the tape back, the next question starts the program again
      if (m.reusable) { explain(WHY.done); setState('ready'); } else { worker.terminate(); worker = null; emptyTape(); explain(WHY.again); setState('idle'); }
    } else if (m.type === 'error') {
      fail(m.stage, m.message);
    }
  }

  // ---- the picture of brnfck-qwen3.5-0.8b-vision: its middle square at 256 x 256, as 256 squares of 16 x 16 in blocks of
  // two by two, each square its red, green and blue pixels row by row (compiler/qwen3.5/reference/vision.js squares)
  const SIDE = 256, SQ = 16, picture = { img: null, name: 'cat' };
  function squaresOf(img) {
    const c = document.createElement('canvas'); c.width = c.height = SIDE;
    const g = c.getContext('2d', { willReadFrequently: true }), w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, s = Math.min(w, h);
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, (w - s) / 2, (h - s) / 2, s, s, 0, 0, SIDE, SIDE);
    const d = g.getImageData(0, 0, SIDE, SIDE).data, out = new Uint8Array(SIDE * SIDE * 3), blocks = SIDE / SQ / 2;
    let k = 0;
    for (let br = 0; br < blocks; br++) for (let bc = 0; bc < blocks; bc++) for (let ir = 0; ir < 2; ir++) for (let ic = 0; ic < 2; ic++) {
      const row = br * 2 + ir, col = bc * 2 + ic;
      for (let ch = 0; ch < 3; ch++) for (let y = 0; y < SQ; y++) for (let x = 0; x < SQ; x++) out[k++] = d[((row * SQ + y) * SIDE + col * SQ + x) * 4 + ch];
    }
    return { bytes: out, url: c.toDataURL('image/png') };
  }
  function choosePicture(value) {
    if (value === 'own') { $('picFile').click(); return; }
    picture.name = value;
    picture.img = document.querySelector('#pics input[value="' + value + '"] + img');
  }
  $('pics').addEventListener('change', (ev) => { if (ev.target.name === 'pic') choosePicture(ev.target.value); });
  $('picFile').addEventListener('change', () => {
    const f = $('picFile').files[0];
    if (!f) return;
    const im = new Image();
    im.onload = () => { picture.name = 'own'; picture.img = im; $('picOwnImg').src = squaresOf(im).url; $('picOwnImg').hidden = false; $('picOwnText').hidden = true; $('picOwn').checked = true; };
    im.onerror = () => { $('picOwnText').textContent = 'That file is not a picture this browser can read'; };
    im.src = URL.createObjectURL(f);
  });
  choosePicture('cat');

  // ---- one question ----
  function archive() {
    const a = $('answer');
    if ($('thread').hidden || a.classList.contains('wait') || !a.textContent.trim()) return;
    // the same .exchange.io of site.css as the one on the screen, and its figures under it
    const li = document.createElement('li'), pair = document.createElement('p'), q = document.createElement('span'), old = document.createElement('span'), meta = document.createElement('p');
    pair.className = 'exchange io';
    q.className = 'q'; q.textContent = $('mine').textContent;
    old.className = 'a'; old.textContent = a.textContent;
    meta.className = 'meta muted small'; meta.textContent = $('status').textContent;
    pair.append(q, old);
    li.append(pair, meta);
    $('history').append(li);
    $('clear').hidden = false;
  }
  function showQuestion(text) {
    archive();
    last = text;
    $('acts').hidden = true;
    status('');
    $('thread').hidden = false;
    $('emptyOutput').hidden = true;
    $('error').hidden = true;
    $('betterBox').hidden = true;
    $('codeRun').hidden = true;
    $('answer').classList.remove('code');
    $('mine').textContent = text;
    $('minePic').hidden = !model.picture;
    if (model.picture) { run0.pic = squaresOf(picture.img); $('minePic').src = run0.pic.url; $('minePic').alt = picture.img.alt || 'Your picture'; }
    $('answer').textContent = '...';
    $('answer').classList.add('wait', 'muted');
    $('chatWorkspace').scrollTop = $('chatWorkspace').scrollHeight;
  }
  function meter() {
    if (!run) return;
    const t = performance.now() - run.t0;
    status(run.pieces === 0 ? `${model.picture ? 'Looking at the picture, reading your question' : 'Reading your question'} · ${secs(t)}` : `${run.pieces} word piece${run.pieces === 1 ? '' : 's'} · ${secs(t)}`);
  }
  const run0 = { pic: null };                                 // the picture of the question on the screen, in its squares
  function send(text) {
    run = { id: nextId++, t0: performance.now(), pieces: 0, firstMs: 0, lastMs: 0, decoder: new TextDecoder('utf-8'), span: null, timer: setInterval(meter, 200) };
    setState('running');
    setStep(1); explain(WHY.read());
    if (live.mem) { Object.assign(live, { limit: live.fixed, question: live.fixed, newest: -1 }); sayMemory(live.fixed); drawLive(); }   // the tape is put back before each question
    title('Reading your question');
    step('Reading your question');
    meter();
    if (model.picture) worker.postMessage({ type: 'ask', id: run.id, question: text, picture: run0.pic.bytes });
    else worker.postMessage({ type: 'ask', id: run.id, question: text });
  }
  function endRun(remark) {
    clearInterval(run.timer);
    const a = $('answer');
    if (run.pieces === 0) a.textContent = '';
    a.classList.remove('wait', 'muted');
    if (run.span) run.span.className = '';
    const tail = run.decoder.decode();
    if (model.code) run.code = (run.code || '') + tail; else a.append(tail);
    if (model.code && run.code) { paintCode(a, run.code); showRun(run.code, last); }
    setStep(3);
    if (remark) { const s = document.createElement('span'); s.className = 'cut muted small'; s.textContent = (a.textContent ? '  ' : '') + remark; a.append(s); }
    // speed: the pieces after the first one, over the time since the first one
    const rate = run.pieces > 1 ? `${((run.lastMs - run.firstMs) / 1000 / (run.pieces - 1)).toFixed(1)} s per word piece · ` : '';
    status(`${rate}${model.model} · computed by ${fmt(P.meta.programBytes)} characters of brainfuck`);
    lastStep = '';
    $('acts').hidden = run.pieces === 0;
    title(document.hidden && run.pieces ? 'Answer ready' : '');
    announce(a.textContent);
    // brnfck-smollm2-135m answered: the better one is one click away, with its size on the button
    const better = MODELS['0.5b'];
    if (model.name === 'small' && run.pieces > 0 && !remark && !ProgramStart.device(better.needGB)) {
      $('better').textContent = env.stored.includes(better.name) ? `Ask ${better.label} instead` : `Ask ${better.label} instead: loads ${better.download} the first time`;
      $('betterBox').hidden = false;
    }
    run = null;
  }
  // ---- brnfck-qwen2.5-coder-0.5b: its answer is a program, coloured by command, and can be run here
  // (challenges/engine.js: the interpreter of the challenges, with their settings: 8-bit cells, 0 at the end of the input)
  function paintCode(box, code) { box.classList.add('code'); paint(box, code); }
  // what a run printed, with spaces, line breaks and other unprintable characters made visible
  function shown(text) {
    const out = document.createElement('span');
    if (!text) { out.className = 'muted'; out.textContent = 'nothing'; return out; }
    for (const ch of text) {
      const c = ch.charCodeAt(0);
      if (c === 10) { const i = document.createElement('i'); i.textContent = '\u21b5'; out.append(i, document.createElement('br')); }
      else if (c < 32 || c > 126) { const i = document.createElement('i'); i.textContent = '\\' + c; out.append(i); }
      else out.append(ch);
    }
    return out;
  }
  let code = '';
  function showRun(src, task) {
    code = src;
    $('codeIn').value = CODE_INPUT[task] !== undefined ? CODE_INPUT[task] : '';
    $('codeOut').textContent = '';
    $('codeRun').hidden = false;
    playLink();
  }
  function playLink() { $('codePlay').href = 'playground/?code=' + encodeURIComponent(code) + '&input=' + encodeURIComponent($('codeIn').value) + '&bits=8&eof=zero'; }
  function runCode() {
    const r = BFEngine.run(code, { input: $('codeIn').value, bits: 8, eof: 0 }), o = $('codeOut');
    const why = { brackets: 'It does not run: its brackets do not match.', limit: 'Stopped after 5,000,000 steps: it may never end.', left: 'Stopped: the pointer went left of the first cell.', right: 'Stopped: the pointer ran off the tape.', flood: 'Stopped: it printed more than 20,000 characters.' };
    o.textContent = '';
    if (why[r.status]) { o.textContent = why[r.status]; return; }
    o.append('It printed ', shown(r.out), ' in ' + fmt(r.steps) + ' steps.');
  }
  $('codeGo').addEventListener('click', runCode);
  $('codeIn').addEventListener('input', playLink);
  $('codeIn').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); runCode(); } });
  // the start page's Lab (home-lab.js) hands a task to this program
  window.BrnfckChat = { askCoder: (task) => { pending = null; select('coder-0.5b').then(() => { $('q').value = task || ''; count(); $('q').focus({ preventScroll: true }); }); } };

  function ask(text) {
    text = text.replace(/\s+/g, ' ').trim();
    if (!text || (state !== 'idle' && state !== 'loading' && state !== 'ready')) return;
    showQuestion(text);
    $('q').value = '';
    count();
    if (state === 'ready') return send(text);
    pending = text;                                          // sent as soon as the program is ready
    if (state === 'idle') startWorker();
  }
  async function stop() {
    if (state !== 'loading' && state !== 'running') return;
    worker.terminate(); worker = null; pending = null;
    if (run) endRun('Stopped.');
    else {
      $('answer').textContent = ''; $('answer').classList.remove('wait', 'muted');
      status(P.mode === 'chunks' ? 'Stopped. What was downloaded so far is kept in this browser.' : 'Stopped.');
      announce('Stopped');
    }
    setStep(-1); emptyTape(); explain(''); title('');        // the worker is gone, and its tape with it
    await refreshStored();
    setState('idle');
    $('q').focus();
  }

  // ---- the controls ----
  $('ask').addEventListener('submit', (ev) => { ev.preventDefault(); ask($('q').value); });
  $('stop').addEventListener('click', stop);
  $('retry').addEventListener('click', () => { if (last && !$('thread').hidden) { pending = last; showQuestion(last); } select(model.name); });
  $('anyway').addEventListener('click', () => select('small'));
  $('better').addEventListener('click', () => { pending = last; showQuestion(last); select('0.5b'); });
  $('removeStored').addEventListener('click', async () => {
    try { await ProgramSource.remove(P.manifest); } catch (e) { }
    await refreshStored();
    describe();
  });
  $('copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('answer').textContent.trim()); $('copy').textContent = 'Copied'; }
    catch (e) { $('copy').textContent = 'Could not copy'; }
    setTimeout(() => { $('copy').textContent = 'Copy answer'; }, 1600);
  });
  $('again').addEventListener('click', () => ask(last));
  $('clear').addEventListener('click', () => {
    $('history').textContent = '';
    $('clear').hidden = true;
    if (state !== 'loading' && state !== 'running') { $('thread').hidden = true; $('emptyOutput').hidden = false; }
    $('q').focus();
  });
  // how much of the question's room is used, once it is nearly full
  function count() {
    const n = $('q').value.length, max = $('q').maxLength;
    $('count').hidden = n < max * 0.8;
    $('count').textContent = `${n}/${max}`;
    $('count').classList.toggle('full', n >= max);
  }
  $('q').addEventListener('input', count);
  $('q').addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowUp' && !$('q').value && last) { ev.preventDefault(); $('q').value = last; count(); }
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && (state === 'loading' || state === 'running')) stop(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state !== 'loading' && state !== 'running') title(''); });
  ProgramStart.follow($('chatWorkspace'));                 // the screen stays at its end while an answer arrives
  const redraw = new ResizeObserver(() => drawLive());
  redraw.observe($('tapeStrip')); redraw.observe($('memGrid'));
  new MutationObserver(() => drawLive()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  for (let i = 0; i < 96; i++) $('tape').append(document.createElement('i'));
  for (const q of EXAMPLES) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = q; b.disabled = true;
    b.addEventListener('click', () => ask(b.textContent));
    $('chips').append(b);
  }
  // the picker: one group per kind of program, smallest download first; a row is the name and its download, drawn to scale,
  // and the checked row adds the model, the start-up and the time per word piece
  const GROUPS = { text: 'Reads text', picture: 'With a photo', code: 'Writes brainfuck' };
  const groupOf = (m) => (m.picture ? 'picture' : m.code ? 'code' : 'text');
  const bytesOf = (m) => { const x = /([\d.]+)\s*(MB|GB)/.exec(m.download); return x ? x[1] * (x[2] === 'GB' ? 1e9 : 1e6) : 0; };
  const most = Math.max(...Object.values(MODELS).map(bytesOf));
  const groups = Object.keys(GROUPS).map((g) => [g, Object.values(MODELS).filter((m) => groupOf(m) === g).sort((x, y) => bytesOf(x) - bytesOf(y))]).filter(([, ms]) => ms.length);
  $('models').querySelector('legend').textContent = `${Object.keys(MODELS).length} programs. ${groups.map(([g, ms]) => `${GROUPS[g]}: ${ms.length}.`).join(' ')}`;
  for (const [g, ms] of groups) {
    const sep = document.createElement('p'), n = document.createElement('span');
    sep.className = 'pick-sep'; n.textContent = ms.length; sep.append(GROUPS[g], n); $('models').append(sep);
    for (const m of ms) {
      const label = document.createElement('label'), r = document.createElement('input'), name = document.createElement('span'), b = document.createElement('b'), s = document.createElement('small');
      r.type = 'radio'; r.name = 'model'; r.value = m.name;
      // the name on a line of its own, breaking after brnfck- only if it must
      { const pre = document.createElement('span'), rest = document.createElement('span'); pre.className = 'pre'; pre.textContent = 'brnfck-'; rest.className = 'nb'; rest.textContent = m.label.replace(/^brnfck-/, ''); b.append(pre, document.createElement('wbr'), rest); }
      // each part stays whole; a line breaks only after a dot
      [m.model, 'start-up ' + m.startup, m.perPiece + ' per word piece'].forEach((part, i) => { const p = document.createElement('span'); p.textContent = part; s.append(i ? '\u00a0\u00b7 ' : '', p); });
      name.className = 'name'; name.append(b, s);
      const z = document.createElement('span'), bar = document.createElement('i');
      z.className = 'size'; z.title = `Download: ${m.download}`; bar.style.setProperty('--w', `${(100 * bytesOf(m) / most).toFixed(1)}%`); z.append(m.download.replace(/^about /, ''), bar);
      r.addEventListener('change', () => {
        try { localStorage.setItem('brnfck.model', m.name); } catch (e) { }
        select(m.name);
      });
      label.append(r, name, z);
      $('models').append(label);
    }
  }

  // ---- start ----
  const stored = [];
  try { for (const k of await caches.keys()) { const m = /^bf-program:([^:]+):/.exec(k); if (m && MODELS[m[1]] && !stored.includes(m[1])) stored.push(m[1]); } } catch (e) { }
  const d = ProgramStart.device(MODELS.small.needGB);
  env = { stored, phone: !!d && d.kind === 'phone' };
  const asked = new URLSearchParams(location.search).get('m');
  let saved = null;
  try { saved = localStorage.getItem('brnfck.model'); } catch (e) { }
  const choice = MODELS[asked] ? asked : MODELS[saved] ? saved : env.phone ? null : 'small';
  const given = new URLSearchParams(location.search).get('q');
  if (given) { $('q').value = given.replace(/\s+/g, ' ').trim().slice(0, $('q').maxLength); count(); }
  if (choice) { select(choice); $('q').focus({ preventScroll: true }); } else unfit();
  if (!choice) { const big = MODELS['1.5b'];
    ProgramStart.find({ name: big.name, manifestUrl: big.manifestUrl, metaUrl: big.metaUrl, fileUrl: big.fileUrl, hostsUrl: 'program-hosts.json' })
      .then((f) => showSource(big.name, f.meta), () => {}); }
})();
