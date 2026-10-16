'use strict';

// The shapes of the models of the four programs, for the page site/compare/: per layer the weights of each part,
// counted from the headers of the weight files (only the text model: Qwen3.5-0.8B also has a vision part and a
// layer that guesses ahead, which the program does not run), and from config.json what each model keeps of the
// past and how many multiplications a word piece costs.
//   node compiler/qwen3.5/compare/shapes.js         writes site/compare/data/shapes.json

const fs = require('fs');
const path = require('path');

const DL = path.join(__dirname, '..', '..', 'downloads'), OUT = path.join(__dirname, '..', '..', '..', 'site', 'compare', 'data', 'shapes.json');
const MODELS = [
  ['smollm2-135m', 'SmolLM2-135M', 'brnfck-smollm2-135m'],
  ['qwen2.5-0.5b', 'Qwen2.5-0.5B', 'brnfck-qwen2.5-0.5b'],
  ['qwen2.5-1.5b', 'Qwen2.5-1.5B', 'brnfck-qwen2.5-1.5b'],
  ['qwen3.5-0.8b', 'Qwen3.5-0.8B', 'brnfck-qwen3.5-0.8b'],
];

function header(file) {
  const fd = fs.openSync(file, 'r'), head = Buffer.alloc(8);
  fs.readSync(fd, head, 0, 8, 0);
  const n = Number(head.readBigUInt64LE()), json = Buffer.alloc(n);
  fs.readSync(fd, json, 0, n, 8);
  fs.closeSync(fd);
  const h = JSON.parse(json.toString('utf8'));
  delete h.__metadata__;
  return h;
}
const count = (shape) => shape.reduce((a, b) => a * b, 1);

// the part of a layer a tensor belongs to, by its name
function part(name) {
  if (/self_attn\.q_proj\.weight$/.test(name)) return 'q';
  if (/self_attn\.k_proj\.weight$/.test(name)) return 'k';
  if (/self_attn\.v_proj\.weight$/.test(name)) return 'v';
  if (/self_attn\.o_proj\.weight$/.test(name)) return 'o';
  if (/self_attn\.[qkv]_proj\.bias$/.test(name)) return 'bias';
  if (/self_attn\.[qk]_norm\.weight$/.test(name)) return 'qknorm';
  if (/linear_attn\.in_proj_qkv\.weight$/.test(name)) return 'qkv';
  if (/linear_attn\.in_proj_z\.weight$/.test(name)) return 'z';
  if (/linear_attn\.in_proj_[ab]\.weight$/.test(name)) return 'ab';
  if (/linear_attn\.out_proj\.weight$/.test(name)) return 'o';
  if (/linear_attn\.conv1d\.weight$/.test(name)) return 'conv';
  if (/linear_attn\.(A_log|dt_bias|norm\.weight)$/.test(name)) return 'small';
  if (/mlp\.(gate|up|down)_proj\.weight$/.test(name)) return 'ffn';
  if (/(input|post_attention)_layernorm\.weight$/.test(name)) return 'norm';
  throw new Error('unknown tensor ' + name);
}

const models = MODELS.map(([dir, name, program]) => {
  const top = JSON.parse(fs.readFileSync(path.join(DL, dir, 'config.json'), 'utf8')), c = top.text_config || top;
  const h = header(path.join(DL, dir, 'model.safetensors'));
  const P = Object.keys(h).some((k) => k.startsWith('model.language_model.')) ? 'model.language_model.' : 'model.';
  const types = (c.layer_types || Array(c.num_hidden_layers).fill('full_attention')).map((t) => (t === 'linear_attention' ? 'lin' : 'att'));
  const layers = types.map((kind) => ({ kind, parts: {} }));
  let emb = 0, out = 0, final = 0;
  for (const [k, t] of Object.entries(h)) {
    if (!k.startsWith(P) && k !== 'lm_head.weight') continue;          // the vision part, the layer that guesses ahead
    const n = count(t.shape), rest = k.slice(P.length);
    if (k === 'lm_head.weight') { out += n; continue; }
    if (rest === 'embed_tokens.weight') { emb += n; continue; }
    if (rest === 'norm.weight') { final += n; continue; }
    const mt = /^layers\.(\d+)\.(.*)$/.exec(rest);
    if (!mt) throw new Error('unexpected tensor ' + k);
    const p = part(mt[2]), L = layers[Number(mt[1])];
    L.parts[p] = (L.parts[p] || 0) + n;
  }
  const tied = !out;
  for (const L of layers) {
    L.ffn = L.parts.ffn; L.norm = L.parts.norm;
    L.mixer = Object.entries(L.parts).reduce((s, [p, n]) => s + (p === 'ffn' || p === 'norm' ? 0 : n), 0);
  }
  // Qwen3.5: q_proj holds per head the query rows and then as many rows of the output gate
  if (c.attn_output_gate) for (const L of layers) if (L.kind === 'att') { L.parts.gate = L.parts.q / 2; L.parts.q /= 2; }

  // what a word piece leaves behind, and what is kept whatever the length
  const kv = c.num_key_value_heads * (c.head_dim || c.hidden_size / c.num_attention_heads), hd = c.head_dim || c.hidden_size / c.num_attention_heads;
  const nAtt = types.filter((t) => t === 'att').length, nLin = types.length - nAtt;
  const convDim = nLin ? 2 * c.linear_num_key_heads * c.linear_key_head_dim + c.linear_num_value_heads * c.linear_value_head_dim : 0;
  const table = nLin ? c.linear_num_value_heads * c.linear_key_head_dim * c.linear_value_head_dim : 0;
  const keep = { perPiece: nAtt * 2 * kv, tables: nLin * table, window: nLin ? nLin * (c.linear_conv_kernel_dim - 1) * convDim : 0 };
  // multiplications per word piece: every weight of the matrices once (the output layer too; the embedding is
  // only looked up), then per earlier word piece two per number of each query head (its score, its share of the
  // values), and per DeltaNet head four per number of its table (fade, ask, write, read)
  let matrices = 0;
  for (const L of layers) for (const [p, n] of Object.entries(L.parts)) if (!['norm', 'qknorm', 'small', 'bias', 'conv'].includes(p)) matrices += n;
  const work = { weights: matrices + c.vocab_size * c.hidden_size, perPiece: nAtt * c.num_attention_heads * hd * 2, tables: nLin * table * 4 };
  const meta = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'site', 'programs', program + '.meta.json'), 'utf8'));
  const total = emb + out + final + layers.reduce((s, L) => s + L.mixer + L.ffn + L.norm, 0);
  console.log(`${name}: ${total.toLocaleString('en-US')} weights (embedding ${emb.toLocaleString('en-US')}${tied ? ', the output layer the same table' : ''});` +
    ` keeps ${keep.perPiece.toLocaleString('en-US')} numbers per word piece + ${(keep.tables + keep.window).toLocaleString('en-US')};` +
    ` ${work.weights.toLocaleString('en-US')} + ${work.tables.toLocaleString('en-US')} multiplications + ${work.perPiece.toLocaleString('en-US')} per earlier word piece`);
  return {
    name, program, dim: c.hidden_size, vocab: c.vocab_size, hidden: c.intermediate_size, heads: c.num_attention_heads, kvHeads: c.num_key_value_heads, headSize: hd,
    tied, emb, out, final, total, maxPos: c.max_position_embeddings, chars: meta.programBytes, tape: meta.tapeSize,
    layers: layers.map((L) => ({ kind: L.kind, mixer: L.mixer, ffn: L.ffn, norm: L.norm, parts: L.parts })), keep, work,
  };
});
fs.writeFileSync(OUT, JSON.stringify({ models }));
console.log(OUT, fs.statSync(OUT).size, 'bytes');
