'use strict';

// Writes the chat program (gen.js), its data file and its meta file into compiler/smollm/program/out/.

const fs = require('fs');
const path = require('path');
const { realArch, FILES } = require('../engine/real');
const { packTokenizer } = require('../tokenizer/pack');
const { loadTokenizer } = require('../reference/float');
const { buildChat } = require('./gen');

const OUT = path.join(__dirname, 'out');
const OUTFILES = { program: path.join(OUT, 'chat.bf'), data: path.join(OUT, 'chat.dat'), meta: path.join(OUT, 'chat.meta.json') };

const TOK = { maxChars: 200 };

function main() {
  if (!fs.existsSync(FILES.weights)) throw new Error(`${FILES.weights} is missing: run  node compiler/smollm/engine/build_real.js  first`);
  fs.mkdirSync(OUT, { recursive: true });
  const arch = realArch();

  let t = Date.now();
  const { bytes: tokBytes, info } = packTokenizer(TOK);
  // What the program relies on (see gen.js):
  const fixed = info.prefix.length + 1;                 // the template before the question, its newline included
  if (fixed + TOK.maxChars + info.suffix.length > arch.maxTokens) throw new Error('a question of maxChars bytes would not fit the positions');
  if (fs.existsSync(FILES.ref)) {
    // the ids the engine was verified with are the ids after the fixed start
    const ref = JSON.parse(fs.readFileSync(FILES.ref, 'utf8')), tok = loadTokenizer();
    if (ref.prefix !== fixed) throw new Error(`the weight stream has ${ref.prefix} fixed positions, the template ${fixed}`);
    for (const e of ref.prompts) if (tok.encode(tok.chatPrompt(e.question)).slice(fixed).join() !== e.ids.join()) throw new Error('the fixed start of the prompt is not what the engine expects');
  }

  const { src, layout } = buildChat(arch, TOK);
  if (/[^+\-<>[\].,]/.test(src)) throw new Error('not pure brainfuck');
  fs.writeFileSync(OUTFILES.program, src);
  console.log(`${OUTFILES.program}: ${src.length.toLocaleString('en-US')} characters, ${((Date.now() - t) / 1000).toFixed(1)} s; tape ${layout.tapeSize.toLocaleString('en-US')} cells of 32 bits (${(layout.tapeSize * 4 / 2 ** 20).toFixed(0)} MiB), of which ${layout.tok.size.toLocaleString('en-US')} for the tokenizer`);

  t = Date.now();
  const from = fs.openSync(FILES.weights, 'r'), to = fs.openSync(OUTFILES.data, 'w'), piece = Buffer.alloc(1 << 22);
  let weightBytes = 0;
  for (let k; (k = fs.readSync(from, piece, 0, piece.length, null)) > 0;) { fs.writeSync(to, piece, 0, k); weightBytes += k; }
  fs.writeSync(to, tokBytes);
  fs.closeSync(from); fs.closeSync(to);
  console.log(`${OUTFILES.data}: ${(weightBytes + tokBytes.length).toLocaleString('en-US')} bytes = weights ${weightBytes.toLocaleString('en-US')} + tokenizer ${tokBytes.length.toLocaleString('en-US')}, ${((Date.now() - t) / 1000).toFixed(1)} s`);

  const meta = {
    program: 'chat.bf', programBytes: src.length, data: 'chat.dat', dataBytes: weightBytes + tokBytes.length, weightBytes, tokenizerBytes: tokBytes.length,
    cellBits: 32, tapeSize: layout.tapeSize, maxQuestionBytes: TOK.maxChars, maxPositions: arch.maxTokens, fixedPositions: fixed,
  };
  fs.writeFileSync(OUTFILES.meta, JSON.stringify(meta, null, 1));
  console.log(`${OUTFILES.meta}: ${JSON.stringify(meta)}`);
}

module.exports = { OUTFILES, TOK };
if (require.main === module) main();
