'use strict';

// Floating point reference for the Qwen2.5 Instruct models (Qwen2ForCausalLM; 0.5B and 1.5B).

const fs = require('fs');
const path = require('path');

const MAX_POS = 256; // size of the key/value cache

// bfloat16 bits -> value
const LUT = new Float32Array(65536);
{ const bits = new Uint32Array(LUT.buffer); for (let i = 0; i < 65536; i++) bits[i] = i << 16; }
const toFloat = (raw) => { const out = new Float32Array(raw.length); for (let i = 0; i < raw.length; i++) out[i] = LUT[raw[i]]; return out; };

// ---------------------------------------------------------------- weights

function readSafetensors(file) {
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(8);
  fs.readSync(fd, head, 0, 8, 0);
  const n = Number(head.readBigUInt64LE());
  const json = Buffer.alloc(n);
  fs.readSync(fd, json, 0, n, 8);
  const header = JSON.parse(json.toString('utf8'));
  const get = (name) => {
    const t = header[name];
    if (!t) throw new Error('missing tensor ' + name);
    if (t.dtype !== 'BF16') throw new Error('expected BF16, got ' + t.dtype);
    const [from, to] = t.data_offsets, count = (to - from) / 2;
    const out = new Uint16Array(count), bytes = Buffer.from(out.buffer);
    for (let done = 0; done < to - from;) done += fs.readSync(fd, bytes, done, Math.min(1 << 26, to - from - done), 8 + n + from + done);
    return out; // the raw bfloat16 bits
  };
  return { header, get, close: () => fs.closeSync(fd) };
}

function pairRows(W, rows, cols, headSize) {
  const out = new W.constructor(W.length), half = headSize / 2;
  for (let r = 0; r < rows; r++) {
    const h = Math.floor(r / headSize), i = r % headSize;
    const src = h * headSize + (i % 2 === 0 ? i / 2 : (i - 1) / 2 + half);
    out.set(W.subarray(src * cols, (src + 1) * cols), r * cols);
  }
  return out;
}

function openWeights(dir) {
  const c = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
  const st = readSafetensors(path.join(dir, 'model.safetensors'));
  const dim = c.hidden_size, heads = c.num_attention_heads, kvHeads = c.num_key_value_heads;
  const headSize = dim / heads, kvDim = kvHeads * headSize;
  const shape = {
    dim, hidden: c.intermediate_size, layers: c.num_hidden_layers, heads, kvHeads, vocab: c.vocab_size,
    headSize, kvDim, theta: c.rope_theta, eps: c.rms_norm_eps, maxPos: MAX_POS,
  };
  // Rotation angles: speed f of every head is theta^(-2f/headSize).
  shape.freq = Float64Array.from({ length: headSize / 2 }, (_, f) => Math.pow(shape.theta, -(2 * f) / headSize));
  const raw = (kind, l) => {
    const p = `model.layers.${l}.`;
    switch (kind) {
      case 'emb': return st.get('model.embed_tokens.weight');
      case 'rmsFinal': return st.get('model.norm.weight');
      case 'rmsAtt': return st.get(p + 'input_layernorm.weight');
      case 'rmsFfn': return st.get(p + 'post_attention_layernorm.weight');
      case 'wq': return pairRows(st.get(p + 'self_attn.q_proj.weight'), dim, dim, headSize);
      case 'wk': return pairRows(st.get(p + 'self_attn.k_proj.weight'), kvDim, dim, headSize);
      case 'wv': return st.get(p + 'self_attn.v_proj.weight');
      case 'wo': return st.get(p + 'self_attn.o_proj.weight');
      case 'bq': return pairRows(st.get(p + 'self_attn.q_proj.bias'), dim, 1, headSize);
      case 'bk': return pairRows(st.get(p + 'self_attn.k_proj.bias'), kvDim, 1, headSize);
      case 'bv': return st.get(p + 'self_attn.v_proj.bias');
      case 'w1': return st.get(p + 'mlp.gate_proj.weight'); // goes through silu
      case 'w3': return st.get(p + 'mlp.up_proj.weight');
      case 'w2': return st.get(p + 'mlp.down_proj.weight');
      default: throw new Error('unknown tensor kind ' + kind);
    }
  };
  const tensor = (kind, l) => toFloat(raw(kind, l));
  return { ...shape, shape, raw, tensor, close: st.close };
}

const LAYER_KINDS = ['rmsAtt', 'wq', 'wk', 'wv', 'wo', 'bq', 'bk', 'bv', 'rmsFfn', 'w1', 'w3', 'w2'];

function loadModel(dir) {
  const src = openWeights(dir);
  const m = { ...src.shape };
  for (const k of LAYER_KINDS) m[k] = [];
  // matrices stay raw (16 bits), the small vectors (gains, biases) become floats
  const get = (k, l) => (k[0] === 'w' || k === 'emb' ? src.raw(k, l) : src.tensor(k, l));
  m.emb = get('emb');
  for (let l = 0; l < m.layers; l++) for (const k of LAYER_KINDS) m[k].push(get(k, l));
  m.rmsFinal = get('rmsFinal');
  src.close();
  return m;
}

// -------------------------------------------------------------- tokenizer

function loadTokenizer(dir) {
  const t = JSON.parse(fs.readFileSync(path.join(dir, 'tokenizer.json'), 'utf8'));
  if (t.normalizer.type !== 'NFC' || t.pre_tokenizer.pretokenizers[0].type !== 'Split') throw new Error('unexpected tokenizer layout');
  const vocab = new Map(Object.entries(t.model.vocab)), tokens = [];
  for (const [s, id] of vocab) tokens[id] = s;
  const added = t.added_tokens.map((a) => ({ id: a.id, text: a.content, special: a.special }));
  for (const s of added) tokens[s.id] = s.text;
  const specialIds = new Set(added.filter((s) => s.special).map((s) => s.id));
  const addedIds = new Set(added.map((s) => s.id));
  const rank = new Map();
  t.model.merges.forEach((mg, i) => rank.set(Array.isArray(mg) ? mg.join(' ') : mg, i));

  // GPT-2's reversible byte <-> printable character map.
  const byteChar = [], charByte = new Map();
  {
    const keep = [];
    for (let b = 33; b <= 126; b++) keep.push(b);
    for (let b = 161; b <= 172; b++) keep.push(b);
    for (let b = 174; b <= 255; b++) keep.push(b);
    let extra = 0;
    for (let b = 0; b < 256; b++) byteChar[b] = String.fromCharCode(keep.includes(b) ? b : 256 + extra++);
    byteChar.forEach((ch, b) => charByte.set(ch, b));
  }

  const bpeCache = new Map();
  const bpe = (word) => {
    if (bpeCache.has(word)) return bpeCache.get(word);
    let parts = Array.from(word);
    for (;;) {
      let best = Infinity, at = -1;
      for (let i = 0; i < parts.length - 1; i++) {
        const r = rank.get(parts[i] + ' ' + parts[i + 1]);
        if (r !== undefined && r < best) { best = r; at = i; }
      }
      if (at < 0) break;
      // merge every occurrence of the winning pair
      const a = parts[at], b = parts[at + 1], next = [];
      for (let i = 0; i < parts.length; i++) {
        if (i < parts.length - 1 && parts[i] === a && parts[i + 1] === b) { next.push(a + b); i++; } else next.push(parts[i]);
      }
      parts = next;
    }
    const ids = parts.map((p) => {
      const id = vocab.get(p);
      if (id === undefined) throw new Error('no token for ' + JSON.stringify(p));
      return id;
    });
    bpeCache.set(word, ids);
    return ids;
  };

  // Added tokens are cut out of the raw text first (none is "normalized"), longest first.
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const addedRe = new RegExp('(' + added.map((s) => s.text).sort((a, b) => b.length - a.length).map(esc).join('|') + ')');
  const addedId = new Map(added.map((s) => [s.text, s.id]));
  const wordRe = /'[sS]|'[tT]|'[rR][eE]|'[vV][eE]|'[mM]|'[lL][lL]|'[dD]|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu;

  const encode = (text) => {
    const ids = [];
    for (const piece of text.split(addedRe)) {
      if (!piece) continue;
      if (addedId.has(piece)) { ids.push(addedId.get(piece)); continue; }
      const norm = piece.normalize('NFC');
      let last = 0;
      const word = (w) => { if (w) ids.push(...bpe(Array.from(Buffer.from(w, 'utf8'), (b) => byteChar[b]).join(''))); };
      for (const mt of norm.matchAll(wordRe)) {
        word(norm.slice(last, mt.index)); // anything the rule skips is a piece of its own
        word(mt[0]);
        last = mt.index + mt[0].length;
      }
      word(norm.slice(last));
    }
    return ids;
  };

  const decode = (ids, { skipSpecial = true } = {}) => {
    const bytes = [];
    for (const id of ids) {
      if (addedIds.has(id)) { if (!skipSpecial || !specialIds.has(id)) bytes.push(...Buffer.from(tokens[id], 'utf8')); continue; }
      if (tokens[id] === undefined) continue; // the 271 unused rows of the embedding table
      for (const ch of tokens[id]) bytes.push(charByte.get(ch));
    }
    return Buffer.from(bytes).toString('utf8');
  };

  const SYSTEM = 'You are Qwen, created by Alibaba Cloud. You are a helpful assistant.';
  const chatPrefix = () => `<|im_start|>system\n${SYSTEM}<|im_end|>\n<|im_start|>user\n`;
  const chatPrompt = (user) => `${chatPrefix()}${user}<|im_end|>\n<|im_start|>assistant\n`;

  return { encode, decode, chatPrompt, chatPrefix, stop: [addedId.get('<|im_end|>'), addedId.get('<|endoftext|>')] };
}

// ----------------------------------------------------------- forward pass

// y = W x (+ bias), with W stored row by row as bfloat16 bits.
function matvec(W, x, rows, y = new Float64Array(rows), bias = null) {
  const cols = x.length, c4 = cols & ~3, T = LUT;
  for (let r = 0, at = 0; r < rows; r++, at += cols) {
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0, c = 0;
    for (; c < c4; c += 4) {
      s0 += T[W[at + c]] * x[c];
      s1 += T[W[at + c + 1]] * x[c + 1];
      s2 += T[W[at + c + 2]] * x[c + 2];
      s3 += T[W[at + c + 3]] * x[c + 3];
    }
    for (; c < cols; c++) s0 += T[W[at + c]] * x[c];
    y[r] = s0 + s1 + s2 + s3 + (bias ? bias[r] : 0);
  }
  return y;
}

function rmsnorm(x, w, eps, out = new Float64Array(x.length)) {
  let ss = 0;
  for (let i = 0; i < x.length; i++) ss += x[i] * x[i];
  const scale = 1 / Math.sqrt(ss / x.length + eps);
  for (let i = 0; i < x.length; i++) out[i] = x[i] * scale * w[i];
  return out;
}

// Rotate adjacent pairs of every head by the angle for this position.
function rotate(vec, pos, m) {
  const { headSize, freq } = m;
  for (let i = 0; i < vec.length; i += 2) {
    const angle = pos * freq[(i % headSize) >> 1];
    const c = Math.cos(angle), s = Math.sin(angle);
    const a = vec[i], b = vec[i + 1];
    vec[i] = a * c - b * s;
    vec[i + 1] = a * s + b * c;
  }
}

const newCache = (m) => ({
  k: Array.from({ length: m.layers }, () => new Float64Array(m.maxPos * m.kvDim)),
  v: Array.from({ length: m.layers }, () => new Float64Array(m.maxPos * m.kvDim)),
});

function forward(m, cache, token, pos, wantLogits = true, probe) {
  const { dim, layers, heads, headSize, kvDim, hidden, eps } = m;
  if (pos >= m.maxPos) throw new Error('position beyond cache size');
  const x = Float64Array.from(m.emb.subarray(token * dim, (token + 1) * dim), (b) => LUT[b]);
  const xn = new Float64Array(dim), q = new Float64Array(dim), k = new Float64Array(kvDim), v = new Float64Array(kvDim);
  const mixed = new Float64Array(dim), out = new Float64Array(dim), a = new Float64Array(hidden), b = new Float64Array(hidden);
  const att = new Float64Array(pos + 1), share = heads / m.kvHeads, scale = 1 / Math.sqrt(headSize);
  if (probe) probe('emb', -1, x);
  for (let l = 0; l < layers; l++) {
    rmsnorm(x, m.rmsAtt[l], eps, xn);
    matvec(m.wq[l], xn, dim, q, m.bq[l]); matvec(m.wk[l], xn, kvDim, k, m.bk[l]); matvec(m.wv[l], xn, kvDim, v, m.bv[l]);
    if (probe) { probe('xnAtt', l, xn); probe('q', l, q); probe('k', l, k); probe('v', l, v); }
    rotate(q, pos, m); rotate(k, pos, m);
    const ck = cache.k[l], cv = cache.v[l];
    ck.set(k, pos * kvDim); cv.set(v, pos * kvDim);

    mixed.fill(0);
    for (let h = 0; h < heads; h++) {
      // the first `share` query heads read key/value head 0, the next ones key/value head 1
      const kvAt = Math.floor(h / share) * headSize, qAt = h * headSize;
      let max = -Infinity;
      for (let t = 0; t <= pos; t++) {
        let s = 0;
        const base = t * kvDim + kvAt;
        for (let i = 0; i < headSize; i++) s += q[qAt + i] * ck[base + i];
        att[t] = s * scale;
        if (att[t] > max) max = att[t];
      }
      if (probe) { probe('scoreMax', l, [max]); probe('scoreGap', l, Array.from(att.subarray(0, pos + 1), (s) => max - s)); }
      let sum = 0;
      for (let t = 0; t <= pos; t++) sum += (att[t] = Math.exp(att[t] - max));
      for (let t = 0; t <= pos; t++) {
        const w = att[t] / sum, base = t * kvDim + kvAt;
        for (let i = 0; i < headSize; i++) mixed[qAt + i] += w * cv[base + i];
      }
    }
    matvec(m.wo[l], mixed, dim, out);
    for (let i = 0; i < dim; i++) x[i] += out[i];
    if (probe) { probe('mixed', l, mixed); probe('attOut', l, out); probe('xMid', l, x); }

    rmsnorm(x, m.rmsFfn[l], eps, xn);
    matvec(m.w1[l], xn, hidden, a); matvec(m.w3[l], xn, hidden, b);
    if (probe) { probe('xnFfn', l, xn); probe('gate', l, a); probe('up', l, b); }
    for (let i = 0; i < hidden; i++) a[i] = (a[i] / (1 + Math.exp(-a[i]))) * b[i];
    matvec(m.w2[l], a, dim, out);
    for (let i = 0; i < dim; i++) x[i] += out[i];
    if (probe) { probe('hid', l, a); probe('ffnOut', l, out); probe('x', l, x); }
  }
  if (!wantLogits) return null;
  rmsnorm(x, m.rmsFinal, eps, xn);
  if (probe) probe('xnFinal', -1, xn);
  return matvec(m.emb, xn, m.vocab, new Float64Array(m.vocab));
}

// The FIRST largest score, as torch.argmax.
function argmax(a) {
  let best = 0;
  for (let i = 1; i < a.length; i++) if (a[i] > a[best]) best = i;
  return best;
}

function generateIds(m, promptIds, maxNew, stop) {
  const cache = newCache(m), out = [];
  let logits = null;
  for (let pos = 0; pos < promptIds.length; pos++) logits = forward(m, cache, promptIds[pos], pos, pos === promptIds.length - 1);
  for (let n = 0; n < maxNew; n++) {
    const token = argmax(logits);
    if (stop.includes(token)) break;
    out.push(token);
    if (n + 1 < maxNew) logits = forward(m, cache, token, promptIds.length + n, true);
  }
  return out;
}

module.exports = { toFloat, openWeights, loadModel, loadTokenizer, forward, newCache, argmax };

if (require.main === module) {
  const { DIR, MAX_NEW } = require('./model');    // (takes --model=... out of the arguments)
  let t = Date.now();
  const tok = loadTokenizer(DIR);
  if (process.argv[2] === '--tokens') { // node compiler/qwen/reference/float.js --tokens "text": only the tokenizer
    const ids = tok.encode(process.argv[3]);
    console.log(JSON.stringify(ids), JSON.stringify(ids.map((i) => tok.decode([i], { skipSpecial: false }))));
    process.exit(0);
  }
  const m = loadModel(DIR);
  console.log(`[model loaded in ${Date.now() - t} ms, ${(process.memoryUsage().rss / 2 ** 30).toFixed(2)} GB in use]`);
  const questions = process.argv.length > 2 ? [process.argv.slice(2).join(' ')]
    : ['What is the capital of France?', 'What is pi?', 'Wat is de hoofdstad van Nederland?'];
  for (const qn of questions) {
    t = Date.now();
    const promptIds = tok.encode(tok.chatPrompt(qn)), ids = generateIds(m, promptIds, MAX_NEW, tok.stop);
    const sec = (Date.now() - t) / 1000;
    console.log(`\n> ${qn}\n${tok.decode(ids)}`);
    console.log(`[${promptIds.length} prompt + ${ids.length} new tokens in ${sec.toFixed(1)} s = ${((promptIds.length + ids.length) / sec).toFixed(1)} tokens/s]`);
  }
}
