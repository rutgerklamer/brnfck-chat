'use strict';

// Float reference for the vision part of Qwen3.5 (model.visual.*, checked by vision/hf_check.py): a picture in, one
// vector per four squares out, which the text model reads in place of the word pieces <|image_pad|>.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const F = require('./float');

// ---------------------------------------------------------------- pictures

// A PNG file as rows of red, green and blue bytes: 8 bits per channel, grey, RGB or RGBA, not interlaced.
function readPng(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error(file + ' is not a PNG file');
  let at = 8, W = 0, H = 0, type = 0;
  const idat = [];
  while (at < b.length) {
    const n = b.readUInt32BE(at), kind = b.toString('latin1', at + 4, at + 8), d = b.subarray(at + 8, at + 8 + n);
    if (kind === 'IHDR') {
      W = d.readUInt32BE(0); H = d.readUInt32BE(4); type = d[9];
      if (d[8] !== 8 || d[12] !== 0 || ![0, 2, 6].includes(type)) throw new Error(file + ': only 8-bit grey, RGB or RGBA without interlacing');
    } else if (kind === 'IDAT') idat.push(d);
    else if (kind === 'IEND') break;
    at += 12 + n;
  }
  const ch = type === 0 ? 1 : type === 2 ? 3 : 4, raw = zlib.inflateSync(Buffer.concat(idat)), stride = W * ch, rgb = new Uint8Array(W * H * 3);
  let prev = new Uint8Array(stride), cur = new Uint8Array(stride);
  for (let y = 0; y < H; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const left = i >= ch ? cur[i - ch] : 0, up = prev[i], ul = i >= ch ? prev[i - ch] : 0;
      let v = row[i];
      if (f === 1) v += left; else if (f === 2) v += up; else if (f === 3) v += (left + up) >> 1;
      else if (f === 4) { const p = left + up - ul, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - ul); v += pa <= pb && pa <= pc ? left : pb <= pc ? up : ul; }
      cur[i] = v;
    }
    for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) rgb[(y * W + x) * 3 + c] = cur[x * ch + (ch === 1 ? 0 : c)];
    [prev, cur] = [cur, prev];
  }
  return { W, H, rgb };
}

// The 16 x 16 squares of a picture in the model's order: blocks of 2 x 2 squares, row by row; in a square
// the red pixels row by row, then the green, then the blue. Bytes as they are (0 .. 255).
function squares(pic, P = 16, merge = 2) {
  const { W, H, rgb } = pic, gh = H / P, gw = W / P;
  if (gh % merge || gw % merge || gh !== Math.floor(gh) || gw !== Math.floor(gw)) throw new Error(`the picture must be a multiple of ${P * merge} pixels high and wide`);
  const n = gh * gw, out = new Uint8Array(n * 3 * P * P), rc = [];
  let s = 0;
  for (let br = 0; br < gh / merge; br++) for (let bc = 0; bc < gw / merge; bc++) for (let ir = 0; ir < merge; ir++) for (let ic = 0; ic < merge; ic++) {
    const row = br * merge + ir, col = bc * merge + ic;
    rc.push([row, col]);
    for (let c = 0; c < 3; c++) for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) out[s++] = rgb[((row * P + y) * W + col * P + x) * 3 + c];
  }
  return { gh, gw, n, bytes: out, rc };
}

// ---------------------------------------------------------------- weights

// The sizes of the vision part, from config.json alone.
function visionShape(dir) {
  const top = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')), c = top.vision_config;
  const V = {
    dim: c.hidden_size, hidden: c.intermediate_size, depth: c.depth, heads: c.num_heads, P: c.patch_size, merge: c.spatial_merge_size,
    out: c.out_hidden_size, side: Math.round(Math.sqrt(c.num_position_embeddings)), theta: (c.rope_parameters && c.rope_parameters.rope_theta) || 10000,
    imageToken: top.image_token_id, startToken: top.vision_start_token_id, endToken: top.vision_end_token_id, eps: 1e-6,
  };
  V.headSize = V.dim / V.heads;
  if (c.temporal_patch_size !== 2 || c.in_channels !== 3 || (c.deepstack_visual_indexes || []).length) throw new Error('unexpected vision layout');
  // rotation speeds of the rows and columns: theta^(-2j / (headSize / 2)), j < headSize / 4
  V.freq = Float64Array.from({ length: V.headSize / 4 }, (_, j) => Math.pow(V.theta, -(2 * j) / (V.headSize / 2)));
  return V;
}

function loadVision(dir) {
  const V = visionShape(dir), st = F.readSafetensors(path.join(dir, 'model.safetensors')), p = 'model.visual.';
  // the patch embedding is a Conv3d over two frames; a picture is its own second frame, so the two halves are added
  const K = st.getFloat(p + 'patch_embed.proj.weight'), inN = 3 * V.P * V.P;
  V.patch = new Float32Array(V.dim * inN);
  for (let o = 0; o < V.dim; o++) for (let ch = 0; ch < 3; ch++) for (let i = 0; i < V.P * V.P; i++) {
    const k0 = ((o * 3 + ch) * 2) * V.P * V.P + i;
    V.patch[o * inN + ch * V.P * V.P + i] = K[k0] + K[k0 + V.P * V.P];
  }
  V.patchBias = st.getFloat(p + 'patch_embed.proj.bias');
  V.posEmbed = st.getFloat(p + 'pos_embed.weight');
  V.blocks = [];
  for (let l = 0; l < V.depth; l++) {
    const b = (n) => p + `blocks.${l}.` + n;
    V.blocks.push({
      n1w: st.getFloat(b('norm1.weight')), n1b: st.getFloat(b('norm1.bias')), n2w: st.getFloat(b('norm2.weight')), n2b: st.getFloat(b('norm2.bias')),
      qkv: st.get(b('attn.qkv.weight')), qkvB: st.getFloat(b('attn.qkv.bias')), proj: st.get(b('attn.proj.weight')), projB: st.getFloat(b('attn.proj.bias')),
      fc1: st.get(b('mlp.linear_fc1.weight')), fc1B: st.getFloat(b('mlp.linear_fc1.bias')), fc2: st.get(b('mlp.linear_fc2.weight')), fc2B: st.getFloat(b('mlp.linear_fc2.bias')),
    });
  }
  V.merger = {
    nw: st.getFloat(p + 'merger.norm.weight'), nb: st.getFloat(p + 'merger.norm.bias'),
    fc1: st.get(p + 'merger.linear_fc1.weight'), fc1B: st.getFloat(p + 'merger.linear_fc1.bias'),
    fc2: st.get(p + 'merger.linear_fc2.weight'), fc2B: st.getFloat(p + 'merger.linear_fc2.bias'),
  };
  st.close();
  return V;
}

// ---------------------------------------------------------------- forward pass

const geluTanh = (x) => 0.5 * x * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (x + 0.044715 * x * x * x)));
// erf by its continued fraction for large |x| and its series for small: well below 1e-12 everywhere
function erf(x) {
  const ax = Math.abs(x);
  if (ax < 2.5) { let term = ax, sum = ax; for (let n = 1; n < 60; n++) { term *= (-ax * ax) / n; sum += term / (2 * n + 1); } return Math.sign(x) * sum * 2 / Math.sqrt(Math.PI); }
  let f = 0;
  for (let n = 60; n >= 1; n--) f = n / 2 / (ax + f);
  return Math.sign(x) * (1 - Math.exp(-ax * ax) / Math.sqrt(Math.PI) / (ax + f));
}
const geluExact = (x) => 0.5 * x * (1 + erf(x / Math.SQRT2));

function layerNorm(x, at, n, w, b, eps, out, oat) {
  let m = 0, v = 0;
  for (let i = 0; i < n; i++) m += x[at + i];
  m /= n;
  for (let i = 0; i < n; i++) { const d = x[at + i] - m; v += d * d; }
  const s = 1 / Math.sqrt(v / n + eps);
  for (let i = 0; i < n; i++) out[oat + i] = (x[at + i] - m) * s * w[i] + b[i];
}

// The learned position of square (row, col) on a grid gh x gw: bilinear between four of the 48 x 48, corners aligned.
function position(V, row, col, gh, gw, out) {
  const { side, dim, posEmbed } = V, taps = (i, size) => {
    const src = (i * (side - 1)) / Math.max(size - 1, 1), f = Math.floor(src);
    return [[Math.min(f, side - 1), 1 - (src - f)], [Math.min(f + 1, side - 1), src - f]];
  };
  out.fill(0);
  for (const [r, wr] of taps(row, gh)) for (const [c, wc] of taps(col, gw)) {
    const wgt = wr * wc;
    if (wgt) for (let i = 0; i < dim; i++) out[i] += wgt * posEmbed[(r * side + c) * dim + i];
  }
  return out;
}

// sq: squares(); returns { x: the input of the first block (n x dim), emb: the vectors for the text model (n / 4 x out) }.
// probe(name, layer, values of all squares), when given, sees every stage.
function encode(V, sq, probe) {
  const { dim, hidden, heads, headSize: hs, eps, depth, freq } = V, { n, gh, gw, bytes, rc } = sq, inN = 3 * V.P * V.P;
  const x = new Float64Array(n * dim), xn = new Float64Array(n * dim), pix = new Float64Array(inN), pos = new Float64Array(dim);
  for (let s = 0; s < n; s++) {
    for (let i = 0; i < inN; i++) pix[i] = bytes[s * inN + i] / 127.5 - 1;
    for (let o = 0; o < dim; o++) {
      let acc = V.patchBias[o];
      for (let i = 0; i < inN; i++) acc += V.patch[o * inN + i] * pix[i];
      x[s * dim + o] = acc;
    }
    position(V, rc[s][0], rc[s][1], gh, gw, pos);
    for (let i = 0; i < dim; i++) x[s * dim + i] += pos[i];
  }
  if (probe) probe('embed', -1, x);
  // cos and sin per square and rotation pair: pair i (with i + hs/2): i < hs/4 turns by the row, the rest by the column
  const half = hs / 2, cs = new Float64Array(n * half), sn = new Float64Array(n * half);
  for (let s = 0; s < n; s++) for (let i = 0; i < half; i++) {
    const a = (i < half / 2 ? rc[s][0] : rc[s][1]) * freq[i % (half / 2)];
    cs[s * half + i] = Math.cos(a); sn[s * half + i] = Math.sin(a);
  }
  const qkv = new Float64Array(n * 3 * dim), att = new Float64Array(n), mixed = new Float64Array(n * dim), y = new Float64Array(dim), h = new Float64Array(hidden), scale = 1 / Math.sqrt(hs);
  for (let l = 0; l < depth; l++) {
    const B = V.blocks[l];
    for (let s = 0; s < n; s++) {
      layerNorm(x, s * dim, dim, B.n1w, B.n1b, eps, xn, s * dim);
      const r = F.hooks.matvec(B.qkv, xn.subarray(s * dim, (s + 1) * dim), 3 * dim);
      for (let i = 0; i < 3 * dim; i++) r[i] += B.qkvB[i];
      // turn q and k
      for (const part of [0, dim]) for (let hh = 0; hh < heads; hh++) {
        const at = part + hh * hs;
        for (let i = 0; i < half; i++) {
          const c = cs[s * half + i], sv = sn[s * half + i], p = r[at + i], q = r[at + i + half];
          r[at + i] = p * c - q * sv; r[at + i + half] = q * c + p * sv;
        }
      }
      qkv.set(r, s * 3 * dim);
    }
    if (probe) probe('qkv', l, qkv);
    mixed.fill(0);
    for (let s = 0; s < n; s++) for (let hh = 0; hh < heads; hh++) {
      const qa = s * 3 * dim + hh * hs;
      let best = -Infinity;
      for (let t = 0; t < n; t++) {
        const ka = t * 3 * dim + dim + hh * hs;
        let v = 0;
        for (let i = 0; i < hs; i++) v += qkv[qa + i] * qkv[ka + i];
        att[t] = v * scale;
        if (att[t] > best) best = att[t];
      }
      let sum = 0;
      for (let t = 0; t < n; t++) sum += (att[t] = Math.exp(att[t] - best));
      for (let t = 0; t < n; t++) {
        const w = att[t] / sum, va = t * 3 * dim + 2 * dim + hh * hs;
        for (let i = 0; i < hs; i++) mixed[s * dim + hh * hs + i] += w * qkv[va + i];
      }
    }
    if (probe) probe('mixed', l, mixed);
    for (let s = 0; s < n; s++) {
      const o = F.hooks.matvec(B.proj, mixed.subarray(s * dim, (s + 1) * dim), dim);
      for (let i = 0; i < dim; i++) x[s * dim + i] += o[i] + B.projB[i];
      layerNorm(x, s * dim, dim, B.n2w, B.n2b, eps, y, 0);
      F.hooks.matvec(B.fc1, y, hidden, h);
      for (let i = 0; i < hidden; i++) h[i] += B.fc1B[i];
      if (probe) probe('fc1', l, h);
      for (let i = 0; i < hidden; i++) h[i] = geluTanh(h[i]);
      const f = F.hooks.matvec(B.fc2, h, dim);
      for (let i = 0; i < dim; i++) x[s * dim + i] += f[i] + B.fc2B[i];
    }
    if (probe) probe('x', l, x);
  }
  // the merger
  const M = V.merger, G = V.merge * V.merge, wide = G * dim, emb = new Float64Array((n / G) * V.out), cat = new Float64Array(wide), u = new Float64Array(wide);
  for (let g = 0; g < n / G; g++) {
    for (let j = 0; j < G; j++) layerNorm(x, (g * G + j) * dim, dim, M.nw, M.nb, eps, cat, j * dim);
    F.hooks.matvec(M.fc1, cat, wide, u);
    for (let i = 0; i < wide; i++) u[i] += M.fc1B[i];
    if (probe) probe('mfc1', -1, u);
    for (let i = 0; i < wide; i++) u[i] = geluExact(u[i]);
    const o = F.hooks.matvec(M.fc2, u, V.out);
    for (let i = 0; i < V.out; i++) emb[g * V.out + i] = o[i] + M.fc2B[i];
  }
  if (probe) probe('emb', -1, emb);
  return { x, emb };
}

// ---------------------------------------------------------------- with the text model

// The prompt of a picture and a question (as Qwen3VLProcessor) and each token's rotation place [time, row, column]:
// picture tokens (start, start + row, start + column); after it the count goes on at start + the larger block-grid side.
function visionPrompt(tok, V, sq, question) {
  const k = V.merge, bh = sq.gh / k, bw = sq.gw / k;
  const before = tok.encode('<|im_start|>user\n<|vision_start|>'), after = tok.encode(`<|vision_end|>${question}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n`);
  const ids = [...before], rope = before.map((_, i) => [i, i, i]);
  const start = before.length;
  for (let r = 0; r < bh; r++) for (let c = 0; c < bw; c++) { ids.push(V.imageToken); rope.push([start, start + r, start + c]); }
  let next = start + Math.max(bh, bw);
  for (const id of after) { ids.push(id); rope.push([next, next, next]); next++; }
  return { ids, rope, imageAt: start, images: bh * bw, nextRope: next };
}

// A greedy answer of the text model about a picture. emb: encode().emb.
function answer(m, V, tok, sq, emb, question, maxNew = 60) {
  const P = visionPrompt(tok, V, sq, question), cache = F.newCache(m), out = [];
  let logits = null;
  const embOf = (i) => (P.ids[i] === V.imageToken ? emb.subarray((i - P.imageAt) * V.out, (i - P.imageAt + 1) * V.out) : null);
  for (let i = 0; i < P.ids.length; i++) logits = F.forward(m, cache, P.ids[i], i, i === P.ids.length - 1, null, null, { x: embOf(i), rope: P.rope[i] });
  let r = P.nextRope;
  for (let n = 0; n < maxNew; n++) {
    const t = F.argmax(logits);
    if (tok.stop.includes(t)) break;
    out.push(t);
    if (n + 1 < maxNew) logits = F.forward(m, cache, t, P.ids.length + n, true, null, null, { rope: [r, r, r] });
    r++;
  }
  return { prompt: P, ids: out, text: tok.decode(out) };
}

module.exports = { readPng, squares, visionShape, loadVision, encode, visionPrompt, answer, geluTanh, geluExact, erf, layerNorm, position };

if (require.main === module) {
  const DIR = F.modelDir(), file = process.argv[2], question = process.argv.slice(3).join(' ') || 'Describe this picture in one sentence.';
  if (!file) throw new Error('usage: node compiler/qwen3.5/reference/vision.js picture.png ["question"]');
  let t = Date.now();
  const V = loadVision(DIR), sq = squares(readPng(file), V.P, V.merge);
  console.log(`vision part loaded in ${Date.now() - t} ms; ${sq.gw * V.P} x ${sq.gh * V.P} pixels = ${sq.n} squares = ${sq.n / 4} word pieces`);
  t = Date.now();
  const { emb } = encode(V, sq);
  console.log(`picture encoded in ${((Date.now() - t) / 1000).toFixed(1)} s`);
  const m = F.loadModel(DIR), tok = F.loadTokenizer(DIR);
  t = Date.now();
  const A = answer(m, V, tok, sq, emb, question);
  console.log(`> ${question}\n${A.text}\n[${A.prompt.ids.length} prompt + ${A.ids.length} new tokens in ${((Date.now() - t) / 1000).toFixed(1)} s]`);
}
