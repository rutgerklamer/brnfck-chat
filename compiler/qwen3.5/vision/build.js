'use strict';

// The program of Qwen3.5-0.8B with vision (program.js) into out/: program, weight and tokenizer streams, meta, spec answers.
//   node compiler/qwen3.5/vision/build.js [program|stream|ref]...     (all three when none is named)

const fs = require('fs');
const os = require('os');
const path = require('path');
const F = require('../reference/float');
const VR = require('../reference/vision');
const Spec = require('../engine/spec');
const VS = require('./spec');
const { promptLayout } = require('./layout');
const { visionArch, VisionChatProgram, visionKind } = require('./program');
const { packToFile, streamBytes } = require('../engine/pack');
const { writeChunks } = require('../engine/gen');
const { packTokenizer } = require('../tokenizer/pack');
const { questionBytes } = require('../program/build');

const NAME = 'qwen3.5-0.8b', SIDE = 256, MAX_NEW = 30;
const OUT = path.join(__dirname, 'out'), PICTURES = path.join(__dirname, 'pictures');
const FILES = {
  program: path.join(OUT, `chat-vision-${NAME}.bf`), meta: path.join(OUT, `chat-vision-${NAME}.meta.json`),
  weights: path.join(OUT, `weights-text-${NAME}.bin`), tokenizer: path.join(OUT, 'tokenizer-vision.bin'), visionWeights: path.join(OUT, `weights-vision-${NAME}.bin`),
  ref: path.join(OUT, `ref-vision-${NAME}.json`),
};
// what the load part reads, in this order (program.js VisionChatProgram)
const DATA = [FILES.weights, FILES.tokenizer, FILES.visionWeights];
// the questions of the reference answers: [picture, question]
const QUESTIONS = [
  ['cat', 'Describe this picture in one sentence.'], ['windmills', 'Describe this picture in one sentence.'],
  ['bicycle', 'Describe this picture in one sentence.'], ['apples', 'Describe this picture in one sentence.'],
  ['cat', 'What colour are the eyes?'], ['windmills', 'Waar is deze foto gemaakt?'],
];
const num = (n) => Math.round(n).toLocaleString('en-US'), gib = (n) => (n / 2 ** 30).toFixed(2) + ' GiB';
const now = () => Number(process.hrtime.bigint()) / 1e9;

// The layout of the squares of every picture the program reads (their bytes do not matter here).
const layoutSquares = (V) => VR.squares({ W: SIDE, H: SIDE, rgb: new Uint8Array(SIDE * SIDE * 3) }, V.P, V.merge);

// The prompt around the question: up to <|vision_end|> it is the tokenizer's prefix (no newline before the question).
function tokOptions(tok, V, sq) {
  const lay = promptLayout(tok, V, sq), pads = '<|image_pad|>'.repeat(lay.images);
  const head = `<|vision_start|>${pads}<|vision_end|>`, prefix = tok.encode(`<|im_start|>user\n${head}`);
  return { maxChars: 200, maxPre: prefix.length, lead: null, prefix, prompt: (q) => tok.chatPrompt(head + q), lay };
}

// The program laid out on the tape, from config.json and the settings (no weights, no program text yet).
function plan() {
  const dir = Spec.modelDir(NAME), src = F.openWeights(dir), shape = src.shape;
  src.close();
  const V = VR.visionShape(dir), sq = layoutSquares(V), tok = F.loadTokenizer(dir), TOK = tokOptions(tok, V, sq);
  const arch = visionArch(shape, { ...Spec.optionsFor(NAME), rope: TOK.lay.rope }, {}, { V, sq, options: {} });
  const e = new VisionChatProgram(arch, { maxChars: TOK.maxChars, maxPre: TOK.maxPre, lead: TOK.lead });
  return { arch, e, V, sq, TOK };
}

function generate() {
  const { arch, e, V, sq, TOK } = plan();
  return { arch, kinds: e.kinds, vp: e.vp, V, sq, TOK, ...e.build() };
}

// The bytes the program reads: the squares of the picture (reference/vision.js squares), then the question and its newline.
function inputBytes(picture, question) {
  const pic = typeof picture === 'string' ? VR.readPng(picture) : picture;
  if (pic.W !== SIDE || pic.H !== SIDE) throw new Error(`the picture must be ${SIDE} x ${SIDE} pixels`);
  return Buffer.concat([Buffer.from(VR.squares(pic, 16, 2).bytes), questionBytes(question)]);
}

// The spec's answer (what the program prints, bit for bit): the vision vectors, read by the text model at the picture.
function specAnswer(lm, vnet, ids, imageAt, imageToken, out, bytes, maxNew) {
  const emb = vnet.encode(bytes), cache = lm.step.newCache(), got = [];
  const input = (pos) => (pos < ids.length && ids[pos] === imageToken ? emb.subarray((pos - imageAt) * out, (pos - imageAt + 1) * out) : null);
  let logits = null;
  for (let pos = 0; pos < ids.length; pos++) logits = lm.step(cache, ids[pos], pos, pos === ids.length - 1, null, input(pos));
  for (let n = 0; n < maxNew; n++) {
    const t = Spec.argmax(logits);
    if (Spec.STOP.includes(t)) return { ids: got, ended: true };
    got.push(t);
    if (n + 1 < maxNew) logits = lm.step(cache, t, ids.length + n, true);
  }
  return { ids: got, ended: false };
}

function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--')), want = (s) => !args.length || args.includes(s);
  fs.mkdirSync(OUT, { recursive: true });
  let t = now();
  const G = generate(), { arch, layout, vp, V, sq, TOK } = G;
  console.log(`${NAME} with its vision part: text dim ${arch.dim}, ${arch.layers} layers; vision ${V.depth} layers of ${V.dim}, ${sq.n} squares, ${TOK.lay.images} word pieces of the picture`);
  console.log(`program: ${num(G.length)} characters (load part ${num(G.loadSrc.length)}), from config.json and the settings in ${(now() - t).toFixed(1)} s`);
  const parts = [{ ...layout, plan: layout.plan.slice(0, layout.planSplit) }, { ...layout, plan: layout.plan.slice(layout.planSplit) }];
  console.log(`tape: ${num(layout.tapeSize)} cells of 32 bits = ${gib(layout.tapeSize * 4)}; the vision part ${num(vp.end - vp.SQ)} cells; weight streams ${num(streamBytes(parts[0]))} + ${num(streamBytes(parts[1]))} bytes`);
  if (want('program')) {
    writeChunks(FILES.program, G.chunks);
    const bits = layout.tapeSize * 4 + 2 ** 21 > 2 ** 32 - 65536 ? 64 : 32;
    fs.writeFileSync(FILES.meta, JSON.stringify({
      model: NAME, vision: true, program: path.basename(FILES.program), programBytes: G.length, loadBytes: G.loadSrc.length, pointerAfterLoad: G.pointer,
      cellBits: 32, tapeSize: layout.tapeSize, engineCells: layout.engineCells, memoryBits: bits, weightBytes: streamBytes(parts[0]), visionBytes: streamBytes(parts[1]),
      pictureSide: SIDE, pictureBytes: sq.n * 3 * V.P * V.P, maxQuestionBytes: TOK.maxChars, maxPositions: arch.maxTokens, imageAt: TOK.lay.start, images: TOK.lay.images,
    }, null, 1));
    console.log(`written: ${FILES.program}`);
  }
  if (want('program') || want('stream')) {
    const { bytes } = packTokenizer({ maxChars: TOK.maxChars, maxPre: TOK.maxPre, lead: TOK.lead, prefix: TOK.prefix, prompt: TOK.prompt });
    fs.writeFileSync(FILES.tokenizer, bytes);
    console.log(`tokenizer stream: ${num(bytes.length)} bytes, the prompt's ${TOK.prefix.length} ids before the question in it`);
  }
  if (!want('stream') && !want('ref')) return;
  t = now();
  console.log(`free memory ${gib(os.freemem())}`);
  const { tok, net } = Spec.buildReal(NAME, { rope: TOK.lay.rope }), vnet = VS.build(VR.loadVision(Spec.modelDir(NAME)), sq);
  console.log(`specs built in ${(now() - t).toFixed(1)} s, ${gib(process.memoryUsage().rss)} in use`);
  if (want('stream')) {
    t = now();
    const kinds = { ...G.kinds, vision: visionKind(vp, vnet, net) };
    for (const [part, file] of [[parts[0], FILES.weights], [parts[1], FILES.visionWeights]]) {
      const tmp = file + '.tmp', n = packToFile(arch, net, part, kinds, tmp);
      if (n !== streamBytes(part)) throw new Error('the stream has another length than the plan says');
      fs.renameSync(tmp, file);
      console.log(`${path.basename(file)}: ${num(n)} bytes written  [${(now() - t).toFixed(1)} s]`);
    }
  }
  if (want('ref')) {
    const ref = { model: NAME, vision: true, maxNew: MAX_NEW, programChars: G.length, questions: [] };
    for (const [picture, question] of QUESTIONS) {
      t = now();
      const ids = tok.encode(TOK.prompt(question)), bytes = VR.squares(VR.readPng(path.join(PICTURES, picture + '.png')), V.P, V.merge).bytes;
      if (ids.slice(0, TOK.prefix.length).join() !== TOK.prefix.join()) throw new Error('the prompt does not start with the prefix');
      const a = specAnswer(net, vnet, ids, TOK.lay.start, V.imageToken, V.out, bytes, MAX_NEW);
      ref.questions.push({ picture, question, ids, newIds: a.ids, ended: a.ended, text: tok.decode(a.ids) });
      console.log(`> [${picture}] ${question}  (${ids.length} prompt ids)\n  ${JSON.stringify(tok.decode(a.ids))}  [${a.ids.length} ids; ${(now() - t).toFixed(0)} s]`);
      fs.writeFileSync(FILES.ref, JSON.stringify(ref));
    }
    console.log(`${FILES.ref} written; ${JSON.stringify(net.stats)}; vision: ${JSON.stringify(vnet.stats)}`);
  }
}

module.exports = { NAME, FILES, DATA, SIDE, QUESTIONS, plan, generate, inputBytes, layoutSquares, tokOptions, specAnswer };
if (require.main === module) main();
