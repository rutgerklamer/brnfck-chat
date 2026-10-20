'use strict';

// reference/vision.js against the Hugging Face code (the files of hf_check.py in out/): the squares, the prompt with
// its picture, the vectors of the vision part, and the greedy answer.
//   node compiler/qwen3.5/vision/check_float.js cat [windmills ...]

const fs = require('fs');
const path = require('path');
const F = require('../reference/float');
const VR = require('../reference/vision');

const OUT = path.join(__dirname, 'out'), PICS = path.join(__dirname, 'pictures');
const f32 = (file) => { const b = fs.readFileSync(file); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };
const rel = (a, b, at, n) => { let d = 0, s = 0; for (let i = 0; i < n; i++) { d += (a[at + i] - b[at + i]) ** 2; s += b[at + i] ** 2; } return Math.sqrt(d / s); };

const DIR = F.modelDir(), V = VR.loadVision(DIR), m = F.loadModel(DIR), tok = F.loadTokenizer(DIR);
let bad = 0;
const check = (ok, what) => { console.log(`  ${ok ? 'ok ' : 'BAD'} ${what}`); if (!ok) bad++; };
for (const name of process.argv.slice(2)) {
  const hf = JSON.parse(fs.readFileSync(path.join(OUT, `hf-${name}.json`), 'utf8'));
  console.log(`${name}: ${JSON.stringify(hf.question)}`);
  const sq = VR.squares(VR.readPng(path.join(PICS, hf.picture)), V.P, V.merge);
  check(hf.grid_thw.join() === [1, sq.gh, sq.gw].join(), `grid ${hf.grid_thw.join(' x ')}`);
  // the squares: the processor's values are v / 127.5 - 1 of our bytes, the same for both frames
  const px = f32(path.join(OUT, `hf-${name}-pixels.f32`)), inN = 3 * V.P * V.P, P2 = V.P * V.P;
  let worst = 0;
  for (let s = 0; s < sq.n; s++) for (let c = 0; c < 3; c++) for (let t = 0; t < 2; t++) for (let i = 0; i < P2; i++) {
    const d = Math.abs(px[s * 2 * inN + (c * 2 + t) * P2 + i] - (sq.bytes[s * inN + c * P2 + i] / 127.5 - 1));
    if (d > worst) worst = d;
  }
  check(worst < 1e-6, `squares in the processor's order, largest difference ${worst.toExponential(2)}`);
  const P = VR.visionPrompt(tok, V, sq, hf.question);
  check(P.ids.join() === hf.input_ids.join(), `prompt: ${P.ids.length} tokens, ${P.images} of them the picture`);
  let t = Date.now();
  const { emb } = VR.encode(V, sq), ref = f32(path.join(OUT, `hf-${name}-emb.f32`));
  const errs = Array.from({ length: P.images }, (_, i) => rel(emb, ref, i * V.out, V.out));
  check(Math.max(...errs) < 1e-4, `vision vectors: relative difference mean ${(errs.reduce((a, b) => a + b, 0) / errs.length).toExponential(2)}, largest ${Math.max(...errs).toExponential(2)} (${((Date.now() - t) / 1000).toFixed(0)} s)`);
  t = Date.now();
  const A = VR.answer(m, V, tok, sq, emb, hf.question, 60);
  const same = A.ids.join() === hf.answer_ids.join();
  check(same, `greedy answer: ${A.ids.length} tokens ${same ? 'the same' : 'differ'} (${((Date.now() - t) / 1000).toFixed(0)} s)`);
  console.log(`  ${JSON.stringify(A.text)}${same ? '' : '\n  HF: ' + JSON.stringify(hf.answer)}`);
}
console.log(bad ? `${bad} BAD` : 'all ok');
process.exit(bad ? 1 : 0);
