'use strict';

// The whole-number model (spec.js) against the float reference (reference/float.js), end to end.
//   node compiler/qwen3.5/engine/check_spec.js [--seq] [--ask] ['{"weightBits":10}']

const fs = require('fs');
const path = require('path');
const F = require('../reference/float');
const Spec = require('./spec');
const { QUESTIONS } = require('./questions');

const args = process.argv.slice(2), options = JSON.parse(args.find((a) => a.startsWith('{')) || '{}');
const want = (s) => !args.some((a) => a.startsWith('--')) || args.includes(s);
const DIR = Spec.modelDir();
const now = () => Number(process.hrtime.bigint()) / 1e9;

let t = now();
const m = F.loadModel(DIR), tok = F.loadTokenizer(DIR);
const { net } = Spec.buildReal(undefined, options);
console.log(`float model and whole-number model loaded in ${(now() - t).toFixed(0)} s; options ${JSON.stringify(options)}`);
const scale = 2 ** net.cfg.LB;

// teacher forced over the 256 tokens of data/seq256.json: is the next token the same, and the KL divergence
if (want('--seq')) {
  const SEQ = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'seq256.json'), 'utf8'));
  const cf = F.newCache(m), ci = net.step.newCache(), N = SEQ.ids.length;
  let same = 0, n = 0, kl = 0;
  t = now();
  for (let pos = 0; pos < N - 1; pos++) {
    const wantL = pos >= SEQ.prompt - 1;
    const lf = F.forward(m, cf, SEQ.ids[pos], pos, wantL), li = net.step(ci, SEQ.ids[pos], pos, wantL);
    if (!wantL) continue;
    n++;
    const af = F.argmax(lf), ai = Spec.argmax(li);
    if (af === ai) same++;
    const mf = lf[af], mi = li[ai] / scale;
    let zf = 0, zi = 0;
    for (let i = 0; i < lf.length; i++) { zf += Math.exp(lf[i] - mf); zi += Math.exp(li[i] / scale - mi); }
    let k = 0;
    for (let i = 0; i < lf.length; i++) { const p = Math.exp(lf[i] - mf) / zf; if (p > 1e-12) k += p * (lf[i] - mf - Math.log(zf) - (li[i] / scale - mi - Math.log(zi))); }
    kl += k;
    if (n % 16 === 0) process.stdout.write(`\r[${n} positions, ${same} the same, ${(now() - t).toFixed(0)} s]`);
  }
  console.log(`\nteacher forced over ${n} answer positions: same next token ${same}/${n} (${(100 * same / n).toFixed(1)}%), mean KL ${(kl / n).toFixed(4)} nats`);
  console.log(`stats: ${JSON.stringify(net.stats)}`);
}

// greedy answers to the test questions, from both
if (want('--ask')) {
  for (const qn of QUESTIONS) {
    const prompt = tok.encode(tok.chatPrompt(qn));
    t = now();
    const a = F.generateIds(m, prompt, 30, tok.stop), tf = now() - t;
    t = now();
    const b = Spec.generateIds(net, prompt, 30), ti = now() - t;
    let k = 0;
    while (k < a.length && a[k] === b[k]) k++;
    console.log(`\n> ${qn}\n  float:         ${JSON.stringify(tok.decode(a))}  [${tf.toFixed(0)} s]\n  whole numbers: ${JSON.stringify(tok.decode(b))}  [${ti.toFixed(0)} s; first ${k} of ${a.length} ids the same]`);
  }
  console.log(`stats: ${JSON.stringify(net.stats)}`);
}
