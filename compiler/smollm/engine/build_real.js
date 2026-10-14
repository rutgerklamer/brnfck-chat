'use strict';

// Writes the engine program, its weight stream and the spec's reference answers (needs the model and about 1.5 GB of memory).

const fs = require('fs');
const F = require('../reference/float');
const Spec = require('./spec');
const { buildEngine, archOf } = require('./gen');
const { packToFile } = require('./pack');
const { realArch, OUT, FILES } = require('./real');

const PROMPTS = [['What is pi?', 24], ['What is the capital of France?', 24], ['Why is the sky blue?', 24], ['What is the opposite of hot?', 24],
  ['What do bees make?', 200]];       // a long answer: positions up to 235 of the 256 the tables are built for

fs.mkdirSync(OUT, { recursive: true });
let t = Date.now();
const { m, tok, net } = Spec.buildReal();
console.log(`spec built in ${((Date.now() - t) / 1000).toFixed(1)} s`);

t = Date.now();
const arch = archOf(m, net), { src, layout } = buildEngine(arch);
if (buildEngine(realArch()).src !== src) throw new Error('the program text depends on more than the architecture');
fs.writeFileSync(FILES.program, src);
console.log(`program: ${src.length.toLocaleString('en-US')} characters (the same text is generated without loading the weights), ${((Date.now() - t) / 1000).toFixed(1)} s`);

t = Date.now();
const bytes = packToFile(m, net, layout, FILES.weights);
console.log(`weight stream: ${bytes.toLocaleString('en-US')} bytes in ${((Date.now() - t) / 1000).toFixed(1)} s; tape ${layout.tapeSize.toLocaleString('en-US')} cells`);

t = Date.now();
const NP = net.prefix.n, kv = m.kvDim, ref = { prefix: NP, prompts: [] };
PROMPTS.forEach(([question, maxNew], qi) => {
  const all = tok.encode(tok.chatPrompt(question));
  if (all.slice(0, NP).join() !== net.prefix.ids.join()) throw new Error('prompt does not start with the fixed prefix');
  const ids = all.slice(NP), newIds = F.generateIds(m, all, maxNew, net.step);
  const e = { question, ids, maxNew, positions: ids.length + maxNew - 1, newIds, text: tok.decode(newIds) };
  if (qi === 0) {
    // run it again, keeping the trace of the first position and all keys and values
    const cache = net.step.newCache(), seq = [...all, ...newIds];
    const n = Math.min(seq.length, all.length + maxNew - 1);
    for (let pos = NP; pos < n; pos++) {
      const tr = pos === NP ? {} : null;
      const logits = net.step(m, cache, seq[pos], pos, pos >= all.length - 1, tr && ((name, l, v) => { (tr[name] ||= {})[l] = v; }));
      if (tr) {
        const pick = F.argmax(logits);
        e.trace = { emb: tr.emb[-1], xn1_0: tr.xn1[0], mixed_0: tr.mixed[0], xatt_0: tr.xatt[0], hid_0: tr.hid[0], xout: Object.keys(tr.xout).map((l) => tr.xout[l]), xnf: tr.xnf[-1], pick, best: logits[pick] + 2 ** (net.cfg.logitBits - 1) };
      }
    }
    e.kvPositions = n;
    e.k = cache.k.map((a) => Array.from(a.subarray(0, n * kv)));
    e.v = cache.v.map((a) => Array.from(a.subarray(0, n * kv)));
  }
  ref.prompts.push(e);
  console.log(`> ${question}  (${ids.length} prompt ids after the prefix)\n  ${JSON.stringify(e.text)}  [${newIds.length} ids]`);
});
fs.writeFileSync(FILES.ref, JSON.stringify(ref));
console.log(`reference written in ${((Date.now() - t) / 1000).toFixed(1)} s`);
