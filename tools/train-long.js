'use strict';

// A long training run inside brainfuck, pass by pass, that can stop and go on; reference.js runs alongside, must agree.
//   node tools/train-long.js shakespeare [--passes 12] [--status] [--dir <folder>] [--chars <n>]

const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const S = require('../compiler/train/spec');
const R = require('../compiler/train/reference');
const { trainingText, shakespeare } = require('../compiler/train/data');

// ---- the reference, in a thread of its own --------------------------------------------------------

if (!isMainThread) {
  const { key, pass, fromFile, chars } = workerData, m = S.MODELS[key];
  const from = fromFile ? JSON.parse(fs.readFileSync(fromFile, 'utf8')) : null;
  if (from) from.params = unpack(m, from.params);
  const text = cut(trainingText(m, [pass - 1, pass]), chars, m);
  let lines = [], failed = null, r = null;
  try {
    r = R.train(m, text, {
      from,
      onStep: (step, l) => { lines.push(`step ${step} loss ${R.milli(l)}`); if (lines.length >= 250) { parentPort.postMessage({ type: 'lines', lines }); lines = []; } },
    });
  } catch (e) { failed = String(e.message || e); }
  if (failed) parentPort.postMessage({ type: 'failed', message: failed });
  else {
    parentPort.postMessage({ type: 'lines', lines, done: true });
    parentPort.postMessage({ type: 'state', state: { step: r.step, ctx: r.ctx, params: pack(r.params) }, held: heldLoss(m, r.params, r.ctx) });
  }
  return;
}

// a pass of at most `chars` characters (a test), in whole batches
function cut(text, chars, m) { return chars ? text.subarray(0, chars - (chars % m.batch)) : text; }

// parameters as plain numbers: [w, v] for every parameter, group by group
function pack(p) { const out = {}; for (const k of Object.keys(p)) out[k] = JSON.parse(JSON.stringify(p[k], (kk, x) => (x && typeof x === 'object' && 'w' in x ? [x.w, x.v] : x))); return out; }
function unpack(m, q) { const wrap = (x) => (Array.isArray(x) && x.length === 2 && typeof x[0] === 'number' && !Array.isArray(x[0]) ? { w: x[0], v: x[1] } : x.map(wrap)); const out = {}; for (const k of Object.keys(q)) out[k] = wrap(q[k]); return out; }

// the loss on the part of the text the training never sees (nats per character), with the weights it has now
function heldLoss(m, p, ctx0) {
  if (m.text !== 'shakespeare') return null;
  const tok = S.tokensOf(m), held = shakespeare().held;
  let ctx = new Array(m.T || m.ctx).fill(0), tot = 0;
  for (let i = 0; i < held.length; i++) {
    const t = tok[held.charCodeAt(i)], { u } = R.forward(m, p, ctx, S.SW), mx = Math.max(...u);
    tot += Math.log(u.reduce((a, x) => a + Math.exp((x - mx) / 16), 0)) - (u[t] - mx) / 16;
    ctx = [...ctx.slice(1), t];
  }
  return tot / held.length;
}

// ---- the brainfuck run -------------------------------------------------------------------------------

const { Gen, childWriting, layout } = require('../compiler/train/gen');
const { regionValues, SL, W, VEL } = require('../compiler/train/layout');
const BFWasm = require('../site/runtime/bfwasm');

const args = process.argv.slice(2);
const key = args.find((a) => !a.startsWith('--')) || 'shakespeare';
const opt = (name) => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
const m = S.MODELS[key];
if (!m) throw new Error(`no model ${key}`);
const DIR = opt('--dir') ? path.resolve(opt('--dir')) : path.join(__dirname, '..', 'compiler', 'train', 'out', 'long', m.name);
fs.mkdirSync(DIR, { recursive: true });
const STATE = path.join(DIR, 'state.json'), LOG = path.join(DIR, 'log.txt');
const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { model: m.name, passes: Number(opt('--passes')) || m.passes || 1, chars: Number(opt('--chars')) || 0, done: [] };
if (opt('--passes') && state.done.length < Number(opt('--passes'))) state.passes = Number(opt('--passes'));
const num = (n) => Math.round(n).toLocaleString('en-US');
const hms = (s) => { s = Math.round(s); const h = Math.floor(s / 3600), mi = Math.floor((s % 3600) / 60); return h ? `${h} h ${String(mi).padStart(2, '0')} min` : `${mi} min ${String(s % 60).padStart(2, '0')} s`; };
const now = () => Number(process.hrtime.bigint()) / 1e9;
const say = (s) => { console.log(s); fs.appendFileSync(LOG, s + '\n'); };

if (args.includes('--status')) {
  console.log(`${m.name}: ${state.done.length} of ${state.passes} passes done`);
  for (const d of state.done) console.log(`  pass ${d.pass}: steps to ${num(d.step)}, ${hms(d.seconds)}, ${d.msPerChar.toFixed(2)} ms per character, loss ${d.loss.toFixed(3)}, held apart ${d.held === null ? '-' : d.held.toFixed(3)}, ${d.equal ? 'equal to the reference' : 'NOT equal: ' + d.note}`);
  process.exit(0);
}

const L = layout(m), file = (n, ext) => path.join(DIR, `pass-${String(n).padStart(2, '0')}.${ext}`);

async function onePass(pass) {
  const t0 = now(), text = cut(trainingText(m, [pass - 1, pass]), state.chars, m), steps = text.length / m.batch;
  const before = pass > 1 ? file(pass - 1, 'json') : null;
  say(`\n== pass ${pass} of ${state.passes}: ${num(text.length)} characters, ${num(steps)} steps${pass > 1 ? ', going on from the tape of pass ' + (pass - 1) : ', from random start weights'}`);

  // the reference, alongside
  const ref = { lines: [], done: false, failed: null, state: null, held: null };
  const worker = new Worker(__filename, { workerData: { key, pass, fromFile: before, chars: state.chars } });
  worker.on('message', (msg) => {
    if (msg.type === 'lines') { ref.lines.push(...msg.lines); if (msg.done) ref.done = true; }
    else if (msg.type === 'failed') { ref.failed = msg.message; say(`   the reference stopped: ${msg.message}`); }
    else if (msg.type === 'state') { ref.state = msg.state; ref.held = msg.held; }
  });
  const refEnded = new Promise((res) => worker.on('exit', res));

  // the program: pass 1 from random start weights; later passes skip the writing part and go on from the saved tape
  const engine = new Gen(m, { child: true }).childEngine();
  const src = new Gen(m).trainer(engine, { resume: pass > 1 }).src;
  const exe = BFWasm.compileSync(src, { cellBits: 32, tapeSize: L.tapeSize });
  if (pass > 1) exe.tape().set(new Uint32Array(fs.readFileSync(file(pass - 1, 'tape')).buffer.slice(0)));
  say(`   ${num(src.length)} characters of brainfuck, compiled in ${(now() - t0).toFixed(1)} s`);

  let buf = '', n = 0, equal = 0, firstBad = null, sum = 0, tShow = now(), lastStep = 0;
  const mine = [];
  const startStep = pass > 1 ? state.done[pass - 2].step : 0;
  const tRun = now();
  const r = exe.run(text, {
    keep: pass > 1, flushEvery: 256,
    onOutput: (bytes) => {
      if (n >= steps) return;
      buf += Buffer.from(bytes).toString('latin1');
      let nl;
      while (n < steps && (nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1); mine.push(line); n++;
        const l = /loss (\d+)\.(\d+)$/.exec(line); if (l) sum += Number(l[1] + '.' + l[2]);
      }
      // compare with the lines of the reference that are there
      while (equal + (firstBad === null ? 0 : 0) < Math.min(mine.length, ref.lines.length) && firstBad === null) {
        const i = equal;
        if (mine[i] === ref.lines[i]) equal++; else { firstBad = i; say(`   step ${num(startStep + i + 1)} differs: "${mine[i]}", the reference "${ref.lines[i]}"`); }
      }
      if (now() - tShow > 120 || n === steps) {
        const el = now() - tRun, per = el / Math.max(1, n), left = (steps - n) * per, after = (state.passes - pass) * steps * per;
        say(`   step ${num(startStep + n)} (${(100 * n / steps).toFixed(1)}% of the pass) · loss of the last ${n - lastStep} steps ${(sum / Math.max(1, n - lastStep)).toFixed(3)} · ${(1000 * el / Math.max(1, n * m.batch)).toFixed(2)} ms per character · this pass ${hms(left)} to go, all passes ${hms(left + after)}`);
        tShow = now(); sum = 0; lastStep = n;
      }
    },
  });
  const runS = now() - tRun;
  const out = r.text, child = out.slice(out.lastIndexOf('\n') + 1);
  fs.writeFileSync(file(pass, 'tape'), Buffer.from(new Uint32Array(exe.tape()).buffer));
  fs.writeFileSync(file(pass, 'bf'), child, 'latin1');
  const sample = BFWasm.compileSync(child, { cellBits: 32, tapeSize: L.tapeSize }).run('').text;
  fs.writeFileSync(file(pass, 'sample.txt'), sample);

  // wait for the reference, then compare every line, weight, velocity and the child
  await refEnded;
  while (equal < Math.min(mine.length, ref.lines.length) && firstBad === null) { if (mine[equal] === ref.lines[equal]) equal++; else firstBad = equal; }
  let note = '', ok = !ref.failed && firstBad === null && equal === steps;
  if (ref.failed) note = 'the reference stopped: ' + ref.failed;
  else if (firstBad !== null) note = 'step ' + (startStep + firstBad + 1) + ' differs';
  if (ref.state) {
    fs.writeFileSync(file(pass, 'json'), JSON.stringify(ref.state));
    const p = unpack(m, ref.state.params), tape = exe.tape(), wantW = regionValues(L, p, 'w'), wantV = regionValues(L, p, 'v');
    let bad = 0;
    L.regions.forEach((Rg, i) => { for (let s = 0; s < Rg.regionSlots; s++) { if ((tape[Rg.R0 + s * SL + W] | 0) !== wantW[i][s] || (tape[Rg.R0 + s * SL + VEL] | 0) !== wantV[i][s]) bad++; } });
    if (bad) { ok = false; note += (note ? '; ' : '') + bad + ' weight slots differ'; }
    const wantChild = childWriting(m, p) + engine;
    if (wantChild !== child) { ok = false; note += (note ? '; ' : '') + 'the child differs'; }
  }
  const lossPass = mine.reduce((a, line) => { const l = /loss (\d+\.\d+)$/.exec(line); return a + (l ? Number(l[1]) : 0); }, 0) / Math.max(1, mine.length);
  const d = { pass, step: startStep + n, seconds: now() - t0, run: runS, msPerChar: 1000 * runS / text.length, loss: lossPass, held: ref.held, equal: ok, note, sample: sample.slice(0, 600) };
  state.done.push(d);
  fs.writeFileSync(STATE, JSON.stringify(state, null, 1));
  say(`   pass ${pass} done in ${hms(d.seconds)}: loss ${lossPass.toFixed(3)} (mean of the pass), held apart ${ref.held === null ? '-' : ref.held.toFixed(3)} · ${ok ? 'every line, weight, velocity and the child equal to the reference' : 'NOT equal: ' + note}`);
  say(`   its child, ${num(child.length)} characters, wrote:\n` + sample.split('\n').slice(0, 12).map((x) => '     | ' + x).join('\n'));
  // keep the tapes and states of the last two passes only; every child and its text stays
  for (const old of [pass - 2]) if (old >= 1) for (const ext of ['tape', 'json']) { try { fs.unlinkSync(file(old, ext)); } catch (e) { } }
}

function summary() {
  const lines = [`${m.name}, trained inside brainfuck in ${state.done.length} passes over the first 90% of data/shakespeare.txt`, '',
    `weights                   ${num(S.paramsOf(m).total)}`, `network                   attention over the last ${m.T} characters, the last ${m.ctx} characters into ${m.hidden} hidden units`,
    `learning                  momentum 7/8, learning-rate shift ${m.gs}, weight decay 1/2^${m.decay || '-'} per step, ${m.batch} characters per step`,
    `time                      ${hms(state.done.reduce((a, d) => a + d.seconds, 0))} in the WebAssembly runtime`, '',
    'pass   steps to   time          ms/char   loss    held apart   equal to the reference'];
  for (const d of state.done) lines.push(`${String(d.pass).padStart(4)}   ${num(d.step).padStart(9)}   ${hms(d.run).padEnd(13)} ${d.msPerChar.toFixed(2).padStart(7)}   ${d.loss.toFixed(3)}   ${d.held === null ? '    -' : d.held.toFixed(3).padStart(10)}   ${d.equal ? 'yes' : 'NO: ' + d.note}`);
  for (const d of state.done) lines.push('', `the child of pass ${d.pass} wrote:`, ...d.sample.split('\n').map((x) => '  ' + x));
  fs.writeFileSync(path.join(__dirname, '..', 'compiler', 'train', 'out', `${m.name}.txt`), lines.join('\n') + '\n');
}

(async () => {
  say(`${m.name}: ${num(S.paramsOf(m).total)} weights, ${state.passes} passes, ${state.done.length} done (${new Date().toISOString().slice(0, 16).replace('T', ' ')})`);
  for (let pass = state.done.length + 1; pass <= state.passes; pass++) { await onePass(pass); summary(); }
  summary();
  say(`\nall ${state.passes} passes done. The last child program: ${path.relative(process.cwd(), file(state.passes, 'bf'))}`);
})().catch((e) => { say('stopped: ' + (e.stack || e)); process.exitCode = 1; });
