'use strict';

// Floating point reference for the text part of the Qwen3.5 models (model_type qwen3_5; 0.8B .. 27B, Qwen3.8-27B).
// Three of every four layers are Gated DeltaNet (linear attention with a state per head), the fourth is
// full attention with an output gate. The site runs this file in a browser (site/compare/live/, a copy): only the functions that take a
// folder read files.
//   node compiler/qwen3.5/reference/float.js [--model=qwen3.5-0.8b] ["question"]

const fs = require('fs');
const path = require('path');

const MAX_POS = 512; // size of the key/value cache of the full attention layers

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
  const bytesOf = (t, out) => {
    const [from, to] = t.data_offsets, bytes = Buffer.from(out.buffer);
    for (let done = 0; done < to - from;) done += fs.readSync(fd, bytes, done, Math.min(1 << 26, to - from - done), 8 + n + from + done);
    return out;
  };
  // the raw bfloat16 bits
  const get = (name) => {
    const t = header[name];
    if (!t) throw new Error('missing tensor ' + name);
    if (t.dtype !== 'BF16') throw new Error(name + ': expected BF16, got ' + t.dtype);
    return bytesOf(t, new Uint16Array((t.data_offsets[1] - t.data_offsets[0]) / 2));
  };
  // a small tensor as floats, BF16 or F32 (A_log and the gated norm are stored as F32)
  const getFloat = (name) => {
    const t = header[name];
    if (!t) throw new Error('missing tensor ' + name);
    if (t.dtype === 'BF16') return toFloat(get(name));
    if (t.dtype === 'F32') return bytesOf(t, new Float32Array((t.data_offsets[1] - t.data_offsets[0]) / 4));
    throw new Error(name + ': unexpected dtype ' + t.dtype);
  };
  return { header, get, getFloat, has: (name) => name in header, close: () => fs.closeSync(fd) };
}

const openWeights = (dir) =>
  weightsFrom(JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')), readSafetensors(path.join(dir, 'model.safetensors')));

// top: config.json; st: { get, getFloat, has, close } over the tensors (readSafetensors, or site/compare/live/worker.js)
function weightsFrom(top, st) {
  const c = top.text_config || top, rope = c.rope_parameters || c;
  const P = st.has('model.language_model.embed_tokens.weight') ? 'model.language_model.' : 'model.';
  const headSize = c.head_dim, rotDim = Math.round(headSize * (rope.partial_rotary_factor ?? 1));
  const shape = {
    dim: c.hidden_size, hidden: c.intermediate_size, layers: c.num_hidden_layers, vocab: c.vocab_size, eps: c.rms_norm_eps,
    types: c.layer_types.map((t) => (t === 'linear_attention' ? 'lin' : 'att')),
    // full attention
    heads: c.num_attention_heads, kvHeads: c.num_key_value_heads, headSize, kvDim: c.num_key_value_heads * headSize,
    rotDim, theta: rope.rope_theta, maxPos: MAX_POS,
    // Gated DeltaNet: nk key heads (queries and keys) of dk, nv value heads of dv; value head h reads key head h / (nv / nk)
    nk: c.linear_num_key_heads, nv: c.linear_num_value_heads, dk: c.linear_key_head_dim, dv: c.linear_value_head_dim,
    kernel: c.linear_conv_kernel_dim,
    tied: !st.has('lm_head.weight'),
  };
  shape.keyDim = shape.nk * shape.dk; shape.valueDim = shape.nv * shape.dv; shape.convDim = 2 * shape.keyDim + shape.valueDim;
  // Rotation speeds of the first rotDim numbers of every head: theta^(-2f/rotDim).
  shape.freq = Float64Array.from({ length: rotDim / 2 }, (_, f) => Math.pow(shape.theta, -(2 * f) / rotDim));
  const name = (kind, l) => {
    const p = `${P}layers.${l}.`;
    switch (kind) {
      case 'emb': return P + 'embed_tokens.weight';
      case 'cls': return shape.tied ? P + 'embed_tokens.weight' : 'lm_head.weight';
      case 'rmsFinal': return P + 'norm.weight';
      case 'rmsAtt': return p + 'input_layernorm.weight';
      case 'rmsFfn': return p + 'post_attention_layernorm.weight';
      case 'w1': return p + 'mlp.gate_proj.weight'; // goes through silu
      case 'w3': return p + 'mlp.up_proj.weight';
      case 'w2': return p + 'mlp.down_proj.weight';
      // full attention
      case 'wq': return p + 'self_attn.q_proj.weight'; // per head: headSize query rows, then headSize gate rows
      case 'wk': return p + 'self_attn.k_proj.weight';
      case 'wv': return p + 'self_attn.v_proj.weight';
      case 'wo': return p + 'self_attn.o_proj.weight';
      case 'qNorm': return p + 'self_attn.q_norm.weight';
      case 'kNorm': return p + 'self_attn.k_norm.weight';
      // Gated DeltaNet
      case 'wqkv': return p + 'linear_attn.in_proj_qkv.weight'; // queries, keys, values
      case 'wz': return p + 'linear_attn.in_proj_z.weight';     // gate of the output norm
      case 'wa': return p + 'linear_attn.in_proj_a.weight';     // decay
      case 'wb': return p + 'linear_attn.in_proj_b.weight';     // write strength beta
      case 'wout': return p + 'linear_attn.out_proj.weight';
      case 'conv': return p + 'linear_attn.conv1d.weight';      // [convDim, 1, kernel]
      case 'aLog': return p + 'linear_attn.A_log';
      case 'dtBias': return p + 'linear_attn.dt_bias';
      case 'gNorm': return p + 'linear_attn.norm.weight';
      default: throw new Error('unknown tensor kind ' + kind);
    }
  };
  const raw = (kind, l) => st.get(name(kind, l));
  const tensor = (kind, l) => st.getFloat(name(kind, l));
  return { ...shape, shape, raw, tensor, close: st.close };
}

const KINDS = {
  all: ['rmsAtt', 'rmsFfn', 'w1', 'w3', 'w2'],
  att: ['wq', 'wk', 'wv', 'wo', 'qNorm', 'kNorm'],
  lin: ['wqkv', 'wz', 'wa', 'wb', 'wout', 'conv', 'aLog', 'dtBias', 'gNorm'],
};

const loadModel = (dir) => modelFrom(openWeights(dir));

function modelFrom(src) {
  const m = { ...src.shape, L: [] };
  // matrices stay raw (16 bits), the small vectors (gains, the convolution, A_log, dt_bias) become floats
  const get = (k, l) => (k[0] === 'w' ? src.raw(k, l) : src.tensor(k, l));
  m.emb = src.raw('emb');
  m.cls = m.tied ? m.emb : src.raw('cls');
  for (let l = 0; l < m.layers; l++) {
    const L = { type: m.types[l] };
    for (const k of [...KINDS.all, ...KINDS[L.type]]) L[k] = get(k, l);
    m.L.push(L);
  }
  m.rmsFinal = src.tensor('rmsFinal');
  src.close();
  return m;
}

// -------------------------------------------------------------- tokenizer

const loadTokenizer = (dir) => tokenizerFrom(JSON.parse(fs.readFileSync(path.join(dir, 'tokenizer.json'), 'utf8')));

function tokenizerFrom(t) {
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

  const utf8 = new TextEncoder(), text = new TextDecoder();
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
  // as Qwen2.5's, but combining marks (\p{M}) stay with the letters before them
  const wordRe = /'[sS]|'[tT]|'[rR][eE]|'[vV][eE]|'[mM]|'[lL][lL]|'[dD]|[^\r\n\p{L}\p{N}]?[\p{L}\p{M}]+|\p{N}| ?[^\s\p{L}\p{M}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu;

  const encode = (text) => {
    const ids = [];
    for (const piece of text.split(addedRe)) {
      if (!piece) continue;
      if (addedId.has(piece)) { ids.push(addedId.get(piece)); continue; }
      const norm = piece.normalize('NFC');
      let last = 0;
      const word = (w) => { if (w) ids.push(...bpe(Array.from(utf8.encode(w), (b) => byteChar[b]).join(''))); };
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
      if (addedIds.has(id)) { if (!skipSpecial || !specialIds.has(id)) bytes.push(...utf8.encode(tokens[id])); continue; }
      if (tokens[id] === undefined) continue; // unused rows of the embedding table
      for (const ch of tokens[id]) bytes.push(charByte.get(ch));
    }
    return text.decode(Uint8Array.from(bytes));
  };

  // The chat template without a system message, with thinking switched off (its default).
  const chatPrompt = (user) => `<|im_start|>user\n${user}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n`;

  return { encode, decode, chatPrompt, stop: [addedId.get('<|im_end|>'), addedId.get('<|endoftext|>')] };
}

// ----------------------------------------------------------- forward pass

// y = W x, with W stored row by row as bfloat16 bits.
function matvec(W, x, rows, y = new Float64Array(rows)) {
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
    y[r] = s0 + s1 + s2 + s3;
  }
  return y;
}

// Every matrix-vector product of the forward pass goes through hooks.matvec: site/compare/live/worker.js shares it out over threads.
const hooks = { matvec };

// The normalisations of Qwen3.5 scale by (1 + w): their gains are stored around 0.
function rmsnorm(x, w, eps, out = new Float64Array(x.length), at = 0, n = x.length) {
  let ss = 0;
  for (let i = at; i < at + n; i++) ss += x[i] * x[i];
  const scale = 1 / Math.sqrt(ss / n + eps);
  for (let i = 0; i < n; i++) out[at + i] = x[at + i] * scale * (1 + w[i]);
  return out;
}

const sigmoid = (v) => 1 / (1 + Math.exp(-v));
const silu = (v) => v / (1 + Math.exp(-v));
const softplus = (v) => (v > 20 ? v : Math.log1p(Math.exp(v))); // as torch, threshold 20

// The position that turns speed f of the rotation when a token has three (time, row, column: tokens of a picture):
// the speeds take them in turn, 1, 4, 7 .. 31 the row, 2, 5 .. 29 the column, the others the time (mrope_section 11, 11, 10,
// interleaved). Text has the same number three times: the ordinary rotation.
const MROPE = Uint8Array.from({ length: 32 }, (_, f) => (f % 3 === 1 && f < 33 ? 1 : f % 3 === 2 && f < 30 ? 2 : 0));

// Rotate the first rotDim numbers of every head: number f goes with number f + rotDim/2. pos: a number, or [t, row, column].
function rotate(vec, pos, m) {
  const { headSize, rotDim, freq } = m, half = rotDim / 2;
  for (let at = 0; at < vec.length; at += headSize) {
    for (let f = 0; f < half; f++) {
      const angle = (typeof pos === 'number' ? pos : pos[MROPE[f]]) * freq[f], c = Math.cos(angle), s = Math.sin(angle);
      const a = vec[at + f], b = vec[at + f + half];
      vec[at + f] = a * c - b * s;
      vec[at + f + half] = b * c + a * s;
    }
  }
}

// What a conversation keeps: the keys and values of the full layers, the convolution window and state of the others.
const newCache = (m) => ({
  k: m.types.map((t) => (t === 'att' ? new Float64Array(m.maxPos * m.kvDim) : null)),
  v: m.types.map((t) => (t === 'att' ? new Float64Array(m.maxPos * m.kvDim) : null)),
  conv: m.types.map((t) => (t === 'lin' ? new Float64Array((m.kernel - 1) * m.convDim) : null)), // the last kernel-1 inputs, oldest first
  S: m.types.map((t) => (t === 'lin' ? new Float64Array(m.nv * m.dk * m.dv) : null)),             // per value head: S[i * dv + j], key i, value j
});

// One Gated DeltaNet layer for one token: xn (normalised input) -> out. Exported for the whole-number comparison.
function deltaNet(m, L, conv, S, xn, out, probe, l) {
  const { nk, nv, dk, dv, keyDim, valueDim, convDim, kernel, eps } = m;
  const mix = hooks.matvec(L.wqkv, xn, convDim), z = hooks.matvec(L.wz, xn, valueDim), a = hooks.matvec(L.wa, xn, nv), b = hooks.matvec(L.wb, xn, nv);
  if (probe) { probe('mix', l, mix); probe('z', l, z); probe('a', l, a); probe('b', l, b); }
  // causal convolution over the last `kernel` tokens of every channel, then silu
  const c = new Float64Array(convDim), w = L.conv;
  for (let ch = 0; ch < convDim; ch++) {
    let s = w[ch * kernel + kernel - 1] * mix[ch];
    for (let j = 0; j < kernel - 1; j++) s += w[ch * kernel + j] * conv[j * convDim + ch];
    c[ch] = silu(s);
  }
  conv.copyWithin(0, convDim); conv.set(mix, (kernel - 2) * convDim);
  // queries and keys to length 1 per head (the queries to 1/sqrt(dk))
  for (let h = 0; h < 2 * nk; h++) {
    let ss = 0;
    for (let i = h * dk; i < (h + 1) * dk; i++) ss += c[i] * c[i];
    const f = 1 / Math.sqrt(ss + 1e-6) / (h < nk ? Math.sqrt(dk) : 1);
    for (let i = h * dk; i < (h + 1) * dk; i++) c[i] *= f;
  }
  if (probe) probe('conv', l, c);
  const o = new Float64Array(valueDim), mem = new Float64Array(dv), dec = new Float64Array(nv), bet = new Float64Array(nv);
  for (let h = 0; h < nv; h++) {
    const kh = Math.floor(h / (nv / nk)), q = c.subarray(kh * dk, (kh + 1) * dk), k = c.subarray(keyDim + kh * dk, keyDim + (kh + 1) * dk);
    const v = c.subarray(2 * keyDim + h * dv, 2 * keyDim + (h + 1) * dv), Sh = S.subarray(h * dk * dv, (h + 1) * dk * dv);
    const decay = Math.exp(-Math.exp(L.aLog[h]) * softplus(a[h] + L.dtBias[h])), beta = sigmoid(b[h]);
    dec[h] = decay; bet[h] = beta;
    // forget a little, read what the state predicts for k, write the difference with strength beta, read with q
    for (let i = 0; i < dk * dv; i++) Sh[i] *= decay;
    mem.fill(0);
    for (let i = 0; i < dk; i++) for (let j = 0; j < dv; j++) mem[j] += Sh[i * dv + j] * k[i];
    for (let j = 0; j < dv; j++) mem[j] = (v[j] - mem[j]) * beta;
    for (let i = 0; i < dk; i++) for (let j = 0; j < dv; j++) Sh[i * dv + j] += k[i] * mem[j];
    for (let i = 0; i < dk; i++) for (let j = 0; j < dv; j++) o[h * dv + j] += Sh[i * dv + j] * q[i];
  }
  if (probe) { probe('decay', l, dec); probe('beta', l, bet); probe('core', l, o); }
  // per value head: rms norm (gain w itself, not 1 + w), times silu(z)
  for (let h = 0; h < nv; h++) {
    let ss = 0;
    for (let j = h * dv; j < (h + 1) * dv; j++) ss += o[j] * o[j];
    const scale = 1 / Math.sqrt(ss / dv + eps);
    for (let j = 0; j < dv; j++) o[h * dv + j] *= scale * L.gNorm[j] * silu(z[h * dv + j]);
  }
  if (probe) probe('gated', l, o);
  return hooks.matvec(L.wout, o, m.dim, out);
}

// pos: the slot of this token in the cache; rope: its place for the rotation (pos, or [t, row, column] in a picture)
function attention(m, L, ck, cv, xn, pos, out, probe, l, rope = pos) {
  const { heads, headSize, kvDim, eps } = m, qDim = heads * headSize;
  const qg = hooks.matvec(L.wq, xn, 2 * qDim), q = new Float64Array(qDim), gate = new Float64Array(qDim);
  for (let h = 0; h < heads; h++) {
    q.set(qg.subarray(2 * h * headSize, (2 * h + 1) * headSize), h * headSize);
    gate.set(qg.subarray((2 * h + 1) * headSize, (2 * h + 2) * headSize), h * headSize);
  }
  const k = hooks.matvec(L.wk, xn, kvDim), v = hooks.matvec(L.wv, xn, kvDim);
  for (let h = 0; h < heads; h++) rmsnorm(q, L.qNorm, eps, q, h * headSize, headSize);
  for (let h = 0; h < m.kvHeads; h++) rmsnorm(k, L.kNorm, eps, k, h * headSize, headSize);
  rotate(q, rope, m); rotate(k, rope, m);
  ck.set(k, pos * kvDim); cv.set(v, pos * kvDim);
  if (probe) { probe('q', l, q); probe('k', l, k); probe('v', l, v); }

  const mixed = new Float64Array(qDim), att = new Float64Array(pos + 1), share = heads / m.kvHeads, scale = 1 / Math.sqrt(headSize);
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
    let sum = 0;
    for (let t = 0; t <= pos; t++) sum += (att[t] = Math.exp(att[t] - max));
    for (let t = 0; t <= pos; t++) {
      const w = att[t] / sum, base = t * kvDim + kvAt;
      for (let i = 0; i < headSize; i++) mixed[qAt + i] += w * cv[base + i];
    }
  }
  for (let i = 0; i < qDim; i++) mixed[i] *= sigmoid(gate[i]);
  if (probe) probe('mixed', l, mixed);
  return hooks.matvec(L.wo, mixed, m.dim, out);
}

// `mixers[l]`, when given, replaces the token mixer of layer l: (xn, out, pos) -> out (the whole-number DeltaNet).
// opts.x: the input vector in place of the token's row (a picture's word piece, reference/vision.js); opts.rope: the
// place for the rotation when it is not pos.
function forward(m, cache, token, pos, wantLogits = true, probe, mixers, opts = {}) {
  const { dim, layers, hidden, eps } = m;
  if (pos >= m.maxPos) throw new Error('position beyond cache size');
  const x = opts.x ? Float64Array.from(opts.x) : Float64Array.from(m.emb.subarray(token * dim, (token + 1) * dim), (b) => LUT[b]);
  const xn = new Float64Array(dim), out = new Float64Array(dim), a = new Float64Array(hidden), b = new Float64Array(hidden);
  if (probe) probe('emb', -1, x);
  for (let l = 0; l < layers; l++) {
    const L = m.L[l];
    rmsnorm(x, L.rmsAtt, eps, xn);
    if (probe) probe('xnAtt', l, xn);
    if (mixers && mixers[l]) mixers[l](xn, out, pos);
    else if (L.type === 'lin') deltaNet(m, L, cache.conv[l], cache.S[l], xn, out, probe, l);
    else attention(m, L, cache.k[l], cache.v[l], xn, pos, out, probe, l, opts.rope ?? pos);
    for (let i = 0; i < dim; i++) x[i] += out[i];
    if (probe) { probe('mixOut', l, out); probe('xMid', l, x); }

    rmsnorm(x, L.rmsFfn, eps, xn);
    hooks.matvec(L.w1, xn, hidden, a); hooks.matvec(L.w3, xn, hidden, b);
    for (let i = 0; i < hidden; i++) a[i] = silu(a[i]) * b[i];
    hooks.matvec(L.w2, a, dim, out);
    for (let i = 0; i < dim; i++) x[i] += out[i];
    if (probe) { probe('ffnOut', l, out); probe('x', l, x); }
  }
  if (!wantLogits) return null;
  rmsnorm(x, m.rmsFinal, eps, xn);
  return hooks.matvec(m.cls, xn, m.vocab, new Float64Array(m.vocab));
}

// The FIRST largest score, as torch.argmax.
function argmax(a) {
  let best = 0;
  for (let i = 1; i < a.length; i++) if (a[i] > a[best]) best = i;
  return best;
}

function generateIds(m, promptIds, maxNew, stop, mixers) {
  const cache = newCache(m), out = [];
  let logits = null;
  for (let pos = 0; pos < promptIds.length; pos++) logits = forward(m, cache, promptIds[pos], pos, pos === promptIds.length - 1, null, mixers);
  for (let n = 0; n < maxNew; n++) {
    const token = argmax(logits);
    if (stop.includes(token)) break;
    out.push(token);
    if (n + 1 < maxNew) logits = forward(m, cache, token, promptIds.length + n, true, null, mixers);
  }
  return out;
}

// --model=<folder in compiler/downloads> (default qwen3.5-0.8b), taken out of the arguments
function modelDir(argv = process.argv) {
  let name = 'qwen3.5-0.8b';
  for (let i = argv.length - 1; i >= 2; i--) {
    const mt = /^--model=(.+)$/.exec(argv[i]);
    if (mt) { name = mt[1]; argv.splice(i, 1); }
  }
  return path.join(__dirname, '..', '..', 'downloads', name);
}

module.exports = { MROPE, hooks, matvec, LUT, toFloat, readSafetensors, openWeights, weightsFrom, loadModel, modelFrom, loadTokenizer, tokenizerFrom, forward, deltaNet, attention, rmsnorm, newCache, argmax, generateIds, modelDir, softplus, sigmoid, silu };

if (require.main === module) {
  const DIR = modelDir(), MAX_NEW = 60;
  let t = Date.now();
  const tok = loadTokenizer(DIR);
  if (process.argv[2] === '--tokens') { // node compiler/qwen3.5/reference/float.js --tokens "text": only the tokenizer
    const ids = tok.encode(process.argv[3]);
    console.log(JSON.stringify(ids), JSON.stringify(ids.map((i) => tok.decode([i], { skipSpecial: false }))));
    process.exit(0);
  }
  const m = loadModel(DIR);
  console.log(`[model loaded in ${Date.now() - t} ms, ${(process.memoryUsage().rss / 2 ** 30).toFixed(2)} GB in use]`);
  const questions = process.argv.length > 2 ? [process.argv.slice(2).join(' ')]
    : ['What is the capital of France?', 'What is pi?', 'Wat is de hoofdstad van Nederland?', 'Name three primary colors.'];
  for (const qn of questions) {
    t = Date.now();
    const promptIds = tok.encode(tok.chatPrompt(qn)), ids = generateIds(m, promptIds, MAX_NEW, tok.stop);
    const sec = (Date.now() - t) / 1000;
    console.log(`\n> ${qn}\n${tok.decode(ids)}`);
    console.log(`[${promptIds.length} prompt + ${ids.length} new tokens in ${sec.toFixed(1)} s = ${((promptIds.length + ids.length) / sec).toFixed(1)} tokens/s]`);
  }
}
