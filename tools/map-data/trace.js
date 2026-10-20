#!/usr/bin/env node
// Runs a real program on one question and counts where the steps go: trace-<name>.json.
//   node tools/map-data/trace.js small                                  its default question, into trace-france.json
//   node tools/map-data/trace.js 1.5b "What is 12 + 30?" sum --max 25   this question, into trace-sum.json, for 25 positions at most
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build, sections } = require('./instrument');
const { modelOf, ROOT, num, gib } = require('./models');
const BF = require(path.join(ROOT, 'compiler', 'core', 'bf'));

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const MAXPOS = Number(opt('--max') || Infinity);
const MODEL = modelOf(args[0]);
const question = args[1] || (MODEL.family === 'smol' ? 'What is the capital of France?' : 'What is 12 + 30?');
const name = args[2] || (MODEL.family === 'smol' ? 'france' : 'sum');
const t0 = Date.now();
const lap = (s) => console.log(`${s}  [${((Date.now() - t0) / 1000).toFixed(0)} s]`);

const { ADD, OUT, IN, JZ, JNZ, CLEAR, MUL1, MUL2, MULN, compile } = require('./interp');

// ---- the program
console.log(`model ${MODEL.id}, question ${JSON.stringify(question)}${MAXPOS < Infinity ? ', at most ' + MAXPOS + ' positions' : ''}; free memory ${gib(os.freemem())}`);
MODEL.checkMemory();
let G = build(MODEL.id);
const secs = sections(G);
const rest = MODEL.readEngine(G);
const prog = compile(rest);
{
  const ref = BF.compile(G.restSrc);
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  if (ref.length !== prog.length || !same(ref.T, prog.T) || !same(ref.N, prog.N) || !same(ref.M, prog.M) || !same(ref.X, prog.X)) throw new Error('not the instructions of bf.js compile');
}
G = null;                                             // lets the generator's text go before the long run
lap(`engine: ${num(rest.length)} characters = ${num(prog.length)} instructions (equal to bf.js compile)`);
const NS = secs.length, stageOf = new Uint8Array(prog.length);
{ let s = 0; for (let i = 0; i < prog.length; i++) { while (prog.AT[i] >= secs[s].to) s++; stageOf[i] = s; } }
const idOf = (id) => secs.findIndex((s) => s.id === id);
// The steps are counted by the name of a section. In Qwen3.5 the text of a step is written once for every place in
// the group of layers (u0.xn1, u1.xn1, ...): those copies share one name (xn1), and their counts are added.
const keyOf = (s) => s.key || s.id, KEYS = [...new Set(secs.map(keyOf))], NK = KEYS.length, keyIx = Int32Array.from(secs, (s) => KEYS.indexOf(keyOf(s)));
const TAKE = idOf('take'), XN1 = secs.findIndex((s) => keyOf(s) === 'xn1'), XOUT = secs.findLastIndex((s) => s.u !== undefined || s.id === 'xout');
const layerKeys = [...new Set(secs.slice(XN1, XOUT + 1).map(keyOf))], OWN = KEYS.length !== NS;

// ---- the tape
const first = MODEL.runWriter();
const tape = first.tape;
lap(`writing part run: ${num(tape.length)} cells`);

// ---- the run
const REF = MODEL.ref(), fixed = REF.prefix, refCase = REF.cases.find((c) => c.question === question);
const input = MODEL.questionBytes(question);
const { T, N, M, X, length } = prog, size = tape.length;
const kinds = new Float64Array(NS * 16);           // steps per section and kind of instruction
const ev = [];
const samples = [];                                // steps, pointer: every SAMPLE steps
const SAMPLE = 1 << 21;
const outBytes = [], outAt = [];
let p = first.pointer, pc = 0, inPos = 0, steps = 0, v = 0, k = 0, last = 255, lo = p, hi = p, s = 0, started = 0, saved = 0, takeAt = 0, stopped = false;
const cnt = new Uint32Array(NS * 16);              // moved into kinds before it can overflow
const flush = () => { for (let i = 0; i < cnt.length; i++) { kinds[i] += cnt[i]; cnt[i] = 0; } };
let batches = 0, told = Date.now();
const kindNames = ['add', 'print', 'read', 'loop test at [', 'loop test at ]', 'clear', 'multiply loop, 1 target', 'multiply loop, 2 targets', 'multiply loop, 3 or more', 'move only'];

function save(complete, list, endSteps, endP, endLo, endHi) {
  const all = list.concat([255, endSteps, endP, endLo, endHi]);
  const E = [];
  for (let i = 0; i + 5 < all.length; i += 5) E.push({ s: all[i], from: all[i + 1], to: all[i + 6], p0: all[i + 2], lo: Math.min(all[i + 2], all[i + 8]), hi: Math.max(all[i + 2], all[i + 9]) });
  const positions = [];
  let cur = null, layer = -1;
  const before = new Float64Array(NK);
  for (const e of E) {
    const k = keyIx[e.s];
    if (e.s === TAKE) { cur = { from: e.from, steps: new Float64Array(NK), text: new Float64Array(NS), layers: [], events: [] }; positions.push(cur); layer = -1; }
    if (!cur) { before[k] += e.to - e.from; continue; }
    if (keyIx[e.s] === keyIx[XN1]) { layer++; cur.layers.push(new Float64Array(NK)); }
    const inLayer = e.s >= XN1 && e.s <= XOUT;
    cur.steps[k] += e.to - e.from; cur.text[e.s] += e.to - e.from; cur.to = e.to;
    if (inLayer) cur.layers[layer][k] += e.to - e.from;
    cur.events.push([k, inLayer ? layer : -1, e.from - cur.from, e.to - e.from, e.p0, e.lo, e.hi]);
  }
  if (!positions.length) return null;
  const outPos = outAt.map((at) => positions.findIndex((q) => at >= q.from && at < q.to));
  const printed = positions.map((q, i) => Buffer.from(outBytes.filter((_, j) => outPos[j] === i)).toString('utf8'));
  const firstPrint = printed.findIndex((t) => t.length > 0);
  const jIndex = Math.min(positions.length - 1, Math.max(0, firstPrint));
  const J = positions[jIndex];
  const detailSamples = [];
  for (let i = 0; i < samples.length; i += 2) if (samples[i] >= J.from && samples[i] <= J.to) detailSamples.push(samples[i] - J.from, samples[i + 1]);
  // a few thousand points are enough for the picture of the path
  const thin = Math.max(1, Math.ceil(detailSamples.length / 2 / 4000)), dSamples = [];
  for (let i = 0; i < detailSamples.length; i += 2 * thin) dSamples.push(detailSamples[i], detailSamples[i + 1]);
  const text = Buffer.from(outBytes).toString('utf8');
  const out = {
    made: 'tools/map-data/trace.js', model: MODEL.id, question, answer: text, complete, maxPositions: MAXPOS < Infinity ? MAXPOS : null,
    sameAsReference: !!refCase && (complete ? refCase.text === text : refCase.text.startsWith(text)), reference: refCase ? REF.file : null, referenceText: refCase ? refCase.text : null,
    inputBytes: input.length, steps: endSteps, fixedPositions: fixed, sections: KEYS,
    ...(OWN ? { textSections: secs.map((x) => x.id) } : {}),
    beforeFirstPosition: Array.from(before),
    kindNames, kinds: KEYS.map((_, k) => { const r = new Array(10).fill(0); secs.forEach((x, i) => { if (keyIx[i] === k) for (let j = 0; j < 10; j++) r[j] += kinds[i * 16 + j] + cnt[i * 16 + j]; }); return r; }),
    positions: positions.map((q, i) => ({ position: fixed + i, steps: Array.from(q.steps), ...(OWN ? { textSteps: Array.from(q.text) } : {}), total: q.to - q.from, layers: q.layers.length, printed: printed[i] })),
    detail: {
      position: fixed + jIndex, printed: printed[jIndex], total: J.to - J.from,
      layers: J.layers.map((l) => layerKeys.map((key) => l[KEYS.indexOf(key)])), layerSections: layerKeys,
      events: J.events,
      samples: dSamples, sampleEvery: SAMPLE * thin,
    },
  };
  fs.writeFileSync(path.join(MODEL.dir, `trace-${name}.json`), JSON.stringify(out));
  { // the list of runs the page may use
    const list = path.join(MODEL.dir, 'traces.json'), have = fs.existsSync(list) ? JSON.parse(fs.readFileSync(list, 'utf8')) : [];
    if (!have.includes(name)) { have.push(name); fs.writeFileSync(list, JSON.stringify(have)); }
  }
  return { out, jIndex, printed };
}

run: while (pc < length) {
  let n = 0;
  for (; n < SAMPLE && pc < length; n++) {
    p += M[pc];
    s = stageOf[pc];
    if (s !== last) {
      if (s === TAKE) { if (++started > MAXPOS) { p -= M[pc]; steps += n; stopped = true; break run; } takeAt = ev.length; }
      ev.push(s, steps + n, p, lo, hi); last = s; lo = hi = p;
    } else if (p < lo) lo = p; else if (p > hi) hi = p;
    const t = T[pc];
    cnt[(s << 4) | t]++;
    switch (t) {
      case ADD: tape[p] += N[pc]; pc++; break;
      case JZ: pc = tape[p] === 0 ? N[pc] : pc + 1; break;
      case JNZ: pc = tape[p] !== 0 ? N[pc] : pc + 1; break;
      case CLEAR: tape[p] = 0; pc++; break;
      case MUL1: v = tape[p]; if (v !== 0) { k = N[pc]; tape[p + X[k]] += Math.imul(v, X[k + 1]); tape[p] = 0; } pc++; break;
      case MUL2: v = tape[p]; if (v !== 0) { k = N[pc]; tape[p + X[k]] += Math.imul(v, X[k + 1]); tape[p + X[k + 2]] += Math.imul(v, X[k + 3]); tape[p] = 0; } pc++; break;
      case MULN: v = tape[p]; if (v !== 0) { k = N[pc]; for (let end = k + 1 + 2 * X[k], q = k + 1; q < end; q += 2) tape[p + X[q]] += Math.imul(v, X[q + 1]); tape[p] = 0; } pc++; break;
      case OUT: outBytes.push(tape[p] & 255); outAt.push(steps + n); pc++; break;
      case IN: tape[p] = inPos < input.length ? input[inPos++] : 0; pc++; break;
      default: pc++;
    }
  }
  steps += n;
  if (p < 0 || p >= size) throw new Error('pointer left the tape');
  samples.push(steps, p);
  if (++batches % 1000 === 0) flush();
  if (started - 1 > saved) {                             // a position has ended: note what is known so far
    saved = started - 1;
    const z = takeAt + 5, r = save(false, ev.slice(0, takeAt), ev[z - 4], ev[z - 3], ev[z - 2], ev[z - 1]);
    if (r) { const q = r.out.positions[saved - 1]; lap(`  position ${q.position} done: ${num(q.total)} steps ${JSON.stringify(q.printed)}`); }
  }
  if (Date.now() - told > 60000) { told = Date.now(); lap(`  ${num(steps)} steps, output so far ${JSON.stringify(Buffer.from(outBytes).toString('utf8'))}`); }
}
flush();
const text = Buffer.from(outBytes).toString('utf8');
lap(`${stopped ? 'stopped after ' + MAXPOS + ' positions' : 'done'}: ${num(steps)} steps, pointer on ${p}, printed ${JSON.stringify(text)}`);
if (refCase && (stopped ? !refCase.text.startsWith(text) : refCase.text !== text)) throw new Error('the printed text is not the reference answer: ' + JSON.stringify(refCase.text));

const R = save(!stopped, ev, steps, p, lo, hi);
lap(`trace-${name}.json: ${R.out.positions.length} positions, ${num(R.out.positions.reduce((a, q) => a + q.total, 0) / R.out.positions.length)} steps per position on average; detail for position ${fixed + R.jIndex} (${JSON.stringify(R.printed[R.jIndex])})`);
for (const q of R.out.positions) console.log(`  position ${q.position}: ${num(q.total)} steps, ${q.layers} layers ${JSON.stringify(q.printed)}`);
