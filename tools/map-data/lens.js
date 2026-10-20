#!/usr/bin/env node
// Runs a real program on one question and reads its residual stream off the tape after every layer: lens-<name>.json.
// The numbers are checked cell for cell against the whole-number spec. Then, for every position that prints a word piece,
// the program's own output layer (the spec's head()) is applied to the numbers of every layer: the word piece the
// program would print if it stopped there (a "logit lens"). For brnfck-qwen3.5-0.8b the multi-token prediction head of
// the model (compiler/qwen3.5/reference/mtp.js, in floating point) also guesses, from the same numbers, the word piece
// after the next one.
//   node --expose-gc tools/map-data/lens.js small                                  its default question, into lens-france.json
//   node --expose-gc tools/map-data/lens.js 1.5b "What is 12 + 30?" sum --max 9     this question, into lens-sum.json; 9 printed word pieces at most
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build, sections } = require('./instrument');
const { modelOf, ROOT, num, gib } = require('./models');
const { ADD, OUT, IN, JZ, JNZ, CLEAR, MUL1, MUL2, MULN, compile } = require('./interp');

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const MAXPRINT = Number(opt('--max') || Infinity);
const MODEL = modelOf(args[0]);
const question = args[1] || 'What is the capital of France?';
const name = args[2] || 'france';
const TOP = 3;                                      // word pieces kept per layer
const t0 = Date.now();
const lap = (s) => console.log(`${s}  [${((Date.now() - t0) / 1000).toFixed(0)} s]`);
const req = (...p) => require(path.join(ROOT, 'compiler', ...p));

// ---- the program and where the residual rests after each layer
console.log(`model ${MODEL.id}, question ${JSON.stringify(question)}; free memory ${gib(os.freemem())}`);
MODEL.checkMemory();
let G = build(MODEL.id);
const secs = sections(G), E = G.engine, a = E.a, dim = a.dim, layers = a.layers;
const prog = compile(MODEL.readEngine(G));
G = null; E.p.code = null;
// residual() of the engines writes x to the station after the layer: s0 + pre.x, s0 = P + Lo.preD (virtual; real = N - virtual)
const base = (l) => (E.Pof ? E.Pof(l) : E.P0 + l * E.stride), lo = (l) => (E.Lt ? E.Lt[a.types[l]] : E.Lo);
const xCell = Int32Array.from({ length: layers }, (_, l) => E.N - (base(l) + lo(l).preD + E.pre.x));
const tokenCell = E.N - E.gl.TOKEN;
const keyOf = (s) => s.key || s.id, TAKE = secs.findIndex((s) => s.id === 'take'), EMB = secs.findIndex((s) => s.id === 'emb');
const isXout = Uint8Array.from(secs, (s) => keyOf(s) === 'xout');
const stageOf = new Uint8Array(prog.length);
{ let s = 0; for (let i = 0; i < prog.length; i++) { while (prog.AT[i] >= secs[s].to) s++; stageOf[i] = s; } }
lap(`engine: ${num(prog.length)} instructions; ${layers} layers of ${dim} numbers`);

// ---- the run: the writing part, then the engine in JavaScript, noting the token and the residuals of every position
const first = MODEL.runWriter(), tape = first.tape, size = tape.length;
lap(`writing part run: ${num(size)} cells`);
const input = MODEL.questionBytes(question), fixed = MODEL.ref().prefix;
const positions = [];                               // { token, x: [layers][dim], out: bytes printed }
let cur = null, li = 0;
{
  const { T, N, M, X, length } = prog;
  let p = first.pointer, pc = 0, inPos = 0, v = 0, k = 0, last = 255, s = 0, steps = 0, told = Date.now();
  while (pc < length) {
    p += M[pc];
    s = stageOf[pc];
    if (s !== last) {
      if (last !== 255 && isXout[last]) { const x = new Int32Array(dim), c = xCell[li]; for (let i = 0; i < dim; i++) x[i] = tape[c - i] | 0; cur.x.push(x); li++; }
      if (s === TAKE) {
        if (positions.filter((q) => q.out.length).length >= MAXPRINT) break;    // enough printed word pieces: the run stops here
        cur = { token: -1, x: [], out: [] }; positions.push(cur); li = 0;
      }
      if (s === EMB) cur.token = tape[tokenCell] | 0;
      last = s;
    }
    switch (T[pc]) {
      case ADD: tape[p] += N[pc]; pc++; break;
      case JZ: pc = tape[p] === 0 ? N[pc] : pc + 1; break;
      case JNZ: pc = tape[p] !== 0 ? N[pc] : pc + 1; break;
      case CLEAR: tape[p] = 0; pc++; break;
      case MUL1: v = tape[p]; if (v !== 0) { k = N[pc]; tape[p + X[k]] += Math.imul(v, X[k + 1]); tape[p] = 0; } pc++; break;
      case MUL2: v = tape[p]; if (v !== 0) { k = N[pc]; tape[p + X[k]] += Math.imul(v, X[k + 1]); tape[p + X[k + 2]] += Math.imul(v, X[k + 3]); tape[p] = 0; } pc++; break;
      case MULN: v = tape[p]; if (v !== 0) { k = N[pc]; for (let end = k + 1 + 2 * X[k], q = k + 1; q < end; q += 2) tape[p + X[q]] += Math.imul(v, X[q + 1]); tape[p] = 0; } pc++; break;
      case OUT: cur.out.push(tape[p] & 255); pc++; break;
      case IN: tape[p] = inPos < input.length ? input[inPos++] : 0; pc++; break;
      default: pc++;
    }
    if ((++steps & 0xfffffff) === 0) {
      if (p < 0 || p >= size) throw new Error('pointer left the tape');
      if (Date.now() - told > 60000) { told = Date.now(); lap(`  ${num(steps)} steps, ${positions.length} positions`); }
    }
  }
  lap(`done: ${num(steps)} steps, ${positions.length} positions`);
}
first.tape = null;
if (global.gc) global.gc();
for (const q of positions) if (q.x.length !== layers) throw new Error(`a position with ${q.x.length} residuals instead of ${layers}`);
const answer = Buffer.from(positions.flatMap((q) => q.out)).toString('utf8');
lap(`printed ${JSON.stringify(answer)}`);
{
  const ref = MODEL.ref().cases.find((c) => c.question === question);
  if (ref && (MAXPRINT < Infinity ? !ref.text.startsWith(answer) : ref.text !== answer)) throw new Error('the printed text is not the reference answer: ' + JSON.stringify(ref.text));
}

// ---- the spec: the same numbers, and the output layer applied to every layer
function specOf(id) {
  if (MODEL.family === 'smol') {
    const S = req('smollm', 'engine', 'spec'), { m, tok, net } = S.buildReal();
    return { net, step: (c, t, pos, want, tr) => net.step(m, c, t, pos, want, tr), LB: net.cfg.LB, XB: net.cfg.XB, piece: (i) => tok.decode([i], { skipSpecial: false }) };
  }
  if (MODEL.family === 'qwen') {
    const S = req('qwen', 'engine', 'spec'), { net } = S.buildReal(id), tok = req('qwen', 'tokenizer', 'ref').loadTokenizer(S.modelDir(id));
    const added = new Map(tok.added.map((x) => [x.id, x.text]));
    return { net, step: net.step, LB: net.cfg.LB, XB: net.cfg.XB, piece: (i) => (added.has(i) ? added.get(i) : Buffer.from(tok.tokenBytes(i)).toString('utf8')) };
  }
  const S = req('qwen3.5', 'engine', 'spec'), { net, tok } = S.buildReal();
  return { net, step: net.step, LB: net.cfg.LB, XB: net.cfg.XB, piece: (i) => tok.decode([i], { skipSpecial: false }) };
}
const SP = specOf(MODEL.id);
lap('spec built');
const argmax = (v) => { let b = 0; for (let i = 1; i < v.length; i++) if (v[i] > v[b]) b = i; return b; };
// the TOP best word pieces, the chosen one's share and rank; shares from the whole-number scores at LB fraction bits
function readout(logits, chosen) {
  const scale = 2 ** -SP.LB, best = logits[argmax(logits)];
  let sum = 0, rank = 0;
  const top = [];
  for (let i = 0; i < logits.length; i++) {
    sum += Math.exp((logits[i] - best) * scale);
    if (logits[i] > logits[chosen] || (logits[i] === logits[chosen] && i < chosen)) rank++;
    if (top.length < TOP || logits[i] > logits[top[top.length - 1]]) { top.push(i); top.sort((u, w) => logits[w] - logits[u] || u - w); if (top.length > TOP) top.pop(); }
  }
  const share = (i) => Math.exp((logits[i] - best) * scale) / sum;
  return { top: top.map((i) => [i, +share(i).toFixed(4)]), p: +share(chosen).toFixed(4), rank };
}

const cache = SP.net.step.newCache(), lensFrom = positions.findIndex((q) => q.out.length > 0);
if (lensFrom < 0) throw new Error('the program printed nothing');
const rows = [], pieces = new Set();
let compared = 0;
positions.forEach((q, i) => {
  const xs = [];
  const logits = SP.step(cache, q.token, fixed + i, true, (nm, l, v) => { if (nm === 'xout') xs[l] = v; });
  for (let l = 0; l < layers; l++) {
    for (let j = 0; j < dim; j++) if (xs[l][j] !== q.x[l][j]) throw new Error(`position ${fixed + i}, layer ${l}, number ${j}: the tape holds ${q.x[l][j]}, the spec ${xs[l][j]}`);
    compared += dim;
  }
  q.next = argmax(logits);
  if (i < lensFrom) return;
  if (i + 1 < positions.length && positions[i + 1].token !== q.next) throw new Error(`position ${fixed + i}: the spec chooses ${q.next}, the program went on with ${positions[i + 1].token}`);
  const row = { position: fixed + i, token: q.token, next: q.next, printed: Buffer.from(q.out).toString('utf8'), layers: [] };
  for (let l = 0; l < layers; l++) {
    const r = readout(SP.net.head(q.x[l]), q.next);
    row.layers.push(r);
    for (const [id] of r.top) pieces.add(id);
  }
  pieces.add(q.token); pieces.add(q.next);
  rows.push(row);
  lap(`  position ${fixed + i} ${JSON.stringify(row.printed)}: first right at layer ${row.layers.findIndex((r) => r.rank === 0)}`);
});
lap(`the tape equals the spec: ${num(compared)} numbers in ${positions.length} positions x ${layers} layers`);

// ---- the multi-token prediction head (brnfck-qwen3.5-0.8b): its guess at position i is for the word piece at i + 2
let mtp = null;
if (MODEL.family === 'qwen3.5') {
  const F = req('qwen3.5', 'reference', 'float'), H = req('qwen3.5', 'reference', 'mtp'), dir = F.modelDir(['', '', '--model=qwen3.5-0.8b']);
  const m = F.loadModel(dir), head = H.loadHead(dir, m), hc = H.newHeadCache(m);
  const ids = positions.map((q) => q.token).concat([positions[positions.length - 1].next]);   // every token, and the last one chosen
  mtp = { weights: head.weights, guesses: [] };
  for (let i = 0; i + 1 < ids.length; i++) {
    const hidden = F.rmsnorm(Float64Array.from(positions[i].x[layers - 1], (v) => v * 2 ** -SP.XB), m.rmsFinal, m.eps);
    const scores = H.guess(m, head, hc, hidden, ids[i + 1], fixed + i);
    if (i < lensFrom) continue;
    const g = argmax(scores), actual = i + 2 < ids.length ? ids[i + 2] : null;
    let best = -Infinity, sum = 0;
    for (const v of scores) if (v > best) best = v;
    for (const v of scores) sum += Math.exp(v - best);
    mtp.guesses.push({ position: i, guess: g, p: +(1 / sum).toFixed(4), actual, hit: actual === null ? null : g === actual });
    pieces.add(g);
  }
  const known = mtp.guesses.filter((x) => x.hit !== null);
  mtp.right = known.filter((x) => x.hit).length; mtp.of = known.length;
  lap(`multi-token prediction head: ${mtp.right} of ${mtp.of} guesses two ahead right`);
}

const out = {
  made: 'tools/map-data/lens.js', model: MODEL.id, label: MODEL.label, question, answer, complete: MAXPRINT === Infinity, layers, dim,
  checked: { numbers: compared, positions: positions.length, equal: true },
  firstPrinting: fixed + lensFrom, rows, mtp,
  pieces: Object.fromEntries([...pieces].sort((u, w) => u - w).map((id) => [id, SP.piece(id)])),
};
fs.writeFileSync(path.join(MODEL.dir, `lens-${name}.json`), JSON.stringify(out));
{
  const list = path.join(MODEL.dir, 'lenses.json'), have = fs.existsSync(list) ? JSON.parse(fs.readFileSync(list, 'utf8')) : [];
  if (!have.includes(name)) { have.push(name); fs.writeFileSync(list, JSON.stringify(have)); }
}
lap(`lens-${name}.json: ${rows.length} positions, ${Object.keys(out.pieces).length} word pieces; peak memory ${gib(process.resourceUsage().maxRSS * 1024)}`);
