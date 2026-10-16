'use strict';

// Runs Qwen3.5 in a web worker for the page compare/, with the code of compiler/qwen3.5 (copied next to this
// file by tools/site-qwen3.5.js): float.js for the model, deltanet.js for the Gated DeltaNet layers in whole
// numbers. The weights come from model.safetensors, one tensor per request, into shared memory, and every
// matrix-vector product is shared out over a pool of threads (pool.js). The page sends { type: 'start', model }
// with the address of the folder that holds config.json, tokenizer.json and model.safetensors.

const V = new URL(self.location.href).searchParams.get('v') || '';   // the version compare.js gives this file
const at = (file) => (V ? `${file}?v=${V}` : file);
importScripts(at('pool.js'));

const mods = {};
async function load(name) {
  const src = await (await fetch(at(`${name}.js`))).text(), module = { exports: {} };
  const require = (n) => (n.startsWith('./') ? mods[n.slice(2)] : {}); // fs, path: not used here
  new Function('module', 'exports', 'require', '__dirname', src)(module, module.exports, require, '');
  mods[name] = module.exports;
}

const say = (msg) => postMessage(msg);

// ---------------------------------------------------------------- the pool

const SHARED = self.crossOriginIsolated && typeof SharedArrayBuffer === 'function';
const alloc = (Type, n) => new Type(SHARED ? new SharedArrayBuffer(n * Type.BYTES_PER_ELEMENT) : n);
const helpers = [], mats = [], matId = new Map();
let ctrl, X, Y, K = 0, received = 0;

function startPool(maxRows, maxCols) {
  if (!SHARED) return;
  K = Math.max(1, Math.min(15, (navigator.hardwareConcurrency || 4) - 1)); // and this thread itself
  ctrl = alloc(Int32Array, 8); X = alloc(Float64Array, maxCols); Y = alloc(Float64Array, maxRows);
  for (let i = 0; i < K; i++) {
    const w = new Worker(at('pool.js'), { name: 'pool' + i });
    w.postMessage({ type: 'init', ctrl, X, Y, me: i, count: K + 1 });
    helpers.push(w);
  }
}

// Hands matrices to the threads, and waits until all of them have them (without blocking: a thread
// that has just been made only starts once this one is free).
async function register(list) {
  if (!K) return;
  for (const { W, d } of list) {
    const id = mats.length;
    mats.push({ W, d }); matId.set(W, id);
    for (const h of helpers) h.postMessage({ type: 'mat', id, W, d });
  }
  received += list.length * K;
  for (let now; (now = Atomics.load(ctrl, 5)) < received;) { const r = Atomics.waitAsync(ctrl, 5, now); if (r.async) await r.value; }
}

function poolMatvec(M, x, rows, y = new Float64Array(rows)) {
  const id = matId.get(M.w || M);
  if (id === undefined) return M.w ? DN.matvec(M, x, rows, y) : F.matvec(M, x, rows, y);
  X.set(x); ctrl[2] = id; ctrl[3] = rows; ctrl[4] = x.length;
  Atomics.store(ctrl, 1, 0);
  Atomics.add(ctrl, 0, 1); Atomics.notify(ctrl, 0);
  poolRows(ctrl, X, Y, mats, K, K + 1); // the last share is this thread's
  for (let done; (done = Atomics.load(ctrl, 1)) < K;) Atomics.wait(ctrl, 1, done);
  y.set(Y.subarray(0, rows));
  return y;
}
const tick = () => new Promise((r) => setTimeout(r, 0)); // lets a stop message in

async function bytes(from, to) {
  const r = await fetch(MODEL + 'model.safetensors', { headers: { Range: `bytes=${from}-${to - 1}` } });
  if (r.status !== 206) throw new Error('the server does not send parts of files');
  return r.arrayBuffer();
}

let F, DN, src, m, tok, lin, MODEL;
const nets = {};      // whole-number DeltaNet layers per setting
let stopping = false;

const SETTINGS = {
  int8: { name: 'whole numbers, 8-bit weights', options: {} },
  int10: { name: 'whole numbers, 10-bit weights', options: { weightBits: 10, xBits: 19 } },
};

async function start() {
  await load('float'); await load('deltanet');
  F = mods.float; DN = mods.deltanet;
  say({ type: 'status', text: 'Reading the tokenizer' });
  const config = await (await fetch(MODEL + 'config.json')).json();
  tok = F.tokenizerFrom(await (await fetch(MODEL + 'tokenizer.json')).json());
  const n = Number(new DataView(await bytes(0, 8)).getBigUint64(0, true));
  const header = JSON.parse(new TextDecoder().decode(await bytes(8, 8 + n)));
  // the text model only: no vision tower, no multi-token prediction head
  const names = Object.keys(header).filter((k) => k.startsWith('model.language_model.') || k === 'lm_head.weight');
  const total = names.reduce((s, k) => s + header[k].data_offsets[1] - header[k].data_offsets[0], 0);
  const data = new Map(), queue = names.slice();
  let done = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const k = queue.shift(), [a, b] = header[k].data_offsets;
      const buf = await bytes(8 + n + a, 8 + n + b), sh = alloc(Uint8Array, b - a);
      sh.set(new Uint8Array(buf));
      data.set(k, sh.buffer);
      done += b - a;
      say({ type: 'load', done, total });
    }
  }));
  const st = {
    has: (k) => data.has(k),
    get: (k) => { if (header[k].dtype !== 'BF16') throw new Error(k + ' is not BF16'); return new Uint16Array(data.get(k)); },
    getFloat: (k) => (header[k].dtype === 'F32' ? new Float32Array(data.get(k)) : F.toFloat(new Uint16Array(data.get(k)))),
    close: () => {},
  };
  src = F.weightsFrom(config, st);
  m = F.modelFrom(src);
  lin = m.types.flatMap((t, l) => (t === 'lin' ? [l] : []));
  startPool(m.vocab, Math.max(m.dim, m.hidden, m.valueDim, m.heads * m.headSize));
  if (K) {
    say({ type: 'status', text: `Handing the weights to ${K} threads` });
    F.hooks.matvec = poolMatvec; DN.hooks.matvec = poolMatvec; DN.hooks.alloc = alloc;
    const list = [{ W: m.cls }];
    for (const L of m.L) for (const k of Object.keys(L)) if (k[0] === 'w') list.push({ W: L[k] });
    await register(list);
  }
  say({ type: 'ready', layers: m.layers, lin, heads: m.nv, dk: m.dk, dv: m.dv, total, threads: K + 1 });
}

async function layersFor(setting) {
  if (setting === 'float') return null;
  if (!nets[setting]) {
    say({ type: 'status', text: 'Making the 18 DeltaNet layers whole numbers' });
    nets[setting] = m.types.map((t, l) => (t === 'lin' ? DN.build(src, l, { checks: false, ...SETTINGS[setting].options }) : null));
    await register(nets[setting].filter(Boolean).flatMap((n) => Object.values(n.weights).map(({ w, d }) => ({ W: w, d }))));
  }
  return nets[setting];
}

// |S| of every head of every DeltaNet layer, for the map
function norms(cache, layers) {
  const out = new Float32Array(lin.length * m.nv), size = m.dk * m.dv;
  lin.forEach((l, r) => {
    if (layers) { out.set(layers[l].norms(), r * m.nv); return; }
    const S = cache.S[l];
    for (let h = 0; h < m.nv; h++) {
      let ss = 0;
      for (let i = h * size; i < (h + 1) * size; i++) ss += S[i] * S[i];
      out[r * m.nv + h] = Math.sqrt(ss);
    }
  });
  return out;
}

async function ask(question, setting, maxNew) {
  stopping = false;
  // the whole-number layers, timed: the page shows what they cost per token
  let mixMs = 0;
  const layers = await layersFor(setting), mixers = layers && layers.map((n) => n && ((xn, out, pos) => {
    const t = performance.now();
    n.mixer(xn, out, pos);
    mixMs += performance.now() - t;
  }));
  if (layers) for (const n of layers) if (n) n.reset();
  const cache = F.newCache(m), ids = tok.encode(tok.chatPrompt(question)), out = [];
  let logits = null, t0 = performance.now();
  for (let pos = 0; pos < ids.length && !stopping; pos++) {
    logits = F.forward(m, cache, ids[pos], pos, pos === ids.length - 1, null, mixers);
    say({ type: 'prompt', done: pos + 1, total: ids.length, norms: norms(cache, layers) });
    await tick();
  }
  const t1 = performance.now();
  mixMs = 0;
  for (let k = 0; k < maxNew && !stopping && logits; k++) {
    const token = F.argmax(logits);
    if (tok.stop.includes(token)) break;
    out.push(token);
    say({ type: 'text', text: tok.decode(out), tokens: out.length, ms: performance.now() - t1, mixMs, norms: norms(cache, layers) });
    await tick();
    if (k + 1 < maxNew && !stopping) logits = F.forward(m, cache, token, ids.length + k, true, null, mixers);
  }
  say({ type: 'done', promptTokens: ids.length, tokens: out.length, promptMs: t1 - t0, ms: performance.now() - t1 });
}

onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'ask') ask(msg.question, msg.setting, msg.maxNew).catch((err) => say({ type: 'error', text: String(err.stack || err) }));
  if (msg.type === 'stop') stopping = true;
  if (msg.type === 'start') { MODEL = msg.model; start().catch((err) => say({ type: 'error', text: String(err.stack || err) })); }
};
