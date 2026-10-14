'use strict';

// Builds the engine of a model into compiler/qwen/engine/out/: program text, weight stream and reference answers.

const fs = require('fs');
const os = require('os');
const Spec = require('./spec');
const { buildEngine, archOf } = require('./gen');
const { packToFile, streamBytes } = require('./pack');
const { realArch, OUT, files } = require('./real');

const name = process.argv[2] || '0.5b';
const FILES = files(name), num = (n) => n.toLocaleString('en-US'), gb = (n) => (n / 2 ** 30).toFixed(2) + ' GiB';
// question, cap on new tokens
const PROMPTS = [['What is 12 + 30?', 24], ['Wat is de hoofdstad van Nederland?', 24], ['What is the capital of France?', 24],
  ['Why is the sky blue?', 100], ['What is pi?', 24], ['What do bees make?', 24]];

fs.mkdirSync(OUT, { recursive: true });
let t = Date.now();
const arch0 = realArch(name), { src, layout } = buildEngine(arch0);
console.log(`model ${name}: dim ${arch0.dim}, ${arch0.layers} layers, ${arch0.heads} heads on ${arch0.kvHeads} key/value heads, head size ${arch0.headSize}, hidden ${arch0.hidden}, vocabulary ${num(arch0.vocab)} in ${layout.chunks} chunks of ${num(arch0.chunk)}`);
console.log(`program: ${num(src.length)} characters, generated from config.json and the settings alone in ${((Date.now() - t) / 1000).toFixed(1)} s`);
const kv = arch0.kvHeads * arch0.headSize;
console.log(`tape: ${num(layout.tapeSize)} cells of 32 bits = ${gb(layout.tapeSize * 4)} (${num(layout.weightCells)} of them weights)` + (layout.tapeSize * 4 + 2 ** 21 > 2 ** 32 - 65536 ? '  -> needs the 64-bit WebAssembly backend' : '  -> fits the 32-bit WebAssembly backend'));
console.log(`weight stream: ${num(streamBytes(layout, 24, kv))} bytes with a prefix of 24 positions (${layout.wBytes} byte(s) per weight, ${layout.eBytes} per table value)`);

fs.writeFileSync(FILES.program, src);
fs.writeFileSync(FILES.meta, JSON.stringify({ tapeSize: layout.tapeSize, cellBits: 32, settings: {} }));
console.log(`written: ${FILES.program}`);

console.log(`free memory ${gb(os.freemem())}`);
t = Date.now();
const { tok, net, shape } = Spec.buildReal(name);
console.log(`spec built in ${((Date.now() - t) / 1000).toFixed(1)} s, ${gb(process.memoryUsage().rss)} in use`);
if (buildEngine(archOf(shape, Spec.optionsFor(name))).src !== src) throw new Error('the program text depends on more than the architecture');
console.log('the same program text is generated from the loaded model');

t = Date.now();
const bytes = packToFile(shape, net, layout, FILES.weights);
if (bytes !== streamBytes(layout, net.prefix.n, kv)) throw new Error('the stream has another length than the plan says');
console.log(`weight stream: ${num(bytes)} bytes written in ${((Date.now() - t) / 1000).toFixed(1)} s`);

t = Date.now();
const NP = net.prefix.n, ref = { model: name, settings: {}, prefix: NP, prefixIds: net.prefix.ids, prompts: [] };
PROMPTS.forEach(([question, maxNew], qi) => {
  const all = tok.encode(tok.chatPrompt(question));
  if (all.slice(0, NP).join() !== net.prefix.ids.join()) throw new Error('prompt does not start with the fixed prefix');
  const ids = all.slice(NP), newIds = Spec.generateIds(net, all, maxNew);
  const e = { question, ids, maxNew, positions: ids.length + maxNew - 1, newIds, text: tok.decode(newIds) };
  if (qi === 0) {
    // run it again, keeping the trace of the first position and all keys and values
    const cache = net.step.newCache(), seq = [...all, ...newIds];
    const n = Math.min(seq.length, all.length + maxNew - 1);
    for (let pos = NP; pos < n; pos++) {
      const tr = pos === NP ? {} : null;
      const logits = net.step(cache, seq[pos], pos, pos >= all.length - 1 || !!tr, tr && ((nm, l, v) => { (tr[nm] ||= {})[l] = v; }));
      if (tr) {
        const pick = Spec.argmax(logits), L = shape.layers;
        e.trace = { emb: tr.emb[-1], xn1_0: tr.xn1[0], qraw_0: tr.qraw[0], kraw_0: tr.kraw[0], v_0: tr.v[0], q_0: tr.q[0], k_0: tr.k[0], tot_0: tr.tot[0], mixed_0: tr.mixed[0], xatt_0: tr.xatt[0], xn2_0: tr.xn2[0], hid_0: tr.hid[0],
          xout: Object.keys(tr.xout).map((l) => tr.xout[l]), mixed_last: tr.mixed[L - 1], hid_last: tr.hid[L - 1], xnf: tr.xnf[-1], pick, best: logits[pick] + 2 ** (net.cfg.logitBits - 1) };
      }
    }
    e.kvPositions = n;
    e.k = cache.k.map((a) => Array.from(a.subarray(0, n * kv)));
    e.v = cache.v.map((a) => Array.from(a.subarray(0, n * kv)));
  }
  ref.prompts.push(e);
  console.log(`> ${question}  (${ids.length} prompt ids after the prefix)\n  ${JSON.stringify(e.text)}  [${newIds.length} ids]`);
});
ref.scoreOverflow = net.stats.scoreOverflow || 0;
fs.writeFileSync(FILES.ref, JSON.stringify(ref));
console.log(`reference written in ${((Date.now() - t) / 1000).toFixed(1)} s; attention scores beyond 2^scoreBits in the spec: ${ref.scoreOverflow}`);
