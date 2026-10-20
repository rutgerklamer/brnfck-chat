'use strict';

// The multi-token prediction head of Qwen3.5 (the tensors mtp.*), in floating point. From the hidden state of
// position i after the final norm and the embedding of the token at i + 1 it guesses the token at i + 2.
// Read from vLLM (qwen3_5_mtp.py, Qwen3_5MultiTokenPredictor; the inputs as v1/spec_decode/llm_base_proposer.py
// shifts them): the two normalised, side by side, through fc; one full attention layer of the main model's kind
// with its own keys and values; the norm; the output layer of the main model.
//   node compiler/qwen3.5/reference/mtp.js ["question"]    the float model's answer, and how often the guesses were right

const path = require('path');
const F = require('./float');

// The head's weights: matrices raw (bfloat16 bits), vectors as floats. dir: compiler/downloads/<model>.
function loadHead(dir, m) {
  const st = F.readSafetensors(path.join(dir, 'model.safetensors')), p = 'mtp.';
  if (!st.has(p + 'fc.weight')) throw new Error('this model has no multi-token prediction head');
  const L = { type: 'att' };
  const names = {
    rmsAtt: 'input_layernorm.weight', rmsFfn: 'post_attention_layernorm.weight', w1: 'mlp.gate_proj.weight', w3: 'mlp.up_proj.weight', w2: 'mlp.down_proj.weight',
    wq: 'self_attn.q_proj.weight', wk: 'self_attn.k_proj.weight', wv: 'self_attn.v_proj.weight', wo: 'self_attn.o_proj.weight', qNorm: 'self_attn.q_norm.weight', kNorm: 'self_attn.k_norm.weight',
  };
  for (const [k, n] of Object.entries(names)) L[k] = k[0] === 'w' ? st.get(p + 'layers.0.' + n) : st.getFloat(p + 'layers.0.' + n);
  const H = {
    L, fc: st.get(p + 'fc.weight'), normE: st.getFloat(p + 'pre_fc_norm_embedding.weight'), normH: st.getFloat(p + 'pre_fc_norm_hidden.weight'), norm: st.getFloat(p + 'norm.weight'),
    weights: 0,
  };
  for (const n of Object.keys(st.header)) if (n.startsWith(p)) H.weights += st.header[n].shape.reduce((a, b) => a * b, 1);
  st.close();
  if (H.fc.length !== m.dim * 2 * m.dim) throw new Error('fc is not dim x 2 dim');
  return H;
}

// What the head keeps over a conversation: the keys and values of its attention layer.
const newHeadCache = (m) => ({ k: new Float64Array(m.maxPos * m.kvDim), v: new Float64Array(m.maxPos * m.kvDim) });

// The scores of the token at pos + 2. hidden: the main model's state at pos after its final norm; next: the token at pos + 1.
function guess(m, H, cache, hidden, next, pos) {
  const { dim, hidden: hd, eps } = m, both = new Float64Array(2 * dim), e = Float64Array.from(m.emb.subarray(next * dim, (next + 1) * dim), (b) => F.LUT[b]);
  F.rmsnorm(e, H.normE, eps, both, 0, dim);
  const hn = F.rmsnorm(hidden, H.normH, eps);
  both.set(hn, dim);
  const x = F.hooks.matvec(H.fc, both, dim), xn = new Float64Array(dim), out = new Float64Array(dim), a = new Float64Array(hd), b = new Float64Array(hd);
  F.rmsnorm(x, H.L.rmsAtt, eps, xn);
  F.attention(m, H.L, cache.k, cache.v, xn, pos, out);
  for (let i = 0; i < dim; i++) x[i] += out[i];
  F.rmsnorm(x, H.L.rmsFfn, eps, xn);
  F.hooks.matvec(H.L.w1, xn, hd, a); F.hooks.matvec(H.L.w3, xn, hd, b);
  for (let i = 0; i < hd; i++) a[i] = F.silu(a[i]) * b[i];
  F.hooks.matvec(H.L.w2, a, dim, out);
  for (let i = 0; i < dim; i++) x[i] += out[i];
  F.rmsnorm(x, H.norm, eps, xn);
  return F.hooks.matvec(m.cls, xn, m.vocab, new Float64Array(m.vocab));
}

module.exports = { loadHead, newHeadCache, guess };

if (require.main === module) {
  const DIR = F.modelDir(), MAX_NEW = 40;
  const tok = F.loadTokenizer(DIR), m = F.loadModel(DIR), H = loadHead(DIR, m);
  console.log(`multi-token prediction head: ${H.weights.toLocaleString('en-US')} weights`);
  const questions = process.argv.length > 2 ? [process.argv.slice(2).join(' ')] : ['What is the capital of France?', 'What is 12 + 30?', 'Wat is de hoofdstad van Nederland?', 'Name three primary colors.'];
  let right = 0, all = 0;
  for (const qn of questions) {
    // the float model's greedy answer, with its state after the final norm at every position
    const prompt = tok.encode(tok.chatPrompt(qn)), ids = prompt.slice(), states = [], cache = F.newCache(m);
    const probe = (name, l, x) => { if (name === 'x' && l === m.layers - 1) states.push(F.rmsnorm(x, m.rmsFinal, m.eps)); };
    let logits = null;
    for (let pos = 0; ; pos++) {
      logits = F.forward(m, cache, ids[pos], pos, true, probe);
      if (pos < prompt.length - 1) continue;
      const t = F.argmax(logits);
      if (tok.stop.includes(t) || ids.length - prompt.length >= MAX_NEW) break;
      ids.push(t);
    }
    // the head over the same positions: its guess at position i is for the token at i + 2
    const hc = newHeadCache(m), marks = [];
    let r = 0, n = 0;
    for (let pos = 0; pos + 1 < ids.length; pos++) {
      const g = F.argmax(guess(m, H, hc, states[pos], ids[pos + 1], pos));
      if (pos + 2 >= prompt.length + 1 && pos + 2 < ids.length) { n++; if (g === ids[pos + 2]) r++; else marks.push(pos + 2 - prompt.length); }
    }
    right += r; all += n;
    console.log(`\n> ${qn}\n${tok.decode(ids.slice(prompt.length))}\n  guesses two ahead right: ${r} of ${n}; wrong at answer pieces ${JSON.stringify(marks)}`);
  }
  console.log(`\nall: ${right} of ${all} (${((100 * right) / all).toFixed(1)}%)`);
}
