'use strict';

// How far deltanet.js drifts from the float model over data/seq256.json, each layer fed the float model's own inputs.
//   node compiler/qwen3.5/reference/drift.js [--sweep (other bit widths) | --e2e[={json}] (inside the float model)]

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const F = require('./float');
const DN = require('./deltanet');

const DIR = F.modelDir();
const SEQ = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'seq256.json'), 'utf8'));
const N = SEQ.ids.length, CHECK = [15, 63, 127, 255].filter((t) => t < N);
const CAP = path.join(__dirname, 'out', 'capture');
const capFile = (l) => path.join(CAP, `L${l}.bin`);

// ---------------------------------------------------------------- float capture

// The float model's inputs, outputs and states of every linear layer, kept in out/capture/ after the first run.
function capture() {
  const m = F.loadModel(DIR), lin = m.types.flatMap((t, l) => (t === 'lin' ? [l] : []));
  const S = m.nv * m.dk * m.dv, per = 2 * N * m.dim + CHECK.length * S;
  const buf = Object.fromEntries(lin.map((l) => [l, new Float32Array(per)]));
  const cache = F.newCache(m), t0 = Date.now();
  for (let pos = 0; pos < N; pos++) {
    F.forward(m, cache, SEQ.ids[pos], pos, false, (name, l, arr) => {
      if (!buf[l]) return;
      if (name === 'xnAtt') buf[l].set(arr, pos * m.dim);
      if (name === 'mixOut') buf[l].set(arr, (N + pos) * m.dim);
    });
    const c = CHECK.indexOf(pos);
    if (c >= 0) for (const l of lin) buf[l].set(cache.S[l], 2 * N * m.dim + c * S);
    if (pos % 32 === 31) process.stdout.write(`\r[float capture ${pos + 1}/${N}, ${((Date.now() - t0) / 1000).toFixed(0)} s]`);
  }
  console.log();
  fs.mkdirSync(CAP, { recursive: true });
  for (const l of lin) fs.writeFileSync(capFile(l), Buffer.from(buf[l].buffer));
  fs.writeFileSync(path.join(CAP, 'meta.json'), JSON.stringify({ ids: SEQ.ids, lin, check: CHECK }));
}

// ---------------------------------------------------------------- one layer, one setting

function relErr(x, ref) {
  let d = 0, r = 0;
  for (let i = 0; i < ref.length; i++) { d += (x[i] - ref[i]) ** 2; r += ref[i] ** 2; }
  return Math.sqrt(d / r);
}

function runLayer(l, options) {
  const src = F.openWeights(DIR);
  const net = DN.build(src, l, options);
  src.close();
  const { dim } = src, S = src.nv * src.dk * src.dv;
  const cap = new Float32Array(fs.readFileSync(capFile(l)).buffer.slice(0));
  const out = new Float64Array(dim), err = [], state = [];
  for (let t = 0; t < N; t++) {
    net.mixer(cap.subarray(t * dim, (t + 1) * dim), out);
    err.push(relErr(out, cap.subarray((N + t) * dim, (N + t + 1) * dim)));
    const c = CHECK.indexOf(t);
    if (c >= 0) state.push(relErr(net.state(), cap.subarray(2 * N * dim + c * S, 2 * N * dim + (c + 1) * S)));
  }
  return { l, err, state, overflow: net.stats.overflow + DN.CLAMPS.n, renorm: net.stats.renorm };
}

// all linear layers for one setting, on worker threads
async function runAll(options, lin) {
  const results = [], queue = lin.slice(), threads = Math.min(lin.length, Math.max(1, os.cpus().length - 2));
  await Promise.all(Array.from({ length: threads }, async () => {
    while (queue.length) {
      const l = queue.shift();
      results.push(await new Promise((resolve, reject) => {
        const w = new Worker(__filename, { workerData: { l, options }, argv: process.argv.slice(2) });
        w.once('message', resolve); w.once('error', reject);
      }));
    }
  }));
  return results.sort((a, b) => a.l - b.l);
}

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const pct = (v) => (100 * v).toFixed(2).padStart(6) + '%';

function summary(rs) {
  return {
    outMean: mean(rs.map((r) => mean(r.err))), outWorst: Math.max(...rs.map((r) => mean(r.err))),
    outLast: mean(rs.map((r) => mean(r.err.slice(-64)))),
    state255: mean(rs.map((r) => r.state[r.state.length - 1])), stateWorst: Math.max(...rs.map((r) => r.state[r.state.length - 1])),
    overflow: rs.reduce((s, r) => s + r.overflow, 0),
  };
}

// ---------------------------------------------------------------- whole model

function e2e(options) {
  const m = F.loadModel(DIR), tok = F.loadTokenizer(DIR), src = F.openWeights(DIR);
  const nets = m.types.map((t, l) => (t === 'lin' ? DN.build(src, l, options) : null));
  src.close();
  const mixers = nets.map((n) => n && n.mixer);
  // teacher forced over the conversation: does the next token stay the same?
  const cf = F.newCache(m), ci = F.newCache(m);
  let same = 0, n = 0, kl = 0;
  const t0 = Date.now();
  for (let pos = 0; pos < N - 1; pos++) {
    const want = pos >= SEQ.prompt - 1;
    const lf = F.forward(m, cf, SEQ.ids[pos], pos, want), li = F.forward(m, ci, SEQ.ids[pos], pos, want, null, mixers);
    if (!want) continue;
    n++;
    const af = F.argmax(lf), ai = F.argmax(li);
    if (af === ai) same++;
    // KL(float || whole numbers) of the next-token distributions
    const mf = lf[af], mi = li[ai];
    let zf = 0, zi = 0;
    for (let i = 0; i < lf.length; i++) { zf += Math.exp(lf[i] - mf); zi += Math.exp(li[i] - mi); }
    let k = 0;
    for (let i = 0; i < lf.length; i++) { const p = Math.exp(lf[i] - mf) / zf; if (p > 1e-12) k += p * (lf[i] - mf - Math.log(zf) - (li[i] - mi - Math.log(zi))); }
    kl += k;
    if (n % 32 === 0) process.stdout.write(`\r[${n} positions, ${((Date.now() - t0) / 1000).toFixed(0)} s]`);
  }
  console.log(`\nteacher forced over ${n} answer positions: same next token ${same}/${n} (${pct(same / n)}), mean KL ${(kl / n).toFixed(5)} nats`);
  for (const qn of ['What is the capital of France?', 'What is pi?', 'Wat is de hoofdstad van Nederland?', 'Name three primary colors.']) {
    for (const nt of nets) if (nt) nt.reset();
    const ids = F.generateIds(m, tok.encode(tok.chatPrompt(qn)), 40, tok.stop, mixers);
    console.log(`\n> ${qn}\n${tok.decode(ids)}`);
  }
}

// ---------------------------------------------------------------- main

const SWEEP = [
  ['default', {}],
  ['decay multiplied into St every token (DB 15)', { decay: 'direct', DB: 15 }],
  ['weights 10 bits', { weightBits: 10, xBits: 19 }],
  ['weights 12 bits', { weightBits: 12, xBits: 17 }],
  ['state SB 15, keys KB 10', { SB: 15, sBits: 23, KB: 10 }],
  ['state SB 14, keys KB 11', { SB: 14, sBits: 22, KB: 11 }],
  ['state SB 13, keys KB 12', { SB: 13, sBits: 21, KB: 12 }],
  ['after the convolution CB 10', { CB: 10, cBits: 18 }],
  ['queries QB 12', { QB: 12 }],
  ['queries QB 15, state SB 15, keys KB 10', { QB: 15, SB: 15, sBits: 23, KB: 10 }],
  ['decay and D at DB 10', { DB: 10, DQB: 10 }],
  ['log decay LB 4, AB 4', { LB: 4, AB: 4, aBits: 10 }],
  ['beta TB 6', { TB: 6 }],
  ['output of the state OB 16', { OB: 16, oBits: 17 }],
  ['out_proj input HB 8', { HB: 8, hBits: 16 }],
];

async function main() {
  if (!fs.existsSync(path.join(CAP, 'meta.json')) || JSON.parse(fs.readFileSync(path.join(CAP, 'meta.json'))).ids.join() !== SEQ.ids.join()) capture();
  const { lin } = JSON.parse(fs.readFileSync(path.join(CAP, 'meta.json')));
  const e = process.argv.find((a) => a.startsWith('--e2e'));
  if (e) return e2e(e.includes('=') ? JSON.parse(e.slice(6)) : {}); // --e2e='{"weightBits":12,"xBits":17}' for other settings
  if (process.argv.includes('--sweep')) {
    console.log('setting'.padEnd(48) + 'out err  (worst layer, last 64)   state err @255 (worst)  overflows and clamps');
    for (const [name, opt] of SWEEP) {
      let s;
      try { s = summary(await runAll(opt, lin)); } catch (e) { console.log(name.padEnd(48) + 'not possible: ' + e.message); continue; }
      console.log(name.padEnd(48) + `${pct(s.outMean)} (${pct(s.outWorst)}, ${pct(s.outLast)})   ${pct(s.state255)} (${pct(s.stateWorst)})   ${s.overflow}`);
    }
    return;
  }
  const rs = await runAll({}, lin);
  console.log('layer  out err mean   max   last 64    state err @' + CHECK.join(' @') + '    renorms  overflows+clamps');
  for (const r of rs) {
    console.log(String(r.l).padStart(5) + '  ' + pct(mean(r.err)) + ' ' + pct(Math.max(...r.err)) + ' ' + pct(mean(r.err.slice(-64))) +
      '    ' + r.state.map(pct).join(' ') + '   ' + String(r.renorm).padStart(6) + '  ' + r.overflow);
  }
  const s = summary(rs);
  console.log(`all    ${pct(s.outMean)}         ${pct(s.outLast)}    state @255 ${pct(s.state255)}, overflows ${s.overflow}`);
  // the error per 32 tokens, to see whether it grows
  console.log('out err per 32 tokens (mean over layers): ' + Array.from({ length: N / 32 }, (_, i) => pct(mean(rs.map((r) => mean(r.err.slice(32 * i, 32 * i + 32)))))).join(' '));
}

if (isMainThread) main();
else parentPort.postMessage(runLayer(workerData.l, workerData.options));
