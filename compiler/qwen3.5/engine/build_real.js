'use strict';

// The engine of Qwen3.5-0.8B: program text, weight stream and the spec's answers to the test questions, in out/.
//   node compiler/qwen3.5/engine/build_real.js [program|stream|ref]... [--model=qwen3.5-0.8b] [--none|--att]   (all three when none is named)

const fs = require('fs');
const os = require('os');
const path = require('path');
const F = require('../reference/float');
const Spec = require('./spec');
const { Engine, archOf, writeChunks } = require('./gen');
const { packToFile, streamBytes } = require('./pack');
const { QUESTIONS } = require('./questions');

const NAME = path.basename(F.modelDir(process.argv)), MAX_NEW = 30;
// tests at full size, written with -none or -att in their names: --none the engine without its token mixers
// (spec.js noMixer), --att only the attention mixers (the DeltaNet layers pass the residual on)
const NONE = process.argv.includes('--none'), ATT = process.argv.includes('--att');
const TAG = NAME + (NONE ? '-none' : ATT ? '-att' : ''), OPTIONS = { ...Spec.optionsFor(NAME), ...(NONE ? { noMixer: true } : ATT ? { skip: ['lin'] } : {}) };
const OUT = path.join(__dirname, 'out');
const FILES = {
  program: path.join(OUT, `${TAG}.bf`), meta: path.join(OUT, `${TAG}.meta.json`),
  weights: path.join(OUT, `weights-${TAG}.bin`), ref: path.join(OUT, `ref-${TAG}.json`),
};
const num = (n) => Math.round(n).toLocaleString('en-US'), gib = (n) => (n / 2 ** 30).toFixed(2) + ' GiB';
const now = () => Number(process.hrtime.bigint()) / 1e9;

// The architecture from config.json alone (openWeights reads only the header of the weights).
function realArch() {
  const src = F.openWeights(Spec.modelDir(NAME)), shape = src.shape;
  src.close();
  return archOf(shape, OPTIONS);
}
function generate() { const arch = realArch(), e = new Engine(arch); return { arch, kinds: e.kinds, ...e.build() }; }

function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--')), want = (s) => !args.length || args.includes(s);
  fs.mkdirSync(OUT, { recursive: true });
  let t = now();
  const G = generate(), { arch, layout } = G;
  console.log(`${NAME}: dim ${arch.dim}, ${arch.layers} layers (${arch.groups} groups of ${arch.unit.join(' ')}), vocabulary ${num(arch.vocab)} in ${layout.chunks} chunks of ${num(arch.chunk)}`);
  console.log(`program: ${num(G.length)} characters, from config.json and the settings alone in ${(now() - t).toFixed(1)} s`);
  console.log(`tape: ${num(layout.tapeSize)} cells of 32 bits = ${gib(layout.tapeSize * 4)}; weight stream ${num(streamBytes(layout))} bytes`);
  if (want('program')) {
    writeChunks(FILES.program, G.chunks);
    fs.writeFileSync(FILES.meta, JSON.stringify({ model: NAME, tapeSize: layout.tapeSize, cellBits: 32, programBytes: G.length, weightBytes: streamBytes(layout), memoryBits: layout.tapeSize * 4 + 2 ** 21 > 2 ** 32 - 65536 ? 64 : 32 }, null, 1));
    console.log(`written: ${FILES.program}`);
  }
  if (!want('stream') && !want('ref')) return;
  t = now();
  console.log(`free memory ${gib(os.freemem())}`);
  const { tok, net } = Spec.buildReal(NAME, OPTIONS);
  console.log(`spec built in ${(now() - t).toFixed(1)} s, ${gib(process.memoryUsage().rss)} in use`);
  if (want('stream')) {
    t = now();
    const tmp = FILES.weights + '.tmp', bytes = packToFile(arch, net, layout, G.kinds, tmp);
    if (bytes !== streamBytes(layout)) throw new Error('the stream has another length than the plan says');
    fs.renameSync(tmp, FILES.weights);
    console.log(`weight stream: ${num(bytes)} bytes written in ${(now() - t).toFixed(1)} s`);
  }
  if (want('ref')) {
    const ref = { model: NAME, maxNew: MAX_NEW, programChars: G.length, questions: [] };
    for (const question of QUESTIONS) {
      t = now();
      const ids = tok.encode(tok.chatPrompt(question)), newIds = Spec.generateIds(net, ids, MAX_NEW);
      ref.questions.push({ question, ids, newIds, ended: newIds.length < MAX_NEW, text: tok.decode(newIds) });
      console.log(`> ${question}  (${ids.length} prompt ids)\n  ${JSON.stringify(tok.decode(newIds))}  [${newIds.length} ids; ${(now() - t).toFixed(0)} s]`);
      fs.writeFileSync(FILES.ref, JSON.stringify(ref));
    }
    console.log(`${FILES.ref} written; ${JSON.stringify(net.stats)}`);
  }
}

module.exports = { NAME, FILES, OUT, realArch, generate };
if (require.main === module) main();
