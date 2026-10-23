'use strict';

// Floating point reference for SmolLM2-135M-Instruct (LlamaForCausalLM).

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'downloads', 'smollm2-135m');
const MAX_POS = 512; // size of the key/value cache

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
    const raw = Buffer.alloc(to - from);
    let done = 0;
    while (done < raw.length) done += fs.readSync(fd, raw, done, Math.min(1 << 26, raw.length - done), 8 + n + from + done);
    // bfloat16 is the top half of a float32.
    const half = new Uint16Array(raw.buffer, raw.byteOffset, count);
    const bits = new Uint32Array(count);
    for (let i = 0; i < count; i++) bits[i] = half[i] << 16;
    return new Float32Array(bits.buffer);
  };
  return { header, get, close: () => fs.closeSync(fd) };
}

// Rows of every head reordered so the rotation pairs (i, i + headSize/2) sit side by side as (2i, 2i + 1).
function pairRows(W, rows, cols, headSize) {
  const out = new Float32Array(W.length), half = headSize / 2;
  for (let r = 0; r < rows; r++) {
    const h = Math.floor(r / headSize), i = r % headSize;
    const src = h * headSize + (i % 2 === 0 ? i / 2 : (i - 1) / 2 + half);
    out.set(W.subarray(src * cols, (src + 1) * cols), r * cols);
  }
  return out;
}

function loadModel(dir = DIR) {
  const c = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
  const st = readSafetensors(path.join(dir, 'model.safetensors'));
  const dim = c.hidden_size, heads = c.num_attention_heads, kvHeads = c.num_key_value_heads;
  const headSize = dim / heads, kvDim = kvHeads * headSize;
  const m = {
    dim, hidden: c.intermediate_size, layers: c.num_hidden_layers, heads, kvHeads, vocab: c.vocab_size,
    headSize, kvDim, theta: c.rope_theta, eps: c.rms_norm_eps, maxPos: MAX_POS,
    rmsAtt: [], wq: [], wk: [], wv: [], wo: [], rmsFfn: [], w1: [], w2: [], w3: [],
  };
  m.emb = st.get('model.embed_tokens.weight');
  for (let l = 0; l < m.layers; l++) {
    const p = `model.layers.${l}.`;
    m.rmsAtt.push(st.get(p + 'input_layernorm.weight'));
    m.wq.push(pairRows(st.get(p + 'self_attn.q_proj.weight'), dim, dim, headSize));
    m.wk.push(pairRows(st.get(p + 'self_attn.k_proj.weight'), kvDim, dim, headSize));
    m.wv.push(st.get(p + 'self_attn.v_proj.weight'));
    m.wo.push(st.get(p + 'self_attn.o_proj.weight'));
    m.rmsFfn.push(st.get(p + 'post_attention_layernorm.weight'));
    m.w1.push(st.get(p + 'mlp.gate_proj.weight')); // goes through silu
    m.w3.push(st.get(p + 'mlp.up_proj.weight'));
    m.w2.push(st.get(p + 'mlp.down_proj.weight'));
  }
  m.rmsFinal = st.get('model.norm.weight');
  st.close();
  // Rotation angles: speed f of every head is theta^(-2f/headSize).
  m.freq = Float64Array.from({ length: headSize / 2 }, (_, f) => Math.pow(m.theta, -(2 * f) / headSize));
  return m;
}

// -------------------------------------------------------------- tokenizer

// GPT-2's reversible byte <-> printable character map.
function byteChars() {
  const keep = new Set();
  for (let b = 33; b <= 126; b++) keep.add(b);
  for (let b = 161; b <= 172; b++) keep.add(b);
  for (let b = 174; b <= 255; b++) keep.add(b);
  const byteChar = [];
  let extra = 0;
  for (let b = 0; b < 256; b++) byteChar[b] = String.fromCharCode(keep.has(b) ? b : 256 + extra++);
  return byteChar;
}

function loadTokenizer(dir = DIR) {
  const t = JSON.parse(fs.readFileSync(path.join(dir, 'tokenizer.json'), 'utf8'));
  const vocab = t.model.vocab, tokens = [];
  for (const [s, id] of Object.entries(vocab)) tokens[id] = s;
  const special = t.added_tokens.map((a) => ({ id: a.id, text: a.content }));
  for (const s of special) tokens[s.id] = s.text;
  const specialIds = new Set(special.map((s) => s.id));
  const rank = new Map();
  t.model.merges.forEach((mg, i) => rank.set(Array.isArray(mg) ? mg.join(' ') : mg, i));

  const byteChar = byteChars(), charByte = new Map(byteChar.map((ch, b) => [ch, b]));

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
      const id = vocab[p];
      if (id === undefined) throw new Error('no token for ' + JSON.stringify(p));
      return id;
    });
    bpeCache.set(word, ids);
    return ids;
  };

  const specialRe = new RegExp('(' + special.map((s) => s.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')');
  const specialId = new Map(special.map((s) => [s.text, s.id]));
  const digitsRe = /\p{Nd}|[^\p{Nd}]+/gu; // pre-tokenizer 1: every digit on its own
  const wordRe = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu; // pre-tokenizer 2: ByteLevel

  const encode = (text) => {
    const ids = [];
    for (const piece of text.split(specialRe)) {
      if (!piece) continue;
      if (specialId.has(piece)) { ids.push(specialId.get(piece)); continue; }
      for (const chunk of piece.match(digitsRe) || []) {
        for (const word of chunk.match(wordRe) || []) {
          const mapped = Array.from(Buffer.from(word, 'utf8'), (b) => byteChar[b]).join('');
          ids.push(...bpe(mapped));
        }
      }
    }
    return ids;
  };

  const decode = (ids, { skipSpecial = true } = {}) => {
    const bytes = [];
    for (const id of ids) {
      if (specialIds.has(id)) { if (!skipSpecial) bytes.push(...Buffer.from(tokens[id], 'utf8')); continue; }
      for (const ch of tokens[id]) bytes.push(charByte.get(ch));
    }
    return Buffer.from(bytes).toString('utf8');
  };

  const SYSTEM = 'You are a helpful AI assistant named SmolLM, trained by Hugging Face';
  // The chat template of tokenizer_config.json for one user turn.
  const chatPrompt = (user, system = SYSTEM) =>
    `<|im_start|>system\n${system}<|im_end|>\n<|im_start|>user\n${user}<|im_end|>\n<|im_start|>assistant\n`;

  return { tokens, encode, decode, chatPrompt, imStart: specialId.get('<|im_start|>'), imEnd: specialId.get('<|im_end|>'), eot: 0 };
}

// ----------------------------------------------------------- forward pass

// y = W x, with W stored row by row.
function matvec(W, x, rows, y = new Float64Array(rows)) {
  const cols = x.length, c4 = cols & ~3;
  for (let r = 0, at = 0; r < rows; r++, at += cols) {
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0, c = 0;
    for (; c < c4; c += 4) {
      s0 += W[at + c] * x[c];
      s1 += W[at + c + 1] * x[c + 1];
      s2 += W[at + c + 2] * x[c + 2];
      s3 += W[at + c + 3] * x[c + 3];
    }
    for (; c < cols; c++) s0 += W[at + c] * x[c];
    y[r] = s0 + s1 + s2 + s3;
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
  const x = Float64Array.from(m.emb.subarray(token * dim, (token + 1) * dim));
  const xn = new Float64Array(dim), q = new Float64Array(dim), k = new Float64Array(kvDim), v = new Float64Array(kvDim);
  const mixed = new Float64Array(dim), out = new Float64Array(dim), a = new Float64Array(hidden), b = new Float64Array(hidden);
  const att = new Float64Array(pos + 1), share = heads / m.kvHeads, scale = 1 / Math.sqrt(headSize);
  if (probe) probe('emb', -1, x);
  for (let l = 0; l < layers; l++) {
    rmsnorm(x, m.rmsAtt[l], eps, xn);
    matvec(m.wq[l], xn, dim, q); matvec(m.wk[l], xn, kvDim, k); matvec(m.wv[l], xn, kvDim, v);
    rotate(q, pos, m); rotate(k, pos, m);
    const ck = cache.k[l], cv = cache.v[l];
    ck.set(k, pos * kvDim); cv.set(v, pos * kvDim);
    if (probe) { probe('xnAtt', l, xn); probe('q', l, q); probe('k', l, k); probe('v', l, v); }

    mixed.fill(0);
    for (let h = 0; h < heads; h++) {
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
  return matvec(m.emb, rmsnorm(x, m.rmsFinal, eps, xn), m.vocab, new Float64Array(m.vocab));
}

function argmax(a) {
  let best = 0;
  for (let i = 1; i < a.length; i++) if (a[i] > a[best]) best = i;
  return best;
}

function generateIds(m, promptIds, maxNew = 60, step = forward, stop = [2, 0]) {
  const cache = step.newCache ? step.newCache() : newCache(m), out = [];
  let logits = null;
  for (let pos = 0; pos < promptIds.length; pos++) logits = step(m, cache, promptIds[pos], pos, pos === promptIds.length - 1);
  for (let n = 0; n < maxNew; n++) {
    const token = argmax(logits);
    if (stop.includes(token)) break;
    out.push(token);
    if (n + 1 < maxNew) logits = step(m, cache, token, promptIds.length + n, true);
  }
  return out;
}

function chat(m, tok, question, maxNew = 60, step = forward) {
  const promptIds = tok.encode(tok.chatPrompt(question));
  const ids = generateIds(m, promptIds, maxNew, step);
  return { promptIds, ids, text: tok.decode(ids) };
}

module.exports = { DIR, loadModel, loadTokenizer, byteChars, forward, generateIds, chat, newCache, argmax, matvec, rmsnorm };

if (require.main === module) {
  let t = Date.now();
  const m = loadModel(), tok = loadTokenizer();
  console.log(`[model loaded in ${Date.now() - t} ms]`);
  const questions = process.argv.length > 2 ? [process.argv.slice(2).join(' ')]
    : ['What is the capital of France?', 'What is pi?', 'Name three colors.'];
  for (const qn of questions) {
    t = Date.now();
    const { promptIds, ids, text } = chat(m, tok, qn, 60);
    const sec = (Date.now() - t) / 1000;
    console.log(`\n> ${qn}\n${text}`);
    console.log(`[${promptIds.length} prompt + ${ids.length} new tokens in ${sec.toFixed(1)} s = ${((promptIds.length + ids.length) / sec).toFixed(1)} tokens/s]`);
  }
}
