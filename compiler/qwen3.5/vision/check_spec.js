'use strict';

// spec.js against reference/vision.js on pictures/: the vision vectors, then ../engine/spec.js teacher forced and greedy.
//   node compiler/qwen3.5/vision/check_spec.js [cat windmills ...] [--options '{"XB": [...]}']

const fs = require('fs');
const path = require('path');
const F = require('../reference/float');
const VR = require('../reference/vision');
const VS = require('./spec');
const Spec = require('../engine/spec');
const { promptLayout } = require('./layout');

const args = process.argv.slice(2), oi = args.indexOf('--options'), options = oi >= 0 ? JSON.parse(args.splice(oi, 2)[1]) : {};
const names = args.length ? args : ['cat', 'windmills', 'bicycle', 'apples'];
const QUESTION = 'Describe this picture in one sentence.', MAX_NEW = 40;
const DIR = F.modelDir(), V = VR.loadVision(DIR), m = F.loadModel(DIR), tok = F.loadTokenizer(DIR);
const pics = names.map((n) => ({ name: n, sq: VR.squares(VR.readPng(path.join(__dirname, 'pictures', n + '.png')), V.P, V.merge) }));
const sq0 = pics[0].sq, net = VS.build(V, sq0, options), EB = net.settings.cfg.EB;
const lay = promptLayout(tok, V, sq0);
const { net: lm } = Spec.buildReal('qwen3.5-0.8b', { rope: lay.rope });
let same = 0, all = 0, kl = 0;
for (const { name, sq } of pics) {
  let t = Date.now();
  const ref = VR.encode(V, sq).emb, got = net.encode(sq.bytes), n = got.length / V.out;
  const err = [];
  for (let g = 0; g < n; g++) {
    let d = 0, s = 0;
    for (let i = 0; i < V.out; i++) { const a = got[g * V.out + i] / 2 ** EB, b = ref[g * V.out + i]; d += (a - b) ** 2; s += b * b; }
    err.push(Math.sqrt(d / s));
  }
  console.log(`${name}: vision vectors in whole numbers, relative difference mean ${(100 * err.reduce((a, b) => a + b, 0) / n).toFixed(2)}%, largest ${(100 * Math.max(...err)).toFixed(2)}% (${((Date.now() - t) / 1000).toFixed(0)} s)`);
  // the float model's answer about the float vectors, then the whole-number model on it
  t = Date.now();
  const A = VR.answer(m, V, tok, sq, ref, QUESTION, MAX_NEW), P = A.prompt, ids = P.ids.concat(A.ids);
  const cache = lm.step.newCache(), input = (i) => (P.ids[i] === V.imageToken ? got.subarray((i - P.imageAt) * V.out, (i - P.imageAt + 1) * V.out) : null);
  let s = 0, fl = F.newCache(m), r = P.nextRope;
  for (let i = 0; i < ids.length - 1; i++) {
    const logits = lm.step(cache, ids[i], i, i >= P.ids.length - 1, null, input(i));
    const fLogits = F.forward(m, fl, ids[i], i, i >= P.ids.length - 1, null, null, { x: P.ids[i] === V.imageToken ? ref.subarray((i - P.imageAt) * V.out, (i - P.imageAt + 1) * V.out) : null, rope: i < P.ids.length ? P.rope[i] : [r + i - P.ids.length, r + i - P.ids.length, r + i - P.ids.length] });
    if (i < P.ids.length - 1) continue;
    all++; if (Spec.argmax(logits) === ids[i + 1]) { s++; same++; }
    // KL(float || whole numbers) of the next token
    const lb = 2 ** -lm.cfg.LB, p = softmax(fLogits, 1), qd = softmax(logits, lb);
    for (let j = 0; j < p.length; j++) if (p[j] > 0) kl += p[j] * Math.log(p[j] / Math.max(qd[j], 1e-300));
  }
  // greedy in whole numbers
  const step = (c, id, pos, want) => lm.step(c, id, pos, want, null, pos < P.ids.length ? input(pos) : null);
  step.newCache = lm.step.newCache;
  const g = Spec.generateIds({ step }, P.ids, MAX_NEW);
  console.log(`  float:  ${JSON.stringify(A.text)}\n  whole:  ${JSON.stringify(tok.decode(g))}\n  teacher forced: same next token ${s} of ${A.ids.length} (${((Date.now() - t) / 1000).toFixed(0)} s)`);
}
console.log(`all: same next token ${same} of ${all} (${((100 * same) / all).toFixed(1)}%), mean KL ${(kl / all).toFixed(4)} nats; attention scores beyond 2^scoreBits: ${net.stats.scoreOverflow}`);

function softmax(a, scale) {
  let mx = -Infinity;
  for (const v of a) if (v > mx) mx = v;
  const out = new Float64Array(a.length);
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (out[i] = Math.exp((a[i] - mx) * scale));
  for (let i = 0; i < a.length; i++) out[i] /= sum;
  return out;
}
