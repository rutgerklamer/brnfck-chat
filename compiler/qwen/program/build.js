'use strict';

// Writes the text-to-text program of a model and what it needs, into compiler/qwen/program/out/.

const fs = require('fs');
const { packTokenizer } = require('../tokenizer/pack');
const { loadTokenizer } = require('../tokenizer/ref');
const Spec = require('../engine/spec');
const { streamBytes } = require('../engine/pack');
const { OUT, TOK, files, realArch, generate, memoryBits, num, gib, now } = require('./common');

function main() {
  const model = process.argv[2] || '0.5b', FILES = files(model);
  fs.mkdirSync(OUT, { recursive: true });
  let t = now();
  const arch = realArch(model), { bytes: tokBytes, info } = packTokenizer(TOK, Spec.modelDir(model));
  const tok = loadTokenizer(Spec.modelDir(model));

  // What gen.js relies on:
  const fixed = info.prefix.length + 1;                // the template before the question, its newline included
  const engineFixed = tok.encode(tok.chatPrefix);
  if (fixed !== 24 || engineFixed.length !== fixed || engineFixed.slice(0, -1).join() !== info.prefix.join() || engineFixed[fixed - 1] !== 198) throw new Error('the fixed start of the prompt is not 23 ids + the newline');
  // ... no token longer than "\n" starts with a newline without containing a second one
  for (let id = 0; id < info.bpeTokens; id++) { const b = tok.tokenBytes(id); if (b[0] === 10 && b.length > 1 && !b.slice(1).includes(10)) throw new Error(`token ${id} could join the template's newline to the question`); }
  if (fixed + TOK.maxChars + info.suffix.length > arch.maxTokens) throw new Error('a question of maxChars bytes would not fit the positions');
  if (arch.stops.join() !== Spec.STOP.join() || arch.vocab < info.vocab) throw new Error('end tokens or vocabulary size are not what the tokenizer has');

  const { src, loadSrc, restSrc, pointer, layout } = generate(model);
  if (/[^+\-<>[\].,]/.test(src)) throw new Error('not pure brainfuck');
  fs.writeFileSync(FILES.program, src);
  const bits = memoryBits(layout.tapeSize);
  console.log(`${FILES.program}: ${num(src.length)} characters (load part ${num(loadSrc.length)}, rest ${num(restSrc.length)})  [${(now() - t).toFixed(1)} s]`);
  console.log(`  tape ${num(layout.tapeSize)} cells of 32 bits = ${gib(layout.tapeSize * 4)}, of which ${num(layout.tok.size)} cells for the tokenizer -> ${bits}-bit WebAssembly memory`);

  if (!fs.existsSync(FILES.tokenizer) || !fs.readFileSync(FILES.tokenizer).equals(Buffer.from(tokBytes))) fs.writeFileSync(FILES.tokenizer, tokBytes);
  const planBytes = streamBytes(layout, fixed, arch.kvHeads * arch.headSize);
  const weightBytes = fs.existsSync(FILES.weights) ? fs.statSync(FILES.weights).size : null;
  if (weightBytes !== null && weightBytes !== planBytes) throw new Error(`${FILES.weights} has ${weightBytes} bytes, the program reads ${planBytes}`);
  console.log(`  data: weight stream ${num(planBytes)} bytes (${weightBytes === null ? 'NOT THERE YET: node compiler/qwen/program/make_ref.js ' + model : FILES.weights}), tokenizer stream ${num(tokBytes.length)} bytes (${FILES.tokenizer})`);

  const meta = {
    model, program: `chat-${model}.bf`, programBytes: src.length, loadBytes: loadSrc.length, pointerAfterLoad: pointer,
    cellBits: 32, tapeSize: layout.tapeSize, engineCells: layout.engineCells, memoryBits: bits,
    weightBytes: planBytes, tokenizerBytes: tokBytes.length, maxQuestionBytes: TOK.maxChars, maxPositions: arch.maxTokens, fixedPositions: fixed,
  };
  fs.writeFileSync(FILES.meta, JSON.stringify(meta, null, 1));
  console.log(`  ${FILES.meta} written`);
}

if (require.main === module) main();
