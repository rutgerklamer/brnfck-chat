'use strict';

// The real model's ARCHITECTURE without its weights: enough to generate the program text.

const fs = require('fs');
const path = require('path');
const { DIR } = require('../reference/float');
const Spec = require('./spec');

const OUT = path.join(__dirname, 'out');           // program, weight stream and reference data are written here
const FILES = { program: path.join(OUT, 'chat.bf'), weights: path.join(OUT, 'weights.bin'), ref: path.join(OUT, 'ref.json') };

function realArch() {
  const c = JSON.parse(fs.readFileSync(path.join(DIR, 'config.json'), 'utf8'));
  const dim = c.hidden_size, heads = c.num_attention_heads, kvHeads = c.num_key_value_heads, headSize = dim / heads;
  const freq = Float64Array.from({ length: headSize / 2 }, (_, f) => Math.pow(c.rope_theta, -(2 * f) / headSize));
  const cfg = { ...Spec.DEFAULTS, tops: { ...Spec.DEFAULTS.tops } };
  return {
    dim, layers: c.num_hidden_layers, heads, kvHeads, headSize, hidden: c.intermediate_size, vocab: c.vocab_size,
    chunk: 2 * c.intermediate_size, maxTokens: cfg.maxTokens, cfg, tables: Spec.makeTables(cfg, dim, headSize, freq), stops: [0, 2],
  };
}

module.exports = { realArch, OUT, FILES };
