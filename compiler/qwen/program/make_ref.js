'use strict';

// The reference answers to the test questions from the whole-number spec (and the weight stream when it is not there yet).

const fs = require('fs');
const os = require('os');
const Spec = require('../engine/spec');
const { packToFile } = require('../engine/pack');
const { loadTokenizer } = require('../tokenizer/ref');
const { OUT, files, generate, num, gib, now } = require('./common');

// brnfck-qwen2.5-coder-0.5b answers with a brainfuck program: challenges of site/challenges/ that the spec solves
const CODER = [
  'Print the input backwards: hello becomes olleh. The input can be empty and never holds the character with number 0.',
  'Print ABC. There is no input.',
  'Read two characters and print them in the opposite order.',
  'Print Y if the input holds at least one character, and N if it is empty.',
  'Print the input followed by the input backwards: abc becomes abccba. The input can be empty and never holds the character with number 0.',
  'The input is made of small letters a to z only. Print it in capitals: hello becomes HELLO. The input can be empty.',
];
const QUESTIONS = process.argv[2] === 'coder-0.5b' ? CODER : [
  'What is 12 + 30?',
  'What is 7 times 8?',
  'What is the capital of France?',
  'Wat is de hoofdstad van Nederland?',
  'Hoeveel is 12 plus 30?',
  'Leg in een zin uit wat een computer is.',
  'I am planning a small vegetable garden behind my house this spring, and I would like to know which three vegetables are the easiest to grow for a complete beginner. Can you name them?',
  'Hello',
  'Waar ligt Leeuwarden?',
];
// the whole program for the coder (its answers are short), the first 30 ids for the chat models
const MAX_NEW = process.argv[2] === 'coder-0.5b' ? 80 : 30;

function main() {
  const model = process.argv[2] || '0.5b', FILES = files(model);
  fs.mkdirSync(OUT, { recursive: true });
  if (process.argv.includes('--max-old')) throw new Error('usage: node compiler/qwen/program/make_ref.js 0.5b|1.5b');
  console.log(`model ${model}; free memory ${gib(os.freemem())}`);
  let t = now();
  const { layout, src } = generate(model);
  const { net, shape, tok: etok } = Spec.buildReal(model);
  console.log(`spec built in ${(now() - t).toFixed(1)} s, ${gib(process.memoryUsage().rss)} in use`);
  const tok = loadTokenizer(Spec.modelDir(model)), NP = net.prefix.n;
  if (tok.encode(tok.chatPrefix).join() !== net.prefix.ids.join()) throw new Error('the two tokenizer references disagree about the fixed prefix');

  if (!fs.existsSync(FILES.weights)) {
    t = now();
    const tmp = FILES.weights + '.tmp', bytes = packToFile(shape, net, layout, tmp);
    fs.renameSync(tmp, FILES.weights);
    console.log(`${FILES.weights}: ${num(bytes)} bytes written in ${(now() - t).toFixed(1)} s`);
  } else console.log(`${FILES.weights}: ${num(fs.statSync(FILES.weights).size)} bytes (already there)`);

  const old = fs.existsSync(FILES.ref) ? JSON.parse(fs.readFileSync(FILES.ref, 'utf8')) : null;
  const ref = { model, maxNew: MAX_NEW, prefix: NP, prefixIds: net.prefix.ids, programChars: src.length, weightBytes: fs.statSync(FILES.weights).size, questions: [] };
  QUESTIONS.forEach((question, qi) => {
    const had = old && old.maxNew === MAX_NEW && old.questions.find((e) => e.question === question && (qi > 0 || e.trace));
    if (had) { ref.questions.push(had); console.log(`> ${question}\n  (cached) ${JSON.stringify(had.text)}`); return; }
    t = now();
    const all = tok.encode(tok.chatPrompt(question));
    if (all.join() !== etok.encode(etok.chatPrompt(question)).join()) throw new Error('the two tokenizer references disagree about this prompt');
    if (all.slice(0, NP).join() !== net.prefix.ids.join()) throw new Error('prompt does not start with the fixed prefix');
    const newIds = Spec.generateIds(net, all, MAX_NEW), ended = newIds.length < MAX_NEW;
    const bytes = Buffer.from(newIds.flatMap((id) => tok.tokenBytes(id)));
    const e = { question, promptIds: all.slice(NP), newIds, ended, printing: newIds.filter((id) => tok.tokenBytes(id).length > 0).length, text: bytes.toString('utf8'), hex: bytes.toString('hex') };
    if (qi === 0) {
      // the first position that is run, stage by stage (as compiler/qwen/engine/build_real.js keeps it)
      const cache = net.step.newCache(), tr = {}, L = shape.layers;
      const logits = net.step(cache, all[NP], NP, true, (nm, l, v) => { (tr[nm] ||= {})[l] = v; });
      const pick = Spec.argmax(logits);
      e.trace = { emb: tr.emb[-1], xn1_0: tr.xn1[0], qraw_0: tr.qraw[0], kraw_0: tr.kraw[0], v_0: tr.v[0], q_0: tr.q[0], k_0: tr.k[0], tot_0: tr.tot[0], mixed_0: tr.mixed[0], xatt_0: tr.xatt[0], xn2_0: tr.xn2[0], hid_0: tr.hid[0],
        xout: Object.keys(tr.xout).map((l) => tr.xout[l]), mixed_last: tr.mixed[L - 1], hid_last: tr.hid[L - 1], xnf: tr.xnf[-1], pick };
    }
    ref.questions.push(e);
    const positions = all.length - NP + newIds.length;
    console.log(`> ${question}  (${all.length - NP} prompt ids after the prefix)\n  ${JSON.stringify(e.text)}  [${newIds.length} ids${ended ? ', end of turn' : ''}; ${(now() - t).toFixed(0)} s, ${((now() - t) / positions).toFixed(2)} s per position]`);
    fs.writeFileSync(FILES.ref, JSON.stringify({ ...ref, scoreOverflow: net.stats.scoreOverflow || 0 }));
  });
  ref.scoreOverflow = net.stats.scoreOverflow || 0;
  fs.writeFileSync(FILES.ref, JSON.stringify(ref));
  console.log(`${FILES.ref} written; attention scores beyond 2^scoreBits in the spec: ${ref.scoreOverflow}; peak memory ${gib(process.resourceUsage().maxRSS * 1024)}`);
}

if (require.main === module) main();
